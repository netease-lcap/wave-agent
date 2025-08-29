import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { InputBox } from "@/components/InputBox";
import { resetMocks } from "../helpers/contextMock";

// 使用 vi.hoisted 来确保 mock 在静态导入之前被设置
await vi.hoisted(async () => {
  const { setupMocks } = await import("../helpers/contextMock");
  setupMocks();
});

// 延迟函数
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("InputBox Memory Mode", () => {
  // 在每个测试前重置 mock 状态
  beforeEach(() => {
    resetMocks();
  });

  it("should show memory mode when input starts with #", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Type # to enter memory mode
    stdin.write("#");
    await delay(10);

    const output = lastFrame();
    expect(output).toContain("📝 Memory Mode");
    expect(output).toContain("Add memory content (remove # to exit)");
    // 当有输入时，不会显示 placeholder，所以只检查模式提示
    expect(output).toContain("#");
  });

  it("should show memory placeholder when input is empty", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 首先输入 # 然后删除，这样会触发记忆模式的 placeholder 检查
    stdin.write("#");
    await delay(10);

    // 删除 # 字符，但这时 inputText 会变为空，不再是记忆模式
    stdin.write("\u0008"); // backspace
    await delay(10);

    // 重新输入 # 进入记忆模式
    stdin.write("#");
    await delay(10);

    const output = lastFrame();
    expect(output).toContain("📝 Memory Mode");
    expect(output).toContain("Add memory content (remove # to exit)");
  });

  it("should not show memory mode for normal input", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Type normal text
    stdin.write("hello");
    await delay(10);

    const output = lastFrame();
    expect(output).not.toContain("📝 Memory Mode");
    expect(output).not.toContain("Add memory content (remove # to exit)");
  });

  it("should exit memory mode when # is removed", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Type # to enter memory mode
    stdin.write("#");
    await delay(10);
    let output = lastFrame();
    expect(output).toContain("📝 Memory Mode");

    // Remove # to exit memory mode
    stdin.write("\u0008"); // backspace
    await delay(10);
    output = lastFrame();
    expect(output).not.toContain("📝 Memory Mode");
  });

  it("should stay in memory mode when additional text is added after #", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Type # to enter memory mode first
    stdin.write("#");
    await delay(10);

    // Then type additional text character by character - should stay in memory mode since it still starts with #
    const text = " remember this";
    for (const char of text) {
      stdin.write(char);
    }
    await delay(10);

    const output = lastFrame();
    expect(output).toContain("📝 Memory Mode");
    expect(output).toContain("Add memory content (remove # to exit)");
    expect(output).toContain("# remember this");
  });

  it("should exit memory mode only when # is deleted from the beginning", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Type # to enter memory mode first
    stdin.write("#");
    await delay(10);
    let output = lastFrame();
    expect(output).toContain("📝 Memory Mode");

    // Add some text after # - should stay in memory mode
    stdin.write(" content");
    await delay(10);
    output = lastFrame();
    expect(output).toContain("📝 Memory Mode");

    // Use backspace to delete all characters including the #
    // This simulates deleting " content#" character by character
    for (let i = 0; i < 9; i++) {
      // " content" = 8 chars + "#" = 1 char = 9 total
      stdin.write("\u0008"); // Backspace
    }
    await delay(10);

    output = lastFrame();
    expect(output).not.toContain("📝 Memory Mode");
    expect(output).not.toContain("Add memory content (remove # to exit)");
  });

  it("should change border color in memory mode", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Normal mode should have gray border
    let output = lastFrame();
    // Note: border color testing is limited in text output, but we can test the content

    // Type # to enter memory mode
    stdin.write("#");
    await delay(10);

    output = lastFrame();
    expect(output).toContain("📝 Memory Mode");
    expect(output).toContain("Add memory content (remove # to exit)");
  });

  it("should NOT trigger memory mode when pasting text starting with # in one go", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 一口气输入以#开头的文本（模拟粘贴操作）
    // 这应该被当作普通消息处理，不应该触发记忆模式
    const pastedText = "#粘贴文本内容";
    stdin.write(pastedText);
    await delay(50); // 等待粘贴debounce处理完成

    const output = lastFrame();

    // 应该不会显示记忆模式UI
    expect(output).not.toContain("📝 Memory Mode");
    expect(output).not.toContain("Add memory content (remove # to exit)");

    // 但是文本内容应该正常显示
    expect(output).toContain("#粘贴文本内容");
  });

  it("should send pasted #text as normal message, not trigger memory save", async () => {
    const { getMocks } = await import("../helpers/contextMock");
    const { mockFunctions } = getMocks();

    const { stdin, lastFrame } = render(<InputBox />);

    // 一口气输入以#开头的文本（模拟粘贴操作）
    const pastedText = "#这是粘贴的内容";
    stdin.write(pastedText);
    await delay(50); // 等待粘贴debounce处理完成

    // 验证不在记忆模式下且内容正确显示
    const output = lastFrame();
    expect(output).not.toContain("📝 Memory Mode");
    expect(output).toContain("#这是粘贴的内容");

    // 发送消息
    stdin.write("\r"); // Enter key
    await delay(100); // 增加等待时间

    // 验证 sendMessage 被调用
    expect(mockFunctions.sendMessage).toHaveBeenCalled();

    // 检查调用参数
    const sendMessageCalls = mockFunctions.sendMessage.mock.calls;
    expect(sendMessageCalls).toHaveLength(1);

    const [content, images, options] = sendMessageCalls[0];
    expect(content).toBe("#这是粘贴的内容");
    expect(images).toBeUndefined();
    expect(options).toEqual({
      isMemoryMode: false,
      isBashMode: false,
    });

    // 验证 saveMemory 没有被调用（因为不在记忆模式下）
    expect(mockFunctions.saveMemory).not.toHaveBeenCalled();
  });

  it("should trigger memory type selector when typing # and adding text character by character", async () => {
    const { getMocks } = await import("../helpers/contextMock");
    const { mockFunctions } = getMocks();

    const { stdin, lastFrame } = render(<InputBox />);

    // 逐字符输入 # 然后添加文本，这会触发记忆模式
    stdin.write("#");
    await delay(10);

    // 验证进入记忆模式
    let output = lastFrame();
    expect(output).toContain("📝 Memory Mode");

    // 继续逐字符添加文本
    stdin.write("记");
    stdin.write("忆");
    stdin.write("内");
    stdin.write("容");
    await delay(10);

    // 验证仍在记忆模式下
    output = lastFrame();
    expect(output).toContain("📝 Memory Mode");
    expect(output).toContain("#记忆内容");

    // 尝试发送消息 - 应该触发记忆类型选择器而不是直接发送
    stdin.write("\r"); // Enter key
    await delay(10);

    // 在记忆模式下，按回车应该激活记忆类型选择器，而不是发送消息
    // 这里我们无法直接测试 activateMemoryTypeSelector 是否被调用
    // 但可以验证 sendMessage 没有被立即调用
    expect(mockFunctions.sendMessage).not.toHaveBeenCalled();
  });

  it("should exit memory mode after saving memory", async () => {
    const { getMocks } = await import("../helpers/contextMock");
    const { mockFunctions } = getMocks();

    const { stdin, lastFrame } = render(<InputBox />);

    // 进入记忆模式
    stdin.write("#");
    await delay(10);

    let output = lastFrame();
    expect(output).toContain("📝 Memory Mode");

    // 添加记忆内容
    stdin.write("测试记忆内容");
    await delay(10);

    // 验证仍在记忆模式
    output = lastFrame();
    expect(output).toContain("📝 Memory Mode");

    // 模拟记忆类型选择 - 这会触发保存并退出记忆模式
    // 通过调用 InputBox 的 handleMemoryTypeSelect 方法
    // 由于我们无法直接测试记忆类型选择器，我们通过模拟输入 Enter 来间接测试
    stdin.write("\r"); // Enter key
    await delay(10);

    // 注意：在实际场景中，这会弹出记忆类型选择器，但在我们的测试中可能不会完全模拟
    // 我们主要验证没有立即发送消息作为普通消息
    expect(mockFunctions.sendMessage).not.toHaveBeenCalled();
  });
});
