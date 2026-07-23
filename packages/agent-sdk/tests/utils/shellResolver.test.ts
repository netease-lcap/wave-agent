import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveShellPath,
  WINDOWS_GIT_BASH_PATHS,
} from "../../src/utils/shellResolver.js";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

vi.mock("node:fs");
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

describe("shellResolver", () => {
  const originalPlatform = process.platform;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.WAVE_GIT_BASH_PATH;
    delete process.env.LOCALAPPDATA;
    delete process.env.WAVE_SHELL;
    delete process.env.SHELL;
    delete process.env.PATH;
  });

  afterEach(() => {
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
    it("returns the env var path when set", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      process.env.WAVE_GIT_BASH_PATH = "D:\\custom\\git\\bash.exe";
      expect(resolveShellPath()).toBe("D:\\custom\\git\\bash.exe");
    });

    it("returns the env var path without checking existsSync", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      process.env.WAVE_GIT_BASH_PATH = "D:\\custom\\git\\bash.exe";
      resolveShellPath();
      expect(fs.existsSync).not.toHaveBeenCalled();
    });
  });

  describe("Windows git-inference", () => {
    it("infers bash.exe from git.exe in common location", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      const gitExe = "C:\\Program Files\\Git\\cmd\\git.exe";
      const expectedBash = "C:\\Program Files\\Git\\bin\\bash.exe";
      vi.mocked(fs.existsSync).mockImplementation(
        (p) => p === gitExe || p === expectedBash,
      );
      expect(resolveShellPath()).toBe(expectedBash);
    });

    it("infers bash.exe from where.exe when git not in common locations", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      const expectedBash = "E:\\custom\\Git\\bin\\bash.exe";
      vi.mocked(fs.existsSync).mockImplementation((p) => p === expectedBash);
      vi.mocked(execFileSync).mockReturnValue(
        "E:\\custom\\Git\\cmd\\git.exe\r\n",
      );
      expect(resolveShellPath()).toBe(expectedBash);
      expect(execFileSync).toHaveBeenCalledWith(
        "where",
        ["git"],
        expect.objectContaining({ encoding: "utf8" }),
      );
    });

    it("falls through to common paths when git inference finds no bash.exe", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      // git.exe exists at common location, but inferred bash.exe does not
      vi.mocked(fs.existsSync).mockImplementation(
        (p) => p === WINDOWS_GIT_BASH_PATHS[0],
      );
      vi.mocked(execFileSync).mockReturnValue("");
      expect(resolveShellPath()).toBe(WINDOWS_GIT_BASH_PATHS[0]);
    });
  });

  describe("Windows with common path", () => {
    it("returns the first existing common path", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      vi.mocked(fs.existsSync).mockImplementation(
        (p) => p === WINDOWS_GIT_BASH_PATHS[0],
      );
      vi.mocked(execFileSync).mockReturnValue("");
      expect(resolveShellPath()).toBe(WINDOWS_GIT_BASH_PATHS[0]);
    });

    it("returns the second common path if the first does not exist", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      vi.mocked(fs.existsSync).mockImplementation(
        (p) => p === WINDOWS_GIT_BASH_PATHS[1],
      );
      vi.mocked(execFileSync).mockReturnValue("");
      expect(resolveShellPath()).toBe(WINDOWS_GIT_BASH_PATHS[1]);
    });

    it("includes LOCALAPPDATA path when set", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      process.env.LOCALAPPDATA = "C:\\Users\\test\\AppData\\Local";
      const localPath =
        "C:\\Users\\test\\AppData\\Local\\Programs\\Git\\bin\\bash.exe";

      vi.mocked(fs.existsSync).mockImplementation((p) => p === localPath);
      vi.mocked(execFileSync).mockReturnValue("");
      expect(resolveShellPath()).toBe(localPath);
    });
  });

  describe("Windows without Git Bash", () => {
    it("returns undefined when no path exists and git not found", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error("not found");
      });
      expect(resolveShellPath()).toBeUndefined();
    });
  });

  describe("Windows priority order", () => {
    it("WAVE_GIT_BASH_PATH takes priority over git-inference and common paths", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      process.env.WAVE_GIT_BASH_PATH = "D:\\custom\\git\\bash.exe";
      vi.mocked(fs.existsSync).mockReturnValue(true);
      expect(resolveShellPath()).toBe("D:\\custom\\git\\bash.exe");
      expect(execFileSync).not.toHaveBeenCalled();
    });
  });
});
