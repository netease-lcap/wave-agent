import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import {
  resolvePath,
  getDisplayPath,
  restoreWindowsPath,
  toWindowsPath,
} from "../../src/utils/path.js";
import { homedir } from "os";
import { resolve } from "path";

describe("path utils", () => {
  describe("resolvePath", () => {
    it("should handle tilde home directory expansion", () => {
      const result = resolvePath("~/.gitconfig", "/test/workdir");
      const expected = resolve(homedir(), ".gitconfig");
      expect(result).toBe(expected);
    });

    it("should handle tilde with subdirectory", () => {
      const result = resolvePath("~/Documents/test.txt", "/test/workdir");
      const expected = resolve(homedir(), "Documents/test.txt");
      expect(result).toBe(expected);
    });

    it("should handle just tilde", () => {
      const result = resolvePath("~", "/test/workdir");
      const expected = homedir();
      expect(result).toBe(expected);
    });

    it("should handle relative paths with workdir", () => {
      const result = resolvePath("test.txt", "/workspace");
      const expected = resolve("/workspace", "test.txt");
      expect(result).toBe(expected);
    });

    it("should handle absolute paths", () => {
      const result = resolvePath("/absolute/path/test.txt", "/test/workdir");
      const expected = resolve("/absolute/path/test.txt");
      expect(result).toBe(expected);
    });

    it("should not treat paths starting with ~ in middle as home directory", () => {
      const result = resolvePath("some~path/file.txt", "/workspace");
      const expected = resolve("/workspace", "some~path/file.txt");
      expect(result).toBe(expected);
    });

    it("should handle relative paths with workdir", () => {
      const result = resolvePath("relative/path/file.txt", "/test/workdir");
      const expected = resolve("/test/workdir", "relative/path/file.txt");
      expect(result).toBe(expected);
    });
  });

  describe("getDisplayPath", () => {
    it("should return relative path when it's shorter and not in parent directory", () => {
      const mockWorkdir = "/Users/test/project";
      const result = getDisplayPath(
        "/Users/test/project/src/utils/path.ts",
        mockWorkdir,
      );
      expect(result).toBe("src/utils/path.ts");
    });

    it("should return absolute path when relative path starts with ..", () => {
      const mockWorkdir = "/Users/test/project";
      const absolutePath = "/Users/test/other-project/file.ts";
      const result = getDisplayPath(absolutePath, mockWorkdir);
      expect(result).toBe(absolutePath);
    });

    it("should return absolute path when relative path is longer", () => {
      const mockWorkdir = "/a";
      const absolutePath = "/b";
      const result = getDisplayPath(absolutePath, mockWorkdir);
      // Relative would be "../b" which is longer than "/b"
      expect(result).toBe(absolutePath);
    });

    it("should return absolute path when relative path equals absolute path length", () => {
      const mockWorkdir = "/Users/test";
      const absolutePath = "/Users/file.ts";
      const result = getDisplayPath(absolutePath, mockWorkdir);
      // Relative would be "../file.ts" which is same length as absolute
      expect(result).toBe(absolutePath);
    });

    it("should handle current directory file", () => {
      const mockWorkdir = "/Users/test/project";
      const result = getDisplayPath(
        "/Users/test/project/package.json",
        mockWorkdir,
      );
      expect(result).toBe("package.json");
    });

    it("should return '.' when path equals current working directory", () => {
      const mockWorkdir = "/Users/test/project";
      const result = getDisplayPath("/Users/test/project", mockWorkdir);
      expect(result).toBe(".");
    });

    it("should handle empty path", () => {
      const result = getDisplayPath("", "/test/workdir");
      expect(result).toBe("");
    });

    it("should handle Windows paths", () => {
      // Skip this test on non-Windows platforms since path.relative behaves differently
      if (process.platform !== "win32") {
        const mockWorkdir = "/Users/test/project";
        const result = getDisplayPath(
          "/Users/test/project/src/file.ts",
          mockWorkdir,
        );
        expect(result).toBe("src/file.ts");
        return;
      }

      const mockWorkdir = "C:\\Users\\test\\project";
      const result = getDisplayPath(
        "C:\\Users\\test\\project\\src\\file.ts",
        mockWorkdir,
      );
      // getDisplayPath normalizes to forward slashes on all platforms
      expect(result).toBe("src/file.ts");
    });

    it("should handle different workdir consistently", () => {
      const customWorkdir = "/custom/workdir";
      const result = getDisplayPath(
        "/custom/workdir/src/utils/file.ts",
        customWorkdir,
      );
      expect(result).toBe("src/utils/file.ts");

      // Test with different path that would be longer as relative
      const absolutePath = "/other/path/file.ts";
      const result2 = getDisplayPath(absolutePath, customWorkdir);
      expect(result2).toBe(absolutePath);
    });
  });

  describe("toWindowsPath", () => {
    let platformSpy: ReturnType<typeof vi.spyOn>;

    beforeAll(() => {
      platformSpy = vi
        .spyOn(process, "platform", "get")
        .mockReturnValue("win32" as NodeJS.Platform);
    });

    afterAll(() => {
      platformSpy.mockRestore();
    });

    it("should convert MSYS /c/ drive paths to Windows paths", () => {
      expect(toWindowsPath("/c/Users/foo")).toBe("C:\\Users\\foo");
    });

    it("should convert /cygdrive/c/ paths to Windows paths", () => {
      expect(toWindowsPath("/cygdrive/d/project")).toBe("D:\\project");
    });

    it("should convert UNC //server/share paths", () => {
      expect(toWindowsPath("//server/share")).toBe("\\\\server\\share");
    });

    it("should uppercase the drive letter and handle bare drive path", () => {
      expect(toWindowsPath("/c")).toBe("C:\\");
    });

    it("should pass through already-Windows paths unchanged", () => {
      expect(toWindowsPath("C:\\Users\\foo")).toBe("C:\\Users\\foo");
    });
  });
});

