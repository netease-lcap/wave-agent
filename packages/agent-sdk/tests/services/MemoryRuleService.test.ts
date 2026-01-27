import { describe, it, expect, vi } from "vitest";
import { MemoryRuleService } from "../../src/services/MemoryRuleService.js";
import * as fs from "fs";

vi.mock("fs", () => ({
  readFileSync: vi.fn(),
}));

describe("MemoryRuleService", () => {
  const service = new MemoryRuleService();

  describe("parseRule", () => {
    it("should parse a rule with frontmatter", async () => {
      const content = `---
paths:
  - "src/**/*.ts"
priority: 10
---
# Rule Content
This is the rule.`;
      vi.mocked(fs.readFileSync).mockReturnValue(content);

      const rule = await service.parseRule(
        content,
        "/path/to/rule.md",
        "project",
      );

      expect(rule.id).toBe("/path/to/rule.md");
      expect(rule.content).toBe("# Rule Content\nThis is the rule.");
      expect(rule.metadata.paths).toEqual(["src/**/*.ts"]);
      expect(rule.metadata.priority).toBe(10);
      expect(rule.source).toBe("project");
      expect(rule.filePath).toBe("/path/to/rule.md");
    });

    it("should parse a rule without frontmatter", async () => {
      const content = "# Rule Content\nNo frontmatter here.";
      vi.mocked(fs.readFileSync).mockReturnValue(content);

      const rule = await service.parseRule(content, "/path/to/rule.md", "user");

      expect(rule.content).toBe("# Rule Content\nNo frontmatter here.");
      expect(rule.metadata.paths).toBeUndefined();
      expect(rule.source).toBe("user");
    });

    it("should handle malformed frontmatter gracefully", async () => {
      const content = `---
invalid yaml
---
# Rule Content`;
      vi.mocked(fs.readFileSync).mockReturnValue(content);

      const rule = await service.parseRule(
        content,
        "/path/to/rule.md",
        "project",
      );

      expect(rule.content).toBe("# Rule Content");
      expect(rule.metadata).toEqual({});
    });
  });

  describe("isRuleActive", () => {
    const ruleWithPaths = {
      metadata: { paths: ["src/**/*.ts", "lib/*.js"] },
    } as unknown as import("../../src/types/memoryRule.js").MemoryRule;

    const ruleWithoutPaths = {
      metadata: {},
    } as unknown as import("../../src/types/memoryRule.js").MemoryRule;

    it("should match if no paths are specified", () => {
      expect(service.isRuleActive(ruleWithoutPaths, ["any/file.txt"])).toBe(
        true,
      );
    });

    it("should match if a file matches one of the patterns", () => {
      expect(service.isRuleActive(ruleWithPaths, ["src/index.ts"])).toBe(true);
      expect(service.isRuleActive(ruleWithPaths, ["lib/utils.js"])).toBe(true);
    });

    it("should not match if no files match any pattern", () => {
      expect(service.isRuleActive(ruleWithPaths, ["tests/test.ts"])).toBe(
        false,
      );
      expect(service.isRuleActive(ruleWithPaths, ["lib/subdir/utils.js"])).toBe(
        false,
      );
    });

    it("should handle dot files if pattern allows", () => {
      const dotRule = {
        metadata: { paths: [".env*"] },
      } as unknown as import("../../src/types/memoryRule.js").MemoryRule;
      expect(service.isRuleActive(dotRule, [".env.local"])).toBe(true);
    });
  });
});
