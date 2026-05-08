import { readdir, stat } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { EventEmitter } from "events";
import { FileWatcherService } from "../services/fileWatcher.js";
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
import { substituteCommandParameters } from "../utils/commandArgumentParser.js";
import {
  parseBashCommands,
  replaceBashCommandsWithOutput,
  executeBashCommands,
} from "../utils/markdownParser.js";
import { getBuiltinSkillsDir } from "../utils/configPaths.js";

import { Container } from "../utils/container.js";
import { logger } from "../utils/globalLogger.js";

/**
 * Manages skill discovery and loading
 */
export class SkillManager extends EventEmitter {
  private personalSkillsPath: string;
  private scanTimeout: number;
  private workdir: string;

  private skillMetadata = new Map<string, SkillMetadata>();
  private skillContent = new Map<string, Skill>();
  private initialized = false;
  private fileWatcher: FileWatcherService | null = null;
  private watchEnabled: boolean;

  constructor(
    private container: Container,
    options: SkillManagerOptions = {},
  ) {
    super();
    this.personalSkillsPath =
      options.personalSkillsPath || join(homedir(), ".wave", "skills");
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
  private async refreshSkills(): Promise<void> {
    // Clear existing data before discovery
    this.skillMetadata.clear();
    this.skillContent.clear();

    const discovery = await this.discoverSkills();

    // Store discovered skill metadata
    discovery.builtinSkills.forEach((skill, name) => {
      this.skillMetadata.set(name, skill);
    });
    discovery.personalSkills.forEach((skill, name) => {
      this.skillMetadata.set(name, skill);
    });
    discovery.projectSkills.forEach((skill, name) => {
      this.skillMetadata.set(name, skill);
    });

    // Log any discovery errors
    if (discovery.errors.length > 0) {
      logger?.warn(`Found ${discovery.errors.length} skill discovery errors`);
      discovery.errors.forEach((error) => {
        logger?.warn(`Skill error in ${error.skillPath}: ${error.message}`);
      });
    }

    this.emit("refreshed", Array.from(this.skillMetadata.values()));
  }

  /**
   * Setup file watcher for skill directories
   */
  private async setupWatcher(): Promise<void> {
    if (this.fileWatcher) {
      await this.fileWatcher.cleanup();
    }

    this.fileWatcher = new FileWatcherService(logger);

    const pathsToWatch = [
      this.personalSkillsPath,
      join(this.workdir, ".wave", "skills"),
    ];

    logger?.debug(`Setting up skill watcher for: ${pathsToWatch.join(", ")}`);

    for (const pathToWatch of pathsToWatch) {
      await this.fileWatcher.watchFile(pathToWatch, async (event) => {
        if (
          event.path.endsWith("SKILL.md") ||
          event.type === "delete" ||
          event.type === "create"
        ) {
          logger?.debug(
            `Skill change detected (${event.type}): ${event.path}. Refreshing skills...`,
          );
          try {
            await this.refreshSkills();
          } catch (error) {
            logger?.error("Failed to refresh skills after change:", error);
          }
        }
      });
    }
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
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
      personalSkills: personalCollection.skills,
      projectSkills: projectCollection.skills,
      errors: [
        ...builtinCollection.errors,
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

    let skillsPath: string;
    if (type === "personal") {
      skillsPath = basePath;
    } else if (type === "builtin") {
      skillsPath = basePath;
    } else {
      skillsPath = join(basePath, ".wave", "skills");
    }

    try {
      const skillDirs = await this.findSkillDirectories(skillsPath);
      logger?.debug(
        `Found ${skillDirs.length} potential skill directories in ${skillsPath}`,
      );

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
              type,
            };

            // Create full skill object with content
            const skill: Skill = {
              ...skillMetadata,
              content: parsed.content,
              frontmatter: parsed.frontmatter,
              isValid: parsed.isValid,
              errors: parsed.validationErrors,
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
    } catch (error) {
      logger?.debug(
        `Could not scan ${skillsPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
      // Not an error - the directory might not exist yet
    }

    return collection;
  }

  /**
   * Find all directories that could contain skills
   */
  private async findSkillDirectories(skillsPath: string): Promise<string[]> {
    const directories: string[] = [];

    try {
      const entries = await readdir(skillsPath, { withFileTypes: true });

      for (const entry of entries) {
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
        content: `❌ **Error executing skill**: ${error instanceof Error ? error.message : String(error)}`,
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
          content: `❌ **Skill not found**: "${skill_name}"\n\nAvailable skills:\n${this.formatAvailableSkills()}`,
        };
      }

      if (!skill.isValid) {
        const errorMsg = formatSkillError(skill.skillPath, skill.errors);
        return {
          content: `❌ **Skill validation failed**:\n\n\`\`\`\n${errorMsg}\n\`\`\``,
        };
      }

      const preparedContent = this.prepareSkillContent(skill, skillArgs || "");
      return { content: preparedContent, skill };
    } catch (error) {
      logger?.error(`Failed to prepare skill '${skill_name}':`, error);
      return {
        content: `❌ **Error preparing skill**: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Prepare skill content with arguments but without bash execution
   */
  private prepareSkillContent(skill: Skill, argsString: string): string {
    const header = `🧠 **${skill.name}** (${skill.type} skill)\n\n`;
    const description = `*${skill.description}*\n\n`;
    const skillPath = `📁 Skill location: \`${skill.skillPath}\`\n\n`;

    // Extract content after frontmatter
    const contentMatch = skill.content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
    let mainContent = contentMatch ? contentMatch[1].trim() : skill.content;

    // 1. Substitute parameters ($1, $ARGUMENTS, etc.)
    mainContent = substituteCommandParameters(mainContent, argsString);

    // 2. Substitute ${WAVE_SKILL_DIR} with the skill's directory path
    mainContent = mainContent.replace(/\$\{WAVE_SKILL_DIR\}/g, skill.skillPath);

    // 3. Substitute ${WAVE_PLUGIN_ROOT} with the skill's plugin root path
    if (skill.pluginRoot) {
      mainContent = mainContent.replace(
        /\$\{WAVE_PLUGIN_ROOT\}/g,
        skill.pluginRoot,
      );
    }

    return header + description + skillPath + mainContent;
  }

  /**
   * Execute bash commands in prepared skill content
   */
  private async executeBashInSkillContent(content: string): Promise<string> {
    const { commands } = parseBashCommands(content);
    if (commands.length > 0) {
      const results = await executeBashCommands(commands, this.workdir);
      return replaceBashCommandsWithOutput(content, results);
    }
    return content;
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
    }
    logger?.debug(
      `Registered ${skills.length} plugin skills from ${pluginName}. Total skills: ${this.skillMetadata.size}`,
    );
  }
}
