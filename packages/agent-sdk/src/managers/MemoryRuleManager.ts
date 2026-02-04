import type { MemoryRule } from "../types/memoryRule.js";
import { MemoryRuleService } from "../services/MemoryRuleService.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { logger } from "../utils/globalLogger.js";

export interface MemoryRuleRegistryState {
  /** All discovered rules, indexed by ID */
  rules: Record<string, MemoryRule>;
  /** Set of active rule IDs based on the current context */
  activeRuleIds: Set<string>;
}

export interface MemoryRuleManagerOptions {
  workdir: string;
}

export class MemoryRuleManager {
  private state: MemoryRuleRegistryState = {
    rules: {},
    activeRuleIds: new Set(),
  };

  private workdir: string;
  private service: MemoryRuleService;

  constructor(options: MemoryRuleManagerOptions) {
    this.workdir = options.workdir;
    this.service = new MemoryRuleService();
  }

  /**
   * Scans .wave/rules and ~/.wave/rules for memory rule files.
   */
  async discoverRules(): Promise<void> {
    const projectRulesDir = path.join(this.workdir, ".wave", "rules");
    const userRulesDir = path.join(os.homedir(), ".wave", "rules");

    logger.debug(`Scanning for modular memory rules...`);
    logger.debug(`  User rules directory: ${userRulesDir}`);
    logger.debug(`  Project rules directory: ${projectRulesDir}`);

    const newRules: Record<string, MemoryRule> = {};

    // Discover user rules first, then project rules so project rules can override if needed
    // (though IDs are based on file path, so they shouldn't collide unless same path)
    await this.scanDirectory(userRulesDir, "user", newRules);
    await this.scanDirectory(projectRulesDir, "project", newRules);

    this.state.rules = newRules;
    const ruleCount = Object.keys(newRules).length;
    logger.debug(`Discovered ${ruleCount} modular memory rules`);

    if (ruleCount > 0) {
      logger.debug("Loaded memory rules:");
      for (const [id, rule] of Object.entries(newRules)) {
        const pathInfo = rule.metadata.paths
          ? `paths: ${JSON.stringify(rule.metadata.paths)}`
          : "global (no path restriction)";
        logger.debug(`  - ${id} (${rule.source}): ${pathInfo}`);
      }
    }
  }

  private async scanDirectory(
    dir: string,
    source: "project" | "user",
    registry: Record<string, MemoryRule>,
    visited: Set<string> = new Set(),
  ): Promise<void> {
    const realDir = await fs.realpath(dir).catch(() => dir);
    if (visited.has(realDir)) {
      logger.warn(
        `Circular symlink detected or directory already visited: ${dir}`,
      );
      return;
    }
    visited.add(realDir);

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const isDirectory =
          typeof entry.isDirectory === "function" ? entry.isDirectory() : false;
        const isSymbolicLink =
          typeof entry.isSymbolicLink === "function"
            ? entry.isSymbolicLink()
            : false;
        const isFile =
          typeof entry.isFile === "function" ? entry.isFile() : false;

        if (isDirectory) {
          await this.scanDirectory(fullPath, source, registry, visited);
        } else if (isSymbolicLink) {
          const stats = await fs.stat(fullPath);
          if (stats.isDirectory()) {
            await this.scanDirectory(fullPath, source, registry, visited);
          } else if (stats.isFile() && entry.name.endsWith(".md")) {
            await this.loadRuleFile(fullPath, source, registry);
          }
        } else if (isFile && entry.name.endsWith(".md")) {
          await this.loadRuleFile(fullPath, source, registry);
        } else if (
          !isDirectory &&
          !isSymbolicLink &&
          !isFile &&
          entry.name.endsWith(".md")
        ) {
          // Fallback for simple string arrays or incomplete mocks
          await this.loadRuleFile(fullPath, source, registry);
        }
      }
    } catch (error) {
      // Ignore if directory doesn't exist
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.error(`Error scanning memory rules directory ${dir}:`, error);
      }
    }
  }

  private async loadRuleFile(
    filePath: string,
    source: "project" | "user",
    registry: Record<string, MemoryRule>,
  ): Promise<void> {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const rule = this.service.parseRule(content, filePath, source);
      // Use relative path from rules root as ID to allow project rules to override user rules
      const rulesRoot =
        source === "project"
          ? path.join(this.workdir, ".wave", "rules")
          : path.join(os.homedir(), ".wave", "rules");
      const relativeId = path.relative(rulesRoot, filePath);
      rule.id = relativeId;
      registry[rule.id] = rule;
      logger.debug(`Loaded memory rule: ${relativeId} from ${filePath}`);
    } catch (error) {
      logger.error(`Failed to parse memory rule at ${filePath}:`, error);
    }
  }

  /**
   * Returns the union of all active memory rules based on the provided file paths.
   */
  getActiveRules(filesInContext: string[]): MemoryRule[] {
    const activeRules: MemoryRule[] = [];
    for (const rule of Object.values(this.state.rules)) {
      if (this.service.isRuleActive(rule, filesInContext)) {
        activeRules.push(rule);
      }
    }
    return activeRules;
  }

  /**
   * Reloads rules from disk.
   */
  async reload(): Promise<void> {
    await this.discoverRules();
  }
}
