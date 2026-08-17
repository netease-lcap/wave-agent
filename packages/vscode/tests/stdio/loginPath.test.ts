import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";

// ── Mocks ──────────────────────────────────────────────────────

const mockExecFileSync = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({
  execFileSync: mockExecFileSync,
}));

// Import after mocks (loginPath also imports decodeCommandOutput from
// binaryResolver, which pulls in child_process + fs — both mocked below).
vi.mock("fs", () => ({
  default: { existsSync: vi.fn() },
  existsSync: vi.fn(),
}));

import {
  resolveGitBashPath,
  probeLoginPath,
  adoptLoginPathIntoEnv,
  _resetLoginPathCacheForTesting,
} from "../../src/stdio/loginPath";

const existsSync = vi.mocked(fs.existsSync);

describe("loginPath", () => {
  const originalPath = process.env.PATH;
  const originalShell = process.env.SHELL;
  const originalWaveGitBash = process.env.WAVE_GIT_BASH_PATH;
  const originalLocalAppData = process.env.LOCALAPPDATA;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetLoginPathCacheForTesting();
    delete process.env.WAVE_GIT_BASH_PATH;
    delete process.env.LOCALAPPDATA;
  });

  afterEach(() => {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalShell === undefined) delete process.env.SHELL;
    else process.env.SHELL = originalShell;
    if (originalWaveGitBash === undefined)
      delete process.env.WAVE_GIT_BASH_PATH;
    else process.env.WAVE_GIT_BASH_PATH = originalWaveGitBash;
    if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = originalLocalAppData;
    _resetLoginPathCacheForTesting();
  });

  describe("resolveGitBashPath", () => {
    it("returns undefined on non-Windows platforms", () => {
      expect(resolveGitBashPath("linux")).toBeUndefined();
      expect(resolveGitBashPath("darwin")).toBeUndefined();
      expect(mockExecFileSync).not.toHaveBeenCalled();
    });

    it("prefers the WAVE_GIT_BASH_PATH env override", () => {
      process.env.WAVE_GIT_BASH_PATH = "C:\\Custom\\git-bash.exe";
      expect(resolveGitBashPath("win32")).toBe("C:\\Custom\\git-bash.exe");
      expect(mockExecFileSync).not.toHaveBeenCalled();
    });

    it("infers <git>/bin/bash.exe from `where git` output", () => {
      mockExecFileSync.mockReturnValue(
        "C:\\Program Files\\Git\\cmd\\git.exe\r\n",
      );
      existsSync.mockImplementation(
        (p) => p === "C:\\Program Files\\Git\\bin\\bash.exe",
      );
      expect(resolveGitBashPath("win32")).toBe(
        "C:\\Program Files\\Git\\bin\\bash.exe",
      );
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "where",
        ["git"],
        expect.objectContaining({ timeout: 3000 }),
      );
    });

    it("falls back to common install paths when `where git` yields nothing usable", () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error("git not found");
      });
      existsSync.mockImplementation((p) => {
        // Fake a standalone Git install under %LOCALAPPDATA%.
        return (
          p === "C:\\Users\\test\\AppData\\Local\\Programs\\Git\\bin\\bash.exe"
        );
      });
      process.env.LOCALAPPDATA = "C:\\Users\\test\\AppData\\Local";
      expect(resolveGitBashPath("win32")).toBe(
        "C:\\Users\\test\\AppData\\Local\\Programs\\Git\\bin\\bash.exe",
      );
    });

    it("returns undefined when no Git Bash can be found", () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error("git not found");
      });
      existsSync.mockReturnValue(false);
      expect(resolveGitBashPath("win32")).toBeUndefined();
    });
  });

  describe("probeLoginPath", () => {
    it("probes $SHELL with -lic 'echo $PATH' on macOS/Linux and returns the last non-empty line", () => {
      process.env.SHELL = "/bin/zsh";
      existsSync.mockReturnValue(true);
      mockExecFileSync.mockReturnValue(
        "zsh profile noise\n/usr/local/bin:/usr/bin:/bin\n",
      );
      expect(probeLoginPath("linux")).toBe("/usr/local/bin:/usr/bin:/bin");
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "/bin/zsh",
        ["-lic", "echo $PATH"],
        expect.objectContaining({ timeout: 5000 }),
      );
    });

    it("falls back through /bin/zsh then /bin/bash when $SHELL is unset or missing", () => {
      delete process.env.SHELL;
      existsSync.mockImplementation((p) => p === "/bin/bash");
      mockExecFileSync.mockReturnValue("/usr/bin:/bin\n");
      expect(probeLoginPath("darwin")).toBe("/usr/bin:/bin");
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "/bin/bash",
        ["-lic", "echo $PATH"],
        expect.objectContaining({ timeout: 5000 }),
      );
    });

    it("probes Git Bash with cygpath -pw on Windows", () => {
      process.env.WAVE_GIT_BASH_PATH = "C:\\Program Files\\Git\\bin\\bash.exe";
      mockExecFileSync.mockReturnValue(
        "C:\\Users\\test\\bin;C:\\Program Files\\Git\\bin\n",
      );
      expect(probeLoginPath("win32")).toBe(
        "C:\\Users\\test\\bin;C:\\Program Files\\Git\\bin",
      );
      expect(mockExecFileSync).toHaveBeenCalledWith(
        "C:\\Program Files\\Git\\bin\\bash.exe",
        ["-lic", 'cygpath -pw "$PATH"'],
        expect.objectContaining({ timeout: 5000 }),
      );
    });

    it("returns undefined when no shell can be located", () => {
      delete process.env.SHELL;
      existsSync.mockReturnValue(false);
      expect(probeLoginPath("linux")).toBeUndefined();
      expect(mockExecFileSync).not.toHaveBeenCalled();
    });

    it("returns undefined when the probe fails (timeout/non-zero)", () => {
      process.env.SHELL = "/bin/zsh";
      existsSync.mockReturnValue(true);
      mockExecFileSync.mockImplementation(() => {
        throw new Error("spawn ENOENT");
      });
      expect(probeLoginPath("linux")).toBeUndefined();
    });
  });

  describe("adoptLoginPathIntoEnv", () => {
    it("injects the probed PATH into process.env", () => {
      process.env.SHELL = "/bin/zsh";
      existsSync.mockReturnValue(true);
      mockExecFileSync.mockReturnValue("/usr/local/bin:/usr/bin:/bin\n");
      adoptLoginPathIntoEnv("linux");
      expect(process.env.PATH).toBe("/usr/local/bin:/usr/bin:/bin");
    });

    it("is cached — probes only once across calls", () => {
      process.env.SHELL = "/bin/zsh";
      existsSync.mockReturnValue(true);
      mockExecFileSync.mockReturnValue("/a:/b\n");
      adoptLoginPathIntoEnv("linux");
      adoptLoginPathIntoEnv("linux");
      expect(mockExecFileSync).toHaveBeenCalledTimes(1);
    });

    it("leaves the environment untouched on probe failure", () => {
      process.env.SHELL = "/bin/zsh";
      existsSync.mockReturnValue(true);
      mockExecFileSync.mockImplementation(() => {
        throw new Error("timeout");
      });
      adoptLoginPathIntoEnv("linux");
      expect(process.env.PATH).toBe(originalPath);
    });
  });
});
