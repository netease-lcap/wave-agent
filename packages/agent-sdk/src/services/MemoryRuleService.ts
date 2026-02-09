import { minimatch } from "minimatch";
import * as path from "node:path";
import { parseFrontmatter } from "../utils/markdownParser.js";
import type { MemoryRule, MemoryRuleMetadata } from "../types/memoryRule.js";

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
   * Determines if a rule matches any of the given file paths using minimatch.
   */
  isRuleActive(
    rule: MemoryRule,
    filesInContext: string[],
    workdir?: string,
  ): boolean {
    if (!rule.metadata.paths || rule.metadata.paths.length === 0) {
      return true;
    }

    return filesInContext.some((filePath) => {
      // Normalize path relative to workdir if it's an absolute path
      let normalizedPath = filePath;
      if (workdir && path.isAbsolute(filePath)) {
        normalizedPath = path.relative(workdir, filePath);
      }

      return rule.metadata.paths!.some((pattern) => {
        const isMatch = minimatch(normalizedPath, pattern, { dot: true });
        return isMatch;
      });
    });
  }
}
