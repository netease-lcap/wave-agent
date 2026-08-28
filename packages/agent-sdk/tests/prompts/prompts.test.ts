import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildSystemPrompt,
  DEFAULT_SYSTEM_PROMPT,
  type SystemPromptBlock,
} from "../../src/prompts/index.js";
import * as os from "node:os";
import { isGitRepository } from "../../src/utils/gitUtils.js";
import type { WorktreeSession } from "../../src/utils/worktreeSession.js";

vi.mock("node:os");
vi.mock("../../src/utils/gitUtils.js");

/** Flatten SystemPromptBlock[] into a single string for string-based assertions */
function flattenBlocks(blocks: SystemPromptBlock[]): string {
  return blocks.map((b) => b.text).join("\n\n");
}

const worktreeSessionActive: WorktreeSession = {
  originalCwd: "/original/repo",
  worktreePath: "/original/repo/.wave/worktrees/test-feature",
  worktreeBranch: "wave-test-feature",
  worktreeName: "test-feature",
  isNew: true,
  repoRoot: "/original/repo",
};

describe("prompts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("buildSystemPrompt", () => {
    it("should include environment details when workdir is provided", () => {
      const originalShell = process.env.SHELL;
      process.env.SHELL = "/bin/zsh";

      vi.mocked(isGitRepository).mockReturnValue("Yes");
      vi.mocked(os.platform).mockReturnValue("linux");
      vi.mocked(os.type).mockReturnValue("Linux");
      vi.mocked(os.release).mockReturnValue("6.8.0");

      const result = flattenBlocks(
        buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
          workdir: "/some/path",
        }),
      );

      expect(result).toContain("# Environment");
      expect(result).toContain(
        "You have been invoked in the following environment:",
      );
      expect(result).toContain("Shell: zsh");
      expect(result).toContain("Primary working directory: /some/path");
      expect(result).toContain("Is a git repository: Yes");
      expect(result).toContain("OS Version: Linux 6.8.0");

      process.env.SHELL = originalShell;
    });

    it("should use originalWorkdir for Primary working directory when provided", () => {
      const result = flattenBlocks(
        buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
          workdir: "/some/path/subdir",
          originalWorkdir: "/some/path",
        }),
      );

      expect(result).toContain("Primary working directory: /some/path");
      expect(result).not.toContain(
        "Primary working directory: /some/path/subdir",
      );
    });

    it("should fall back to workdir when originalWorkdir is not provided", () => {
      const result = flattenBlocks(
        buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
          workdir: "/some/path",
        }),
      );

      expect(result).toContain("Primary working directory: /some/path");
    });

    it("should handle bash shell in buildSystemPrompt", () => {
      const originalShell = process.env.SHELL;
      process.env.SHELL = "/bin/bash";

      const result = flattenBlocks(
        buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
          workdir: "/some/path",
        }),
      );
      expect(result).toContain("Shell: bash");

      process.env.SHELL = originalShell;
    });

    it("should handle unknown shell in buildSystemPrompt", () => {
      const originalShell = process.env.SHELL;
      delete process.env.SHELL;

      const result = flattenBlocks(
        buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
          workdir: "/some/path",
        }),
      );
      expect(result).toContain("Shell: unknown");

      process.env.SHELL = originalShell;
    });

    it("should include autoMemory when provided", () => {
      const result = flattenBlocks(
        buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
          autoMemory: { directory: "/mem", content: "Memory Content" },
        }),
      );
      expect(result).toContain("auto memory");
      expect(result).toContain("## MEMORY.md\n\nMemory Content");
    });

    it("should handle empty autoMemory content", () => {
      const result = flattenBlocks(
        buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
          autoMemory: { directory: "/mem", content: "" },
        }),
      );
      expect(result).toContain("auto memory");
      expect(result).not.toContain("## MEMORY.md");
    });

    it("should include language when provided", () => {
      const result = flattenBlocks(
        buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
          language: "Spanish",
        }),
      );
      expect(result).toContain("# Language\nAlways respond in Spanish.");
    });

    it("should not include plan mode in system prompt (moved to system-reminder messages)", () => {
      const result = flattenBlocks(
        buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {}),
      );
      expect(result).not.toContain("Plan mode is active.");
    });

    it("should not include memory context in system prompt (moved to messages array)", () => {
      const result = flattenBlocks(
        buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {}),
      );
      expect(result).not.toContain("## Memory Context");
    });

    it("should include worktree warning when worktree session is active", () => {
      const result = flattenBlocks(
        buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
          workdir: "/original/repo/.wave/worktrees/test-feature",
          worktreeSession: worktreeSessionActive,
        }),
      );

      expect(result).toContain("This is a git worktree");
      expect(result).toContain("Do NOT `cd` to the original repository root.");
      expect(result).not.toContain("original repository root at");
    });

    it("should not include worktree warning when no worktree session", () => {
      const result = flattenBlocks(
        buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
          workdir: "/some/path",
        }),
      );

      expect(result).not.toContain("This is a git worktree");
      expect(result).not.toContain("original repository root");
    });

    it("should use subagent env format (Notes + <env>) when isSubagent is true", () => {
      const originalShell = process.env.SHELL;
      process.env.SHELL = "/bin/bash";

      vi.mocked(isGitRepository).mockReturnValue("Yes");
      vi.mocked(os.platform).mockReturnValue("linux");
      vi.mocked(os.type).mockReturnValue("Linux");
      vi.mocked(os.release).mockReturnValue("6.8.0");

      const result = flattenBlocks(
        buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
          workdir: "/some/path",
          isSubagent: true,
        }),
      );

      expect(result).toContain("Notes:");
      expect(result).toContain(
        "Agent threads always have their cwd reset between bash calls",
      );
      expect(result).toContain(
        "Here is useful information about the environment you are running in:",
      );
      expect(result).toContain("<env>");
      expect(result).toContain("Working directory: /some/path");
      expect(result).toContain("Is directory a git repo: Yes");
      expect(result).not.toContain("# Environment");
      expect(result).not.toContain("Primary working directory");
      expect(result).not.toContain("Today's date");

      process.env.SHELL = originalShell;
    });

    it("should not include worktree warning in subagent env format", () => {
      const result = flattenBlocks(
        buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
          workdir: "/original/repo/.wave/worktrees/test-feature",
          worktreeSession: worktreeSessionActive,
          isSubagent: true,
        }),
      );

      expect(result).not.toContain("This is a git worktree");
      expect(result).not.toContain("original repository root");
    });

    it("should list additional working directories as bullets in main agent env", () => {
      const result = flattenBlocks(
        buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
          workdir: "/some/path",
          additionalWorkingDirectories: ["/some/path/config", "/opt/shared"],
        }),
      );

      expect(result).toContain("Additional working directories:");
      expect(result).toContain("  - /some/path/config");
      expect(result).toContain("  - /opt/shared");
      // Title appears before the first bullet
      expect(result.indexOf("Additional working directories:")).toBeLessThan(
        result.indexOf("  - /some/path/config"),
      );
    });

    it("should not include additional working directories section when empty", () => {
      const result = flattenBlocks(
        buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
          workdir: "/some/path",
        }),
      );

      expect(result).not.toContain("Additional working directories:");
    });

    it("should list additional working directories on a single line in subagent env", () => {
      const result = flattenBlocks(
        buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
          workdir: "/some/path",
          isSubagent: true,
          additionalWorkingDirectories: ["/some/path/config", "/opt/shared"],
        }),
      );

      expect(result).toContain(
        "Additional working directories: /some/path/config, /opt/shared",
      );
    });

    it("should append Unix shell syntax hint when platform is win32", () => {
      const originalShell = process.env.SHELL;
      process.env.SHELL = "/bin/bash";

      vi.mocked(os.platform).mockReturnValue("win32");

      const result = flattenBlocks(
        buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
          workdir: "/some/path",
        }),
      );
      expect(result).toContain(
        "Shell: bash (use Unix shell syntax, not Windows — e.g., /dev/null not NUL, forward slashes in paths)",
      );

      process.env.SHELL = originalShell;
    });

    it("should use friendly OS version on win32", () => {
      vi.mocked(os.platform).mockReturnValue("win32");
      vi.mocked(os.version).mockReturnValue("Windows 11 Pro");
      vi.mocked(os.release).mockReturnValue("10.0.26100");

      const result = flattenBlocks(
        buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
          workdir: "/some/path",
        }),
      );
      expect(result).toContain("OS Version: Windows 11 Pro 10.0.26100");
    });

    it("should not include Today's date in the env section", () => {
      vi.mocked(os.platform).mockReturnValue("linux");
      vi.mocked(os.type).mockReturnValue("Linux");
      vi.mocked(os.release).mockReturnValue("6.8.0");

      const result = flattenBlocks(
        buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
          workdir: "/some/path",
        }),
      );
      expect(result).not.toContain("Today's date");
    });
  });

  describe("buildSystemPrompt block structure", () => {
    it("should return an array of SystemPromptBlock", () => {
      const blocks = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
        workdir: "/some/path",
      });

      expect(Array.isArray(blocks)).toBe(true);
      expect(blocks.length).toBeGreaterThanOrEqual(1);
      blocks.forEach((block) => {
        expect(block).toHaveProperty("text");
        expect(block).toHaveProperty("cacheable");
        expect(typeof block.text).toBe("string");
        expect(typeof block.cacheable).toBe("boolean");
      });
    });

    it("should mark the first block as cacheable (static)", () => {
      const blocks = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
        workdir: "/some/path",
      });

      expect(blocks[0].cacheable).toBe(true);
      expect(blocks[0].text).toContain(DEFAULT_SYSTEM_PROMPT);
    });

    it("should mark dynamic blocks as not cacheable", () => {
      const blocks = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
        workdir: "/some/path",
        autoMemory: { directory: "/mem", content: "some memory" },
      });

      // Find the dynamic block (contains env info)
      const dynamicBlock = blocks.find((b) => !b.cacheable);
      expect(dynamicBlock).toBeDefined();
      expect(dynamicBlock!.text).toContain("Primary working directory");
      expect(dynamicBlock!.text).toContain("auto memory");
    });

    it("should keep static block stable regardless of dynamic content changes", () => {
      const blocks1 = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
        workdir: "/path/a",
      });
      const blocks2 = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
        workdir: "/path/b",
      });

      // Static block (cacheable) should be identical regardless of workdir
      const static1 = blocks1
        .filter((b) => b.cacheable)
        .map((b) => b.text)
        .join("\n\n");
      const static2 = blocks2
        .filter((b) => b.cacheable)
        .map((b) => b.text)
        .join("\n\n");
      expect(static1).toBe(static2);

      // Dynamic blocks should differ
      const dynamic1 = blocks1
        .filter((b) => !b.cacheable)
        .map((b) => b.text)
        .join("\n\n");
      const dynamic2 = blocks2
        .filter((b) => !b.cacheable)
        .map((b) => b.text)
        .join("\n\n");
      expect(dynamic1).not.toBe(dynamic2);
    });
  });
});
