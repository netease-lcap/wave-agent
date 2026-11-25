import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveShellPath,
  WINDOWS_GIT_BASH_PATHS,
  __resetShellResolverWarnMemoForTesting,
} from "../../src/utils/shellResolver.js";
import { logger } from "../../src/utils/globalLogger.js";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

vi.mock("node:fs");
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
  spawnSync: vi.fn(),
}));

/**
 * A fake Windows disk for one test: exactly the paths passed here "exist".
 * Keys are built with `path.win32` on both platforms, like the resolver does,
 * so the suite is identical on the Windows runner.
 */
function fakeDisk(...existing: string[]): void {
  const files = new Set(existing);
  vi.mocked(fs.existsSync).mockImplementation((p) => files.has(String(p)));
}

const WIN = path.win32;
const FIXED_GIT = "C:\\Program Files\\Git\\cmd\\git.exe";
const FIXED_BASH = "C:\\Program Files\\Git\\bin\\bash.exe";
const GIT_ON_D = "D:\\Program Files\\Git";
const SHIM_DIR = "C:\\shim";

describe("shellResolver", () => {
  const originalPlatform = process.platform;
  const originalEnv = { ...process.env };
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetShellResolverWarnMemoForTesting();
    warnSpy = vi.spyOn(logger, "warn");
    delete process.env.WAVE_GIT_BASH_PATH;
    delete process.env.LOCALAPPDATA;
    delete process.env.WAVE_SHELL;
    delete process.env.SHELL;
    delete process.env.PATH;
    delete process.env.PATHEXT;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(process, "platform", { value: originalPlatform });
    process.env = { ...originalEnv };
  });

  describe("non-Windows platform", () => {
    it("returns WAVE_SHELL override when it points to an executable bash", () => {
      Object.defineProperty(process, "platform", { value: "linux" });
      process.env.WAVE_SHELL = "/custom/bash";
      vi.mocked(fs.accessSync).mockImplementation(() => undefined);
      expect(resolveShellPath()).toBe("/custom/bash");
    });

    it("returns WAVE_SHELL override when it points to an executable zsh", () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      process.env.WAVE_SHELL = "/opt/homebrew/bin/zsh";
      vi.mocked(fs.accessSync).mockImplementation(() => undefined);
      expect(resolveShellPath()).toBe("/opt/homebrew/bin/zsh");
    });

    it("ignores WAVE_SHELL when it is not bash/zsh", () => {
      Object.defineProperty(process, "platform", { value: "linux" });
      process.env.WAVE_SHELL = "/bin/sh";
      vi.mocked(fs.accessSync).mockImplementation(() => undefined);
      const result = resolveShellPath();
      expect(result).not.toBe("/bin/sh");
      // falls through to fixed-path resolution
      expect(result).toBeDefined();
    });

    it("ignores WAVE_SHELL when not executable", () => {
      Object.defineProperty(process, "platform", { value: "linux" });
      process.env.WAVE_SHELL = "/nonexistent/bash";
      vi.mocked(fs.accessSync).mockImplementation(() => {
        throw new Error("ENOENT");
      });
      expect(resolveShellPath()).toBeUndefined();
    });

    it("returns $SHELL when it is bash", () => {
      Object.defineProperty(process, "platform", { value: "linux" });
      process.env.SHELL = "/bin/bash";
      vi.mocked(fs.accessSync).mockImplementation(() => undefined);
      expect(resolveShellPath()).toBe("/bin/bash");
    });

    it("returns $SHELL when it is zsh", () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      process.env.SHELL = "/bin/zsh";
      vi.mocked(fs.accessSync).mockImplementation(() => undefined);
      expect(resolveShellPath()).toBe("/bin/zsh");
    });

    it("prefers WAVE_SHELL over $SHELL", () => {
      Object.defineProperty(process, "platform", { value: "linux" });
      process.env.WAVE_SHELL = "/custom/bash";
      process.env.SHELL = "/bin/bash";
      vi.mocked(fs.accessSync).mockImplementation(() => undefined);
      expect(resolveShellPath()).toBe("/custom/bash");
    });

    it("prefers zsh when $SHELL is zsh, even if bash is available via fixed path", () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      process.env.SHELL = "/bin/zsh";
      vi.mocked(fs.accessSync).mockImplementation((p) => {
        // only /bin/zsh exists
        return p === "/bin/zsh"
          ? undefined
          : (() => {
              throw new Error("ENOENT");
            })();
      });
      expect(resolveShellPath()).toBe("/bin/zsh");
    });

    it("prefers bash when $SHELL is bash, even if zsh is also available", () => {
      Object.defineProperty(process, "platform", { value: "linux" });
      process.env.SHELL = "/bin/bash";
      vi.mocked(fs.accessSync).mockImplementation(() => undefined);
      // bash candidates come first when $SHELL is bash
      expect(resolveShellPath()).toBe("/bin/bash");
    });

    it("finds bash via fixed path when $SHELL unset", () => {
      Object.defineProperty(process, "platform", { value: "linux" });
      vi.mocked(fs.accessSync).mockImplementation((p) => {
        if (p === "/bin/bash") return undefined;
        throw new Error("ENOENT");
      });
      expect(resolveShellPath()).toBe("/bin/bash");
    });

    it("finds zsh via fixed path when $SHELL unset and bash unavailable", () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      vi.mocked(fs.accessSync).mockImplementation((p) => {
        if (p === "/bin/zsh") return undefined;
        throw new Error("ENOENT");
      });
      expect(resolveShellPath()).toBe("/bin/zsh");
    });

    it("resolves bash via $PATH when no fixed path exists", () => {
      Object.defineProperty(process, "platform", { value: "linux" });
      process.env.PATH = "/usr/local/bin";
      vi.mocked(fs.accessSync).mockImplementation((p) => {
        if (p === "/usr/local/bin/bash") return undefined;
        throw new Error("ENOENT");
      });
      expect(resolveShellPath()).toBe("/usr/local/bin/bash");
    });

    it("returns undefined when no bash/zsh found", () => {
      Object.defineProperty(process, "platform", { value: "linux" });
      vi.mocked(fs.accessSync).mockImplementation(() => {
        throw new Error("ENOENT");
      });
      expect(resolveShellPath()).toBeUndefined();
    });
  });

  describe("Windows with WAVE_GIT_BASH_PATH env var", () => {
    it("returns the env var path when it names an existing bash.exe", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      const custom = WIN.join("D:", "custom", "git", "bash.exe");
      process.env.WAVE_GIT_BASH_PATH = custom;
      fakeDisk(custom);
      expect(resolveShellPath()).toBe(custom);
      // Validated like CLAUDE_CODE_GIT_BASH_PATH: the file has to be on disk.
      expect(fs.existsSync).toHaveBeenCalledWith(custom);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("accepts sh.exe and an extension-less bash as well", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      for (const name of ["SH.EXE", "bash", "sh"]) {
        vi.clearAllMocks();
        const custom = WIN.join("E:", "shells", name);
        process.env.WAVE_GIT_BASH_PATH = custom;
        fakeDisk(custom);
        expect(resolveShellPath()).toBe(custom);
      }
    });

    it("takes priority over git-inference and common paths", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      const custom = WIN.join("D:", "custom", "git", "bash.exe");
      process.env.WAVE_GIT_BASH_PATH = custom;
      fakeDisk(custom, FIXED_GIT, FIXED_BASH, WINDOWS_GIT_BASH_PATHS[1]);
      expect(resolveShellPath()).toBe(custom);
      expect(execFileSync).not.toHaveBeenCalled();
    });

    it("ignores the env var when the file does not exist, warns, and auto-detects", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      process.env.WAVE_GIT_BASH_PATH = "C:\\nope\\bash.exe";
      process.env.PATH = `${SHIM_DIR};${WIN.join(GIT_ON_D, "cmd")}`;
      fakeDisk(
        WIN.join(SHIM_DIR, "git.cmd"),
        WIN.join(GIT_ON_D, "cmd", "git.exe"),
        WIN.join(GIT_ON_D, "bin", "bash.exe"),
      );
      expect(resolveShellPath()).toBe(WIN.join(GIT_ON_D, "bin", "bash.exe"));
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        'WAVE_GIT_BASH_PATH "C:\\nope\\bash.exe" not found; falling back to auto-detection',
      );
    });

    it("ignores the env var when it is not a bash/sh binary, even if the file exists", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      const notBash = WIN.join(GIT_ON_D, "cmd", "git.exe");
      process.env.WAVE_GIT_BASH_PATH = notBash;
      process.env.PATH = WIN.join(GIT_ON_D, "cmd");
      fakeDisk(notBash, WIN.join(GIT_ON_D, "bin", "bash.exe"));
      expect(resolveShellPath()).toBe(WIN.join(GIT_ON_D, "bin", "bash.exe"));
      expect(warnSpy).toHaveBeenCalledWith(
        `WAVE_GIT_BASH_PATH "${notBash}" is not a bash/sh binary; falling back to auto-detection`,
      );
    });
  });

  describe("Windows git-inference", () => {
    it("infers bash.exe from git.exe in common location", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      fakeDisk(FIXED_GIT, FIXED_BASH);
      expect(resolveShellPath()).toBe(FIXED_BASH);
    });

    it("skips a git.cmd shim ahead of the real Git on PATH and resolves the real one", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      process.env.PATH = `${SHIM_DIR};${WIN.join(GIT_ON_D, "cmd")}`;
      fakeDisk(
        WIN.join(SHIM_DIR, "git.cmd"),
        WIN.join(GIT_ON_D, "cmd", "git.exe"),
        WIN.join(GIT_ON_D, "bin", "bash.exe"),
      );
      expect(resolveShellPath()).toBe(WIN.join(GIT_ON_D, "bin", "bash.exe"));
    });

    it("lands on usr\\bin\\bash.exe for a git in usr\\bin (Git + Unix tools on PATH)", () => {
      // Same geometry as cmd\\git.exe: ../../bin/bash.exe from usr\\bin\\git.exe is
      // usr\\bin\\bash.exe — MSYS2's own bash, which Git for Windows ships next to
      // its bin\\bash.exe launcher. Claude Code's findGitBashPath lands here too.
      Object.defineProperty(process, "platform", { value: "win32" });
      process.env.PATH = WIN.join(GIT_ON_D, "usr", "bin");
      fakeDisk(
        WIN.join(GIT_ON_D, "usr", "bin", "git.exe"),
        WIN.join(GIT_ON_D, "usr", "bin", "bash.exe"),
      );
      expect(resolveShellPath()).toBe(
        WIN.join(GIT_ON_D, "usr", "bin", "bash.exe"),
      );
    });

    it("searches cwd before PATH", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      const cwd = WIN.join("E:", "Tools", "Git", "cmd");
      vi.spyOn(process, "cwd").mockReturnValue(cwd);
      process.env.PATH = `${SHIM_DIR};${WIN.join(GIT_ON_D, "cmd")}`;
      fakeDisk(
        WIN.join(SHIM_DIR, "git.cmd"),
        WIN.join(GIT_ON_D, "cmd", "git.exe"),
        WIN.join(GIT_ON_D, "bin", "bash.exe"),
        WIN.join(cwd, "git.exe"),
        WIN.join("E:", "Tools", "Git", "bin", "bash.exe"),
      );
      expect(resolveShellPath()).toBe(
        WIN.join("E:", "Tools", "Git", "bin", "bash.exe"),
      );
    });

    it("honours PATHEXT: a dir with only git.exe is no hit when PATHEXT is .CMD", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      process.env.PATHEXT = ".CMD";
      process.env.PATH = WIN.join(GIT_ON_D, "cmd");
      fakeDisk(
        WIN.join(GIT_ON_D, "cmd", "git.exe"),
        WIN.join(GIT_ON_D, "bin", "bash.exe"),
      );
      expect(resolveShellPath()).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        "Git Bash not found; Bash tool unavailable on Windows",
        expect.objectContaining({
          probed: expect.arrayContaining(["no git executable on cwd or PATH"]),
        }),
      );
    });

    it("ignores PATHEXT entries outside .com/.exe/.bat/.cmd", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      process.env.PATHEXT = ".FOO;.EXE";
      process.env.PATH = WIN.join(GIT_ON_D, "cmd");
      fakeDisk(
        WIN.join(GIT_ON_D, "cmd", "git.exe"),
        WIN.join(GIT_ON_D, "bin", "bash.exe"),
      );
      expect(resolveShellPath()).toBe(WIN.join(GIT_ON_D, "bin", "bash.exe"));
    });

    it("prefers the fixed C: git.exe over one on PATH", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      process.env.PATH = WIN.join(GIT_ON_D, "cmd");
      fakeDisk(
        FIXED_GIT,
        FIXED_BASH,
        WIN.join(GIT_ON_D, "cmd", "git.exe"),
        WIN.join(GIT_ON_D, "bin", "bash.exe"),
      );
      expect(resolveShellPath()).toBe(FIXED_BASH);
    });

    it("keeps walking PATH when the fixed git.exe has no bash.exe", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      process.env.PATH = WIN.join(GIT_ON_D, "cmd");
      fakeDisk(
        FIXED_GIT,
        WIN.join(GIT_ON_D, "cmd", "git.exe"),
        WIN.join(GIT_ON_D, "bin", "bash.exe"),
      );
      expect(resolveShellPath()).toBe(WIN.join(GIT_ON_D, "bin", "bash.exe"));
    });

    it("falls through to common paths when git inference finds no bash.exe", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      fakeDisk(FIXED_GIT, WINDOWS_GIT_BASH_PATHS[1]);
      expect(resolveShellPath()).toBe(WINDOWS_GIT_BASH_PATHS[1]);
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("never spawns where.exe or any other child process", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      process.env.PATH = `${SHIM_DIR};${WIN.join(GIT_ON_D, "cmd")}`;
      fakeDisk(
        WIN.join(SHIM_DIR, "git.cmd"),
        WIN.join(GIT_ON_D, "cmd", "git.exe"),
        WIN.join(GIT_ON_D, "bin", "bash.exe"),
      );
      resolveShellPath();
      fakeDisk(WIN.join(SHIM_DIR, "git.cmd"));
      resolveShellPath();
      fakeDisk();
      resolveShellPath();
      expect(execFileSync).not.toHaveBeenCalled();
      expect(spawnSync).not.toHaveBeenCalled();
    });
  });

  describe("Windows with common path", () => {
    it("returns the first existing common path", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      fakeDisk(WINDOWS_GIT_BASH_PATHS[0]);
      expect(resolveShellPath()).toBe(WINDOWS_GIT_BASH_PATHS[0]);
    });

    it("returns the second common path if the first does not exist", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      fakeDisk(WINDOWS_GIT_BASH_PATHS[1]);
      expect(resolveShellPath()).toBe(WINDOWS_GIT_BASH_PATHS[1]);
    });

    it("includes LOCALAPPDATA path when set", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      process.env.LOCALAPPDATA = "C:\\Users\\test\\AppData\\Local";
      const localPath = `${process.env.LOCALAPPDATA}\\Programs\\Git\\bin\\bash.exe`;

      fakeDisk(localPath);
      expect(resolveShellPath()).toBe(localPath);
    });
  });

  describe("Windows without Git Bash", () => {
    it("returns undefined and logs one warning listing every probe", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      process.env.PATH = SHIM_DIR;
      const shimGit = WIN.join(SHIM_DIR, "git.cmd");
      fakeDisk(shimGit);
      expect(resolveShellPath()).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [message, detail] = warnSpy.mock.calls[0];
      expect(message).toBe(
        "Git Bash not found; Bash tool unavailable on Windows",
      );
      expect(detail).toEqual({
        probed: [
          "git.exe not found: C:\\Program Files\\Git\\cmd\\git.exe",
          "git.exe not found: C:\\Program Files (x86)\\Git\\cmd\\git.exe",
          `bash.exe not found: ${WIN.join(shimGit, "..", "..", "bin", "bash.exe")} (behind ${shimGit})`,
          "bash.exe not found: C:\\Program Files\\Git\\bin\\bash.exe",
          "bash.exe not found: C:\\Program Files (x86)\\Git\\bin\\bash.exe",
        ],
      });
    });

    it("logs the same diagnostic only once per process", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      fakeDisk();
      expect(resolveShellPath()).toBeUndefined();
      expect(resolveShellPath()).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });
});
