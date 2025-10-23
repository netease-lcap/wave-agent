import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import {
  InputBox,
  INPUT_PLACEHOLDER_TEXT_PREFIX,
} from "../../src/components/InputBox.js";

// Delay function
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("InputBox Cursor Display", () => {
  it("should display cursor at the beginning when empty", async () => {
    const { lastFrame } = render(<InputBox />);

    // Verify initial state displays placeholder and cursor
    const output = lastFrame();
    expect(output).toContain(INPUT_PLACEHOLDER_TEXT_PREFIX);
    // Cursor should highlight the first character
    expect(output).toMatch(/Type your message/);
  });

  it("should move cursor with left and right arrow keys", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Input some text
    stdin.write("hello");
    await delay(50);

    // Cursor should be at the end
    expect(lastFrame()).toContain("hello");

    // Move cursor left
    stdin.write("\u001B[D"); // Left arrow
    stdin.write("\u001B[D"); // Left arrow

    // Insert text at current position
    stdin.write("X");
    await delay(50);

    // Verify text is inserted at correct position
    expect(lastFrame()).toContain("helXlo");

    // Move cursor right
    stdin.write("\u001B[C"); // Right arrow
    stdin.write("\u001B[C"); // Right arrow

    // Insert text at the end
    stdin.write("Y");
    await delay(50);

    expect(lastFrame()).toContain("helXloY");
  });

  it("should insert text at cursor position", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Input initial text
    stdin.write("abc");
    await delay(50);

    // Move cursor to middle (move left one position)
    stdin.write("\u001B[D"); // Left arrow
    await delay(50);

    // Insert text
    stdin.write("X");
    await delay(50);

    expect(lastFrame()).toContain("abXc");

    // Continue moving cursor to more forward position
    stdin.write("\u001B[D"); // Left arrow
    stdin.write("\u001B[D"); // Left arrow
    await delay(50);

    // Insert at new position (result should be aYbXc or similar order)
    stdin.write("Y");
    await delay(50);

    // Adjust expectation based on actual output (should be aYbXc)
    expect(lastFrame()).toContain("aYbXc");
  });

  it("should preserve cursor position when file selector is active", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Input some text, trigger file selector at middle position
    stdin.write("check ");
    await delay(50);
    stdin.write("@");
    await delay(400); // Increase delay to wait for search completion

    // Verify file selector displays - should show all files
    const output = lastFrame();
    expect(output).toContain("📁 Select File");

    // Cancel file selector
    stdin.write("\u001B"); // ESC
    await delay(50);

    // Verify return to original text, cursor at correct position
    expect(lastFrame()).toContain("check @");
    expect(lastFrame()).not.toContain("Select File");

    // Continue input should be at correct position
    stdin.write(" more text");
    await delay(50);

    expect(lastFrame()).toContain("check @ more text");
  });

  it("should display cursor correctly in placeholder mode", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Initial state should show placeholder
    expect(lastFrame()).toContain(INPUT_PLACEHOLDER_TEXT_PREFIX);

    // Cursor should be visible on placeholder text (through background highlighting)
    const output = lastFrame();
    expect(output).toMatch(/Type your message/);

    // Input a character should switch to normal mode
    stdin.write("h");
    await delay(50);

    expect(lastFrame()).toContain("h");
    expect(lastFrame()).not.toContain(
      "Type your message (use @ to reference files, / for commands, ! for bash history, # to add memory)...",
    );

    // Delete character should return to placeholder mode
    stdin.write("\u007F"); // Backspace
    await delay(50);

    expect(lastFrame()).toContain(INPUT_PLACEHOLDER_TEXT_PREFIX);
  });
});
