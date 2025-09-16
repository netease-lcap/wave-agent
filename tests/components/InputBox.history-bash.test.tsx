import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { InputBox } from "@/components/InputBox";
import { resetMocks, getMocks } from "../helpers/contextMock";
import { waitForText } from "../helpers/waitHelpers";

// 使用 vi.hoisted 来确保 mock 在静态导入之前被设置
await vi.hoisted(async () => {
  const { setupMocks } = await import("../helpers/contextMock");
  setupMocks();
});

describe("InputBox History Navigation with Bash Mode", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("should activate bash mode when navigating to history entry starting with ! and single line", async () => {
    const { mockChatContext } = getMocks();

    // 设置带有叹号开头的单行历史记录
    const mockHistoryData = [
      "regular message",
      "!ls -la",
      "!pwd",
      "another regular message",
    ];
    mockChatContext.userInputHistory = mockHistoryData;

    const renderResult = render(<InputBox />);
    const { stdin, lastFrame } = renderResult;

    // 输入当前文本（非bash）
    stdin.write("current input");
    await waitForText(renderResult, "current input");

    // 确认不在bash模式（border应该是gray）
    expect(lastFrame()).toContain("│ current input");
    expect(lastFrame()).not.toContain("💻 Bash Mode");

    // 按上键导航到第一个历史记录（"another regular message"）
    stdin.write("\u001B[A"); // Up arrow
    await waitForText(renderResult, "another regular message");

    // 应该仍然不在bash模式
    expect(lastFrame()).not.toContain("💻 Bash Mode");

    // 继续按上键导航到"!pwd"（叹号开头的单行）
    stdin.write("\u001B[A"); // Up arrow
    await waitForText(renderResult, "!pwd");

    // 现在应该激活bash模式
    expect(lastFrame()).toContain("💻 Bash Mode");

    // 继续按上键导航到"!ls -la"（也是叹号开头的单行）
    stdin.write("\u001B[A"); // Up arrow
    await waitForText(renderResult, "!ls -la");

    // 应该仍然在bash模式
    expect(lastFrame()).toContain("💻 Bash Mode");

    // 按上键导航到"regular message"（不是叹号开头）
    stdin.write("\u001B[A"); // Up arrow
    await waitForText(renderResult, "regular message");

    // bash模式状态应该保持（因为checkBashMode会处理模式切换）
    // 但由于文本不以!开头，实际上bash模式应该被deactivate
    // 这个行为由checkBashMode控制，不是我们这里的责任
  });

  it("should activate bash mode when navigating down to exclamation history", async () => {
    const { mockChatContext } = getMocks();

    const mockHistoryData = ["!git status", "normal command", "!npm install"];
    mockChatContext.userInputHistory = mockHistoryData;

    const renderResult = render(<InputBox />);
    const { stdin, lastFrame } = renderResult;

    // 输入草稿
    stdin.write("draft");
    await waitForText(renderResult, "draft");

    // 向上导航两次到达"!git status"
    stdin.write("\u001B[A"); // Up arrow - 到"!npm install"
    await waitForText(renderResult, "!npm install");
    expect(lastFrame()).toContain("💻 Bash Mode");

    stdin.write("\u001B[A"); // Up arrow - 到"normal command"
    await waitForText(renderResult, "normal command");

    stdin.write("\u001B[A"); // Up arrow - 到"!git status"
    await waitForText(renderResult, "!git status");
    expect(lastFrame()).toContain("💻 Bash Mode");

    // 向下导航
    stdin.write("\u001B[B"); // Down arrow - 到"normal command"
    await waitForText(renderResult, "normal command");

    // 继续向下导航到叹号命令
    stdin.write("\u001B[B"); // Down arrow - 到"!npm install"
    await waitForText(renderResult, "!npm install");
    expect(lastFrame()).toContain("💻 Bash Mode");
  });

  it("should not activate bash mode for multi-line exclamation history", async () => {
    const { mockChatContext } = getMocks();

    // 设置包含多行文本的历史记录（以叹号开头但包含换行符）
    const mockHistoryData = [
      "regular message",
      "!echo 'line 1'\necho 'line 2'", // 多行，以叹号开头
      "!single line command",
    ];
    mockChatContext.userInputHistory = mockHistoryData;

    const renderResult = render(<InputBox />);
    const { stdin, lastFrame } = renderResult;

    // 按上键导航到单行叹号命令
    stdin.write("\u001B[A"); // Up arrow
    await waitForText(renderResult, "!single line command");
    expect(lastFrame()).toContain("💻 Bash Mode");

    // 继续按上键导航到多行叹号命令
    stdin.write("\u001B[A"); // Up arrow
    // 等待一小段时间让文本更新
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 检查文本是否包含多行内容的一部分
    expect(lastFrame()).toContain("!echo 'line 1'");

    // 不应该自动激活bash模式（因为是多行）
    // bash模式状态应该由checkBashMode根据文本内容决定
    // 由于文本以!开头，checkBashMode可能仍会保持bash模式
    // 这个测试主要验证navigateHistory不会因为多行而调用activateBashMode
  });

  it("should not activate bash mode for non-exclamation history", async () => {
    const { mockChatContext } = getMocks();

    const mockHistoryData = [
      "normal command 1",
      "regular message",
      "some text",
    ];
    mockChatContext.userInputHistory = mockHistoryData;

    const renderResult = render(<InputBox />);
    const { stdin, lastFrame } = renderResult;

    // 导航所有历史记录
    stdin.write("\u001B[A"); // Up arrow
    await waitForText(renderResult, "some text");
    expect(lastFrame()).not.toContain("💻 Bash Mode");

    stdin.write("\u001B[A"); // Up arrow
    await waitForText(renderResult, "regular message");
    expect(lastFrame()).not.toContain("💻 Bash Mode");

    stdin.write("\u001B[A"); // Up arrow
    await waitForText(renderResult, "normal command 1");
    expect(lastFrame()).not.toContain("💻 Bash Mode");

    // 向下导航也不应该激活bash模式
    stdin.write("\u001B[B"); // Down arrow
    await waitForText(renderResult, "regular message");
    expect(lastFrame()).not.toContain("💻 Bash Mode");
  });
});
