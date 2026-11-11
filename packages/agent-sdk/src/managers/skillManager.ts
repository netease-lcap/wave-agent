import { readdir, stat, rm } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { EventEmitter } from "events";
import {
  DEFAULT_IGNORED_MATCHERS,
  FileWatcherService,
  isDotEntry,
  type FileWatcherConfig,
} from "../services/fileWatcher.js";
import type {
  SkillManagerOptions,
  SkillMetadata,
  Skill,
  SkillCollection,
  SkillDiscoveryResult,
  SkillToolArgs,
  SkillInvocationContext,
} from "../types/index.js";
import { parseSkillFile, formatSkillError } from "../utils/skillParser.js";
import { findNestedSkillRoots } from "../utils/nestedSkills.js";
import { substituteDirectoryPlaceholders } from "../utils/directoryPlaceholders.js";
import { substituteCommandParameters } from "../utils/commandArgumentParser.js";
import {
  parseBashCommands,
  replaceBashCommandsWithOutput,
  executeBashCommands,
} from "../utils/markdownParser.js";
import { createBashCommandGate } from "../utils/bashCommandGate.js";
import type { PermissionManager } from "./permissionManager.js";
import { getBuiltinSkillsDir } from "../utils/configPaths.js";
import { isArtifactEnabled } from "../services/artifactAvailability.js";

import { Container } from "../utils/container.js";
import { logger } from "../utils/globalLogger.js";

/**
 * Watcher options for skill hot reload.
 *
 * Skill roots are the one place in the product where **other processes**
 * install into a directory we watch: installers unpack into a staging
 * directory (`.lazy-recipes.install-<uuid>`) and `rename()` it into place.
 *
 * On Windows native `fs.watch` holds a handle per watched directory, and
 * renaming a directory that has a watched *descendant* fails with `EPERM`
 * (verified on a real machine with chokidar 4.0.3: renaming a staging dir
 * that contains a subdirectory fails, one that contains only files succeeds;
 * chokidar upstream calls this unfixable — paulmillr/chokidar#1380). It is a
 * property of *native* watching only: inotify/FSEvents register the subtree
 * without opening per-directory descriptors, so macOS and Linux are fine.
 *
 * Two mitigations, both applied here:
 *  - never watch inside dot-prefixed entries (`isDotEntry`): the staging
 *    directory is dot-named by convention, so it is never touched;
 *  - on Windows, poll instead of using native events (`usePolling`): no
 *    directory handles at all, which also covers the staging names that are
 *    not dot-prefixed and the "rename the existing skill away" upgrade path.
 *    Polling a skills tree is cheap once the walk is bounded (`depth: 2`) and
 *    junk trees are ignored (measured ~1% of one core for 40 skills / 280
 *    entries at a 1s interval, on par with native watching). The price is
 *    latency: it takes ~2s to notice an installed or edited skill there.
 *
 * `depth: 2` is root → `<skill>/` → one nested level: enough to see
 * `<skill>/SKILL.md` and to notice a skill being replaced or removed, without
 * walking a skill that ships a large asset tree.
 */
export function skillWatcherOptions(): Partial<FileWatcherConfig> {
  return {
    depth: 2,
    ignored: [...DEFAULT_IGNORED_MATCHERS, isDotEntry],
    ...(process.platform === "win32"
      ? { usePolling: true, pollInterval: 1000 }
      : {}),
  };
}

/**
 * Manages skill discovery and loading
 */
export class SkillManager extends EventEmitter {
  private personalSkillsPath: string;
  private personalClaudeSkillsPath: string;
  private personalAgentsSkillsPath: string;
  private scanTimeout: number;
  private workdir: string;

