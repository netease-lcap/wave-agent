import { describe, it, expect, vi } from "vitest";
import { MemoryRuleService } from "../../src/services/MemoryRuleService.js";
import * as fs from "fs";
import * as nodeFs from "node:fs";
import * as path from "node:path";

vi.mock("fs", () => ({
  readFileSync: vi.fn(),
}));

// Only the worktree probe is stubbed; everything else keeps the real builtin so
// the logger and other importers behave normally.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, statSync: vi.fn(), readFileSync: vi.fn() };
});

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

    it("should parse a rule whose paths use a block scalar", async () => {
      // 块标量写法以前会让 paths 变成字面量 ">-"，规则永远匹配不到文件
      // （spec core/memory-management 场景 4）。
      const content = `---
paths: >-
  src/api/**/*.ts
  src/server/**/*.ts
priority: 5
---
# Rule Content`;
      vi.mocked(fs.readFileSync).mockReturnValue(content);

      const rule = await service.parseRule(
        content,
        "/path/to/rule.md",
        "project",
      );

      expect(rule.metadata.paths).toEqual([
        "src/api/**/*.ts src/server/**/*.ts",
      ]);
      expect(rule.metadata.priority).toBe(5);
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

    it("should normalize absolute paths relative to workdir", () => {
      const rule = {
        metadata: { paths: ["src/**/*.ts"] },
      } as unknown as import("../../src/types/memoryRule.js").MemoryRule;
      const workdir = "/home/user/project";
      const absolutePath = "/home/user/project/src/index.ts";

      expect(service.isRuleActive(rule, [absolutePath], workdir)).toBe(true);
    });

    it("should still match relative paths", () => {
      const rule = {
        metadata: { paths: ["src/**/*.ts"] },
      } as unknown as import("../../src/types/memoryRule.js").MemoryRule;
      const workdir = "/home/user/project";
      const relativePath = "src/index.ts";

      expect(service.isRuleActive(rule, [relativePath], workdir)).toBe(true);
    });

    it("resolves patterns against the rule's own base, not the session workdir", () => {
      // A bash `cd` moves the session workdir; the rule still covers its project.
      const baseDir = path.resolve("/repo");
      const rule = {
        metadata: { paths: ["src/**/*.ts"] },
        baseDir,
      } as unknown as import("../../src/types/memoryRule.js").MemoryRule;

      expect(
        service.isRuleActive(rule, [path.join(baseDir, "src", "a.ts")], "/tmp"),
      ).toBe(true);
    });

    it("does not activate for a file outside the base, even with a ** pattern", () => {
      const baseDir = path.resolve("/repo");
      const rule = {
        metadata: { paths: ["**/*.ts"] },
        baseDir,
      } as unknown as import("../../src/types/memoryRule.js").MemoryRule;

      expect(
        service.isRuleActive(
          rule,
          [path.join(path.resolve("/other"), "a.ts")],
          baseDir,
        ),
      ).toBe(false);
    });

    it("matches files read from a linked worktree through the checkout mapping", () => {
      const baseDir = path.resolve("/repo");
      const worktree = path.join(baseDir, ".wave", "worktrees", "wt");
      const worktreeGitfile = path.join(worktree, ".git");
      const checkoutGitDir = path.join(baseDir, ".git", "worktrees", "wt");

      vi.mocked(nodeFs.statSync).mockImplementation((p) => {
        if (String(p) === worktreeGitfile) {
          return {
            isFile: () => true,
          } as unknown as ReturnType<typeof fs.statSync>;
        }
        throw Object.assign(new Error(`ENOENT: ${String(p)}`), {
          code: "ENOENT",
        });
      });
      vi.mocked(nodeFs.readFileSync).mockImplementation((p) => {
        if (String(p) === worktreeGitfile) return `gitdir: ${checkoutGitDir}\n`;
        throw Object.assign(new Error(`ENOENT: ${String(p)}`), {
          code: "ENOENT",
        });
      });

      const rule = {
        metadata: { paths: ["src/**/*.ts"] },
        baseDir,
      } as unknown as import("../../src/types/memoryRule.js").MemoryRule;

      expect(
        service.isRuleActive(
          rule,
          [path.join(worktree, "src", "a.ts")],
          baseDir,
        ),
      ).toBe(true);
    });

    it("ignores an unusable pattern instead of throwing", () => {
      const rule = {
        metadata: { paths: ["src/**/*.ts", "!(unclosed"] },
        baseDir: path.resolve("/repo"),
      } as unknown as import("../../src/types/memoryRule.js").MemoryRule;

      expect(() =>
        service.isRuleActive(rule, ["src/a.ts"], path.resolve("/repo")),
      ).not.toThrow();
    });
  });
});
