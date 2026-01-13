import * as fs from "fs/promises";
import * as path from "path";
import {
  PluginManifest,
  CustomSlashCommand,
  Skill,
  LspConfig,
  McpConfig,
  PartialHookConfiguration,
} from "../types/index.js";
import { scanCommandsDirectory } from "../utils/customCommands.js";
import { parseSkillFile } from "../utils/skillParser.js";

export class PluginLoader {
  /**
   * Load and validate a plugin manifest from a directory
   * @param pluginPath Absolute path to the plugin directory
   */
  static async loadManifest(pluginPath: string): Promise<PluginManifest> {
    const dotWavePluginPath = path.join(pluginPath, ".wave-plugin");
    const manifestPath = path.join(dotWavePluginPath, "plugin.json");

    // T018: Ensure plugin.json is the only file in .wave-plugin/
    try {
      const entries = await fs.readdir(dotWavePluginPath);
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
        throw new Error(
          `Plugin manifest directory not found at ${dotWavePluginPath}`,
        );
      }
      throw error;
    }

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

  /**
   * Load commands from a plugin's commands directory
   * @param pluginPath Absolute path to the plugin directory
   */
  static loadCommands(pluginPath: string): CustomSlashCommand[] {
    const commandsPath = path.join(pluginPath, "commands");
    return scanCommandsDirectory(commandsPath);
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
            });
            if (parsed.isValid) {
              skills.push({
                name: parsed.skillMetadata.name,
                description: parsed.skillMetadata.description,
                type: "project", // Plugin skills are treated as project skills
                skillPath: parsed.skillMetadata.skillPath,
                content: parsed.content,
                frontmatter: parsed.frontmatter,
                isValid: parsed.isValid,
                errors: parsed.validationErrors,
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
   * Load MCP configuration from a plugin
   */
  static async loadMcpConfig(
    pluginPath: string,
  ): Promise<McpConfig | undefined> {
    const mcpPath = path.join(pluginPath, ".mcp.json");
    try {
      const content = await fs.readFile(mcpPath, "utf-8");
      return JSON.parse(content) as McpConfig;
    } catch {
      return undefined;
    }
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
      return JSON.parse(content) as PartialHookConfiguration;
    } catch {
      return undefined;
    }
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
    if (!manifest.version) {
      throw new Error("Plugin manifest missing 'version'");
    }
    if (!/^[a-z0-9-]+$/.test(manifest.name)) {
      throw new Error(
        `Invalid plugin name: ${manifest.name}. Only lowercase letters, numbers, and hyphens are allowed.`,
      );
    }
  }
}