  private skillMetadata = new Map<string, SkillMetadata>();
  private skillContent = new Map<string, Skill>();
  private pluginSkillMetadata = new Map<string, SkillMetadata>();
  private pluginSkillContent = new Map<string, Skill>();
  /** Subtree skills, discovered from file operations (see `discoverNestedSkills`). */
  private nestedSkillMetadata = new Map<string, SkillMetadata>();
  private nestedSkillContent = new Map<string, Skill>();
  /** Skill roots discovered from a subtree; watched like the eager roots. */
  private nestedSkillRoots = new Set<string>();
  /** Every `<dir>/<config>/skills` path probed this session — hits *and* misses. */
  private probedSkillDirs = new Set<string>();
  private initialized = false;
  /** Serializes full rescans (initialize / file-watcher events / deleteSkill
   *  convergence). Overlapping scans over the shared caches must not interleave:
   *  chaining them keeps the last completed scan in sync with the newest disk
   *  state instead of letting an older snapshot win a race. */
  private refreshChain: Promise<void> = Promise.resolve();
  /** Coalesces a burst of watcher events into a single rescan. Installing or
   *  upgrading a skill unpacks dozens of files in a few hundred ms; without
   *  this, every event queued its own full rescan on refreshChain (queued, not
   *  merged) and the last one could land seconds after the install finished.
   *  Same 300 ms window Claude Code uses in its skill change detector. */
  private static readonly RELOAD_DEBOUNCE_MS = 300;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private fileWatcher: FileWatcherService | null = null;
  private watchEnabled: boolean;

  constructor(
    private container: Container,
    options: SkillManagerOptions = {},
  ) {
    super();
    this.personalSkillsPath =
      options.personalSkillsPath || join(homedir(), ".wave", "skills");
    this.personalClaudeSkillsPath =
      options.personalClaudeSkillsPath || join(homedir(), ".claude", "skills");
    this.personalAgentsSkillsPath =
      options.personalAgentsSkillsPath || join(homedir(), ".agents", "skills");
    this.scanTimeout = options.scanTimeout || 5000;
    this.workdir = options.workdir || process.cwd();
    this.watchEnabled = options.watch ?? false;
  }

  /**
   * Initialize the skill manager by discovering available skills
   */
  async initialize(): Promise<void> {
    logger?.debug("Initializing SkillManager...");

    try {
      await this.refreshSkills();

      if (this.watchEnabled && !this.fileWatcher) {
        await this.setupWatcher();
      }

      this.initialized = true;
      logger?.debug(
        `SkillManager initialized with ${this.skillMetadata.size} skills`,
      );
    } catch (error) {
      logger?.error("Failed to initialize SkillManager:", error);
      throw error;
    }
  }

  /**
   * Refresh skills by re-discovering them
   */
  private refreshSkills(): Promise<void> {
    // Serialize rescans: initialize / file-watcher events / deleteSkill all
    // trigger full re-scans; running them concurrently makes a stale snapshot
    // or a partial cache (see performRefresh's atomic swap) observable to
    // metadata readers such as the settings-page skill list.
    const run = this.refreshChain.then(() => this.performRefresh());
    this.refreshChain = run.catch(() => {});
    return run;
  }

  private async performRefresh(): Promise<void> {
    // Route this scan's incremental skill-content writes into a scratch map
    // (processSkillDirs writes to this.skillContent) and rebuild both caches
    // fully before swapping them in — readers must never observe a
    // half-refreshed (e.g. momentarily empty) skill list mid-scan.
    const scratchContent = new Map<string, Skill>();
    const previousContent = this.skillContent;
    this.skillContent = scratchContent;

    let discovery: SkillDiscoveryResult;
    try {
      discovery = await this.discoverSkills();
    } catch (error) {
      this.skillContent = previousContent;
      throw error;
    }

    const nextMetadata = new Map<string, SkillMetadata>();
    const nextContent = new Map<string, Skill>();

    // Store discovered skills (builtin/personal/project)
    discovery.builtinSkills.forEach((skill, name) => {
      nextMetadata.set(name, skill);
    });
    discovery.personalSkills.forEach((skill, name) => {
      nextMetadata.set(name, skill);
    });
    discovery.projectSkills.forEach((skill, name) => {
      nextMetadata.set(name, skill);
    });
    scratchContent.forEach((skill, name) => {
      nextContent.set(name, skill);
    });

    // Restore subtree and plugin skills. Neither can be rediscovered by a
    // rescan: subtree roots come from file operations (recorded in
    // `nestedSkillRoots`), plugin skills from a process that already handed them
    // over. Re-seeding them keeps a watcher-driven refresh from dropping them.
    this.nestedSkillMetadata.forEach((metadata, name) => {
      nextMetadata.set(name, metadata);
    });
    this.nestedSkillContent.forEach((skill, name) => {
      nextContent.set(name, skill);
    });

    // Restore plugin skills
    this.pluginSkillMetadata.forEach((metadata, name) => {
      nextMetadata.set(name, metadata);
    });
    this.pluginSkillContent.forEach((skill, name) => {
      nextContent.set(name, skill);
    });

    // Log any discovery errors
    if (discovery.errors.length > 0) {
      logger?.warn(`Found ${discovery.errors.length} skill discovery errors`);
      discovery.errors.forEach((error) => {
        logger?.warn(`Skill error in ${error.skillPath}: ${error.message}`);
      });
    }

    // Atomic swap: from this point on readers see the complete new snapshot
    this.skillMetadata = nextMetadata;
    this.skillContent = nextContent;

    this.emit("refreshed", Array.from(this.skillMetadata.values()));
  }

