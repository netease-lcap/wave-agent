import * as fs from "fs/promises";
import * as path from "path";
import {
  PluginManifest,
  CustomSlashCommand,
  Skill,
  LspConfig,
  McpConfig,
  McpServerConfig,
  PartialHookConfiguration,
  PluginWorkflow,
} from "../types/index.js";
import { scanCommandsDirectory } from "../utils/customCommands.js";
import { parseSkillFile } from "../utils/skillParser.js";
import {
  parseAgentFile,
  type SubagentConfiguration,
} from "../utils/subagentParser.js";
import { logger } from "../utils/globalLogger.js";
import { WORKFLOW_SCRIPT_EXTENSION } from "../workflow/workflowRegistry.js";
import { parseScript, validateScript } from "../workflow/scriptRuntime.js";
import { MOD_LIMITS, type PluginMod } from "../types/mods.js";

/** 能被编译成 mod 的扩展名（与 `mods/compile.ts` 的 loader 表一致）。 */
const MOD_LOADER_EXTENSIONS = new Set([".tsx", ".ts", ".jsx", ".js"]);

export class PluginLoader {
  /**
   * Load and validate a plugin manifest from a directory
   * @param pluginPath Absolute path to the plugin directory
   */
  static async loadManifest(pluginPath: string): Promise<PluginManifest> {
    const dotWavePluginPath = path.join(pluginPath, ".wave-plugin");

    // Check if .wave-plugin/ directory exists
    let wavePluginDirExists = false;
    try {
      const entries = await fs.readdir(dotWavePluginPath);
      wavePluginDirExists = true;
      // T018: Ensure plugin.json is the only file in .wave-plugin/
      const misplaced = entries.filter((e) => e !== "plugin.json");
      if (misplaced.length > 0) {
        throw new Error(
          `Misplaced files/directories in .wave-plugin/: ${misplaced.join(", ")}. Only plugin.json should be in this directory.`,
        );
      }
    } catch (error) {
      if (
        error instanceof Error &&
        (error as { code?: string }).code === "ENOENT"
      ) {
        // .wave-plugin/ doesn't exist, will try .claude-plugin/ fallback below
      } else {
        throw error;
      }
    }

    if (wavePluginDirExists) {
      const manifestPath = path.join(dotWavePluginPath, "plugin.json");
      try {
        const content = await fs.readFile(manifestPath, "utf-8");
        const manifest = JSON.parse(content) as PluginManifest;
        this.validateManifest(manifest);
        return manifest;
      } catch (error) {
        if (
          error instanceof Error &&
          (error as { code?: string }).code === "ENOENT"
        ) {
          throw new Error(`Plugin manifest not found at ${manifestPath}`);
        }
        throw new Error(
          `Failed to load plugin manifest at ${manifestPath}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    // Fallback to .claude-plugin/
    const dotClaudePluginPath = path.join(pluginPath, ".claude-plugin");
    const claudeManifestPath = path.join(dotClaudePluginPath, "plugin.json");
    try {
      const content = await fs.readFile(claudeManifestPath, "utf-8");
      const manifest = JSON.parse(content) as PluginManifest;
      this.validateManifest(manifest);
      return manifest;
    } catch (error) {
      if (
        error instanceof Error &&
        (error as { code?: string }).code === "ENOENT"
      ) {
        throw new Error(
          `Plugin manifest not found at ${dotWavePluginPath} or ${dotClaudePluginPath}`,
        );
      }
      throw new Error(
        `Failed to load plugin manifest at ${claudeManifestPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Load commands from a plugin's commands directory
   * @param pluginPath Absolute path to the plugin directory
   */
  static loadCommands(pluginPath: string): CustomSlashCommand[] {
    const commandsPath = path.join(pluginPath, "commands");
    // Stamp the root here, the way plugin skills get theirs: a command's
    // `${WAVE_PLUGIN_ROOT}` has no other source, and the scanner is shared with
    // user/project command directories that must stay rootless.
    return scanCommandsDirectory(commandsPath).map((command) => ({
      ...command,
      pluginRoot: pluginPath,
    }));
  }

  /**
   * Load skills from a plugin's skills directory
   * @param pluginPath Absolute path to the plugin directory
   */
  static async loadSkills(pluginPath: string): Promise<Skill[]> {
    const skillsPath = path.join(pluginPath, "skills");
    const skills: Skill[] = [];

    try {
      const entries = await fs.readdir(skillsPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillDir = path.join(skillsPath, entry.name);
          const skillFilePath = path.join(skillDir, "SKILL.md");
          try {
            await fs.stat(skillFilePath);
            const parsed = parseSkillFile(skillFilePath, {
              basePath: skillDir,
              validateMetadata: true,
              pluginRoot: pluginPath,
            });
            if (parsed.isValid) {
              for (const warning of parsed.warnings) {
                logger?.warn(`Skill ${skillDir}: ${warning}`);
              }
              skills.push({
                ...parsed.skillMetadata,
                type: "project", // Plugin skills are treated as project skills
                pluginRoot: pluginPath,
                content: parsed.content,
                frontmatter: parsed.frontmatter,
                isValid: parsed.isValid,
                errors: parsed.validationErrors,
                warnings: parsed.warnings,
              });
            }
          } catch {
            // Skip directories without SKILL.md
          }
        }
      }
    } catch {
      // skills directory might not exist
    }

    return skills;
  }

  /**
   * Load LSP configuration from a plugin
   */
  static async loadLspConfig(
    pluginPath: string,
  ): Promise<LspConfig | undefined> {
    const lspPath = path.join(pluginPath, ".lsp.json");
    try {
      const content = await fs.readFile(lspPath, "utf-8");
      return JSON.parse(content) as LspConfig;
    } catch {
      return undefined;
    }
  }

  /**
   * Load MCP configuration from a plugin.
   *
   * Accepts both declaration shapes found in the wild (spec plugin A-023): the
   * wrapped `{"mcpServers": {…}}` and the flat `{"<serverName>": {…}}`, matching
   * Claude Code's `parsed.mcpServers || parsed`. A plugin manifest that declares
   * `mcpServers` inline is equivalent to a sibling `.mcp.json`; when both exist
   * they are merged by server name, the file winning.
   *
   * @param manifestMcpServers Inline declarations from the plugin manifest
   */
  static async loadMcpConfig(
    pluginPath: string,
    manifestMcpServers?: Record<string, McpServerConfig>,
  ): Promise<McpConfig | undefined> {
    const servers: Record<string, McpServerConfig> = {
      ...(manifestMcpServers ?? {}),
    };

    const mcpPath = path.join(pluginPath, ".mcp.json");
    try {
      const content = await fs.readFile(mcpPath, "utf-8");
      const parsed: unknown = JSON.parse(content);
      // Return raw config — let McpManager resolve templates and capture originalUrl
      Object.assign(servers, extractMcpServers(parsed));
    } catch {
      // no .mcp.json — inline declarations (if any) stand alone
    }

    if (Object.keys(servers).length === 0) return undefined;
    return { mcpServers: servers };
  }

  /**
   * Load hooks configuration from a plugin
   */
  static async loadHooksConfig(
    pluginPath: string,
  ): Promise<PartialHookConfiguration | undefined> {
    const hooksPath = path.join(pluginPath, "hooks", "hooks.json");
    try {
      const content = await fs.readFile(hooksPath, "utf-8");
      const parsed = JSON.parse(content);
      // Claude Code wrapper format: { "hooks": { "SessionStart": [...] } }
      // (optional "description" sibling key)
      if (parsed && typeof parsed === "object" && "hooks" in parsed) {
        return parsed.hooks as PartialHookConfiguration;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Load agent configurations from a plugin's agents directory
   */
  static async loadAgents(
    pluginPath: string,
  ): Promise<SubagentConfiguration[]> {
    const agentsPath = path.join(pluginPath, "agents");
    const agents: SubagentConfiguration[] = [];

    try {
      const entries = await fs.readdir(agentsPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".md")) {
          const agentFilePath = path.join(agentsPath, entry.name);
          try {
            const config = parseAgentFile(agentFilePath, "plugin", pluginPath);
            agents.push(config);
          } catch (parseError) {
            // Log error but continue with other files
            logger?.warn(
              `Warning: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
            );
          }
        }
      }
    } catch {
      // agents directory might not exist
    }

    return agents;
  }

  /**
   * Load workflow scripts from a plugin's `workflows/` directory.
   *
   * Only `*.js` is accepted (what Claude Code ships); each file goes through the
   * same validation an inline script does — acorn parse, literal-only `meta` as
   * the first statement. A file that fails validation is skipped on its own: it
   * must not fail the plugin or the sibling workflows (spec workflow「调用插件携带
   * 的工作流」场景 1).
   *
   * The invocation name is the file stem, not `meta.name` (场景 2).
   *
   * @param pluginPath Absolute path to the plugin directory
   */
  static async loadWorkflows(pluginPath: string): Promise<PluginWorkflow[]> {
    const workflowsPath = path.join(pluginPath, "workflows");
    const workflows: PluginWorkflow[] = [];

    try {
      const entries = await fs.readdir(workflowsPath, { withFileTypes: true });
      for (const entry of entries) {
        if (
          !entry.isFile() ||
          !entry.name.endsWith(WORKFLOW_SCRIPT_EXTENSION)
        ) {
          continue;
        }
        const scriptPath = path.join(workflowsPath, entry.name);
        try {
          const script = await fs.readFile(scriptPath, "utf-8");
          const validation = validateScript(script);
          if (!validation.valid) {
            logger?.warn(
              `Skipping plugin workflow ${scriptPath}: ${validation.errors.join("; ")}`,
            );
            continue;
          }
          const { meta } = parseScript(script);
          workflows.push({
            name: entry.name.slice(0, -WORKFLOW_SCRIPT_EXTENSION.length),
            description: meta.description,
            path: scriptPath,
            meta,
          });
        } catch (error) {
          logger?.warn(
            `Skipping plugin workflow ${scriptPath}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    } catch {
      // workflows directory might not exist
    }

    return workflows;
  }

  /**
   * Collect the mod files under `<pluginRoot>/mods/`.
   *
   * Only paths and sizes are gathered here — compilation needs esbuild, an
   * on-demand runtime dependency that may not be installed yet, so it happens
   * in `managers/modManager.ts` right before a session uses the mod.
   *
   * The entry names are the file stems and the ids are `<plugin>:<stem>`, the
   * same `<plugin>:<name>` shape commands and workflows use. Files are resolved
   * through `realpath` and dropped when the result escapes the plugin
   * directory (a symlink pointing outside must not become loadable code), and
   * the spec's per-file / total / count limits are enforced here so an
   * oversized mod never reaches the compiler.
   */
  static async loadMods(
    pluginPath: string,
    pluginName: string,
  ): Promise<PluginMod[]> {
    const modsPath = path.join(pluginPath, "mods");
    const mods: PluginMod[] = [];
    let realRoot: string;
    try {
      realRoot = await fs.realpath(pluginPath);
    } catch {
      return mods;
    }

    // 排序也放在这个 try 里：读目录失败与「结果不可迭代」同属「这个插件没有
    // mod」，与 `loadSkills` / `loadAgents` 的口径一致 —— 插件加载不该因为一次
    // 目录读取问题整体失败（那会连带丢掉命令、技能等已就绪的能力）。
    let entries;
    try {
      entries = await fs.readdir(modsPath, { withFileTypes: true });
      entries = entries.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      // No mods directory — the common case.
      return mods;
    }

    let totalBytes = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!MOD_LOADER_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        continue;
      }
      if (mods.length >= MOD_LIMITS.fileCount) {
        logger?.warn(
          `插件 ${pluginName} 的 mod 文件超过 ${MOD_LIMITS.fileCount} 个，其余被忽略`,
        );
        break;
      }
      const filePath = path.join(modsPath, entry.name);
      try {
        const realPath = await fs.realpath(filePath);
        if (
          realPath !== realRoot &&
          !realPath.startsWith(realRoot + path.sep)
        ) {
          logger?.warn(`忽略越出插件目录的 mod 文件：${filePath}`);
          continue;
        }
        const stat = await fs.stat(realPath);
        if (stat.size > MOD_LIMITS.fileBytes) {
          logger?.warn(
            `忽略超过 ${MOD_LIMITS.fileBytes} 字节的 mod 文件：${filePath}`,
          );
          continue;
        }
        totalBytes += stat.size;
        if (totalBytes > MOD_LIMITS.totalBytes) {
          logger?.warn(
            `插件 ${pluginName} 的 mod 文件总量超过 ${MOD_LIMITS.totalBytes} 字节，其余被忽略`,
          );
          break;
        }
        mods.push({
          id: `${pluginName}:${path.parse(entry.name).name}`,
          name: path.parse(entry.name).name,
          path: realPath,
          pluginRoot: pluginPath,
        });
      } catch (error) {
        logger?.warn(
          `读取 mod 文件失败：${filePath}（${error instanceof Error ? error.message : String(error)}）`,
        );
      }
    }
    return mods;
  }

  /**
   * Validate the plugin manifest structure
   */
  private static validateManifest(manifest: PluginManifest): void {
    if (!manifest.name) {
      throw new Error("Plugin manifest missing 'name'");
    }
    if (!manifest.description) {
      throw new Error("Plugin manifest missing 'description'");
    }
    // `version` is optional: the Claude Code ecosystem omits it freely and the
    // install path already defaults it (spec plugin A-022).
    if (!/^[a-z0-9-]+$/.test(manifest.name)) {
      throw new Error(
        `Invalid plugin name: ${manifest.name}. Only lowercase letters, numbers, and hyphens are allowed.`,
      );
    }
  }
}

/**
 * Normalizes an MCP declaration to a server map, accepting both the wrapped and
 * the flat shape (spec plugin A-023). Anything that is not an object of server
 * configs yields an empty map rather than throwing, so one malformed declaration
 * cannot fail the whole plugin.
 */
function extractMcpServers(parsed: unknown): Record<string, McpServerConfig> {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  const record = parsed as Record<string, unknown>;
  const wrapped = record.mcpServers;
  const servers =
    wrapped && typeof wrapped === "object" && !Array.isArray(wrapped)
      ? (wrapped as Record<string, McpServerConfig>)
      : (record as Record<string, McpServerConfig>);
  return servers;
}
