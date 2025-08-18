import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { InputBox } from "@/components/InputBox";
import { resetMocks } from "../mocks/contextMock";

// 使用 vi.hoisted 来确保 mock 在静态导入之前被设置
await vi.hoisted(async () => {
  const { setupMocks } = await import("../mocks/contextMock");
  setupMocks();
});

// 延迟函数
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("InputBox File Selector", () => {
  // 在每个测试前重置 mock 状态
  beforeEach(() => {
    resetMocks();
  });

  it("should trigger file selector when @ is typed", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 输入 @ 符号
    stdin.write("@");
    await delay(50);

    // 验证文件选择器出现
    expect(lastFrame()).toContain("Select File");
    expect(lastFrame()).toContain("src/index.ts");
    expect(lastFrame()).toContain("src/components/App.tsx");
    expect(lastFrame()).toContain("package.json");
  });

  it("should filter files when typing after @", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 先输入 @ 触发文件选择器
    stdin.write("@");
    await delay(10); // 增加延迟确保状态更新

    // 验证文件选择器已经显示
    expect(lastFrame()).toContain("Select File");

    // 然后输入过滤条件，一个字符一个字符输入
    stdin.write("s");
    await delay(10);
    stdin.write("r");
    await delay(10);
    stdin.write("c");
    await delay(10);

    // 验证文件选择器显示了过滤后的结果
    const output = lastFrame();
    expect(output).toContain("Select File");
    expect(output).toContain('filtering: "src"');
    expect(output).toContain("src/index.ts");
    expect(output).toContain("src/components/App.tsx");
    // package.json 应该被过滤掉
    expect(output).not.toContain("package.json");
  });

  it("should filter files with more specific query", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 先输入 @ 触发文件选择器
    stdin.write("@");
    await delay(50);

    // 然后输入更具体的过滤条件
    stdin.write("tsx");
    await delay(50);

    // 验证只显示匹配的文件
    expect(lastFrame()).toContain("Select File");
    expect(lastFrame()).toContain('filtering: "tsx"');
    expect(lastFrame()).toContain("src/components/App.tsx");
    // 其他文件应该被过滤掉
    expect(lastFrame()).not.toContain("src/index.ts");
    expect(lastFrame()).not.toContain("package.json");
  });

  it("should show no files message when no matches found", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 先输入 @ 触发文件选择器
    stdin.write("@");
    await delay(50);

    // 然后输入不存在的文件过滤条件
    stdin.write("nonexistent");
    await delay(50);

    // 验证显示无匹配文件的消息
    expect(lastFrame()).toContain('No files found for "nonexistent"');
    expect(lastFrame()).toContain("Press Escape to cancel");
  });

  it("should close file selector when escape is pressed", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 输入 @ 触发文件选择器
    stdin.write("@");
    await delay(50);
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
    await delay(10);

    // 然后输入过滤条件
    stdin.write("src");
    await delay(10);
    expect(lastFrame()).toContain("Select File");

    // 删除字符（模拟退格键）
    stdin.write("\u007F"); // Backspace
    await delay(10);
    stdin.write("\u007F"); // Backspace
    await delay(10);
    stdin.write("\u007F"); // Backspace
    await delay(10);
    stdin.write("\u007F"); // Backspace (删除 @ 符号)
    await delay(10);

    // 验证文件选择器消失
    expect(lastFrame()).not.toContain("Select File");
  });

  it("should select file and replace @ query when Enter is pressed", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 先输入 @ 触发文件选择器
    stdin.write("@");
    await delay(50);

    // 然后输入过滤条件
    stdin.write("tsx");
    await delay(50);

    // 验证文件选择器显示
    expect(lastFrame()).toContain("Select File");
    expect(lastFrame()).toContain("src/components/App.tsx");

    // 按 Enter 选择第一个文件
    stdin.write("\r"); // Enter key
    await delay(50);

    // 验证文件选择器消失，文本被替换
    expect(lastFrame()).not.toContain("Select File");
    expect(lastFrame()).toContain("src/components/App.tsx");
  });

  it("should navigate files with arrow keys in file selector", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 输入 @ 触发文件选择器
    stdin.write("@");
    await delay(50);

    // 验证第一个文件被选中（默认选中第一个）
    expect(lastFrame()).toContain("▶ src/index.ts");

    // 按下箭头键移动选择
    stdin.write("\u001B[B"); // Down arrow
    await delay(50);

    // 验证选择移动到第二个文件
    expect(lastFrame()).toContain("▶ src/components/App.tsx");
    expect(lastFrame()).not.toContain("▶ src/index.ts");

    // 按上箭头键
    stdin.write("\u001B[A"); // Up arrow
    await delay(50);

    // 验证选择回到第一个文件
    expect(lastFrame()).toContain("▶ src/index.ts");
    expect(lastFrame()).not.toContain("▶ src/components/App.tsx");
  });

  it("should handle complex input with @ in the middle", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 输入一些文本，然后在中间插入 @
    stdin.write("Check this file ");
    await delay(50);

    // 先输入 @ 触发文件选择器
    stdin.write("@");
    await delay(50);

    // 然后输入过滤条件
    stdin.write("tsx");
    await delay(50);

    // 验证文件选择器显示
    expect(lastFrame()).toContain("Select File");
    expect(lastFrame()).toContain('filtering: "tsx"');

    // 选择文件
    stdin.write("\r"); // Enter
    await delay(50);

    // 验证完整的文本
    expect(lastFrame()).toContain("Check this file src/components/App.tsx");
    expect(lastFrame()).not.toContain("Select File");
  });
});
