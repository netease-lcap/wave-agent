import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import { InputBox } from "@/components/InputBox";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// 延迟函数
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("InputBox File Selector", () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    // 保存原始工作目录
    originalCwd = process.cwd();

    // 创建临时目录
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-selector-test-"));

    // 创建测试文件结构
    const testFiles = [
      "src/index.ts",
      "src/components/App.tsx",
      "src/cli.tsx",
      "package.json",
      "tests/helpers/HookTester.tsx",
      "tests/hooks/useMemoryMode.test.tsx",
      "tests/hooks/useLoadingTimer.test.tsx",
      "tests/hooks/useImageManager.test.tsx",
      "tests/hooks/useBashMode.test.tsx",
      "tests/components/ToolResultDisplay.test.tsx",
      "tests/components/ToolResultDisplay.compactParams.test.tsx",
      "tests/components/MessageList.pagination.test.tsx",
      "tests/components/MessageList.loading.test.tsx",
    ];

    // 创建目录结构和文件
    for (const filePath of testFiles) {
      const fullPath = path.join(tempDir, filePath);
      const dir = path.dirname(fullPath);

      // 确保目录存在
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 写入文件内容
      fs.writeFileSync(fullPath, `// Test file: ${filePath}`);
    }

    // 改变工作目录到临时目录
    process.chdir(tempDir);
  });

  afterEach(() => {
    // 恢复原始工作目录
    process.chdir(originalCwd);

    // 清理临时目录
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should trigger file selector when @ is typed", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 输入 @ 符号
    stdin.write("@");
    await delay(100); // 增加延迟以等待防抖搜索完成

    // 验证文件选择器出现
    expect(lastFrame()).toContain("Select File");
    expect(lastFrame()).toContain("src/index.ts");
    expect(lastFrame()).toContain("src/cli.tsx");
    // 验证显示了至少一些文件
    expect(lastFrame()).toMatch(/File \d+ of \d+/);
  });

  it("should filter files when typing after @", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 先输入 @ 触发文件选择器
    stdin.write("@");
    await delay(100); // 等待防抖搜索完成

    // 验证文件选择器已经显示
    expect(lastFrame()).toContain("Select File");

    // 然后输入过滤条件（搜索包含 "test" 的文件）
    stdin.write("test");
    await delay(100); // 等待防抖搜索完成

    // 验证文件选择器显示了过滤后的结果
    const output = lastFrame();
    expect(output).toContain("Select File");
    expect(output).toContain('filtering: "test"');
    expect(output).toContain("tests/hooks/useMemoryMode.test.tsx");
    // package.json 应该被过滤掉
    expect(output).not.toContain("package.json");
  });

  it("should filter files with more specific query", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 先输入 @ 触发文件选择器
    stdin.write("@");
    await delay(100); // 等待初始搜索完成

    // 然后输入更具体的过滤条件
    stdin.write("tsx");
    await delay(100); // 等待防抖搜索完成

    // 验证只显示匹配的文件
    expect(lastFrame()).toContain("Select File");
    expect(lastFrame()).toContain('filtering: "tsx"');
    expect(lastFrame()).toContain("src/cli.tsx");
    // 其他文件应该被过滤掉
    expect(lastFrame()).not.toContain("src/index.ts");
    expect(lastFrame()).not.toContain("package.json");
  });

  it("should show no files message when no matches found", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 先输入 @ 触发文件选择器
    stdin.write("@");
    await delay(100); // 等待初始搜索完成

    // 然后输入不存在的文件过滤条件
    stdin.write("nonexistent");
    await delay(100); // 等待防抖搜索完成

    // 验证显示无匹配文件的消息
    expect(lastFrame()).toContain('No files found for "nonexistent"');
    expect(lastFrame()).toContain("Press Escape to cancel");
  });

  it("should close file selector when escape is pressed", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 输入 @ 触发文件选择器
    stdin.write("@");
    await delay(100); // 等待防抖搜索完成
    expect(lastFrame()).toContain("Select File");

    // 按 Escape 键
    stdin.write("\u001B"); // ESC key
    await delay(50);

    // 验证文件选择器消失
    expect(lastFrame()).not.toContain("Select File");
    expect(lastFrame()).toContain("@");
  });

  it("should close file selector when @ is deleted", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 先输入 @ 触发文件选择器
    stdin.write("@");
    await delay(100); // 等待防抖搜索完成

    // 验证文件选择器出现
    expect(lastFrame()).toContain("Select File");

    // 删除 @ 字符
    stdin.write("\u007F"); // Backspace
    await delay(50);

    // 验证文件选择器消失
    expect(lastFrame()).not.toContain("Select File");
  });

  it("should select file and replace @ query when Enter is pressed", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 先输入 @ 触发文件选择器
    stdin.write("@");
    await delay(100); // 等待初始搜索完成

    // 然后输入过滤条件
    stdin.write("tsx");
    await delay(100); // 等待防抖搜索完成

    // 验证文件选择器显示
    expect(lastFrame()).toContain("Select File");
    expect(lastFrame()).toContain("src/cli.tsx");

    // 按 Enter 选择第一个文件
    stdin.write("\r"); // Enter key
    await delay(50);

    // 验证文件选择器消失，文本被替换
    expect(lastFrame()).not.toContain("Select File");
    expect(lastFrame()).toContain("src/cli.tsx");
  });

  it("should navigate files with arrow keys in file selector", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 输入 @ 触发文件选择器
    stdin.write("@");
    await delay(100); // 等待防抖搜索完成

    // 验证第一个文件被选中（默认选中第一个）
    expect(lastFrame()).toContain("▶ src/index.ts");

    // 按下箭头键移动选择
    stdin.write("\u001B[B"); // Down arrow
    await delay(50);

    // 验证选择移动到第二个文件
    expect(lastFrame()).toContain("▶ src/cli.tsx");
    expect(lastFrame()).not.toContain("▶ src/index.ts");

    // 按上箭头键
    stdin.write("\u001B[A"); // Up arrow
    await delay(50);

    // 验证选择回到第一个文件
    expect(lastFrame()).toContain("▶ src/index.ts");
    expect(lastFrame()).not.toContain("▶ src/cli.tsx");
  });

  it("should handle complex input with @ in the middle", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 输入一些文本，然后在中间插入 @
    stdin.write("Check this file ");
    await delay(50);

    // 先输入 @ 触发文件选择器
    stdin.write("@");
    await delay(100); // 等待初始搜索完成

    // 然后输入过滤条件
    stdin.write("tsx");
    await delay(100); // 等待防抖搜索完成

    // 验证文件选择器显示
    expect(lastFrame()).toContain("Select File");
    expect(lastFrame()).toContain('filtering: "tsx"');

    // 选择文件
    stdin.write("\r"); // Enter
    await delay(50);

    // 验证完整的文本
    expect(lastFrame()).toContain("Check this file src/cli.tsx");
    expect(lastFrame()).not.toContain("Select File");
  });
});
