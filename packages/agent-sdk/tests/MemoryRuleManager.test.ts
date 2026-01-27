import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryRuleManager } from "../src/managers/MemoryRuleManager.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { logger } from "../src/utils/globalLogger.js";

vi.mock("node:fs/promises");
vi.mock("node:os");
vi.mock("../src/utils/globalLogger.js");

describe("MemoryRuleManager", () => {
  const workdir = "/test/workdir";
  const homedir = "/home/user";
  let manager: MemoryRuleManager;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(os.homedir).mockReturnValue(homedir);
    vi.mocked(fs.realpath).mockImplementation(async (p) => p.toString());
    vi.mocked(fs.stat).mockImplementation(async (p) => {
      if (p.toString().endsWith(".md")) {
        return { isDirectory: () => false } as unknown as Awaited<
          ReturnType<typeof fs.stat>
        >;
      }
      return { isDirectory: () => true } as unknown as Awaited<
        ReturnType<typeof fs.stat>
      >;
    });
    manager = new MemoryRuleManager({ workdir });
  });

  describe("discoverRules", () => {
    it("should correctly scan directories and discover rules", async () => {
      const projectRulesDir = path.join(workdir, ".wave", "rules");
      const userRulesDir = path.join(homedir, ".wave", "rules");

      vi.mocked(fs.readdir).mockImplementation(async (dir) => {
        if (dir === userRulesDir) {
          return [
            { isFile: () => true, name: "user-rule1.md" },
          ] as unknown as Awaited<ReturnType<typeof fs.readdir>>;
        }
        if (dir === projectRulesDir) {
          return [
            { isFile: () => true, name: "project-rule1.md" },
          ] as unknown as Awaited<ReturnType<typeof fs.readdir>>;
        }
        return [] as unknown as Awaited<ReturnType<typeof fs.readdir>>;
      });

      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        if (
          typeof filePath === "string" &&
          filePath.includes("user-rule1.md")
        ) {
          return "---\npaths:\n  - src/**/*.ts\n---\nUser rule content";
        }
        if (
          typeof filePath === "string" &&
          filePath.includes("project-rule1.md")
        ) {
          return "---\npriority: 10\n---\nProject rule content";
        }
        return "";
      });

      await manager.discoverRules();

      const activeRules = manager.getActiveRules(["src/index.ts"]);
      expect(activeRules).toHaveLength(2);

      const userRule = activeRules.find((r) => r.source === "user");
      expect(userRule?.content).toBe("User rule content");

      const projectRule = activeRules.find((r) => r.source === "project");
      expect(projectRule?.content).toBe("Project rule content");
    });

    it("should handle missing directories gracefully (ENOENT)", async () => {
      vi.mocked(fs.readdir).mockRejectedValue({ code: "ENOENT" });
      await expect(manager.discoverRules()).resolves.not.toThrow();
      expect(manager.getActiveRules([])).toHaveLength(0);
    });

    it("should log error for other readdir errors", async () => {
      const error = new Error("Permission denied") as NodeJS.ErrnoException;
      error.code = "EACCES";
      vi.mocked(fs.readdir).mockRejectedValue(error);

      await manager.discoverRules();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe("getActiveRules", () => {
    it("should filter rules based on files in context", async () => {
      const projectRulesDir = path.join(workdir, ".wave", "rules");
      vi.mocked(fs.readdir).mockImplementation(async (dir) => {
        if (dir === projectRulesDir) {
          return [
            { isFile: () => true, name: "rule1.md" },
            { isFile: () => true, name: "rule2.md" },
          ] as unknown as Awaited<ReturnType<typeof fs.readdir>>;
        }
        return [] as unknown as Awaited<ReturnType<typeof fs.readdir>>;
      });

      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        if (typeof filePath === "string" && filePath.includes("rule1.md"))
          return '---\npaths:\n  - "*.ts"\n---\nRule 1';
        if (typeof filePath === "string" && filePath.includes("rule2.md"))
          return '---\npaths:\n  - "*.js"\n---\nRule 2';
        return "";
      });

      await manager.discoverRules();

      expect(manager.getActiveRules(["index.ts"])).toHaveLength(1);
      expect(manager.getActiveRules(["index.js"])).toHaveLength(1);
      expect(manager.getActiveRules(["index.ts", "index.js"])).toHaveLength(2);
      expect(manager.getActiveRules(["README.md"])).toHaveLength(0);
    });
  });

  describe("Prioritization and Overriding", () => {
    it("should allow project rules to override user rules with the same ID", async () => {
      const projectRulesDir = path.join(workdir, ".wave", "rules");
      const userRulesDir = path.join(homedir, ".wave", "rules");

      vi.mocked(fs.readdir).mockImplementation(async (dir) => {
        if (dir === userRulesDir || dir === projectRulesDir) {
          return [
            { isFile: () => true, name: "common.md" },
          ] as unknown as Awaited<ReturnType<typeof fs.readdir>>;
        }
        return [] as unknown as Awaited<ReturnType<typeof fs.readdir>>;
      });

      vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
        if (typeof filePath === "string" && filePath.includes(userRulesDir))
          return "User version";
        if (typeof filePath === "string" && filePath.includes(projectRulesDir))
          return "Project version";
        return "";
      });

      const { MemoryRuleService } = await import(
        "../src/services/MemoryRuleService.js"
      );
      const parseRuleSpy = vi.spyOn(MemoryRuleService.prototype, "parseRule");
      parseRuleSpy.mockImplementation((content, filePath, source) => {
        return {
          id: "common-id",
          content: content.trim(),
          metadata: {},
          source,
          filePath,
        };
      });

      await manager.discoverRules();

      const rules = manager.getActiveRules([]);
      expect(rules).toHaveLength(1);
      expect(rules[0].source).toBe("project");
      expect(rules[0].content).toBe("Project version");

      parseRuleSpy.mockRestore();
    });
  });
});