  /**
   * Setup file watcher for skill directories
   */
  private async setupWatcher(): Promise<void> {
    if (this.fileWatcher) {
      await this.fileWatcher.cleanup();
    }

    this.fileWatcher = new FileWatcherService(logger, skillWatcherOptions());

    const pathsToWatch = [
      this.personalSkillsPath,
      this.personalClaudeSkillsPath,
      this.personalAgentsSkillsPath,
      join(this.workdir, ".wave", "skills"),
      join(this.workdir, ".claude", "skills"),
      join(this.workdir, ".agents", "skills"),
      ...Array.from(this.nestedSkillRoots),
    ];

    logger?.debug(`Setting up skill watcher for: ${pathsToWatch.join(", ")}`);

    for (const pathToWatch of pathsToWatch) {
      await this.watchRoot(pathToWatch);
    }
  }

  /**
   * Watch one skill root for changes. `FileWatcherService.watchFile` adds a
   * callback to an existing watcher instead of starting a second one, so a
   * subtree root discovered mid-session can call this without disturbing the
   * eager roots.
   */
  private async watchRoot(root: string): Promise<void> {
    if (!this.fileWatcher) return;
    await this.fileWatcher.watchFile(root, (event) => {
      if (
        event.path.endsWith("SKILL.md") ||
        event.type === "delete" ||
        event.type === "create"
      ) {
        logger?.debug(
          `Skill change detected (${event.type}): ${event.path}. Scheduling skill refresh...`,
        );
        this.scheduleRefresh();
      }
    });
  }

