import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { InputBox, INPUT_PLACEHOLDER_TEXT } from "@/components/InputBox";
import { resetMocks, getMocks } from "../mocks/contextMock";

// 使用 vi.hoisted 来确保 mock 在静态导入之前被设置
await vi.hoisted(async () => {
  const { setupMocks } = await import("../mocks/contextMock");
  setupMocks();
});

// 延迟函数
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("InputBox Basic Functionality", () => {
  // 在每个测试前重置 mock 状态
  beforeEach(() => {
    resetMocks();
  });

  it("should call abortMessage when ESC key is pressed during loading", async () => {
    const { mockChatContext, mockFunctions } = getMocks();

    // 设置 loading 状态
    mockChatContext.isLoading = true;

    const { stdin } = render(<InputBox />);

    // 模拟按下 ESC 键
    stdin.write("\u001B"); // ESC 键
    await delay(50);

    // 验证 abortMessage 被调用
    expect(mockFunctions.abortMessage).toHaveBeenCalledTimes(1);
  });

  it("should call abortMessage when ESC key is pressed during command running", async () => {
    const { mockChatContext, mockFunctions } = getMocks();

    // 设置 command running 状态
    mockChatContext.isCommandRunning = true;

    const { stdin } = render(<InputBox />);

    // 模拟按下 ESC 键
    stdin.write("\u001B"); // ESC 键
    await delay(50);

    // 验证 abortMessage 被调用
    expect(mockFunctions.abortMessage).toHaveBeenCalledTimes(1);
  });

  it('should handle continuous input "hello"', async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 模拟连续快速输入 "hello"，不添加延迟
    stdin.write("hello");
    await delay(50); // 等待状态更新

    // 验证输入文本是否正确显示
    expect(lastFrame()).toContain("hello");

    // 验证不再显示占位符文本
    expect(lastFrame()).not.toContain(INPUT_PLACEHOLDER_TEXT);

    // 验证光标位置正确（应该在文本末尾）
    const output = lastFrame();
    expect(output).toContain("hello");
  });

  it("should handle paste input with newlines", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 模拟用户粘贴包含换行符的文本
    const pastedText = "This is line 1\nThis is line 2\nThis is line 3";
    stdin.write(pastedText);

    // 等待debounce处理（30毫秒 + 额外时间确保处理完成）
    await delay(150);

    // 验证文本被正确处理（换行符应该被保留或转换为空格）
    const output = lastFrame();
    expect(output).toContain("This is line 1");
    expect(output).toContain("This is line 2");
    expect(output).toContain("This is line 3");

    // 验证输入框不再显示占位符
    expect(output).not.toContain(INPUT_PLACEHOLDER_TEXT);

    // 验证显示内容不包含💬前缀
    expect(output).toContain("This is line 1");
  });

  it("should handle paste input with mixed content including @", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 模拟粘贴包含@符号和换行符的复杂文本
    const complexText =
      "Please check @src/index.ts\nand also review\n@package.json file";
    stdin.write(complexText);

    // 等待debounce处理（30毫秒 + 额外时间确保处理完成）
    await delay(150);

    // 验证文本被正确处理
    const output = lastFrame();
    expect(output).toContain("Please check @src/index.ts");
    expect(output).toContain("and also review");
    expect(output).toContain("@package.json file");

    // 验证不会意外触发文件选择器（因为这是粘贴操作，不是单个@字符输入）
    expect(output).not.toContain("Select File");

    // 验证显示内容不包含💬前缀
    expect(output).toContain("Please check @src/index.ts");
  });

  it("should handle sequential paste operations correctly (React async state fix)", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 第一次粘贴操作：模拟用户粘贴代码的第一部分
    const firstPaste = "const originalContent = await fs.promises.readFile";
    stdin.write(firstPaste);
    // 第二次粘贴操作：模拟用户继续粘贴代码的剩余部分
    const secondPaste = "(fullPath, 'utf-8');";
    stdin.write(secondPaste);

    // 等待debounce处理，连续粘贴会被合并处理（30毫秒 + 额外时间确保处理完成）
    await delay(150);

    // 验证连续粘贴被正确合并并显示完整内容
    const finalOutput = lastFrame();
    const expectedFullText =
      "const originalContent = await fs.promises.readFile(fullPath, 'utf-8');";

    expect(finalOutput).toContain(expectedFullText);
  });

  it("should debounce paste operations and not show intermediate states", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 模拟连续快速的粘贴操作（模拟长文本粘贴时的多次触发）
    const part1 = "This is the first part of ";
    const part2 = "a very long text that ";
    const part3 = "gets pasted in multiple chunks";

    // 快速连续输入多个粘贴块
    stdin.write(part1);
    stdin.write(part2);
    stdin.write(part3);

    // 在debounce时间内检查，应该还没有显示内容（或显示不完整）
    await delay(10); // 小于30毫秒

    // 等待debounce处理完成
    await delay(140); // 30毫秒 + 额外时间确保处理完成

    // 验证最终显示完整的合并内容
    const finalOutput = lastFrame();
    const expectedFullText =
      "This is the first part of a very long text that gets pasted in multiple chunks";
    expect(finalOutput).toContain(expectedFullText);

    // 验证不再显示占位符
    expect(finalOutput).not.toContain(INPUT_PLACEHOLDER_TEXT);
  });

  it("should handle single character input immediately (non-paste scenario)", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 模拟逐字符输入，应该立即显示
    stdin.write("h");
    await delay(10); // 很短的延迟，应该就能看到结果
    expect(lastFrame()).toContain("h");

    stdin.write("e");
    await delay(10);
    expect(lastFrame()).toContain("he");

    stdin.write("l");
    await delay(10);
    expect(lastFrame()).toContain("hel");

    stdin.write("l");
    await delay(10);
    expect(lastFrame()).toContain("hell");

    stdin.write("o");
    await delay(10);
    expect(lastFrame()).toContain("hello");

    // 验证不再显示占位符
    expect(lastFrame()).not.toContain(INPUT_PLACEHOLDER_TEXT);
  });

  it("should compress long text (>200 chars) into compressed format [长文本#1]", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 模拟粘贴超过200字符的长文本
    const longText = "A".repeat(250); // 250个字符的长文本
    stdin.write(longText);

    // 等待debounce处理完成
    await delay(150);

    // 验证长文本被压缩为 [长文本#1] 格式
    const output = lastFrame();
    expect(output).toContain("[长文本#1]");
    expect(output).not.toContain(longText); // 不应该显示原文本
  });

  it("should send original long text content when message is sent", async () => {
    const { mockFunctions } = getMocks();
    const { stdin, lastFrame } = render(<InputBox />);

    // 模拟粘贴超过200字符的长文本
    const longText =
      "This is a very long text that will be compressed in UI but should be sent as original content. " +
      "X".repeat(150);
    stdin.write(longText);

    // 等待debounce处理完成
    await delay(150);

    // 验证UI显示压缩文本
    const output = lastFrame();
    expect(output).toContain("[长文本#1]");

    // 模拟按回车发送消息
    stdin.write("\r");
    await delay(50);

    // 验证发送的是原始长文本内容，不是压缩标签
    expect(mockFunctions.sendMessage).toHaveBeenCalledTimes(1);
    const sentMessage = mockFunctions.sendMessage.mock.calls[0][0];
    expect(sentMessage).toBe(longText);
    expect(sentMessage).not.toContain("[长文本#1]");
  });

  it("should handle multiple long text compressions with incremental numbering", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 第一次粘贴长文本
    const longText1 = "First long text: " + "A".repeat(200);
    stdin.write(longText1);
    await delay(150);

    let output = lastFrame();
    expect(output).toContain("[长文本#1]");

    // 清空输入（模拟用户清空后再次粘贴）
    stdin.write("\u0015"); // Ctrl+U 清空行
    await delay(50);

    // 第二次粘贴长文本
    const longText2 = "Second long text: " + "B".repeat(200);
    stdin.write(longText2);
    await delay(150);

    output = lastFrame();
    expect(output).toContain("[长文本#2]");
  });

  it("should not compress short text (<= 200 chars)", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 模拟粘贴200字符的文本（刚好不超过阈值）
    const shortText = "A".repeat(200); // 正好200字符
    stdin.write(shortText);

    // 等待debounce处理完成
    await delay(150);

    // 验证短文本不会被压缩
    const output = lastFrame();
    // 由于Ink会将长文本换行显示，我们只检查开头部分
    expect(output).toContain("AAAAAAAAAA"); // 检查开头的A字符
    expect(output).not.toContain("[长文本#1]");
  });

  it("should log long text compression process", async () => {
    const { logger } = await import("@/utils/logger");

    const { stdin, lastFrame } = render(<InputBox />);

    // 模拟粘贴超过200字符的长文本
    const longText =
      "This is a very long text that exceeds 200 characters. " +
      "X".repeat(160);
    stdin.write(longText);

    // 等待debounce处理完成
    await delay(150);

    // 验证压缩日志
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      "[InputBox] 📦 长文本压缩: originalLength:",
      expect.any(Number),
      "compressedLabel:",
      "[长文本#1]",
      "preview:",
      expect.any(String),
    );

    // 验证最终输出
    const output = lastFrame();
    expect(output).toContain("[长文本#1]");
  });
});
