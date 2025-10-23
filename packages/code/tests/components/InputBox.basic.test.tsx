import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import {
  InputBox,
  INPUT_PLACEHOLDER_TEXT,
} from "../../src/components/InputBox.js";

// Delay function
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("InputBox Basic Functionality", () => {
  it("should show placeholder text when empty", async () => {
    const { lastFrame } = render(<InputBox />);

    // Verify placeholder text is displayed (may be wrapped)
    expect(lastFrame()).toMatch(/Type your message[\s\S]*use @ to reference/);
  });

  it('should handle continuous input "hello"', async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Simulate continuous fast input "hello", no delay added
    stdin.write("hello");
    await delay(50); // Wait for state update

    // Verify input text is displayed correctly
    expect(lastFrame()).toContain("hello");

    // Verify placeholder text is no longer displayed
    expect(lastFrame()).not.toContain(INPUT_PLACEHOLDER_TEXT);
  });

  it("should handle paste input with newlines", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Simulate user pasting text with newlines
    const pastedText = "This is line 1\nThis is line 2\nThis is line 3";
    stdin.write(pastedText);

    // Wait for debounce processing (30ms + extra time to ensure completion)
    await delay(150);

    // Verify text is processed correctly (newlines should be preserved or converted to spaces)
    const output = lastFrame();
    expect(output).toContain("This is line 1");
    expect(output).toContain("This is line 2");
    expect(output).toContain("This is line 3");

    // Verify input box no longer shows placeholder
    expect(output).not.toContain(INPUT_PLACEHOLDER_TEXT);
  });

  it("should handle paste input with mixed content including @", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Simulate pasting complex text with @ symbols and newlines
    const complexText =
      "Please check @src/index.ts\nand also review\n@package.json file";
    stdin.write(complexText);

    // Wait for debounce processing (30ms + extra time to ensure completion)
    await delay(150);

    // Verify text is processed correctly
    const output = lastFrame();
    expect(output).toContain("Please check @src/index.ts");
    expect(output).toContain("and also review");
    expect(output).toContain("@package.json file");

    // Verify file selector is not accidentally triggered (since this is paste operation, not single @ character input)
    expect(output).not.toContain("Select File");
  });

  it("should handle sequential paste operations correctly", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // First paste operation: simulate user pasting first part of code
    const firstPaste = "const originalContent = await fs.promises.readFile";
    stdin.write(firstPaste);
    // Second paste operation: simulate user continuing to paste remaining part of code
    const secondPaste = "(fullPath, 'utf-8');";
    stdin.write(secondPaste);

    // Wait for debounce processing, continuous paste will be merged (30ms + extra time to ensure completion)
    await delay(150);

    // Verify continuous paste is correctly merged and complete content is displayed
    const finalOutput = lastFrame();
    const expectedFullText =
      "const originalContent = await fs.promises.readFile(fullPath, 'utf-8');";

    expect(finalOutput).toContain(expectedFullText);
  });

  it("should debounce paste operations and not show intermediate states", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Simulate continuous fast paste operations (simulates multiple triggers during long text paste)
    const part1 = "This is the first part of ";
    const part2 = "a very long text that ";
    const part3 = "gets pasted in multiple chunks";

    // Quickly input multiple paste blocks consecutively
    stdin.write(part1);
    stdin.write(part2);
    stdin.write(part3);

    // Wait for debounce processing completion
    await delay(140); // 30ms + extra time to ensure processing completion

    // Verify final display shows complete merged content
    const finalOutput = lastFrame();
    const expectedFullText =
      "This is the first part of a very long text that gets pasted in multiple chunks";
    expect(finalOutput).toContain(expectedFullText);

    // Verify placeholder is no longer displayed
    expect(finalOutput).not.toContain(INPUT_PLACEHOLDER_TEXT);
  });

  it("should handle single character input immediately", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Simulate character-by-character input, should display immediately
    stdin.write("h");
    await delay(10); // Very short delay, should be able to see result
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

    // Verify placeholder is no longer displayed
    expect(lastFrame()).not.toContain(INPUT_PLACEHOLDER_TEXT);
  });

  it("should compress long text (>200 chars) into compressed format", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Simulate pasting long text over 200 characters
    const longText = "A".repeat(250); // 250 character long text
    stdin.write(longText);

    // Wait for debounce processing completion
    await delay(150);

    // Verify long text is compressed to [LongText#1] format
    const output = lastFrame();
    expect(output).toContain("[LongText#1]");
    expect(output).not.toContain(longText); // Should not display original text
  });

  it("should handle multiple long text compressions with incremental numbering", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // First paste of long text
    const longText1 = "First long text: " + "A".repeat(200);
    stdin.write(longText1);
    await delay(150);

    let output = lastFrame();
    expect(output).toContain("[LongText#1]");

    // Second paste of long text
    const longText2 = "Second long text: " + "B".repeat(200);
    stdin.write(longText2);
    await delay(150);

    output = lastFrame();
    expect(output).toContain("[LongText#2]");
  });

  it("should not compress short text (<= 200 chars)", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Simulate pasting 200 character text (just at threshold)
    const shortText = "A".repeat(200); // Exactly 200 characters
    stdin.write(shortText);

    // Wait for debounce processing completion
    await delay(150);

    // Verify short text will not be compressed
    const output = lastFrame();
    // Since Ink will wrap long text for display, we only check the beginning part
    expect(output).toContain("AAAAAAAAAA"); // Check beginning A characters
    expect(output).not.toContain("[LongText#1]");
  });
});