  /**
   * Debounce a watcher-driven rescan: each event pushes the window out, so a
   * burst costs exactly one rescan once it settles.
   */
  private scheduleRefresh(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
    }
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      this.refreshSkills().catch((error) => {
        logger?.error("Failed to refresh skills after change:", error);
      });
    }, SkillManager.RELOAD_DEBOUNCE_MS);
  }

  /**
   * Load skills from the subtree directories the agent's file operations have
   * reached (see `utils/nestedSkills.ts`), and merge them into the visible set.
   *
   * Startup discovery scans one level deep by design (see
   * `discoverSkillCollection`); this is how a monorepo subsystem's skills become
   * visible without walking the whole tree up front. Merge order gives the more
   * specific context the last word: a subtree skill overrides a same-named
   * project/personal skill, while builtin and plugin skills keep their names — a
   * directory on disk must not quietly shadow a product skill, and plugin names
   * are namespaced anyway.
   *
   * Serialized with the full rescans (`refreshChain`): both write the same
   * caches, and a refresh swaps in a snapshot built from its own scratch map.
   *
   * @param filePaths Absolute paths the agent just read, wrote or edited.
   * @returns Whether the visible skill set changed.
   */
  public async discoverNestedSkills(filePaths: string[]): Promise<boolean> {
    if (!this.initialized || filePaths.length === 0) return false;
    const run = this.refreshChain.then(() =>
      this.performNestedDiscovery(filePaths),
    );
    // Keep the chain's own errors from poisoning later rescans; the caller still
    // sees this run's rejection.
    this.refreshChain = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  private async performNestedDiscovery(filePaths: string[]): Promise<boolean> {
    const roots: string[] = [];
    for (const filePath of filePaths) {
      try {
        roots.push(
          ...(await findNestedSkillRoots(
            filePath,
            this.workdir,
            this.probedSkillDirs,
          )),
        );
      } catch (error) {
        logger?.warn(
          `Failed to probe subtree skills above ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const newRoots = roots.filter((root) => !this.nestedSkillRoots.has(root));
    if (newRoots.length === 0) return false;

    let changed = false;
    for (const root of newRoots) {
      this.nestedSkillRoots.add(root);
      const collection: SkillCollection = {
        type: "project",
        basePath: root,
        skills: new Map(),
        errors: [],
      };
      await this.scanSkillPath(root, collection);
      for (const error of collection.errors) {
        logger?.warn(`Skill error in ${error.skillPath}: ${error.message}`);
      }
      for (const [name, metadata] of collection.skills) {
        const existing = this.skillMetadata.get(name);
        if (existing?.type === "builtin" || existing?.pluginName) {
          logger?.debug(
            `Subtree skill '${name}' from ${root} ignored: ${existing.pluginName ? `plugin '${existing.pluginName}'` : "a builtin skill"} already owns that name`,
          );
          continue;
        }
        const skill = this.skillContent.get(name);
        if (!skill) continue;
        this.nestedSkillMetadata.set(name, metadata);
        this.nestedSkillContent.set(name, skill);
        this.skillMetadata.set(name, metadata);
        changed = true;
      }
    }

    if (changed) {
      this.emit("refreshed", Array.from(this.skillMetadata.values()));
    }

    // Watch even when nothing was added: an empty root can gain skills later,
    // and the watcher is what surfaces that without waiting for another file
    // operation in the subtree.
    for (const root of newRoots) {
      try {
        await this.watchRoot(root);
      } catch (error) {
        logger?.warn(
          `Failed to watch subtree skill root ${root}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    logger?.debug(
      `Discovered ${newRoots.length} subtree skill root(s) (${changed ? "skill set changed" : "no new skills"}): ${newRoots.join(", ")}`,
    );
    return changed;
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
    if (this.fileWatcher) {
      await this.fileWatcher.cleanup();
      this.fileWatcher = null;
    }
  }

  /**
   * Check if the skill manager is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get all available skills metadata
   */
  getAvailableSkills(): SkillMetadata[] {
    if (!this.initialized) {
      throw new Error("SkillManager not initialized. Call initialize() first.");
    }

    return Array.from(this.skillMetadata.values());
  }

  /**
   * Get metadata for a specific skill by name
   */
  getSkillMetadata(name: string): SkillMetadata | undefined {
    if (!this.initialized) {
      throw new Error("SkillManager not initialized. Call initialize() first.");
    }

    return this.skillMetadata.get(name);
  }

  /**
   * Load a specific skill by name
   * Returns the skill content that was loaded during initialization
   */
  async loadSkill(skillName: string): Promise<Skill | null> {
    if (!this.initialized) {
      throw new Error("SkillManager not initialized. Call initialize() first.");
    }

    // Return skill content that was loaded during initialization
    const skill = this.skillContent.get(skillName);
    if (skill) {
      logger?.debug(`Skill '${skillName}' retrieved from loaded content`);
      return skill;
    }

    logger?.debug(`Skill '${skillName}' not found`);
    return null;
  }

  /**
   * Discover skills in builtin, personal and project directories
   */
  private async discoverSkills(): Promise<SkillDiscoveryResult> {
    const builtinCollection = await this.discoverSkillCollection(
      getBuiltinSkillsDir(),
      "builtin",
    );

    const personalAgentsCollection = await this.discoverSkillCollection(
      this.personalAgentsSkillsPath,
      "personal",
    );

    const personalClaudeCollection = await this.discoverSkillCollection(
      this.personalClaudeSkillsPath,
      "personal",
    );

    const personalCollection = await this.discoverSkillCollection(
      this.personalSkillsPath,
      "personal",
    );

    const projectCollection = await this.discoverSkillCollection(
      this.workdir,
      "project",
    );

    return {
      builtinSkills: builtinCollection.skills,
      personalSkills: new Map([
        ...personalAgentsCollection.skills, // lowest priority
        ...personalClaudeCollection.skills, // overrides .agents
        ...personalCollection.skills, // .wave overrides .claude
      ]),
      projectSkills: projectCollection.skills,
      errors: [
        ...builtinCollection.errors,
        ...personalAgentsCollection.errors,
        ...personalClaudeCollection.errors,
        ...personalCollection.errors,
        ...projectCollection.errors,
      ],
    };
  }

  /**
   * Discover skills in a specific directory
   */
  private async discoverSkillCollection(
    basePath: string,
    type: "personal" | "project" | "builtin",
  ): Promise<SkillCollection> {
    const collection: SkillCollection = {
      type,
      basePath,
      skills: new Map(),
      errors: [],
    };

    if (type === "project") {
      // Scan .agents/skills first, then .claude/skills, then .wave/skills (wave overrides)
      const agentsPath = join(basePath, ".agents", "skills");
      const claudePath = join(basePath, ".claude", "skills");
      const wavePath = join(basePath, ".wave", "skills");
      await this.scanSkillPath(agentsPath, collection);
      await this.scanSkillPath(claudePath, collection);
      await this.scanSkillPath(wavePath, collection);
    } else {
      await this.scanSkillPath(basePath, collection);
    }

    return collection;
  }

  private async scanSkillPath(
    skillsPath: string,
    collection: SkillCollection,
  ): Promise<void> {
    try {
      const skillDirs = await this.findSkillDirectories(skillsPath);
      logger?.debug(
        `Found ${skillDirs.length} potential skill directories in ${skillsPath}`,
      );
      await this.processSkillDirs(skillDirs, collection);
    } catch (error) {
      logger?.debug(
        `Could not scan ${skillsPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async processSkillDirs(
    skillDirs: string[],
    collection: SkillCollection,
  ): Promise<void> {
    for (const skillDir of skillDirs) {
      try {
        const skillFilePath = join(skillDir, "SKILL.md");

        // Check if SKILL.md exists
        try {
          await stat(skillFilePath);
        } catch {
          continue; // Skip directories without SKILL.md
        }

        const parsed = parseSkillFile(skillFilePath, {
          basePath: skillDir,
          validateMetadata: true,
        });

        if (parsed.isValid) {
          // Override the skill type with the collection type
          const skillMetadata: SkillMetadata = {
            ...parsed.skillMetadata,
            type: collection.type,
          };

          // Feature-gated builtin skills (e.g. artifact behind
          // enableArtifact) are skipped while the gate is off, mirroring
          // ToolManager's registration gate for the Artifact tool.
          if (this.isSkillGatedOff(skillMetadata)) {
            continue;
          }

          // Create full skill object with content
          const skill: Skill = {
            ...skillMetadata,
            content: parsed.content,
            frontmatter: parsed.frontmatter,
            isValid: parsed.isValid,
            errors: parsed.validationErrors,
            warnings: parsed.warnings,
          };

          collection.skills.set(skillMetadata.name, skillMetadata);
          // Store the full skill content in the manager's skillContent map
          this.skillContent.set(skillMetadata.name, skill);
        } else {
          collection.errors.push({
            skillPath: skillDir,
            message: parsed.validationErrors.join("; "),
          });
        }
      } catch (error) {
        collection.errors.push({
          skillPath: skillDir,
          message: `Failed to process skill: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  }

  /**
   * Find all directories that could contain skills.
   *
   * Dot-prefixed entries are skipped: they are never skills (a skill name
   * can't start with `.`), and an installer's staging directory
   * (`.lazy-recipes.install-<uuid>`) that is being unpacked right now would
   * otherwise be probed for a half-written SKILL.md. Same rule the hot-reload
   * watcher applies, so discovery and watching agree on what a skill is.
   */
  private async findSkillDirectories(skillsPath: string): Promise<string[]> {
    const directories: string[] = [];

    try {
      const entries = await readdir(skillsPath, { withFileTypes: true });

      for (const entry of entries) {
        if (isDotEntry(entry.name)) {
          continue;
        }
        const fullPath = join(skillsPath, entry.name);
        if (entry.isDirectory()) {
          directories.push(fullPath);
        } else if (entry.isSymbolicLink()) {
          try {
            const s = await stat(fullPath);
            if (s.isDirectory()) {
              directories.push(fullPath);
            }
          } catch {
            // Ignore broken symlinks or other errors
          }
        }
      }
    } catch {
      // Directory doesn't exist - return empty array
    }

    return directories;
  }

  /**
   * Whether a discovered skill is a feature-gated builtin skill whose gate
   * is currently off. Mirrors ToolManager's gate for the Artifact tool so
   * the /artifact skill command stays in sync with enableArtifact.
   */
  private isSkillGatedOff(metadata: SkillMetadata): boolean {
    if (metadata.type !== "builtin") {
      return false;
    }
    if (metadata.name === "artifact") {
      return !isArtifactEnabled(this.workdir);
    }
    return false;
  }

  /**
   * Re-evaluate feature-gated builtin skills after a live configuration
   * reload (same hook as ToolManager.reloadFeatureGatedTools). Re-scans
   * skill directories and emits "refreshed" so slash-command registration
   * follows the gate.
   */
  async reloadFeatureGatedSkills(): Promise<void> {
    await this.refreshSkills();
  }

  /**
   * Execute a skill by name
   */
  async executeSkill(args: SkillToolArgs): Promise<{
    content: string;
    context?: SkillInvocationContext;
    allowedTools?: string[];
  }> {
    const { skill_name } = args;

    logger?.debug(`Invoking skill: ${skill_name}`);

    const prepared = await this.prepareSkill(args);
    if (!prepared.skill) {
      return { content: prepared.content };
    }

    // Register the skill's own `allowed-tools` BEFORE its injected commands
    // run, so a skill that declares e.g. `Bash(git push*)` authorizes its own
    // `!`git push``. The skill tool registers the same list again afterwards;
    // PermissionManager.addTemporaryRules deduplicates.
    const permissionManager = this.container.has("PermissionManager")
      ? this.container.get<PermissionManager>("PermissionManager")
      : undefined;
    const allowedTools = prepared.skill.allowedTools;
    if (permissionManager && allowedTools?.length) {
      permissionManager.addTemporaryRules(allowedTools);
    }

    try {
      const finalContent = await this.executeBashInSkillContent(
        prepared.content,
      );

      return {
        content: finalContent,
        context: {
          skillName: skill_name,
        },
        allowedTools: prepared.skill.allowedTools,
      };
    } catch (error) {
      logger?.error(`Failed to execute skill '${skill_name}':`, error);
      return {
        content: `**Error executing skill**: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Prepare a skill by name without executing bash commands
   */
  async prepareSkill(args: SkillToolArgs): Promise<
    | {
        content: string;
        skill: Skill;
      }
    | { content: string; skill?: undefined }
  > {
    const { skill_name, args: skillArgs } = args;

    try {
      const skill = await this.loadSkill(skill_name);

      if (!skill) {
        return {
          content: `**Skill not found**: "${skill_name}"\n\nAvailable skills:\n${this.formatAvailableSkills()}`,
        };
      }

      if (!skill.isValid) {
        const errorMsg = formatSkillError(skill.skillPath, skill.errors);
        return {
          content: `**Skill validation failed**:\n\n\`\`\`\n${errorMsg}\n\`\`\``,
        };
      }

      const preparedContent = this.prepareSkillContent(skill, skillArgs || "");
      return { content: preparedContent, skill };
    } catch (error) {
      logger?.error(`Failed to prepare skill '${skill_name}':`, error);
      return {
        content: `**Error preparing skill**: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Render a skill's body the way the model must see it: frontmatter stripped,
   * parameters substituted, `${WAVE_SKILL_DIR}` / `${CLAUDE_SKILL_DIR}` /
   * `${WAVE_PLUGIN_ROOT}` replaced with real paths, and the
   * `Base directory for this skill: <path>` header prepended.
   *
   * Public because the post-compaction re-injection has to render the same
   * text when it cannot reuse the content recorded at invocation time
   * (spec core/message-compact 场景 4).
   */
  renderSkillContent(skill: Skill, argsString = ""): string {
    return this.prepareSkillContent(skill, argsString);
  }

  /**
   * Prepare skill content with arguments but without bash execution
   */
  private prepareSkillContent(skill: Skill, argsString: string): string {
    const skillPath = `Base directory for this skill: ${skill.skillPath}\n\n`;

    // Extract content after frontmatter
    const contentMatch = skill.content.match(
      /^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/,
    );
    let mainContent = contentMatch ? contentMatch[1].trim() : skill.content;

    // 1. Substitute parameters ($1, $ARGUMENTS, etc.)
    mainContent = substituteCommandParameters(mainContent, argsString);

    // 2. Substitute the directory placeholders. The same resolver the skill's
    // `allowed-tools` rules went through at parse time, so the body and the
    // rules can never disagree about what `${WAVE_SKILL_DIR}` means.
    mainContent = substituteDirectoryPlaceholders(mainContent, {
      skillPath: skill.skillPath,
      pluginRoot: skill.pluginRoot,
    });

    return skillPath + this.skillWarningNotice(skill) + mainContent;
  }

  /**
   * A mis-authored skill must say so where its author will see it: a rule left
   * holding an unresolvable placeholder was dropped, so the command it meant to
   * pre-authorize will ask for confirmation (spec ecosystem/agent-skills 场景 5).
   */
  private skillWarningNotice(skill: Skill): string {
    if (!skill.warnings?.length) return "";
    return `> **Skill warning**: ${skill.warnings.join("; ")}\n\n`;
  }

  /**
   * Execute bash commands in prepared skill content
   */
  private async executeBashInSkillContent(content: string): Promise<string> {
    const { commands } = parseBashCommands(content);
    if (commands.length === 0) return content;

    const currentWorkdir =
      this.container.get<string>("CurrentWorkdir") ?? this.workdir;
    const results = await executeBashCommands(
      commands,
      currentWorkdir,
      undefined,
      createBashCommandGate(this.container),
    );
    return replaceBashCommandsWithOutput(content, results);
  }

  /**
   * Format available skills list for error messages
   */
  private formatAvailableSkills(): string {
    const skills = this.getAvailableSkills();

    if (skills.length === 0) {
      return "• No skills available\n\nTo create skills, see the Wave Skills documentation.";
    }

    return skills
      .map(
        (skill) => `• **${skill.name}** (${skill.type}): ${skill.description}`,
      )
      .join("\n");
  }

  /**
   * Register skills provided by a plugin
   */
  registerPluginSkills(pluginName: string, skills: Skill[]): void {
    for (const skill of skills) {
      const namespacedName = `${pluginName}:${skill.name}`;
      const metadata: SkillMetadata = {
        name: namespacedName,
        description: skill.description,
        type: skill.type,
        skillPath: skill.skillPath,
        allowedTools: skill.allowedTools,
        context: skill.context,
        agent: skill.agent,
        model: skill.model,
        disableModelInvocation: skill.disableModelInvocation,
        userInvocable: skill.userInvocable,
        pluginName,
        pluginRoot: skill.pluginRoot,
      };
      // Update the skill object itself to have the namespaced name
      skill.name = namespacedName;

      this.skillMetadata.set(namespacedName, metadata);
      this.skillContent.set(namespacedName, skill);
      // Also store in plugin-specific maps so they survive refreshSkills()
      this.pluginSkillMetadata.set(namespacedName, metadata);
      this.pluginSkillContent.set(namespacedName, skill);
    }
    logger?.debug(
      `Registered ${skills.length} plugin skills from ${pluginName}. Total skills: ${this.skillMetadata.size}`,
    );
  }

  /**
   * Drop every skill contributed by a plugin, addressed by its plugin name.
   * Clears the plugin-specific maps too: refreshSkills() re-seeds the visible
   * maps from them, so clearing only those would resurrect the skills on the
   * next disk refresh. Called by the in-place plugin reload path before
   * re-registering.
   */
  unregisterPluginSkills(pluginName: string): void {
    const prefix = `${pluginName}:`;
    for (const name of Array.from(this.pluginSkillMetadata.keys())) {
      if (name.startsWith(prefix)) {
        this.pluginSkillMetadata.delete(name);
      }
    }
    for (const name of Array.from(this.pluginSkillContent.keys())) {
      if (name.startsWith(prefix)) {
        this.pluginSkillContent.delete(name);
      }
    }
    for (const name of Array.from(this.skillMetadata.keys())) {
      if (name.startsWith(prefix)) {
        this.skillMetadata.delete(name);
      }
    }
    for (const name of Array.from(this.skillContent.keys())) {
      if (name.startsWith(prefix)) {
        this.skillContent.delete(name);
      }
    }
    logger?.debug(`Unregistered plugin skills from ${pluginName}`);
  }

  /**
   * Directory roots that may hold deletable copies of a skill in the given
   * discovery scope. Personal skills are scanned from three user-level dirs
   * (~/.wave|~/.claude|~/.agents/skills) and project skills from the current
   * project's three project dirs (.wave|.claude|.agents/skills). The discovery
   * map merges same-named copies from these roots into a single name-keyed
   * entry, so deleteSkill must sweep the whole set to remove a skill fully.
   */
  private scopeSkillRoots(type: string): string[] {
    if (type === "personal") {
      return [
        this.personalSkillsPath,
        this.personalClaudeSkillsPath,
        this.personalAgentsSkillsPath,
      ];
    }
    if (type === "project") {
      return [
        join(this.workdir, ".wave", "skills"),
        join(this.workdir, ".claude", "skills"),
        join(this.workdir, ".agents", "skills"),
      ];
    }
    return [];
  }

  /**
   * Delete a user/personal or project skill by removing its directory
   * (containing SKILL.md). Builtin and plugin skills are read-only and
   * cannot be deleted.
   *
   * A same-named skill may physically live in several same-scope directories
   * (~/.wave/skills + ~/.claude/skills + ~/.agents/skills for user skills,
   * .wave/.claude/.agents/skills under the project for project skills) while
   * only the highest-priority copy is listed; every copy is removed so one
   * delete removes the skill completely instead of re-surfacing the next
   * copy on the next scan. Caches are then re-converged with disk before
   * returning so the caller's follow-up metadata read reflects the result.
   * @param name - The skill name as shown in skill metadata
   * @returns true if the skill was deleted
   */
  async deleteSkill(name: string): Promise<boolean> {
    if (!this.initialized) {
      throw new Error("SkillManager not initialized. Call initialize() first.");
    }

    const metadata = this.skillMetadata.get(name);
    if (!metadata) {
      return false;
    }

    // Builtin and plugin skills are read-only
    if (metadata.type === "builtin" || metadata.pluginName) {
      return false;
    }

    if (!metadata.skillPath) {
      return false;
    }

    const dirsToRemove = new Set<string>([metadata.skillPath]);
    for (const root of this.scopeSkillRoots(metadata.type)) {
      dirsToRemove.add(join(root, name));
    }

    for (const dir of dirsToRemove) {
      await rm(dir, { recursive: true, force: true });
    }

    // Converge caches with disk: the serialized full refresh both drops the
    // deleted entries and reflects any copy that survived deletion. If the
    // refresh itself fails, fall back to dropping the entry from memory so
    // the deleted skill does not keep being served.
    try {
      await this.refreshSkills();
    } catch (error) {
      logger?.warn(
        `Failed to refresh skills after deleting '${name}': ${error}`,
      );
      this.skillMetadata.delete(name);
      this.skillContent.delete(name);
    }

    logger?.debug(`Deleted skill '${name}' at ${metadata.skillPath}`);
    return true;
  }
}
