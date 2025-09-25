import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { InputBox, INPUT_PLACEHOLDER_TEXT } from "@/components/InputBox";

// 延迟函数
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("InputBox Basic Functionality", () => {
  it("should show placeholder text when empty", async () => {
    const { lastFrame } = render(<InputBox />);

    // 验证显示占位符文本（可能被换行）
    expect(lastFrame()).toMatch(/Type your message[\s\S]*use @ to reference/);
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
  });

  it("should handle sequential paste operations correctly", async () => {
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

  it("should handle single character input immediately", async () => {
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

  it("should compress long text (>200 chars) into compressed format", async () => {
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

  it("should handle multiple long text compressions with incremental numbering", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 第一次粘贴长文本
    const longText1 = "First long text: " + "A".repeat(200);
    stdin.write(longText1);
    await delay(150);

    let output = lastFrame();
    expect(output).toContain("[长文本#1]");

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
});
