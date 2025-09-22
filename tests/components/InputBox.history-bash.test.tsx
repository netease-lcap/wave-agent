import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { InputBox } from "@/components/InputBox";
import { resetMocks } from "../helpers/contextMock";
import { waitForText } from "../helpers/waitHelpers";

// 使用 vi.hoisted 来确保 mock 在静态导入之前被设置
await vi.hoisted(async () => {
  const { setupMocks } = await import("../helpers/contextMock");
  setupMocks();
});

// 延迟函数
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("InputBox History Navigation with Bash Commands", () => {
  // 在每个测试前重置 mock 状态
  beforeEach(() => {
    resetMocks();
  });

  it("should show ! commands in input when navigating to bash history", async () => {
    const { getMocks } = await import("../helpers/contextMock");
    const { mockChatContext } = getMocks();

    // 模拟历史记录中有bash命令
    mockChatContext.userInputHistory = ["!pwd", "normal message", "!ls -la"];

    const { stdin, lastFrame } = render(<InputBox />);

    // 按上键导航历史 - 应该显示最新的历史项目（"!ls -la"）
    stdin.write("\u001B[A"); // Up arrow
    await delay(100);

    const output = lastFrame();
    expect(output).toContain("!ls -la");
  });

  it("should navigate through bash history normally", async () => {
    const { getMocks } = await import("../helpers/contextMock");
    const { mockChatContext } = getMocks();

    // 设置历史记录
    mockChatContext.userInputHistory = ["!npm install", "normal command"];

    const renderResult = render(<InputBox />);
    const { stdin, lastFrame } = renderResult;

    // 按上键应该得到"normal command"（最新的）
    stdin.write("\u001B[A"); // Up arrow
    await waitForText(renderResult.lastFrame, "normal command");
    expect(lastFrame()).toContain("normal command");

    // 再按上键应该得到"!npm install"（更早的）
    stdin.write("\u001B[A"); // Up arrow
    await waitForText(renderResult.lastFrame, "!npm install");
    expect(lastFrame()).toContain("!npm install");
  });

  it("should handle multiline bash commands in history", async () => {
    const { getMocks } = await import("../helpers/contextMock");
    const { mockChatContext } = getMocks();

    // 设置历史记录，包括多行命令
    const multilineCommand = "!echo first\necho second";
    mockChatContext.userInputHistory = [
      "!single line command",
      multilineCommand,
    ];

    const renderResult = render(<InputBox />);
    const { stdin, lastFrame } = renderResult;

    // 按上键导航到最新的历史记录（多行命令）
    stdin.write("\u001B[A"); // Up arrow
    await waitForText(renderResult.lastFrame, "!echo first");
    const output = lastFrame();
    expect(output).toContain("!echo first");
    expect(output).toContain("echo second");

    // 再按上键导航到更早的历史记录（单行命令）
    stdin.write("\u001B[A"); // Up arrow
    await waitForText(renderResult.lastFrame, "!single line command");
    expect(lastFrame()).toContain("!single line command");
  });

  it("should not interfere with normal history navigation for non-bash commands", async () => {
    const { getMocks } = await import("../helpers/contextMock");
    const { mockChatContext } = getMocks();

    // 设置非bash命令的历史记录
    mockChatContext.userInputHistory = ["first message", "second message"];

    const renderResult = render(<InputBox />);
    const { stdin, lastFrame } = renderResult;

    // 按上键导航到最新的历史记录
    stdin.write("\u001B[A"); // Up arrow
    await waitForText(renderResult.lastFrame, "second message");
    expect(lastFrame()).toContain("second message");

    // 再按上键导航到更早的历史记录
    stdin.write("\u001B[A"); // Up arrow
    await waitForText(renderResult.lastFrame, "first message");
    expect(lastFrame()).toContain("first message");
  });
});