describe("restoreWindowsPath", () => {
  let platformSpy: ReturnType<typeof vi.spyOn>;

  afterAll(() => {
    platformSpy.mockRestore();
  });

  describe("on Windows", () => {
    beforeAll(() => {
      platformSpy = vi
        .spyOn(process, "platform", "get")
        .mockReturnValue("win32" as NodeJS.Platform);
    });

    it("should restore the MSYS spellings to the drive path they name", () => {
      expect(restoreWindowsPath("/d/x")).toBe("D:\\x");
      expect(restoreWindowsPath("/cygdrive/d/x")).toBe("D:\\x");
      expect(restoreWindowsPath("/proc/cygdrive/d/x")).toBe("D:\\x");
      // A bare drive is that drive's root.
      expect(restoreWindowsPath("/d")).toBe("D:\\");
    });

    it("should unwrap a verbatim drive path", () => {
      expect(restoreWindowsPath("\\\\?\\D:\\x")).toBe("D:\\x");
      expect(restoreWindowsPath("\\\\?\\G:\\y")).toBe("G:\\y");
      // The forward-slash spelling of the same namespace is left alone, and is
      // refused as a device path rather than guessed at.
      expect(restoreWindowsPath("//?/G:/y")).toBe("//?/G:/y");
    });

    it("should keep a device or namespace path as written", () => {
      // There is no drive behind these, so there is nothing to restore; the
      // judgement refuses them instead of guessing.
      for (const target of [
        "\\\\.\\PhysicalDrive0",
        "\\\\?\\GLOBALROOT\\Device\\HarddiskVolume1",
      ]) {
        expect(restoreWindowsPath(target)).toBe(target);
      }
    });

    it("should expand this machine's administrative share to its drive", () => {
      expect(restoreWindowsPath("//localhost/D$/x")).toBe("D:\\x");
      expect(restoreWindowsPath("//127.0.0.1/C$/x")).toBe("C:\\x");
    });

    it("should keep another machine's administrative share", () => {
      // That D$ is a different disk: expanding it to `D:\x` would judge a local
      // directory the command never touches.
      expect(restoreWindowsPath("//nas/D$/x")).toBe("\\\\nas\\D$\\x");
    });

    it("should only flip the separators of an ordinary UNC share", () => {
      expect(restoreWindowsPath("//server/share/x")).toBe(
        "\\\\server\\share\\x",
      );
    });

    it("should leave a native path alone", () => {
      expect(restoreWindowsPath("D:\\x")).toBe("D:\\x");
      expect(restoreWindowsPath("x")).toBe("x");
    });
  });

  it("should return the path as written off Windows", () => {
    // None of these spellings name a drive on POSIX, so nothing is restored.
    const spy = vi
      .spyOn(process, "platform", "get")
      .mockReturnValue("linux" as NodeJS.Platform);
    try {
      expect(restoreWindowsPath("/d/x")).toBe("/d/x");
      expect(restoreWindowsPath("D:\\x")).toBe("D:\\x");
    } finally {
      spy.mockRestore();
    }
  });
});
