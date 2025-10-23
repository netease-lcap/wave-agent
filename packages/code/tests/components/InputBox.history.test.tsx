import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import {
  InputBox,
  INPUT_PLACEHOLDER_TEXT_PREFIX,
} from "../../src/components/InputBox.js";
import { waitForText } from "../helpers/waitHelpers.js";

// Delay function
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("InputBox History Navigation", () => {
  it("should not navigate when no history exists", async () => {
    const renderResult = render(<InputBox userInputHistory={[]} />);
    const { stdin, lastFrame } = renderResult;

    // Input some text
    stdin.write("current input");
    await waitForText(renderResult.lastFrame, "current input");

    // Press up key, since there's no history, should have no change
    stdin.write("\u001B[A"); // Up arrow
    await delay(10);
    expect(lastFrame()).toContain("current input");

    // Press down key, should also have no change
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

    // Input current text
    stdin.write("current draft");
    await waitForText(renderResult.lastFrame, "current draft");

    // Press up key, should show latest history record
    stdin.write("\u001B[A"); // Up arrow
    await waitForText(renderResult.lastFrame, "test message");
    expect(lastFrame()).not.toContain("current draft");

    // Press up key again, should show earlier history record
    stdin.write("\u001B[A"); // Up arrow
    await waitForText(renderResult.lastFrame, "how are you");
    expect(lastFrame()).not.toContain("test message");

    // Press up key again, should show earliest history record
    stdin.write("\u001B[A"); // Up arrow
    await waitForText(renderResult.lastFrame, "hello world");
    expect(lastFrame()).not.toContain("how are you");

    // Press up key again, should stay at earliest record (no more changes)
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

    // Input draft text
    stdin.write("my draft");
    await waitForText(renderResult.lastFrame, "my draft");

    // Navigate up to history records
    stdin.write("\u001B[A"); // Up arrow - to latest history
    await waitForText(renderResult.lastFrame, "third message");

    stdin.write("\u001B[A"); // Up arrow - to middle history
    await waitForText(renderResult.lastFrame, "second message");

    // Now navigate down
    stdin.write("\u001B[B"); // Down arrow
    await waitForText(renderResult.lastFrame, "third message");

    // Continue down, should return to draft
    stdin.write("\u001B[B"); // Down arrow
    await waitForText(renderResult.lastFrame, "my draft");

    // Go down again, should clear input
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

    // Input some text as draft
    stdin.write("work in progress");
    await waitForText(renderResult.lastFrame, "work in progress");

    // Navigate to history record
    stdin.write("\u001B[A"); // Up arrow
    await waitForText(renderResult.lastFrame, "another command");

    // Navigate to earlier history
    stdin.write("\u001B[A"); // Up arrow
    await waitForText(renderResult.lastFrame, "previous command");

    // Navigate down back to newer history
    stdin.write("\u001B[B"); // Down arrow
    await waitForText(renderResult.lastFrame, "another command");

    // Continue down, should restore to original draft
    stdin.write("\u001B[B"); // Down arrow
    await waitForText(renderResult.lastFrame, "work in progress");

    unmount();
  });

  it("should reset history navigation when typing new text", async () => {
    const mockHistoryData = ["old message"];

    const { stdin, lastFrame, unmount } = render(
      <InputBox userInputHistory={mockHistoryData} />,
    );

    // Navigate to history record
    stdin.write("\u001B[A"); // Up arrow
    await delay(10);
    expect(lastFrame()).toContain("old message");

    // Inputting new character should reset history navigation
    stdin.write("X");
    await delay(10);
    expect(lastFrame()).toContain("old messageX");

    // Now pressing up should show history again (because history navigation was reset)
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

    // Navigate to history record
    stdin.write("\u001B[A"); // Up arrow
    await delay(10);
    expect(lastFrame()).toContain("test history");

    // Deleting character should reset history navigation
    stdin.write("\u007F"); // Backspace
    await delay(10);
    expect(lastFrame()).toContain("test histor");

    // Pressing up again should restart history navigation
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

    // Input @ to trigger file selector
    stdin.write("@");
    await delay(400);
    expect(lastFrame()).toContain("Select File");

    // Pressing up should be for file selector navigation, not history navigation
    stdin.write("\u001B[A"); // Up arrow
    await delay(10);
    expect(lastFrame()).toContain("Select File");
    expect(lastFrame()).toContain("@");
    expect(lastFrame()).not.toContain("some history");

    // Cancel file selector
    stdin.write("\u001B"); // ESC
    await delay(10);

    // Now pressing up should perform history navigation
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

    // Input / to trigger command selector
    stdin.write("/");
    await waitForText(lastFrame, "/");

    // Pressing up should be for command selector navigation, not history navigation
    stdin.write("\u001B[A"); // Up arrow

    // Command selector should still be there, shouldn't switch to history
    expect(lastFrame()).toContain("/");
    expect(lastFrame()).not.toContain("some command history");

    // Cancel command selector (press ESC or delete /)
    stdin.write("\u0008"); // Backspace to remove /
    await waitForText(lastFrame, "Type your message");

    // Now pressing up should perform history navigation
    stdin.write("\u001B[A"); // Up arrow
    await waitForText(lastFrame, "some command history");

    unmount();
  });
});
