import { readdir, stat } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import type {
  ISkillManager,
  SkillManagerOptions,
  SkillMetadata,
  Skill,
  SkillCollection,
  SkillDiscoveryResult,
  SkillToolArgs,
  SkillInvocationContext,
  Logger,
} from "../types.js";
import type { ToolPlugin, ToolResult } from "../tools/types.js";
import { parseSkillFile, formatSkillError } from "../utils/skillParser.js";

/**
 * Manages skill discovery, loading, and caching
 */
export class SkillManager implements ISkillManager {
  private personalSkillsPath: string;
  private maxMetadataCache: number;
  private maxContentCache: number;
  private scanTimeout: number;
  private logger?: Logger;

  private metadataCache = new Map<string, SkillMetadata>();
  private contentCache = new Map<string, Skill>();
  private initialized = false;

  constructor(options: SkillManagerOptions = {}) {
    this.personalSkillsPath =
      options.personalSkillsPath || join(homedir(), ".wave", "skills");
    this.maxMetadataCache = options.maxMetadataCache || 1000;
    this.maxContentCache = options.maxContentCache || 100;
    this.scanTimeout = options.scanTimeout || 5000;
    this.logger = options.logger;
  }

  /**
   * Initialize the skill manager by discovering available skills
   */
  async initialize(): Promise<void> {
    this.logger?.info("Initializing SkillManager...");

    try {
      const discovery = await this.discoverSkills();

      // Update metadata cache with discovered skills
      this.metadataCache.clear();
      discovery.personalSkills.forEach((skill, name) => {
        this.metadataCache.set(name, skill);
      });
      discovery.projectSkills.forEach((skill, name) => {
        this.metadataCache.set(name, skill);
      });

      // Log any discovery errors
      if (discovery.errors.length > 0) {
        this.logger?.warn(
          `Found ${discovery.errors.length} skill discovery errors`,
        );
        discovery.errors.forEach((error) => {
          this.logger?.warn(
            `Skill error in ${error.skillPath}: ${error.message}`,
          );
        });
      }

      this.initialized = true;
      this.logger?.info(
        `SkillManager initialized with ${this.metadataCache.size} skills`,
      );
    } catch (error) {
      this.logger?.error("Failed to initialize SkillManager:", error);
      throw error;
    }
  }

  /**
   * Get all available skills metadata
   */
  getAvailableSkills(): SkillMetadata[] {
    if (!this.initialized) {
      throw new Error("SkillManager not initialized. Call initialize() first.");
    }

    return Array.from(this.metadataCache.values());
  }

  /**
   * Load a specific skill by name
   */
  async loadSkill(skillName: string): Promise<Skill | null> {
    if (!this.initialized) {
      throw new Error("SkillManager not initialized. Call initialize() first.");
    }

    // Check content cache first
    const cached = this.contentCache.get(skillName);
    if (cached) {
      this.logger?.debug(`Skill '${skillName}' loaded from cache`);
      return cached;
    }

    // Get metadata from cache
    const metadata = this.metadataCache.get(skillName);
    if (!metadata) {
      this.logger?.debug(`Skill '${skillName}' not found`);
      return null;
    }

    try {
      // Load skill file
      const skillFilePath = join(metadata.skillPath, "SKILL.md");
      const parsed = parseSkillFile(skillFilePath, {
        basePath: metadata.skillPath,
        validateMetadata: true,
      });

      const skill: Skill = {
        name: parsed.skillMetadata.name,
        description: parsed.skillMetadata.description,
        type: metadata.type, // Use the corrected type from metadata
        skillPath: parsed.skillMetadata.skillPath,
        content: parsed.content,
        frontmatter: parsed.frontmatter,
        isValid: parsed.isValid,
        errors: parsed.validationErrors,
      };

      // Add to content cache if valid and cache has space
      if (skill.isValid && this.contentCache.size < this.maxContentCache) {
        this.contentCache.set(skillName, skill);
      }

      this.logger?.debug(`Skill '${skillName}' loaded from ${skillFilePath}`);
      return skill;
    } catch (error) {
      this.logger?.warn(`Failed to load skill '${skillName}':`, error);
      return null;
    }
  }

  /**
   * Discover skills in both personal and project directories
   */
  private async discoverSkills(): Promise<SkillDiscoveryResult> {
    const personalCollection = await this.discoverSkillCollection(
      this.personalSkillsPath,
      "personal",
    );

    const projectCollection = await this.discoverSkillCollection(
      process.cwd(),
      "project",
    );

    return {
      personalSkills: personalCollection.skills,
      projectSkills: projectCollection.skills,
      errors: [...personalCollection.errors, ...projectCollection.errors],
    };
  }

