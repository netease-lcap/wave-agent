import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveShellPath,
  WINDOWS_GIT_BASH_PATHS,
} from "../../src/utils/shellResolver.js";
import fs from "node:fs";

vi.mock("node:fs");

describe("shellResolver", () => {
  const originalPlatform = process.platform;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GIT_BASH_PATH;
    delete process.env.LOCALAPPDATA;
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    process.env = { ...originalEnv };
  });

  describe("non-Windows platform", () => {
    it("returns undefined on linux", () => {
      Object.defineProperty(process, "platform", { value: "linux" });
      expect(resolveShellPath()).toBeUndefined();
    });

    it("returns undefined on darwin", () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      expect(resolveShellPath()).toBeUndefined();
    });
  });

  describe("Windows with GIT_BASH_PATH env var", () => {
    it("returns the env var path when it exists", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      process.env.GIT_BASH_PATH = "D:\\custom\\git\\bash.exe";
      expect(resolveShellPath()).toBe("D:\\custom\\git\\bash.exe");
    });

    it("returns the env var path without checking existsSync", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      process.env.GIT_BASH_PATH = "D:\\custom\\git\\bash.exe";
      resolveShellPath();
      expect(fs.existsSync).not.toHaveBeenCalled();
    });
  });

  describe("Windows with common path", () => {
    it("returns the first existing common path", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      vi.mocked(fs.existsSync).mockImplementation(
        (p) => p === WINDOWS_GIT_BASH_PATHS[0],
      );
      expect(resolveShellPath()).toBe(WINDOWS_GIT_BASH_PATHS[0]);
    });

    it("returns the second common path if the first does not exist", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      vi.mocked(fs.existsSync).mockImplementation(
        (p) => p === WINDOWS_GIT_BASH_PATHS[1],
      );
      expect(resolveShellPath()).toBe(WINDOWS_GIT_BASH_PATHS[1]);
    });

    it("includes LOCALAPPDATA path when set", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      process.env.LOCALAPPDATA = "C:\\Users\\test\\AppData\\Local";
      const localPath =
        "C:\\Users\\test\\AppData\\Local\\Programs\\Git\\bin\\bash.exe";

      vi.mocked(fs.existsSync).mockImplementation((p) => p === localPath);
      expect(resolveShellPath()).toBe(localPath);
    });
  });

  describe("Windows without Git Bash", () => {
    it("returns undefined when no path exists", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(resolveShellPath()).toBeUndefined();
    });
  });

  describe("priority order", () => {
    it("GIT_BASH_PATH takes priority over common paths", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      process.env.GIT_BASH_PATH = "D:\\custom\\git\\bash.exe";
      vi.mocked(fs.existsSync).mockReturnValue(true);
      expect(resolveShellPath()).toBe("D:\\custom\\git\\bash.exe");
    });
  });
});
