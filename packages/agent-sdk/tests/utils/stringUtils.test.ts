import { describe, it, expect } from "vitest";
import {
  parseCustomHeaders,
  removeCodeBlockWrappers,
  stripAnsiColors,
} from "@/utils/stringUtils.js";

describe("stripAnsiColors", () => {
  it("should remove basic ANSI color codes", () => {
    const input = "\x1b[31mRed Text\x1b[0m";
    const result = stripAnsiColors(input);
    expect(result).toBe("Red Text");
  });

  it("should remove complex ANSI codes", () => {
    const input = "\x1b[1;34;42mBold Blue on Green\x1b[0m";
    const result = stripAnsiColors(input);
    expect(result).toBe("Bold Blue on Green");
  });

  it("should return original text if no ANSI codes present", () => {
    const input = "Plain Text";
    const result = stripAnsiColors(input);
    expect(result).toBe("Plain Text");
  });
});

describe("removeCodeBlockWrappers", () => {
  it("should remove code block wrappers with language", () => {
    const input = "```typescript\nconst x = 1;\n```";
    const result = removeCodeBlockWrappers(input);
    expect(result).toBe("const x = 1;");
  });

  it("should remove code block wrappers without language", () => {
    const input = "```\nconst x = 1;\n```";
    const result = removeCodeBlockWrappers(input);
    expect(result).toBe("const x = 1;");
  });

  it("should return original content if no wrappers found", () => {
    const input = "const x = 1;";
    const result = removeCodeBlockWrappers(input);
    expect(result).toBe("const x = 1;");
  });

  it("should handle content with only opening wrapper", () => {
    const input = "```typescript\nconst x = 1;";
    const result = removeCodeBlockWrappers(input);
    expect(result).toBe("const x = 1;");
  });

  it("should handle content with only closing wrapper", () => {
    const input = "const x = 1;\n```";
    const result = removeCodeBlockWrappers(input);
    expect(result).toBe("const x = 1;");
  });

  it("should handle empty content", () => {
    const input = "";
    const result = removeCodeBlockWrappers(input);
    expect(result).toBe("");
  });
});

describe("parseCustomHeaders", () => {
  it("should parse a single header", () => {
    const input = "X-Test: 123";
    const result = parseCustomHeaders(input);
    expect(result).toEqual({ "X-Test": "123" });
  });

  it("should parse multiple headers separated by newlines", () => {
    const input = "X-Test: 123\nY-Header: abc";
    const result = parseCustomHeaders(input);
    expect(result).toEqual({
      "X-Test": "123",
      "Y-Header": "abc",
    });
  });

  it("should handle \r\n as separator", () => {
    const input = "X-Test: 123\r\nY-Header: abc";
    const result = parseCustomHeaders(input);
    expect(result).toEqual({
      "X-Test": "123",
      "Y-Header": "abc",
    });
  });

  it("should trim keys and values", () => {
    const input = "  X-Test  :   123   ";
    const result = parseCustomHeaders(input);
    expect(result).toEqual({ "X-Test": "123" });
  });

  it("should ignore empty lines", () => {
    const input = "X-Test: 123\n\n\nY-Header: abc\n";
    const result = parseCustomHeaders(input);
    expect(result).toEqual({
      "X-Test": "123",
      "Y-Header": "abc",
    });
  });

  it("should ignore malformed lines (missing colon)", () => {
    const input = "X-Test: 123\nMalformedLine\nY-Header: abc";
    const result = parseCustomHeaders(input);
    expect(result).toEqual({
      "X-Test": "123",
      "Y-Header": "abc",
    });
  });

  it("should handle multiple colons by splitting at the first one", () => {
    const input = "X-Test: value:with:colons";
    const result = parseCustomHeaders(input);
    expect(result).toEqual({ "X-Test": "value:with:colons" });
  });

  it("should return empty object for empty input", () => {
    expect(parseCustomHeaders("")).toEqual({});
    expect(parseCustomHeaders("   ")).toEqual({});
  });

  it("should handle undefined or null input gracefully", () => {
    expect(parseCustomHeaders(undefined as unknown as string)).toEqual({});
    expect(parseCustomHeaders(null as unknown as string)).toEqual({});
  });
});
