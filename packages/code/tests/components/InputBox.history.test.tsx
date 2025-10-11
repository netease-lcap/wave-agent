import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import {
  InputBox,
  INPUT_PLACEHOLDER_TEXT_PREFIX,
} from "../../src/components/InputBox.js";
import { waitForText } from "../helpers/waitHelpers.js";

// 延迟函数
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("InputBox History Navigation", () => {
  it("should not navigate when no history exists", async () => {
    const renderResult = render(<InputBox userInputHistory={[]} />);
    const { stdin, lastFrame } = renderResult;

    // 输入一些文本
    stdin.write("current input");
    await waitForText(renderResult.lastFrame, "current input");

    // 按上键，因为没有历史记录，应该没有变化
    stdin.write("\u001B[A"); // Up arrow
    await delay(10);
    expect(lastFrame()).toContain("current input");

    // 按下键，也应该没有变化
    stdin.write("\u001B[B"); // Down arrow
    await delay(10);
    expect(lastFrame()).toContain("current input");
  });

  it("should navigate up to previous history entry", async () => {
    const mockHistoryData = ["hello world", "how are you", "test message"];

    const renderResult = render(
      <InputBox userInputHistory={mockHistoryData} />,
    );
    const { stdin, lastFrame, unmount } = renderResult;

    // 输入当前文本
    stdin.write("current draft");
    await waitForText(renderResult.lastFrame, "current draft");

    // 按上键，应该显示最新的历史记录
    stdin.write("\u001B[A"); // Up arrow
    await waitForText(renderResult.lastFrame, "test message");
    expect(lastFrame()).not.toContain("current draft");

    // 再按上键，应该显示更早的历史记录
    stdin.write("\u001B[A"); // Up arrow
    await waitForText(renderResult.lastFrame, "how are you");
    expect(lastFrame()).not.toContain("test message");

    // 再按上键，应该显示最早的历史记录
    stdin.write("\u001B[A"); // Up arrow
    await waitForText(renderResult.lastFrame, "hello world");
    expect(lastFrame()).not.toContain("how are you");

    // 再按上键，应该停留在最早的记录（不应该再变化）
    stdin.write("\u001B[A"); // Up arrow
    await delay(10);
    expect(lastFrame()).toContain("hello world");

    unmount();
  });

  it("should navigate down through history and back to draft", async () => {
    const mockHistoryData = [
      "first message",
      "second message",
      "third message",
    ];

    const renderResult = render(
      <InputBox userInputHistory={mockHistoryData} />,
    );
    const { stdin, lastFrame, unmount } = renderResult;

    // 输入草稿文本
    stdin.write("my draft");
    await waitForText(renderResult.lastFrame, "my draft");

    // 向上导航到历史记录
    stdin.write("\u001B[A"); // Up arrow - 到最新历史
    await waitForText(renderResult.lastFrame, "third message");

    stdin.write("\u001B[A"); // Up arrow - 到中间历史
    await waitForText(renderResult.lastFrame, "second message");

    // 现在向下导航
    stdin.write("\u001B[B"); // Down arrow
    await waitForText(renderResult.lastFrame, "third message");

    // 继续向下，应该回到草稿
    stdin.write("\u001B[B"); // Down arrow
    await waitForText(renderResult.lastFrame, "my draft");

    // 再向下，应该清空输入
    stdin.write("\u001B[B"); // Down arrow
    await waitForText(renderResult.lastFrame, INPUT_PLACEHOLDER_TEXT_PREFIX);
    expect(lastFrame()).not.toContain("my draft");

    unmount();
  });

  it("should preserve current input as draft when navigating to history", async () => {
    const mockHistoryData = ["previous command", "another command"];

    const renderResult = render(
      <InputBox userInputHistory={mockHistoryData} />,
    );
    const { stdin, unmount } = renderResult;

    // 输入一些文本作为草稿
    stdin.write("work in progress");
    await waitForText(renderResult.lastFrame, "work in progress");

    // 导航到历史记录
    stdin.write("\u001B[A"); // Up arrow
    await waitForText(renderResult.lastFrame, "another command");

    // 导航到更早的历史
    stdin.write("\u001B[A"); // Up arrow
    await waitForText(renderResult.lastFrame, "previous command");

    // 向下导航回到较新的历史
    stdin.write("\u001B[B"); // Down arrow
    await waitForText(renderResult.lastFrame, "another command");

    // 继续向下，应该恢复到原来的草稿
    stdin.write("\u001B[B"); // Down arrow
    await waitForText(renderResult.lastFrame, "work in progress");

    unmount();
  });

  it("should reset history navigation when typing new text", async () => {
    const mockHistoryData = ["old message"];

    const { stdin, lastFrame, unmount } = render(
      <InputBox userInputHistory={mockHistoryData} />,
    );

    // 导航到历史记录
    stdin.write("\u001B[A"); // Up arrow
    await delay(10);
    expect(lastFrame()).toContain("old message");

    // 输入新字符应该重置历史导航
    stdin.write("X");
    await delay(10);
    expect(lastFrame()).toContain("old messageX");

    // 现在按上键应该再次显示历史记录（因为历史导航被重置了）
    stdin.write("\u001B[A"); // Up arrow
    await delay(10);
    expect(lastFrame()).toContain("old message");
    expect(lastFrame()).not.toContain("old messageX");

    unmount();
  });

  it("should reset history navigation when deleting text", async () => {
    const mockHistoryData = ["test history"];

    const { stdin, lastFrame, unmount } = render(
      <InputBox userInputHistory={mockHistoryData} />,
    );

    // 导航到历史记录
    stdin.write("\u001B[A"); // Up arrow
    await delay(10);
    expect(lastFrame()).toContain("test history");

    // 删除字符应该重置历史导航
    stdin.write("\u007F"); // Backspace
    await delay(10);
    expect(lastFrame()).toContain("test histor");

    // 再次按上键应该重新开始历史导航
    stdin.write("\u001B[A"); // Up arrow
    await delay(10);
    expect(lastFrame()).toContain("test history");

    unmount();
  });

  it("should not navigate history when file selector is active", async () => {
    const mockHistoryData = ["some history"];

    const { stdin, lastFrame, unmount } = render(
      <InputBox userInputHistory={mockHistoryData} />,
    );

    // 输入 @ 触发文件选择器
    stdin.write("@");
    await delay(400);
    expect(lastFrame()).toContain("Select File");

    // 按上键应该用于文件选择器导航，不是历史导航
    stdin.write("\u001B[A"); // Up arrow
    await delay(10);
    expect(lastFrame()).toContain("Select File");
    expect(lastFrame()).toContain("@");
    expect(lastFrame()).not.toContain("some history");

    // 取消文件选择器
    stdin.write("\u001B"); // ESC
    await delay(10);

    // 现在按上键应该进行历史导航
    stdin.write("\u001B[A"); // Up arrow
    await delay(10);
    expect(lastFrame()).toContain("some history");

    unmount();
  });

  it("should not navigate history when command selector is active", async () => {
    const mockHistoryData = ["some command history"];

    const { stdin, lastFrame, unmount } = render(
      <InputBox userInputHistory={mockHistoryData} />,
    );

    // 输入 / 触发命令选择器
    stdin.write("/");
    await waitForText(lastFrame, "/");

    // 按上键应该用于命令选择器导航，不是历史导航
    stdin.write("\u001B[A"); // Up arrow

    // 命令选择器应该还在，不应该切换到历史
    expect(lastFrame()).toContain("/");
    expect(lastFrame()).not.toContain("some command history");

    // 取消命令选择器（按 ESC 或删除 /）
    stdin.write("\u0008"); // Backspace to remove /
    await waitForText(lastFrame, "Type your message");

    // 现在按上键应该进行历史导航
    stdin.write("\u001B[A"); // Up arrow
    await waitForText(lastFrame, "some command history");

    unmount();
  });
});
