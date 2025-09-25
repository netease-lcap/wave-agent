import { describe, it, expect } from "vitest";
import { stripAnsiColors } from "@/utils/stringUtils";

describe("stripAnsiColors", () => {
  it("should remove basic ANSI color codes", () => {
    // ESC[31m = red, ESC[0m = reset
    const redText = "\u001b[31mHello World\u001b[0m";
    const result = stripAnsiColors(redText);
    expect(result).toBe("Hello World");
  });

  it("should remove multiple color codes in one string", () => {
    // ESC[32m = green, ESC[33m = yellow, ESC[0m = reset
    const coloredText =
      "\u001b[32mGreen\u001b[0m and \u001b[33mYellow\u001b[0m text";
    const result = stripAnsiColors(coloredText);
    expect(result).toBe("Green and Yellow text");
  });

  it("should handle complex ANSI codes with multiple parameters", () => {
    // ESC[1;31m = bold red, ESC[4;32m = underlined green
    const complexText =
      "\u001b[1;31mBold Red\u001b[0m and \u001b[4;32mUnderlined Green\u001b[0m";
    const result = stripAnsiColors(complexText);
    expect(result).toBe("Bold Red and Underlined Green");
  });

  it("should handle background color codes", () => {
    // ESC[41m = red background, ESC[42m = green background
    const bgText =
      "\u001b[41mRed Background\u001b[0m \u001b[42mGreen Background\u001b[0m";
    const result = stripAnsiColors(bgText);
    expect(result).toBe("Red Background Green Background");
  });

  it("should handle 256-color codes", () => {
    // ESC[38;5;196m = 256-color foreground, ESC[48;5;21m = 256-color background
    const color256Text =
      "\u001b[38;5;196mRed 256\u001b[0m \u001b[48;5;21mBlue BG\u001b[0m";
    const result = stripAnsiColors(color256Text);
    expect(result).toBe("Red 256 Blue BG");
  });

  it("should handle RGB color codes", () => {
    // ESC[38;2;255;0;0m = RGB red, ESC[48;2;0;255;0m = RGB green background
    const rgbText =
      "\u001b[38;2;255;0;0mRGB Red\u001b[0m \u001b[48;2;0;255;0mRGB Green BG\u001b[0m";
    const result = stripAnsiColors(rgbText);
    expect(result).toBe("RGB Red RGB Green BG");
  });

  it("should handle cursor movement codes", () => {
    // ESC[2J = clear screen, ESC[H = home cursor
    const cursorText = "\u001b[2JCleared\u001b[H screen";
    const result = stripAnsiColors(cursorText);
    expect(result).toBe("Cleared screen");
  });

  it("should handle mixed formatting codes", () => {
    // ESC[1m = bold, ESC[3m = italic, ESC[4m = underline
    const formatText =
      "\u001b[1mBold\u001b[0m \u001b[3mItalic\u001b[0m \u001b[4mUnderline\u001b[0m";
    const result = stripAnsiColors(formatText);
    expect(result).toBe("Bold Italic Underline");
  });

  it("should return empty string for empty input", () => {
    const result = stripAnsiColors("");
    expect(result).toBe("");
  });

  it("should return unchanged string if no ANSI codes present", () => {
    const plainText = "This is plain text without any colors";
    const result = stripAnsiColors(plainText);
    expect(result).toBe(plainText);
  });

  it("should handle text with only ANSI codes", () => {
    const onlyAnsi = "\u001b[31m\u001b[1m\u001b[0m";
    const result = stripAnsiColors(onlyAnsi);
    expect(result).toBe("");
  });

  it("should handle ANSI codes at the beginning and end", () => {
    const boundaryText =
      "\u001b[32mStart\u001b[0m Middle \u001b[33mEnd\u001b[0m";
    const result = stripAnsiColors(boundaryText);
    expect(result).toBe("Start Middle End");
  });

  it("should handle consecutive ANSI codes", () => {
    const consecutiveText =
      "Text\u001b[31m\u001b[1m\u001b[4mMultiple\u001b[0m\u001b[0m\u001b[0m codes";
    const result = stripAnsiColors(consecutiveText);
    expect(result).toBe("TextMultiple codes");
  });

  it("should handle real-world terminal output", () => {
    // Simulate typical terminal command output with colors
    const terminalOutput =
      "\u001b[32m✓\u001b[0m Test passed\n\u001b[31m✗\u001b[0m Test failed\n\u001b[33m⚠\u001b[0m Warning";
    const result = stripAnsiColors(terminalOutput);
    expect(result).toBe("✓ Test passed\n✗ Test failed\n⚠ Warning");
  });

  it("should handle npm/yarn output style colors", () => {
    // Simulate package manager output
    const npmOutput =
      "\u001b[32m+ package@1.0.0\u001b[0m\n\u001b[33madded 1 package\u001b[0m";
    const result = stripAnsiColors(npmOutput);
    expect(result).toBe("+ package@1.0.0\nadded 1 package");
  });

  it("should handle git output style colors", () => {
    // Simulate git diff colors
    const gitOutput =
      "\u001b[32m+\u001b[0m Added line\n\u001b[31m-\u001b[0m Removed line";
    const result = stripAnsiColors(gitOutput);
    expect(result).toBe("+ Added line\n- Removed line");
  });

  it("should handle malformed ANSI codes gracefully", () => {
    // Test with incomplete ANSI sequences
    const malformedText =
      "Text \u001b[31 incomplete and \u001b[ another incomplete";
    const result = stripAnsiColors(malformedText);
    // Should only remove complete ANSI codes
    expect(result).toBe(
      "Text \u001b[31 incomplete and \u001b[ another incomplete",
    );
  });

  it("should handle ANSI codes with capital letters", () => {
    // Some ANSI codes use capital letters
    const capitalText = "\u001b[2JClear screen\u001b[1KClear line";
    const result = stripAnsiColors(capitalText);
    expect(result).toBe("Clear screenClear line");
  });

  it("should handle very long parameter sequences", () => {
    // Test with many parameters in one ANSI code
    const longParams = "\u001b[38;2;255;128;64;1;4;7mLong params\u001b[0m";
    const result = stripAnsiColors(longParams);
    expect(result).toBe("Long params");
  });

  it("should preserve Unicode characters", () => {
    // Test with Unicode characters mixed with ANSI codes
    const unicodeText =
      "\u001b[32m你好\u001b[0m \u001b[31m🌈\u001b[0m \u001b[33mΩ\u001b[0m";
    const result = stripAnsiColors(unicodeText);
    expect(result).toBe("你好 🌈 Ω");
  });

  it("should handle large text efficiently", () => {
    // Test performance with large text containing many ANSI codes
    const repeatedColoredText =
      "\u001b[32mGreen\u001b[0m \u001b[31mRed\u001b[0m ".repeat(1000);
    const expectedResult = "Green Red ".repeat(1000);

    const start = performance.now();
    const result = stripAnsiColors(repeatedColoredText);
    const end = performance.now();

    expect(result).toBe(expectedResult);
    // Should complete within reasonable time (less than 100ms for 1000 repetitions)
    expect(end - start).toBeLessThan(100);
  });
});
