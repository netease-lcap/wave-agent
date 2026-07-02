import type { MemoryRule } from "../types/memoryRule.js";
import { MemoryRuleService } from "../services/MemoryRuleService.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { logger } from "../utils/globalLogger.js";

import { Container } from "../utils/container.js";

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

  constructor(
    private container: Container,
    options: MemoryRuleManagerOptions,
  ) {
    this.workdir = options.workdir;
    this.service = new MemoryRuleService();
  }

  /**
   * Scans .wave/rules and ~/.wave/rules for memory rule files.
   */
  async discoverRules(): Promise<void> {
    const projectWaveRulesDir = path.join(this.workdir, ".wave", "rules");
    const projectClaudeRulesDir = path.join(this.workdir, ".claude", "rules");
    const userWaveRulesDir = path.join(os.homedir(), ".wave", "rules");
    const userClaudeRulesDir = path.join(os.homedir(), ".claude", "rules");

    logger.debug(`Scanning for modular memory rules...`);
    logger.debug(`  User rules directory: ${userWaveRulesDir}`);
    logger.debug(`  Project rules directory: ${projectWaveRulesDir}`);

    const newRules: Record<string, MemoryRule> = {};

    // Scan order: userClaude → userWave → projectClaude → projectWave
    // Later writes override, so .wave takes priority over .claude
    await this.scanDirectory(userClaudeRulesDir, "user", newRules);
    await this.scanDirectory(userWaveRulesDir, "user", newRules);
    await this.scanDirectory(projectClaudeRulesDir, "project", newRules);
    await this.scanDirectory(projectWaveRulesDir, "project", newRules);

    this.state.rules = newRules;
    const ruleCount = Object.keys(newRules).length;
    logger.debug(`Discovered ${ruleCount} modular memory rules`);
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

      // Determine rulesRoot dynamically based on actual file path
      let rulesRoot: string;
      if (source === "project") {
        if (filePath.includes(path.join(".claude", "rules"))) {
          rulesRoot = path.join(this.workdir, ".claude", "rules");
        } else {
          rulesRoot = path.join(this.workdir, ".wave", "rules");
        }
      } else {
        if (filePath.includes(path.join(".claude", "rules"))) {
          rulesRoot = path.join(os.homedir(), ".claude", "rules");
        } else {
          rulesRoot = path.join(os.homedir(), ".wave", "rules");
        }
      }

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
      if (this.service.isRuleActive(rule, filesInContext, this.workdir)) {
        activeRules.push(rule);
      }
    }
    return activeRules;
  }

  /**
   * Returns rules split by type:
   * - unconditional: rules with no `paths` metadata (always active)
   * - conditional: rules with `paths` metadata that match filesInContext
   */
  getActiveRulesSplit(filesInContext: string[]): {
    unconditional: MemoryRule[];
    conditional: MemoryRule[];
  } {
    const unconditional: MemoryRule[] = [];
    const conditional: MemoryRule[] = [];
    for (const rule of Object.values(this.state.rules)) {
      if (!rule.metadata.paths || rule.metadata.paths.length === 0) {
        unconditional.push(rule);
      } else if (
        this.service.isRuleActive(rule, filesInContext, this.workdir)
      ) {
        conditional.push(rule);
      }
    }
    return { unconditional, conditional };
  }

  /**
   * Reloads rules from disk.
   */
  async reload(): Promise<void> {
    await this.discoverRules();
  }
}