  /**
   * Discover skills in a specific directory
   */
  private async discoverSkillCollection(
    basePath: string,
    type: "personal" | "project",
  ): Promise<SkillCollection> {
    const collection: SkillCollection = {
      type,
      basePath,
      skills: new Map(),
      errors: [],
    };

    const skillsPath =
      type === "personal" ? basePath : join(basePath, ".wave", "skills");

    try {
      const skillDirs = await this.findSkillDirectories(skillsPath);
      this.logger?.debug(
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
            const skillMetadata = {
              ...parsed.skillMetadata,
              type,
            };
            collection.skills.set(skillMetadata.name, skillMetadata);
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
      this.logger?.debug(
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
        if (entry.isDirectory()) {
          directories.push(join(skillsPath, entry.name));
        }
      }
    } catch {
      // Directory doesn't exist - return empty array
    }

    return directories;
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.metadataCache.clear();
    this.contentCache.clear();
    this.logger?.debug("SkillManager caches cleared");
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { metadataSize: number; contentSize: number } {
    return {
      metadataSize: this.metadataCache.size,
      contentSize: this.contentCache.size,
    };
  }

  /**
   * Create a tool plugin for registering with ToolManager
   */
  createTool(): ToolPlugin {
    // Initialize skill manager asynchronously
    let initializationPromise: Promise<void> | null = null;

    const ensureInitialized = async (): Promise<void> => {
      if (!initializationPromise) {
        initializationPromise = this.initialize();
      }
      await initializationPromise;
    };

    const getToolDescription = (): string => {
      if (!this.initialized) {
        return "Invoke a Wave skill by name. Skills are user-defined automation templates that can be personal or project-specific. Skills will be loaded during initialization.";
      }

      const availableSkills = this.getAvailableSkills();

      if (availableSkills.length === 0) {
        return "Invoke a Wave skill by name. Skills are user-defined automation templates that can be personal or project-specific. No skills are currently available.";
      }

      const skillList = availableSkills
        .map(
          (skill) =>
            `• **${skill.name}** (${skill.type}): ${skill.description}`,
        )
        .join("\n");

      return `Invoke a Wave skill by name. Skills are user-defined automation templates that can be personal or project-specific.\n\nAvailable skills:\n${skillList}`;
    };

    return {
      name: "skill",
      description: getToolDescription(),
      config: {
        type: "function",
        function: {
          name: "skill",
          description: getToolDescription(),
          parameters: {
            type: "object",
            properties: {
              skill_name: {
                type: "string",
                description: "Name of the skill to invoke",
                enum: this.initialized
                  ? this.getAvailableSkills().map((skill) => skill.name)
                  : [],
              },
            },
            required: ["skill_name"],
          },
        },
      },
      execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
        try {
          // Ensure skill manager is initialized
          await ensureInitialized();

          // Validate arguments
          const skillName = args.skill_name as string;
          if (!skillName || typeof skillName !== "string") {
            return {
              success: false,
              content: "",
              error: "skill_name parameter is required and must be a string",
            };
          }

          // Execute the skill
          const result = await this.executeSkill({ skill_name: skillName });

          return {
            success: true,
            content: result.content,
            shortResult: `Invoked skill: ${skillName}`,
          };
        } catch (error) {
          return {
            success: false,
            content: "",
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
      formatCompactParams: (params: Record<string, unknown>) => {
        const skillName = params.skill_name as string;
        return skillName || "unknown-skill";
      },
    };
  }

  /**
   * Execute a skill by name
   */
  async executeSkill(
    args: SkillToolArgs,
  ): Promise<{ content: string; context?: SkillInvocationContext }> {
    const { skill_name } = args;

    this.logger?.info(`Invoking skill: ${skill_name}`);

    try {
      // Load the skill
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

      // Return skill content with context
      return {
        content: this.formatSkillContent(skill),
        context: {
          skillName: skill_name,
        },
      };
    } catch (error) {
      this.logger?.error(`Failed to execute skill '${skill_name}':`, error);
      return {
        content: `❌ **Error executing skill**: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Format skill content for output
   */
  private formatSkillContent(skill: Skill): string {
    const header = `🧠 **${skill.name}** (${skill.type} skill)\n\n`;
    const description = `*${skill.description}*\n\n`;
    const skillPath = `📁 Skill location: \`${skill.skillPath}\`\n\n`;

    // Extract content after frontmatter
    const contentMatch = skill.content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
    const mainContent = contentMatch ? contentMatch[1].trim() : skill.content;

    return header + description + skillPath + mainContent;
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
}
