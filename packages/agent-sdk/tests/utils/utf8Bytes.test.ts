import { describe, expect, it } from "vitest";
import {
  exceedsUtf8Bytes,
  truncateUtf8,
  utf8ByteLength,
} from "../../src/utils/utf8Bytes.js";

/**
 * The output cap is counted in UTF-8 bytes, the way Claude Code counts it, so a
 * line of Chinese costs three bytes per character. These cases pin the two
 * things that can go wrong with that: counting characters instead of bytes (the
 * cap then lets three times as many bytes through), and cutting in the middle
 * of a multi-byte character (which decodes to U+FFFD).
 */

describe("utf8ByteLength", () => {
  it("counts ASCII as one byte and CJK as three", () => {
    expect(utf8ByteLength("")).toBe(0);
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("中文")).toBe(6);
  });

  it("counts a surrogate pair as the one four-byte character it encodes to", () => {
    expect("😀").toHaveLength(2);
    expect(utf8ByteLength("😀")).toBe(4);
  });
});

describe("exceedsUtf8Bytes", () => {
  it("measures bytes, not string length", () => {
    // Six characters would pass a six-character budget; six bytes is exactly
    // the line, and one more byte trips it.
    expect(exceedsUtf8Bytes("中文中文", 11)).toBe(true);
    expect(exceedsUtf8Bytes("中文中文", 12)).toBe(false);
    expect(exceedsUtf8Bytes("abcdef", 5)).toBe(true);
    expect(exceedsUtf8Bytes("abcdef", 6)).toBe(false);
  });
});

describe("truncateUtf8", () => {
  it("returns the input untouched when it fits", () => {
    expect(truncateUtf8("中文", 6)).toBe("中文");
    expect(truncateUtf8("", 10)).toBe("");
  });

  it("cuts ASCII at exactly the budget", () => {
    expect(truncateUtf8("abcdef", 4)).toBe("abcd");
    expect(truncateUtf8("abcdef", 6)).toBe("abcdef");
  });

  it("backs off to a character boundary instead of cutting into one", () => {
    // 中 = E4 B8 AD: budgets 4 and 5 land inside the second character, so only
    // the first one survives; a budget of 2 cannot hold even one.
    expect(truncateUtf8("中文", 3)).toBe("中");
    expect(truncateUtf8("中文", 4)).toBe("中");
    expect(truncateUtf8("中文", 5)).toBe("中");
    expect(truncateUtf8("中文", 2)).toBe("");
  });

  it("keeps mixed text on a character boundary", () => {
    // "a" + 中 is already four bytes, so a budget of three keeps only "a".
    expect(truncateUtf8("a中文", 3)).toBe("a");
    expect(truncateUtf8("a中文", 4)).toBe("a中");
    expect(truncateUtf8("a中文", 5)).toBe("a中");
    expect(truncateUtf8("a中文", 7)).toBe("a中文");
  });

  it("does not split a surrogate pair", () => {
    expect(truncateUtf8("😀😀", 4)).toBe("😀");
    expect(truncateUtf8("😀😀", 5)).toBe("😀");
    expect(truncateUtf8("😀", 3)).toBe("");
  });

  it("never leaves a replacement character behind", () => {
    const text = "中文abc😀".repeat(10);
    for (const budget of [1, 2, 3, 4, 5, 7, 9, 13, 20, 33]) {
      const cut = truncateUtf8(text, budget);
      expect(cut).not.toContain("\uFFFD");
      expect(utf8ByteLength(cut)).toBeLessThanOrEqual(budget);
    }
  });

  it("returns an empty string for a non-positive budget", () => {
    expect(truncateUtf8("中文", 0)).toBe("");
    expect(truncateUtf8("中文", -1)).toBe("");
  });
});
