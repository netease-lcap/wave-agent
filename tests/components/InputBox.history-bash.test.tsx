import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { InputBox } from "@/components/InputBox";
import { waitForText } from "../helpers/waitHelpers";

describe("InputBox History Navigation with Bash Commands", () => {
  it("should show ! commands in input when navigating to bash history", async () => {
    // 模拟历史记录中有bash命令
    const userInputHistory = ["!pwd", "normal message", "!ls -la"];

    const { stdin, lastFrame } = render(
      <InputBox userInputHistory={userInputHistory} />,
    );

    // 按上键导航历史 - 应该显示最新的历史项目（"!ls -la"）
    stdin.write("\u001B[A"); // Up arrow
    await waitForText(lastFrame, "!ls -la");

    const output = lastFrame();
    expect(output).toContain("!ls -la");
  });

  it("should navigate through bash history normally", async () => {
    // 设置历史记录
    const userInputHistory = ["!npm install", "normal command"];

    const renderResult = render(
      <InputBox userInputHistory={userInputHistory} />,
    );
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
    // 设置历史记录，包括多行命令
    const multilineCommand = "!echo first\necho second";
    const userInputHistory = ["!single line command", multilineCommand];

    const renderResult = render(
      <InputBox userInputHistory={userInputHistory} />,
    );
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
    // 设置非bash命令的历史记录
    const userInputHistory = ["first message", "second message"];

    const renderResult = render(
      <InputBox userInputHistory={userInputHistory} />,
    );
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
