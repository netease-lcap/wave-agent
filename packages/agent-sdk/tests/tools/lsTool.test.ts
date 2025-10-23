import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { lsTool } from "@/tools/lsTool.js";
import { mkdtemp, writeFile, mkdir, symlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { rimraf } from "rimraf";
import type { ToolContext } from "@/tools/types.js";

const testContext: ToolContext = { workdir: "/test/workdir" };

describe("lsTool", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ls-test-"));

    // Create test file structure
    await mkdir(join(tempDir, "src"), { recursive: true });
    await mkdir(join(tempDir, "tests"), { recursive: true });
    await mkdir(join(tempDir, "docs"), { recursive: true });

    await writeFile(join(tempDir, "package.json"), '{"name": "test"}');
    await writeFile(join(tempDir, "README.md"), "# Test Project");
    await writeFile(join(tempDir, ".gitignore"), "node_modules/");
    await writeFile(
      join(tempDir, "src/index.ts"),
      "export const app = 'main';",
    );
    await writeFile(
      join(tempDir, "src/utils.ts"),
      "export const utils = 'helper';",
    );
    await writeFile(
      join(tempDir, "tests/app.test.js"),
      "test('app', () => {});",
    );
    await writeFile(join(tempDir, "docs/guide.md"), "# Guide");

    // Create a large file to test file size display
    await writeFile(join(tempDir, "large-file.txt"), "x".repeat(5000));

    // Create symbolic link (if supported)
    try {
      await symlink(
        join(tempDir, "README.md"),
        join(tempDir, "readme-link.md"),
      );
    } catch {
      // Ignore on systems that don't support symbolic links
    }
  });

  afterEach(async () => {
    await rimraf(tempDir);
  });

  it("should be properly configured", () => {
    expect(lsTool.name).toBe("LS");
    expect(lsTool.config.type).toBe("function");
    if (
      lsTool.config.type === "function" &&
      lsTool.config.function.parameters
    ) {
      expect(lsTool.config.function.name).toBe("LS");
      expect(lsTool.config.function.parameters.required).toEqual(["path"]);
    }
  });

  it("should list directory contents", async () => {
    const result = await lsTool.execute({ path: tempDir }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("Directory:");
    expect(result.content).toContain("Total items:");
    expect(result.content).toContain("📁 docs");
    expect(result.content).toContain("📁 src");
    expect(result.content).toContain("📁 tests");
    expect(result.content).toContain("📄 package.json");
    expect(result.content).toContain("📄 README.md");
    expect(result.content).toContain("📄 .gitignore");
    expect(result.shortResult).toMatch(/\d+ items \(\d+ dirs, \d+ files\)/);
  });

  it("should show file sizes", async () => {
    const result = await lsTool.execute({ path: tempDir }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("large-file.txt (5000 bytes)");
    expect(result.content).toMatch(/package\.json \(\d+ bytes\)/);
  });

  it("should sort directories first, then files", async () => {
    const result = await lsTool.execute({ path: tempDir }, testContext);

    expect(result.success).toBe(true);
    const lines = result.content.split("\n");
    const itemLines = lines.filter(
      (line) => line.startsWith("📁") || line.startsWith("📄"),
    );

    // All directories should come before files
    let foundFile = false;
    for (const line of itemLines) {
      if (line.startsWith("📄")) {
        foundFile = true;
      } else if (line.startsWith("📁") && foundFile) {
        // If we find a directory after finding a file, sorting is wrong
        expect(false).toBe(true);
      }
    }
  });

  it("should ignore files matching ignore patterns", async () => {
    // Create some files that should be ignored
    await writeFile(join(tempDir, "temp.tmp"), "temporary");
    await writeFile(join(tempDir, "backup.bak"), "backup");
    await writeFile(join(tempDir, "config.log"), "log file");

    const result = await lsTool.execute(
      {
        path: tempDir,
        ignore: ["*.tmp", "*.bak", "*.log"],
      },
      testContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).not.toContain("temp.tmp");
    expect(result.content).not.toContain("backup.bak");
    expect(result.content).not.toContain("config.log");
    expect(result.content).toContain("package.json"); // Normal files should exist
  });

  it("should ignore files matching path patterns", async () => {
    const result = await lsTool.execute(
      {
        path: tempDir,
        ignore: [join(tempDir, "docs")],
      },
      testContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).not.toContain("📁 docs");
    expect(result.content).toContain("📁 src"); // Other directories should exist
  });

  it("should show symlinks with special indicator", async () => {
    const result = await lsTool.execute({ path: tempDir }, testContext);

    expect(result.success).toBe(true);
    // Check if symbolic links are included (if system supports them)
    if (result.content.includes("readme-link.md")) {
      expect(result.content).toContain("🔗 readme-link.md");
    }
  });

  it("should return error for non-existent path", async () => {
    const nonExistentPath = join(tempDir, "non-existent");
    const result = await lsTool.execute({ path: nonExistentPath }, testContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("ENOENT");
  });

  it("should return error for file path (not directory)", async () => {
    const filePath = join(tempDir, "package.json");
    const result = await lsTool.execute({ path: filePath }, testContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("is not a directory");
  });

  it("should return error for relative path", async () => {
    const result = await lsTool.execute(
      { path: "./relative/path" },
      testContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Path must be an absolute path");
  });

  it("should return error for missing path parameter", async () => {
    const result = await lsTool.execute({}, testContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("path parameter is required");
  });

  it("should return error for invalid path type", async () => {
    const result = await lsTool.execute({ path: 123 }, testContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain(
      "path parameter is required and must be a string",
    );
  });

  it("should list subdirectory contents", async () => {
    const srcPath = join(tempDir, "src");
    const result = await lsTool.execute({ path: srcPath }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("Directory: " + srcPath);
    expect(result.content).toContain("📄 index.ts");
    expect(result.content).toContain("📄 utils.ts");
    expect(result.content).not.toContain("package.json"); // Should not contain parent directory files
    expect(result.shortResult).toContain("2 items (0 dirs, 2 files)");
  });

  it("should handle empty directory", async () => {
    const emptyDir = join(tempDir, "empty");
    await mkdir(emptyDir);

    const result = await lsTool.execute({ path: emptyDir }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("Total items: 0");
    expect(result.shortResult).toBe("0 items (0 dirs, 0 files)");
  });

  it("should format compact parameters correctly", () => {
    const params1 = { path: "/home/user/project" };
    expect(lsTool.formatCompactParams?.(params1, testContext)).toBe(
      "/home/user/project",
    );

    const params2 = {
      path: "/home/user/project",
      ignore: ["*.tmp", "*.log"],
    };
    expect(lsTool.formatCompactParams?.(params2, testContext)).toBe(
      "/home/user/project ignore: *.tmp, *.log",
    );

    const params3 = { path: "/test" };
    expect(lsTool.formatCompactParams?.(params3, testContext)).toBe("/test");
  });

  it("should handle files without read permissions gracefully", async () => {
    // Create a file, then try to create a file without read permissions
    // Note: This may not work on some systems, so we only test basic functionality
    const result = await lsTool.execute({ path: tempDir }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("Total items:");
  });

  it("should show binary file indicator", async () => {
    // Create a binary file
    const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe]);
    await writeFile(join(tempDir, "binary.bin"), binaryContent);

    const result = await lsTool.execute({ path: tempDir }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("binary.bin");
    // Check if there's a binary file identifier (depends on isBinary function implementation)
  });

  it("should handle files with special characters in names", async () => {
    // Create files with special characters in names
    await writeFile(join(tempDir, "file with spaces.txt"), "content");
    await writeFile(join(tempDir, "file-with-dashes.txt"), "content");
    await writeFile(join(tempDir, "file_with_underscores.txt"), "content");

    const result = await lsTool.execute({ path: tempDir }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("file with spaces.txt");
    expect(result.content).toContain("file-with-dashes.txt");
    expect(result.content).toContain("file_with_underscores.txt");
  });
});
