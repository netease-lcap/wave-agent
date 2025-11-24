import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  PathEncoder,
  type PathEncodingOptions,
} from "../../src/utils/pathEncoder.js";
import { realpath, mkdir } from "fs/promises";
import { homedir, platform } from "os";

// Mock fs/promises
vi.mock("fs/promises");

// Mock os
vi.mock("os");

describe("PathEncoder", () => {
  let pathEncoder: PathEncoder;

  beforeEach(() => {
    vi.clearAllMocks();
    pathEncoder = new PathEncoder();

    // Set default platform to linux for consistent testing
    vi.mocked(platform).mockReturnValue("linux");
    vi.mocked(homedir).mockReturnValue("/home/testuser");
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("constructor", () => {
    it("should create PathEncoder with default options", () => {
      const encoder = new PathEncoder();
      expect(encoder).toBeInstanceOf(PathEncoder);
    });

    it("should create PathEncoder with custom options", () => {
      const customOptions: PathEncodingOptions = {
        maxLength: 100,
        pathSeparatorReplacement: "_",
        spaceReplacement: "-",
        invalidCharReplacement: "X",
        preserveCase: true,
        hashLength: 12,
      };
      const encoder = new PathEncoder(customOptions);
      expect(encoder).toBeInstanceOf(PathEncoder);
    });
  });

  describe("encode()", () => {
    beforeEach(() => {
      // Mock realpath to return the input path (no symbolic link resolution)
      vi.mocked(realpath).mockImplementation((path) =>
        Promise.resolve(path as string),
      );
    });

    it("should encode basic absolute path", async () => {
      const result = await pathEncoder.encode("/home/user/project");
      expect(result).toBe("home-user-project");
    });

    it("should encode path with spaces", async () => {
      const result = await pathEncoder.encode("/home/user/my project");
      expect(result).toBe("home-user-my_project");
    });

    it("should remove leading slash", async () => {
      const result = await pathEncoder.encode("/test/path");
      expect(result).toBe("test-path");
    });

    it("should replace path separators with hyphens", async () => {
      const result = await pathEncoder.encode("/home/user/documents/project");
      expect(result).toBe("home-user-documents-project");
    });

    it("should replace multiple consecutive spaces with single underscore", async () => {
      const result = await pathEncoder.encode("/home/user/my   project");
      expect(result).toBe("home-user-my_project");
    });

    it("should convert to lowercase by default", async () => {
      const result = await pathEncoder.encode("/HOME/USER/PROJECT");
      expect(result).toBe("home-user-project");
    });

    it("should preserve case when preserveCase option is true", async () => {
      const encoder = new PathEncoder({ preserveCase: true });
      const result = await encoder.encode("/HOME/User/Project");
      expect(result).toBe("HOME-User-Project");
    });

    it("should handle paths with invalid characters on Linux", async () => {
      vi.mocked(platform).mockReturnValue("linux");
      const encoder = new PathEncoder();
      const result = await encoder.encode("/home/user/project\x00file");
      expect(result).toBe("home-user-project_file");
    });

    it("should handle paths with invalid characters on Windows", async () => {
      vi.mocked(platform).mockReturnValue("win32");
      const encoder = new PathEncoder();
      const result = await encoder.encode("/home/user/project<>:|?*file");
      expect(result).toBe("home-user-project______file");
    });

    it("should handle paths with invalid characters on macOS", async () => {
      vi.mocked(platform).mockReturnValue("darwin");
      const encoder = new PathEncoder();
      const result = await encoder.encode("/home/user/project:file");
      expect(result).toBe("home-user-project_file");
    });

    it("should handle backslashes as path separators", async () => {
      // Mock realpath to return the input path directly (no resolution)
      vi.mocked(realpath).mockResolvedValue("C:\\Users\\John\\Project");
      const result = await pathEncoder.encode("C:\\Users\\John\\Project");
      expect(result).toBe("c:-users-john-project");
    });

    it("should truncate long paths and add hash", async () => {
      const longPath = "/home/user/" + "a".repeat(300);
      const result = await pathEncoder.encode(longPath);

      expect(result.length).toBeLessThanOrEqual(200);
      expect(result).toMatch(/-[a-f0-9]{8}$/); // Should end with hash
    });

    it("should use custom options for encoding", async () => {
      const encoder = new PathEncoder({
        pathSeparatorReplacement: "_",
        spaceReplacement: "-",
        invalidCharReplacement: "X",
        preserveCase: true,
      });

      vi.mocked(realpath).mockResolvedValue("/Home/User/My Project");
      const result = await encoder.encode("/Home/User/My Project");
      expect(result).toBe("Home_User_My-Project");
    });

    it("should handle empty path after removing leading slash", async () => {
      vi.mocked(realpath).mockResolvedValue("/");
      const result = await pathEncoder.encode("/");
      expect(result).toBe("");
    });

    it("should handle Unicode characters", async () => {
      const result = await pathEncoder.encode("/home/用户/项目");
      expect(result).toBe("home-用户-项目");
    });

    it("should handle path with custom hash length", async () => {
      const encoder = new PathEncoder({
        maxLength: 50,
        hashLength: 16,
      });

      const longPath = "/home/user/" + "a".repeat(100);
      const result = await encoder.encode(longPath);

      expect(result.length).toBeLessThanOrEqual(50);
      expect(result).toMatch(/-[a-f0-9]{16}$/);
    });
  });

  describe("resolvePath()", () => {
    it("should resolve absolute path", async () => {
      vi.mocked(realpath).mockResolvedValue("/resolved/path");

      const result = await pathEncoder.resolvePath("/home/user/project");
      expect(result).toBe("/resolved/path");
    });

    it("should expand tilde to home directory", async () => {
      vi.mocked(realpath).mockResolvedValue("/home/testuser/project");

      const result = await pathEncoder.resolvePath("~/project");
      expect(result).toBe("/home/testuser/project");

      // Verify realpath was called with expanded path
      expect(realpath).toHaveBeenCalledWith(
        expect.stringContaining("/home/testuser/project"),
      );
    });

    it("should handle tilde as home directory root", async () => {
      vi.mocked(realpath).mockResolvedValue("/home/testuser");

      const result = await pathEncoder.resolvePath("~");
      expect(result).toBe("/home/testuser");
    });

    it("should not expand tilde in middle of path", async () => {
      vi.mocked(realpath).mockResolvedValue("/some/path~with~tildes");

      const result = await pathEncoder.resolvePath("/some/path~with~tildes");
      expect(result).toBe("/some/path~with~tildes");
    });

    it("should handle relative paths", async () => {
      vi.mocked(realpath).mockImplementation((path) =>
        Promise.resolve(path as string),
      );

      const result = await pathEncoder.resolvePath("relative/path");
      expect(result).toMatch(/.*relative\/path$/);
    });

    it("should throw error when realpath fails", async () => {
      vi.mocked(realpath).mockRejectedValue(new Error("Path not found"));

      await expect(
        pathEncoder.resolvePath("/nonexistent/path"),
      ).rejects.toThrow('Failed to resolve path "/nonexistent/path"');
    });

    it("should resolve symbolic links", async () => {
      vi.mocked(realpath).mockResolvedValue("/real/path/target");

      const result = await pathEncoder.resolvePath("/path/to/symlink");
      expect(result).toBe("/real/path/target");
      expect(realpath).toHaveBeenCalledWith(
        expect.stringMatching(/.*path\/to\/symlink$/),
      );
    });
  });

  describe("createProjectDirectory()", () => {
    const baseSessionDir = "/session/base";

    beforeEach(() => {
      vi.mocked(mkdir).mockResolvedValue(undefined);
      vi.mocked(realpath).mockImplementation((path) =>
        Promise.resolve(path as string),
      );
    });

    it("should create project directory with basic path", async () => {
      const originalPath = "/home/user/project";

      const result = await pathEncoder.createProjectDirectory(
        originalPath,
        baseSessionDir,
      );

      expect(result).toEqual({
        originalPath: "/home/user/project",
        encodedName: "home-user-project",
        encodedPath: "/session/base/home-user-project",
        pathHash: undefined,
        isSymbolicLink: false,
      });

      expect(mkdir).toHaveBeenCalledWith("/session/base/home-user-project", {
        recursive: true,
      });
    });

    it("should detect symbolic links", async () => {
      const originalPath = "/home/user/symlink";
      const resolvedPath = "/home/user/actual-project";

      vi.mocked(realpath).mockResolvedValue(resolvedPath);

      const result = await pathEncoder.createProjectDirectory(
        originalPath,
        baseSessionDir,
      );

      expect(result.isSymbolicLink).toBe(true);
      expect(result.originalPath).toBe(resolvedPath);
    });

    it("should handle tilde expansion in createProjectDirectory", async () => {
      const originalPath = "~/project";

      const result = await pathEncoder.createProjectDirectory(
        originalPath,
        baseSessionDir,
      );

      expect(result.originalPath).toBe("/home/testuser/project");
      expect(result.encodedName).toBe("home-testuser-project");
    });

    it("should generate hash for long paths", async () => {
      const encoder = new PathEncoder({ maxLength: 50 });
      const longPath = "/home/user/" + "a".repeat(100);

      const result = await encoder.createProjectDirectory(
        longPath,
        baseSessionDir,
      );

      expect(result.pathHash).toBeDefined();
      expect(result.pathHash).toHaveLength(8);
      expect(result.encodedName.length).toBeLessThanOrEqual(50);
    });

    it("should handle realpath failure gracefully", async () => {
      // Mock realpath to fail only for the first call in createProjectDirectory
      // but succeed for the second call in encode method
      let callCount = 0;
      vi.mocked(realpath).mockImplementation((path) => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error("Permission denied"));
        }
        return Promise.resolve(path as string);
      });

      const result = await pathEncoder.createProjectDirectory(
        "/protected/path",
        baseSessionDir,
      );

      // Should use absolute path when realpath fails
      expect(result.originalPath).toMatch(/.*protected\/path$/);
      expect(result.isSymbolicLink).toBe(false);
    });

    it("should ignore mkdir errors when directory exists", async () => {
      vi.mocked(mkdir).mockRejectedValue(new Error("Directory exists"));

      const result = await pathEncoder.createProjectDirectory(
        "/home/user/project",
        baseSessionDir,
      );

      // Should not throw error
      expect(result).toBeDefined();
      expect(result.originalPath).toBe("/home/user/project");
    });

    it("should create nested encoded path correctly", async () => {
      const originalPath = "/very/deep/nested/project/structure";

      const result = await pathEncoder.createProjectDirectory(
        originalPath,
        baseSessionDir,
      );

      expect(result.encodedName).toBe("very-deep-nested-project-structure");
      expect(result.encodedPath).toBe(
        "/session/base/very-deep-nested-project-structure",
      );
    });
  });

  describe("validateEncodedName()", () => {
    it("should validate normal encoded names", () => {
      expect(pathEncoder.validateEncodedName("home-user-project")).toBe(true);
      expect(pathEncoder.validateEncodedName("valid_name")).toBe(true);
    });

    it("should reject empty names", () => {
      expect(pathEncoder.validateEncodedName("")).toBe(false);
      expect(pathEncoder.validateEncodedName("   ")).toBe(false);
    });

    it("should reject names with only dots", () => {
      expect(pathEncoder.validateEncodedName(".")).toBe(false);
      expect(pathEncoder.validateEncodedName("..")).toBe(false);
      expect(pathEncoder.validateEncodedName("...")).toBe(false);
    });

    it("should reject names that are too long", () => {
      const longName = "a".repeat(300);
      expect(pathEncoder.validateEncodedName(longName)).toBe(false);
    });

    it("should reject names with invalid characters on Windows", () => {
      vi.mocked(platform).mockReturnValue("win32");
      const encoder = new PathEncoder();

      expect(encoder.validateEncodedName("name<with>invalid")).toBe(false);
      expect(encoder.validateEncodedName("name:with|invalid")).toBe(false);
      expect(encoder.validateEncodedName("name?with*invalid")).toBe(false);
    });

    it("should reject Windows reserved names", () => {
      vi.mocked(platform).mockReturnValue("win32");
      const encoder = new PathEncoder();

      expect(encoder.validateEncodedName("CON")).toBe(false);
      expect(encoder.validateEncodedName("con")).toBe(false);
      expect(encoder.validateEncodedName("PRN")).toBe(false);
      expect(encoder.validateEncodedName("NUL")).toBe(false);
      expect(encoder.validateEncodedName("COM1")).toBe(false);
      expect(encoder.validateEncodedName("LPT9")).toBe(false);
    });

    it("should reject names with null characters on Linux", () => {
      vi.mocked(platform).mockReturnValue("linux");
      const encoder = new PathEncoder();

      expect(encoder.validateEncodedName("name\x00with\x00null")).toBe(false);
    });

    it("should reject names with colon on macOS", () => {
      vi.mocked(platform).mockReturnValue("darwin");
      const encoder = new PathEncoder();

      expect(encoder.validateEncodedName("name:with:colon")).toBe(false);
    });
  });

  describe("resolveCollision()", () => {
    it("should return original name if no collision", () => {
      const existingNames = new Set(["other-name"]);
      const result = pathEncoder.resolveCollision(
        "project-name",
        existingNames,
      );
      expect(result).toBe("project-name");
    });

    it("should add numbered suffix for first collision", () => {
      const existingNames = new Set(["project-name"]);
      const result = pathEncoder.resolveCollision(
        "project-name",
        existingNames,
      );
      expect(result).toBe("project-name-1");
    });

    it("should increment suffix for multiple collisions", () => {
      const existingNames = new Set([
        "project-name",
        "project-name-1",
        "project-name-2",
      ]);
      const result = pathEncoder.resolveCollision(
        "project-name",
        existingNames,
      );
      expect(result).toBe("project-name-3");
    });

    it("should use hash when all numbered suffixes are exhausted", () => {
      const existingNames = new Set<string>();
      // Fill with 1-999
      for (let i = 0; i <= 999; i++) {
        existingNames.add(i === 0 ? "project-name" : `project-name-${i}`);
      }

      const result = pathEncoder.resolveCollision(
        "project-name",
        existingNames,
      );
      expect(result).toMatch(/^project-name-[a-f0-9]{8}$/);
    });
  });

  describe("decode()", () => {
    it("should decode basic encoded path", async () => {
      const result = await pathEncoder.decode("home-user-project");
      expect(result).toBe("/home/user/project");
    });

    it("should decode path with spaces", async () => {
      const result = await pathEncoder.decode("home-user-my_project");
      expect(result).toBe("/home/user/my project");
    });

    it("should return null for hashed paths", async () => {
      const result = await pathEncoder.decode(
        "home-user-very-long-path-abcd1234",
      );
      expect(result).toBe(null);
    });

    it("should handle custom separators in decode", async () => {
      const encoder = new PathEncoder({
        pathSeparatorReplacement: "_",
        spaceReplacement: "-",
      });

      const result = await encoder.decode("home_user_my-project");
      expect(result).toBe("/home/user/my project");
    });
  });

  describe("platform-specific constraints", () => {
    it("should use Windows constraints", () => {
      vi.mocked(platform).mockReturnValue("win32");
      const encoder = new PathEncoder();

      // Test that Windows reserved names are rejected
      expect(encoder.validateEncodedName("CON")).toBe(false);
    });

    it("should use macOS constraints", () => {
      vi.mocked(platform).mockReturnValue("darwin");
      const encoder = new PathEncoder();

      // Test that colon is rejected on macOS
      expect(encoder.validateEncodedName("name:with:colon")).toBe(false);
    });

    it("should use Linux constraints by default", () => {
      vi.mocked(platform).mockReturnValue("linux");
      const encoder = new PathEncoder();

      // Test that most characters are allowed except null
      expect(encoder.validateEncodedName("name-with-special<>chars")).toBe(
        true,
      );
      expect(encoder.validateEncodedName("name\x00with\x00null")).toBe(false);
    });
  });

  describe("error handling", () => {
    it("should handle encoding errors gracefully", async () => {
      vi.mocked(realpath).mockRejectedValue(new Error("Access denied"));

      await expect(pathEncoder.encode("/protected/path")).rejects.toThrow(
        "Failed to resolve path",
      );
    });

    it("should provide meaningful error messages", async () => {
      vi.mocked(realpath).mockRejectedValue(new Error("ENOENT: no such file"));

      await expect(pathEncoder.resolvePath("/nonexistent")).rejects.toThrow(
        'Failed to resolve path "/nonexistent": Error: ENOENT: no such file',
      );
    });

    it("should handle network path failures gracefully", async () => {
      vi.mocked(realpath).mockRejectedValue(
        new Error("Network is unreachable"),
      );

      await expect(pathEncoder.encode("//network/share/path")).rejects.toThrow(
        "Failed to resolve path",
      );
    });

    it("should handle permission denied errors", async () => {
      vi.mocked(realpath).mockRejectedValue(new Error("Permission denied"));

      await expect(pathEncoder.resolvePath("/root/.private")).rejects.toThrow(
        'Failed to resolve path "/root/.private": Error: Permission denied',
      );
    });
  });

  describe("edge cases and stress tests", () => {
    beforeEach(() => {
      // Ensure realpath is mocked to return the input path for these tests
      vi.mocked(realpath).mockImplementation((path) =>
        Promise.resolve(path as string),
      );
    });

    it("should handle extremely long paths with multiple segments", async () => {
      const longSegment = "a".repeat(50);
      const longPath = "/" + Array(10).fill(longSegment).join("/");

      const result = await pathEncoder.encode(longPath);
      expect(result.length).toBeLessThanOrEqual(200);
      expect(result).toMatch(/-[a-f0-9]{8}$/);
    });

    it("should handle paths with mixed Unicode and ASCII characters", async () => {
      const mixedPath = "/home/用户名/プロジェクト/项目/مشروع/проект";
      const result = await pathEncoder.encode(mixedPath);
      expect(result).toContain("用户名");
      expect(result).toContain("プロジェクト");
    });

    it("should handle paths with emoji and special Unicode", async () => {
      const emojiPath = "/home/user/📁项目/🚀app";
      const result = await pathEncoder.encode(emojiPath);
      expect(result).toContain("📁项目");
      expect(result).toContain("🚀app");
    });

    it("should handle collision resolution with Unicode names", async () => {
      const existingNames = new Set(["项目名称", "项目名称-1", "项目名称-2"]);
      const result = pathEncoder.resolveCollision("项目名称", existingNames);
      expect(result).toBe("项目名称-3");
    });

    it("should handle paths with repeated separators", async () => {
      const result = await pathEncoder.encode("///home///user////project///");
      // The encoder should normalize the path, so repeated separators become single separators
      expect(result).toBe("home-user-project");
    });

    it("should handle Windows UNC paths", async () => {
      vi.mocked(realpath).mockResolvedValue("\\\\server\\share\\folder");
      const result = await pathEncoder.encode("\\\\server\\share\\folder");
      expect(result).toMatch(/server-share-folder/);
    });

    it("should validate very short names", () => {
      expect(pathEncoder.validateEncodedName("a")).toBe(true);
      expect(pathEncoder.validateEncodedName("1")).toBe(true);
      expect(pathEncoder.validateEncodedName("-")).toBe(true);
    });
  });

  describe("performance and consistency", () => {
    beforeEach(() => {
      // Ensure realpath is mocked to return the input path for these tests
      vi.mocked(realpath).mockImplementation((path) =>
        Promise.resolve(path as string),
      );
    });

    it("should produce consistent hashes for same input", async () => {
      const longPath = "/home/user/" + "test".repeat(100);

      const result1 = await pathEncoder.encode(longPath);
      const result2 = await pathEncoder.encode(longPath);

      expect(result1).toBe(result2);
    });

    it("should handle multiple collision resolutions efficiently", () => {
      const baseName = "project";
      const existingNames = new Set<string>();

      // Add many existing names
      for (let i = 0; i < 100; i++) {
        existingNames.add(i === 0 ? baseName : `${baseName}-${i}`);
      }

      const result = pathEncoder.resolveCollision(baseName, existingNames);
      expect(result).toBe("project-100");
    });

    it("should handle rapid successive encoding calls", async () => {
      const paths = [
        "/home/user/project1",
        "/home/user/project2",
        "/home/user/project3",
      ];

      const results = await Promise.all(
        paths.map((p) => pathEncoder.encode(p)),
      );

      expect(results).toEqual([
        "home-user-project1",
        "home-user-project2",
        "home-user-project3",
      ]);
    });
  });

  describe("integration scenarios", () => {
    beforeEach(() => {
      // Ensure realpath is mocked to return the input path for these tests
      vi.mocked(realpath).mockImplementation((path) =>
        Promise.resolve(path as string),
      );
    });

    it("should handle complete workflow from path to directory creation", async () => {
      const originalPath = "~/my project/subfolder";
      const baseSessionDir = "/tmp/sessions";

      // First encode the path
      const encoded = await pathEncoder.encode(originalPath);
      expect(encoded).toBe("home-testuser-my_project-subfolder");

      // Then create project directory
      const projectDir = await pathEncoder.createProjectDirectory(
        originalPath,
        baseSessionDir,
      );

      expect(projectDir.encodedName).toBe(encoded);
      expect(projectDir.originalPath).toBe(
        "/home/testuser/my project/subfolder",
      );
      expect(mkdir).toHaveBeenCalledWith(
        "/tmp/sessions/home-testuser-my_project-subfolder",
        { recursive: true },
      );
    });

    it("should handle path validation in complete workflow", () => {
      // Simulate the encoding process
      const encodedName = "home-user-valid-project";

      // Validate the encoded name
      const isValid = pathEncoder.validateEncodedName(encodedName);
      expect(isValid).toBe(true);

      // Test collision resolution
      const existingNames = new Set([encodedName]);
      const resolvedName = pathEncoder.resolveCollision(
        encodedName,
        existingNames,
      );
      expect(resolvedName).toBe("home-user-valid-project-1");
    });

    it("should maintain filesystem safety across all operations", async () => {
      // Test with problematic path containing various challenging characters
      const problematicPath =
        "/home/user/Project Name: <Test> |Special*Characters?";

      const encoded = await pathEncoder.encode(problematicPath);
      const isValid = pathEncoder.validateEncodedName(encoded);

      expect(isValid).toBe(true);
      // On Linux, most characters are allowed except null, so this test should pass
      // Let's check if encoded correctly replaces invalid chars for current platform
      if (platform() === "linux") {
        // Linux only considers null character as invalid
        expect(encoded).not.toContain("\x00");
      } else {
        // On other platforms, these characters should be replaced
        expect(encoded).not.toMatch(/[<>:|?*]/);
      }
    });
  });
});
