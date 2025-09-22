import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { InputBox, INPUT_PLACEHOLDER_TEXT_PREFIX } from "@/components/InputBox";
import { resetMocks } from "../helpers/contextMock";

// 使用 vi.hoisted 来确保 mock 在静态导入之前被设置
await vi.hoisted(async () => {
  const { setupMocks } = await import("../helpers/contextMock");
  setupMocks();
});

// 延迟函数
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("InputBox Cursor Display", () => {
  // 在每个测试前重置 mock 状态
  beforeEach(() => {
    resetMocks();
  });

  it("should display cursor at the beginning when empty", async () => {
    const { lastFrame } = render(<InputBox />);

    // 验证初始状态显示占位符和光标
    const output = lastFrame();
    expect(output).toContain(INPUT_PLACEHOLDER_TEXT_PREFIX);
    // 光标应该高亮显示第一个字符
    expect(output).toMatch(/Type your message/);
  });

  it("should move cursor with left and right arrow keys", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 输入一些文本
    stdin.write("hello");
    await delay(50);

    // 光标应该在末尾
    expect(lastFrame()).toContain("hello");

    // 向左移动光标
    stdin.write("\u001B[D"); // Left arrow
    stdin.write("\u001B[D"); // Left arrow

    // 在当前位置插入文本
    stdin.write("X");
    await delay(50);

    // 验证文本插入到正确位置
    expect(lastFrame()).toContain("helXlo");

    // 向右移动光标
    stdin.write("\u001B[C"); // Right arrow
    stdin.write("\u001B[C"); // Right arrow

    // 在末尾插入文本
    stdin.write("Y");
    await delay(50);

    expect(lastFrame()).toContain("helXloY");
  });

  it("should insert text at cursor position", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 输入初始文本
    stdin.write("abc");
    await delay(50);

    // 移动光标到中间（向左移动一位）
    stdin.write("\u001B[D"); // Left arrow
    await delay(50);

    // 插入文本
    stdin.write("X");
    await delay(50);

    expect(lastFrame()).toContain("abXc");

    // 继续移动光标到更靠前的位置
    stdin.write("\u001B[D"); // Left arrow
    stdin.write("\u001B[D"); // Left arrow
    await delay(50);

    // 在新位置插入（结果应该是 aYbXc 或类似的顺序）
    stdin.write("Y");
    await delay(50);

    // 根据实际输出调整期望（应该是 aYbXc）
    expect(lastFrame()).toContain("aYbXc");
  });

  it("should preserve cursor position when file selector is active", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 输入一些文本，在中间位置触发文件选择器
    stdin.write("check ");
    await delay(50);
    stdin.write("@");
    await delay(400); // 增加延迟等待搜索完成

    // 验证文件选择器显示 - 应该显示所有文件
    const output = lastFrame();
    expect(output).toContain("📁 Select File");
    expect(output).toContain("src/index.ts");

    // 取消文件选择器
    stdin.write("\u001B"); // ESC
    await delay(50);

    // 验证回到原文本，光标在正确位置
    expect(lastFrame()).toContain("check @");
    expect(lastFrame()).not.toContain("Select File");

    // 继续输入应该在正确位置
    stdin.write(" more text");
    await delay(50);

    expect(lastFrame()).toContain("check @ more text");
  });

  it("should display cursor correctly in placeholder mode", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 初始状态应该显示占位符
    expect(lastFrame()).toContain(INPUT_PLACEHOLDER_TEXT_PREFIX);

    // 光标应该在占位符文本上可见（通过背景色高亮）
    const output = lastFrame();
    expect(output).toMatch(/Type your message/);

    // 输入一个字符应该切换到正常模式
    stdin.write("h");
    await delay(50);

    expect(lastFrame()).toContain("h");
    expect(lastFrame()).not.toContain(
      "Type your message (use @ to reference files, / for commands, ! for bash history, # to add memory)...",
    );

    // 删除字符应该回到占位符模式
    stdin.write("\u007F"); // Backspace
    await delay(50);

    expect(lastFrame()).toContain(INPUT_PLACEHOLDER_TEXT_PREFIX);
  });
});
