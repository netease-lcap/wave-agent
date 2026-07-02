import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildSystemPrompt,
  enhanceSystemPromptWithEnvDetails,
  DEFAULT_SYSTEM_PROMPT,
  type SystemPromptBlock,
} from "../../src/prompts/index.js";
import * as os from "node:os";
import { isGitRepository } from "../../src/utils/gitUtils.js";
import * as worktreeSession from "../../src/utils/worktreeSession.js";

vi.mock("node:os");
vi.mock("../../src/utils/gitUtils.js");
vi.mock("../../src/utils/worktreeSession.js");

/** Flatten SystemPromptBlock[] into a single string for string-based assertions */
function flattenBlocks(blocks: SystemPromptBlock[]): string {
  return blocks.map((b) => b.text).join("\n\n");
}

describe("prompts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("enhanceSystemPromptWithEnvDetails", () => {
    it("should cover all shell branches (zsh)", () => {
      const originalShell = process.env.SHELL;
      process.env.SHELL = "/bin/zsh";

      vi.mocked(isGitRepository).mockReturnValue("Yes");
      vi.mocked(os.platform).mockReturnValue("linux");
      vi.mocked(os.type).mockReturnValue("Linux");
      vi.mocked(os.release).mockReturnValue("6.8.0");

      const result = enhanceSystemPromptWithEnvDetails(
        "Existing Prompt",
        "/some/path",
      );

      expect(result).toContain("Shell: zsh");
      expect(result).toContain("Is directory a git repo: Yes");
      expect(result).toContain("Platform: linux");
      expect(result).toContain("OS Version: Linux 6.8.0");

      process.env.SHELL = originalShell;
    });

    it("should cover all shell branches (bash)", () => {
      const originalShell = process.env.SHELL;
      process.env.SHELL = "/bin/bash";

      vi.mocked(isGitRepository).mockReturnValue("No");
      vi.mocked(os.platform).mockReturnValue("darwin");
      vi.mocked(os.type).mockReturnValue("Darwin");
      vi.mocked(os.release).mockReturnValue("23.0.0");

      const result = enhanceSystemPromptWithEnvDetails(
        "Existing Prompt",
        "/some/path",
      );

      expect(result).toContain("Shell: bash");
      expect(result).toContain("Is directory a git repo: No");
      expect(result).toContain("Platform: darwin");
      expect(result).toContain("OS Version: Darwin 23.0.0");

      process.env.SHELL = originalShell;
    });

    it("should cover all shell branches (unknown/other)", () => {
      const originalShell = process.env.SHELL;
      process.env.SHELL = "/usr/bin/fish";

      const result = enhanceSystemPromptWithEnvDetails(
        "Existing Prompt",
        "/some/path",
      );
      expect(result).toContain("Shell: /usr/bin/fish");

      delete process.env.SHELL;
      const result2 = enhanceSystemPromptWithEnvDetails(
        "Existing Prompt",
        "/some/path",
      );
      expect(result2).toContain("Shell: unknown");

      process.env.SHELL = originalShell;
    });
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

      expect(result).toContain("Shell: zsh");
      expect(result).toContain("Primary working directory: /some/path");
      expect(result).toContain("Is directory a git repo: Yes");

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

    it("should include permission mode when dontAsk is selected", () => {
      const result = flattenBlocks(
        buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
          permissionMode: "dontAsk",
        }),
      );
      expect(result).toContain("# Permission Mode");
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
      vi.mocked(worktreeSession.getCurrentWorktreeSession).mockReturnValue({
        originalCwd: "/original/repo",
        worktreePath: "/original/repo/.wave/worktrees/test-feature",
        worktreeBranch: "wave-test-feature",
        worktreeName: "test-feature",
        isNew: true,
        repoRoot: "/original/repo",
      });

      const result = flattenBlocks(
        buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
          workdir: "/original/repo/.wave/worktrees/test-feature",
        }),
      );

      expect(result).toContain("This is a git worktree");
      expect(result).toContain(
        "Do NOT `cd` to the original repository root at /original/repo",
      );
    });

    it("should not include worktree warning when no worktree session", () => {
      vi.mocked(worktreeSession.getCurrentWorktreeSession).mockReturnValue(
        null,
      );

      const result = flattenBlocks(
        buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
          workdir: "/some/path",
        }),
      );

      expect(result).not.toContain("This is a git worktree");
      expect(result).not.toContain("original repository root");
    });
  });

  describe("buildSystemPrompt block structure", () => {
    it("should return an array of SystemPromptBlock", () => {
      const blocks = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
        workdir: "/some/path",
        permissionMode: "dontAsk",
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
        permissionMode: "dontAsk",
        autoMemory: { directory: "/mem", content: "some memory" },
      });

      // Find the dynamic block (contains env info)
      const dynamicBlock = blocks.find((b) => !b.cacheable);
      expect(dynamicBlock).toBeDefined();
      expect(dynamicBlock!.text).toContain("Primary working directory");
      expect(dynamicBlock!.text).toContain("# Permission Mode");
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

  describe("enhanceSystemPromptWithEnvDetails worktree", () => {
    it("should include worktree warning in enhanceSystemPromptWithEnvDetails", () => {
      vi.mocked(worktreeSession.getCurrentWorktreeSession).mockReturnValue({
        originalCwd: "/original/repo",
        worktreePath: "/original/repo/.wave/worktrees/fix-bug",
        worktreeBranch: "wave-fix-bug",
        worktreeName: "fix-bug",
        isNew: true,
        repoRoot: "/original/repo",
      });

      const result = enhanceSystemPromptWithEnvDetails(
        "Existing Prompt",
        "/original/repo/.wave/worktrees/fix-bug",
      );

      expect(result).toContain("This is a git worktree");
      expect(result).toContain(
        "Do NOT `cd` to the original repository root at /original/repo",
      );
      expect(result).toContain(
        "Absolute paths from prior context may refer to the original repo",
      );
      expect(result).toContain("Do NOT edit files outside this worktree");
    });

    it("should not include worktree warning when no session in enhanceSystemPromptWithEnvDetails", () => {
      vi.mocked(worktreeSession.getCurrentWorktreeSession).mockReturnValue(
        null,
      );

      const result = enhanceSystemPromptWithEnvDetails(
        "Existing Prompt",
        "/some/path",
      );

      expect(result).not.toContain("This is a git worktree");
      expect(result).not.toContain("original repo");
    });
  });
});
