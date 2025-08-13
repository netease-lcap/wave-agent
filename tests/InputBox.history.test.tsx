import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import {
  InputBox,
  INPUT_PLACEHOLDER_TEXT_PREFIX,
} from "../src/components/InputBox";
import { resetMocks, getMocks } from "./mocks/contextMock";
import { waitForText } from "./utils/aiWaitHelpers";

// 使用 vi.hoisted 来确保 mock 在静态导入之前被设置
await vi.hoisted(async () => {
  const { setupMocks } = await import("./mocks/contextMock");
  setupMocks();
});

// 延迟函数（保留作为备用）
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("InputBox History Navigation", () => {
  // 在每个测试前重置 mock 状态
  beforeEach(() => {
    resetMocks();
  });

  it("should not navigate when no history exists", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 输入一些文本
    stdin.write("current input");
    await waitForText({ lastFrame }, "current input");

    // 按上键，因为没有历史记录，应该没有变化
    stdin.write("\u001B[A"); // Up arrow
    await delay(50); // 给一点时间让按键处理
    expect(lastFrame()).toContain("current input");

    // 按下键，也应该没有变化
    stdin.write("\u001B[B"); // Down arrow
    await delay(50); // 给一点时间让按键处理
    expect(lastFrame()).toContain("current input");
  });

  it("should navigate up to previous history entry", async () => {
    const { mockChatContext } = getMocks();

    // 设置带有历史记录的 mock
    const mockHistoryData = ["hello world", "how are you", "test message"];
    mockChatContext.userInputHistory = mockHistoryData;

    const { stdin, lastFrame, unmount } = render(<InputBox />);

    // 输入当前文本
    stdin.write("current draft");
    await waitForText({ lastFrame }, "current draft");

    // 按上键，应该显示最新的历史记录
    stdin.write("\u001B[A"); // Up arrow
    await waitForText({ lastFrame }, "test message");
    expect(lastFrame()).not.toContain("current draft");

    // 再按上键，应该显示更早的历史记录
    stdin.write("\u001B[A"); // Up arrow
    await waitForText({ lastFrame }, "how are you");
    expect(lastFrame()).not.toContain("test message");

    // 再按上键，应该显示最早的历史记录
    stdin.write("\u001B[A"); // Up arrow
    await waitForText({ lastFrame }, "hello world");
    expect(lastFrame()).not.toContain("how are you");

    // 再按上键，应该停留在最早的记录（不应该再变化）
    stdin.write("\u001B[A"); // Up arrow
    await delay(50); // 这里仍使用delay，因为期望没有变化
    expect(lastFrame()).toContain("hello world");

    unmount();
  });

  it("should navigate down through history and back to draft", async () => {
    const { mockChatContext } = getMocks();

    // 设置带有历史记录的 mock
    const mockHistoryData = [
      "first message",
      "second message",
      "third message",
    ];
    mockChatContext.userInputHistory = mockHistoryData;

    const { stdin, lastFrame, unmount } = render(<InputBox />);

    // 输入草稿文本
    stdin.write("my draft");
    await waitForText({ lastFrame }, "my draft");

    // 向上导航到历史记录
    stdin.write("\u001B[A"); // Up arrow - 到最新历史
    await waitForText({ lastFrame }, "third message");

    stdin.write("\u001B[A"); // Up arrow - 到中间历史
    await waitForText({ lastFrame }, "second message");

    // 现在向下导航
    stdin.write("\u001B[B"); // Down arrow
    await waitForText({ lastFrame }, "third message");

    // 继续向下，应该回到草稿
    stdin.write("\u001B[B"); // Down arrow
    await waitForText({ lastFrame }, "my draft");

    // 再向下，应该清空输入
    stdin.write("\u001B[B"); // Down arrow
    await waitForText({ lastFrame }, INPUT_PLACEHOLDER_TEXT_PREFIX);
    expect(lastFrame()).not.toContain("my draft");

    unmount();
  });

  it("should preserve current input as draft when navigating to history", async () => {
    const { mockChatContext } = getMocks();

    const mockHistoryData = ["previous command", "another command"];
    mockChatContext.userInputHistory = mockHistoryData;

    const { stdin, lastFrame, unmount } = render(<InputBox />);

    // 输入一些文本作为草稿
    stdin.write("work in progress");
    await waitForText({ lastFrame }, "work in progress");

    // 导航到历史记录
    stdin.write("\u001B[A"); // Up arrow
    await waitForText({ lastFrame }, "another command");

    // 导航到更早的历史
    stdin.write("\u001B[A"); // Up arrow
    await waitForText({ lastFrame }, "previous command");

    // 向下导航回到较新的历史
    stdin.write("\u001B[B"); // Down arrow
    await waitForText({ lastFrame }, "another command");

    // 继续向下，应该恢复到原来的草稿
    stdin.write("\u001B[B"); // Down arrow
    await waitForText({ lastFrame }, "work in progress");

    unmount();
  });

  it("should reset history navigation when typing new text", async () => {
    const { mockChatContext } = getMocks();

    const mockHistoryData = ["old message"];
    mockChatContext.userInputHistory = mockHistoryData;

    const { stdin, lastFrame, unmount } = render(<InputBox />);

    // 导航到历史记录
    stdin.write("\u001B[A"); // Up arrow
    await delay(50);
    expect(lastFrame()).toContain("old message");

    // 输入新字符应该重置历史导航
    stdin.write("X");
    await delay(50);
    expect(lastFrame()).toContain("old messageX");

    // 现在按上键应该再次显示历史记录（因为历史导航被重置了）
    stdin.write("\u001B[A"); // Up arrow
    await delay(50);
    expect(lastFrame()).toContain("old message");
    expect(lastFrame()).not.toContain("old messageX");

    unmount();
  });

  it("should reset history navigation when deleting text", async () => {
    const { mockChatContext } = getMocks();

    const mockHistoryData = ["test history"];
    mockChatContext.userInputHistory = mockHistoryData;

    const { stdin, lastFrame, unmount } = render(<InputBox />);

    // 导航到历史记录
    stdin.write("\u001B[A"); // Up arrow
    await delay(50);
    expect(lastFrame()).toContain("test history");

    // 删除字符应该重置历史导航
    stdin.write("\u007F"); // Backspace
    await delay(50);
    expect(lastFrame()).toContain("test histor");

    // 再次按上键应该重新开始历史导航
    stdin.write("\u001B[A"); // Up arrow
    await delay(50);
    expect(lastFrame()).toContain("test history");

    unmount();
  });

  it("should not navigate history when file selector is active", async () => {
    const { mockChatContext } = getMocks();

    const mockHistoryData = ["some history"];
    mockChatContext.userInputHistory = mockHistoryData;

    const { stdin, lastFrame, unmount } = render(<InputBox />);

    // 输入 @ 触发文件选择器
    stdin.write("@");
    await delay(50);
    expect(lastFrame()).toContain("Select File");

    // 按上键应该用于文件选择器导航，不是历史导航
    stdin.write("\u001B[A"); // Up arrow
    await delay(50);
    expect(lastFrame()).toContain("Select File");
    expect(lastFrame()).toContain("@");
    expect(lastFrame()).not.toContain("some history");

    // 取消文件选择器
    stdin.write("\u001B"); // ESC
    await delay(50);

    // 现在按上键应该进行历史导航
    stdin.write("\u001B[A"); // Up arrow
    await delay(50);
    expect(lastFrame()).toContain("some history");

    unmount();
  });

  it("should not navigate history when command selector is active", async () => {
    const { mockChatContext } = getMocks();

    const mockHistoryData = ["some command history"];
    mockChatContext.userInputHistory = mockHistoryData;

    const { stdin, lastFrame, unmount } = render(<InputBox />);

    // 输入 / 触发命令选择器
    stdin.write("/");
    await delay(50);
    expect(lastFrame()).toContain("Command Selector");

    // 按上键应该用于命令选择器导航，不是历史导航
    stdin.write("\u001B[A"); // Up arrow
    await delay(50);
    expect(lastFrame()).toContain("Command Selector");
    expect(lastFrame()).toContain("/");
    expect(lastFrame()).not.toContain("some command history");

    // 取消命令选择器
    stdin.write("\u001B"); // ESC
    await delay(50);

    // 现在按上键应该进行历史导航
    stdin.write("\u001B[A"); // Up arrow
    await delay(50);
    expect(lastFrame()).toContain("some command history");

    unmount();
  });

  it("should handle empty history gracefully", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // 输入一些文本
    stdin.write("test input");
    await delay(50);

    // 按上键，应该没有变化（因为历史为空）
    stdin.write("\u001B[A"); // Up arrow
    await delay(50);
    expect(lastFrame()).toContain("test input");

    // 按下键，也应该没有变化
    stdin.write("\u001B[B"); // Down arrow
    await delay(50);
    expect(lastFrame()).toContain("test input");
  });
});
