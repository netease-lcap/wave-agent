import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildSystemPrompt,
  enhanceSystemPromptWithEnvDetails,
  DEFAULT_SYSTEM_PROMPT,
} from "../../src/prompts/index.js";
import * as os from "node:os";
import { isGitRepository } from "../../src/utils/gitUtils.js";
import * as worktreeSession from "../../src/utils/worktreeSession.js";

vi.mock("node:os");
vi.mock("../../src/utils/gitUtils.js");
vi.mock("../../src/utils/worktreeSession.js");

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

      const result = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
        workdir: "/some/path",
      });

      expect(result).toContain("Shell: zsh");
      expect(result).toContain("Working directory: /some/path");
      expect(result).toContain("Is directory a git repo: Yes");

      process.env.SHELL = originalShell;
    });

    it("should handle bash shell in buildSystemPrompt", () => {
      const originalShell = process.env.SHELL;
      process.env.SHELL = "/bin/bash";

      const result = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
        workdir: "/some/path",
      });
      expect(result).toContain("Shell: bash");

      process.env.SHELL = originalShell;
    });

    it("should handle unknown shell in buildSystemPrompt", () => {
      const originalShell = process.env.SHELL;
      delete process.env.SHELL;

      const result = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
        workdir: "/some/path",
      });
      expect(result).toContain("Shell: unknown");

      process.env.SHELL = originalShell;
    });

    it("should include autoMemory when provided", () => {
      const result = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
        autoMemory: { directory: "/mem", content: "Memory Content" },
      });
      expect(result).toContain("auto memory");
      expect(result).toContain("## MEMORY.md\n\nMemory Content");
    });

    it("should handle empty autoMemory content", () => {
      const result = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
        autoMemory: { directory: "/mem", content: "" },
      });
      expect(result).toContain("auto memory");
      expect(result).not.toContain("## MEMORY.md");
    });

    it("should include permission mode when dontAsk is selected", () => {
      const result = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
        permissionMode: "dontAsk",
      });
      expect(result).toContain("# Permission Mode");
    });

    it("should include language when provided", () => {
      const result = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
        language: "Spanish",
      });
      expect(result).toContain("# Language\nAlways respond in Spanish.");
    });

    it("should include plan mode when provided", () => {
      const result = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
        planMode: { planFilePath: "/plan.md", planExists: true },
      });
      expect(result).toContain("Plan mode is active.");
    });

    it("should include memory context when provided", () => {
      const result = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
        memory: "Historical Context",
      });
      expect(result).toContain(
        "## Memory Context\n\nThe following is important context and memory from previous interactions:\n\nHistorical Context",
      );
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

      const result = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
        workdir: "/original/repo/.wave/worktrees/test-feature",
      });

      expect(result).toContain("This is a git worktree");
      expect(result).toContain(
        "Do NOT `cd` to the original repository root at /original/repo",
      );
    });

    it("should not include worktree warning when no worktree session", () => {
      vi.mocked(worktreeSession.getCurrentWorktreeSession).mockReturnValue(
        null,
      );

      const result = buildSystemPrompt(DEFAULT_SYSTEM_PROMPT, [], {
        workdir: "/some/path",
      });

      expect(result).not.toContain("This is a git worktree");
      expect(result).not.toContain("original repository root");
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
