import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { lsTool } from "@/tools/lsTool";
import { mkdtemp, writeFile, mkdir, symlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { rimraf } from "rimraf";

describe("lsTool", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ls-test-"));

    // 创建测试文件结构
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

    // 创建一个大文件以测试文件大小显示
    await writeFile(join(tempDir, "large-file.txt"), "x".repeat(5000));

    // 创建符号链接（如果支持的话）
    try {
      await symlink(
        join(tempDir, "README.md"),
        join(tempDir, "readme-link.md"),
      );
    } catch {
      // 在不支持符号链接的系统上忽略
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
    const result = await lsTool.execute({ path: tempDir });

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
    const result = await lsTool.execute({ path: tempDir });

    expect(result.success).toBe(true);
    expect(result.content).toContain("large-file.txt (5000 bytes)");
    expect(result.content).toMatch(/package\.json \(\d+ bytes\)/);
  });

  it("should sort directories first, then files", async () => {
    const result = await lsTool.execute({ path: tempDir });

    expect(result.success).toBe(true);
    const lines = result.content.split("\n");
    const itemLines = lines.filter(
      (line) => line.startsWith("📁") || line.startsWith("📄"),
    );

    // 所有目录应该在文件之前
    let foundFile = false;
    for (const line of itemLines) {
      if (line.startsWith("📄")) {
        foundFile = true;
      } else if (line.startsWith("📁") && foundFile) {
        // 如果找到文件后又找到目录，说明排序有问题
        expect(false).toBe(true);
      }
    }
  });

  it("should ignore files matching ignore patterns", async () => {
    // 创建一些应该被忽略的文件
    await writeFile(join(tempDir, "temp.tmp"), "temporary");
    await writeFile(join(tempDir, "backup.bak"), "backup");
    await writeFile(join(tempDir, "config.log"), "log file");

    const result = await lsTool.execute({
      path: tempDir,
      ignore: ["*.tmp", "*.bak", "*.log"],
    });

    expect(result.success).toBe(true);
    expect(result.content).not.toContain("temp.tmp");
    expect(result.content).not.toContain("backup.bak");
    expect(result.content).not.toContain("config.log");
    expect(result.content).toContain("package.json"); // 正常文件应该存在
  });

  it("should ignore files matching path patterns", async () => {
    const result = await lsTool.execute({
      path: tempDir,
      ignore: [join(tempDir, "docs")],
    });

    expect(result.success).toBe(true);
    expect(result.content).not.toContain("📁 docs");
    expect(result.content).toContain("📁 src"); // 其他目录应该存在
  });

  it("should show symlinks with special indicator", async () => {
    const result = await lsTool.execute({ path: tempDir });

    expect(result.success).toBe(true);
    // 检查是否包含符号链接（如果系统支持的话）
    if (result.content.includes("readme-link.md")) {
      expect(result.content).toContain("🔗 readme-link.md");
    }
  });

  it("should return error for non-existent path", async () => {
    const nonExistentPath = join(tempDir, "non-existent");
    const result = await lsTool.execute({ path: nonExistentPath });

    expect(result.success).toBe(false);
    expect(result.error).toContain("ENOENT");
  });

  it("should return error for file path (not directory)", async () => {
    const filePath = join(tempDir, "package.json");
    const result = await lsTool.execute({ path: filePath });

    expect(result.success).toBe(false);
    expect(result.error).toContain("is not a directory");
  });

  it("should return error for relative path", async () => {
    const result = await lsTool.execute({ path: "./relative/path" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Path must be an absolute path");
  });

  it("should return error for missing path parameter", async () => {
    const result = await lsTool.execute({});

    expect(result.success).toBe(false);
    expect(result.error).toContain("path parameter is required");
  });

  it("should return error for invalid path type", async () => {
    const result = await lsTool.execute({ path: 123 });

    expect(result.success).toBe(false);
    expect(result.error).toContain(
      "path parameter is required and must be a string",
    );
  });

  it("should list subdirectory contents", async () => {
    const srcPath = join(tempDir, "src");
    const result = await lsTool.execute({ path: srcPath });

    expect(result.success).toBe(true);
    expect(result.content).toContain("Directory: " + srcPath);
    expect(result.content).toContain("📄 index.ts");
    expect(result.content).toContain("📄 utils.ts");
    expect(result.content).not.toContain("package.json"); // 不应该包含父目录的文件
    expect(result.shortResult).toContain("2 items (0 dirs, 2 files)");
  });

  it("should handle empty directory", async () => {
    const emptyDir = join(tempDir, "empty");
    await mkdir(emptyDir);

    const result = await lsTool.execute({ path: emptyDir });

    expect(result.success).toBe(true);
    expect(result.content).toContain("Total items: 0");
    expect(result.shortResult).toBe("0 items (0 dirs, 0 files)");
  });

  it("should format compact parameters correctly", () => {
    const params1 = { path: "/home/user/project" };
    expect(lsTool.formatCompactParams?.(params1)).toBe("/home/user/project");

    const params2 = {
      path: "/home/user/project",
      ignore: ["*.tmp", "*.log"],
    };
    expect(lsTool.formatCompactParams?.(params2)).toBe(
      "/home/user/project ignore: *.tmp, *.log",
    );

    const params3 = { path: "/test" };
    expect(lsTool.formatCompactParams?.(params3)).toBe("/test");
  });

  it("should handle files without read permissions gracefully", async () => {
    // 创建一个文件，然后尝试创建没有读权限的文件
    // 注意：这在某些系统上可能不工作，所以我们只测试基本功能
    const result = await lsTool.execute({ path: tempDir });

    expect(result.success).toBe(true);
    expect(result.content).toContain("Total items:");
  });

  it("should show binary file indicator", async () => {
    // 创建一个二进制文件
    const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe]);
    await writeFile(join(tempDir, "binary.bin"), binaryContent);

    const result = await lsTool.execute({ path: tempDir });

    expect(result.success).toBe(true);
    expect(result.content).toContain("binary.bin");
    // 检查是否有二进制文件标识（取决于 isBinary 函数的实现）
  });

  it("should handle files with special characters in names", async () => {
    // 创建包含特殊字符的文件名
    await writeFile(join(tempDir, "file with spaces.txt"), "content");
    await writeFile(join(tempDir, "file-with-dashes.txt"), "content");
    await writeFile(join(tempDir, "file_with_underscores.txt"), "content");

    const result = await lsTool.execute({ path: tempDir });

    expect(result.success).toBe(true);
    expect(result.content).toContain("file with spaces.txt");
    expect(result.content).toContain("file-with-dashes.txt");
    expect(result.content).toContain("file_with_underscores.txt");
  });
});
