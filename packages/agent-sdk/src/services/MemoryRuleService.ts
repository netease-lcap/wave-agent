import { Minimatch } from "minimatch";
import type { MemoryRule, MemoryRuleMetadata } from "../types/memoryRule.js";
import { parseFrontmatter } from "../utils/markdownParser.js";
import { relativizeTriggerPath } from "../utils/worktreePaths.js";
import { logger } from "../utils/globalLogger.js";

/**
 * Compiled `paths` patterns, keyed by the pattern text. Rule matching runs once
 * per read file per rule, so recompiling the same globs every time is the hot
 * path; invalid patterns are cached as `null` and warned about once.
 */
const matcherCache = new Map<string, Minimatch | null>();
const warnedPatterns = new Set<string>();

function getMatcher(pattern: string): Minimatch | null {
  const cached = matcherCache.get(pattern);
  if (cached !== undefined) return cached;

  let matcher: Minimatch | null = null;
  try {
    matcher = new Minimatch(pattern, { dot: true });
  } catch (error) {
    if (!warnedPatterns.has(pattern)) {
      warnedPatterns.add(pattern);
      logger.warn(
        `Ignoring unusable paths pattern "${pattern}" in a memory rule: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  matcherCache.set(pattern, matcher);
  return matcher;
}

export class MemoryRuleService {
  /**
   * Parses a markdown file into a MemoryRule object.
   */
  parseRule(
    content: string,
    filePath: string,
    source: "project" | "user",
  ): MemoryRule {
    const { frontmatter, content: bodyContent } = parseFrontmatter(content);

    const metadata: MemoryRuleMetadata = {};
    if (frontmatter) {
      if (Array.isArray(frontmatter.paths)) {
        metadata.paths = frontmatter.paths.filter(
          (p): p is string => typeof p === "string",
        );
      } else if (typeof frontmatter.paths === "string") {
        metadata.paths = [frontmatter.paths];
      }

      if (typeof frontmatter.priority === "number") {
        metadata.priority = frontmatter.priority;
      } else if (typeof frontmatter.priority === "string") {
        const parsed = parseInt(frontmatter.priority, 10);
        if (!isNaN(parsed)) {
          metadata.priority = parsed;
        }
      }
    }

    return {
      id: filePath, // Use absolute path as ID for now
      content: bodyContent.trim(),
      metadata,
      source,
      filePath,
    };
  }

  /**
   * Determines if a rule matches any of the given file paths.
   *
   * Patterns are resolved against the rule's own base directory (`baseDir`,
   * stamped by MemoryRuleManager) rather than the session workdir, so a bash
   * `cd` never shifts what a rule covers. Files that cannot be expressed
   * relative to that base — outside it, or in a linked worktree (mapped back to
   * its checkout first) — do not activate the rule.
   */
  isRuleActive(
    rule: MemoryRule,
    filesInContext: string[],
    workdir?: string,
  ): boolean {
    if (!rule.metadata.paths || rule.metadata.paths.length === 0) {
      return true;
    }

    const baseDir = rule.baseDir ?? workdir;
    const patterns = rule.metadata.paths;

    return filesInContext.some((filePath) => {
      const normalizedPath =
        baseDir === undefined
          ? filePath
          : relativizeTriggerPath(filePath, baseDir);
      if (normalizedPath === null) return false;

      return patterns.some((pattern) => {
        const matcher = getMatcher(pattern);
        if (matcher === null) return false;
        return matcher.match(normalizedPath);
      });
    });
  }
}
