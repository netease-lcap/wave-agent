import { readdir, stat } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import type {
  SkillManagerOptions,
  SkillMetadata,
  Skill,
  SkillCollection,
  SkillDiscoveryResult,
  SkillToolArgs,
  SkillInvocationContext,
  Logger,
} from "../types/index.js";
import { parseSkillFile, formatSkillError } from "../utils/skillParser.js";

/**
 * Manages skill discovery and loading
 */
export class SkillManager {
  private personalSkillsPath: string;
  private scanTimeout: number;
  private logger?: Logger;
  private workdir: string;

  private skillMetadata = new Map<string, SkillMetadata>();
  private skillContent = new Map<string, Skill>();
  private initialized = false;

  constructor(options: SkillManagerOptions = {}) {
    this.personalSkillsPath =
      options.personalSkillsPath || join(homedir(), ".wave", "skills");
    this.scanTimeout = options.scanTimeout || 5000;
    this.logger = options.logger;
    this.workdir = options.workdir || process.cwd();
  }

  /**
   * Initialize the skill manager by discovering available skills
   */
  async initialize(): Promise<void> {
    this.logger?.debug("Initializing SkillManager...");

    try {
      // Clear existing data before discovery
      this.skillMetadata.clear();
      this.skillContent.clear();

      const discovery = await this.discoverSkills();

      // Store discovered skill metadata
      discovery.personalSkills.forEach((skill, name) => {
        this.skillMetadata.set(name, skill);
      });
      discovery.projectSkills.forEach((skill, name) => {
        this.skillMetadata.set(name, skill);
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
      this.logger?.debug(
        `SkillManager initialized with ${this.skillMetadata.size} skills`,
      );
    } catch (error) {
      this.logger?.error("Failed to initialize SkillManager:", error);
      throw error;
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
      this.logger?.debug(`Skill '${skillName}' retrieved from loaded content`);
      return skill;
    }

    this.logger?.debug(`Skill '${skillName}' not found`);
    return null;
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
      this.workdir,
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

            // Create full skill object with content
            const skill: Skill = {
              name: parsed.skillMetadata.name,
              description: parsed.skillMetadata.description,
              type: type, // Use the collection type
              skillPath: parsed.skillMetadata.skillPath,
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
   * Execute a skill by name
   */
  async executeSkill(
    args: SkillToolArgs,
  ): Promise<{ content: string; context?: SkillInvocationContext }> {
    const { skill_name } = args;

    this.logger?.debug(`Invoking skill: ${skill_name}`);

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
