import { describe, it, expect } from "vitest";
import {
  parseCustomHeaders,
  removeCodeBlockWrappers,
} from "@/utils/stringUtils.js";

describe("removeCodeBlockWrappers", () => {
  it("should remove code block wrappers with language", () => {
    const input = "```typescript\nconst x = 1;\n```";
    expect(removeCodeBlockWrappers(input)).toBe("const x = 1;");
  });

  it("should remove code block wrappers without language", () => {
    const input = "```\nconst x = 1;\n```";
    expect(removeCodeBlockWrappers(input)).toBe("const x = 1;");
  });

  it("should return original content if no wrappers", () => {
    const input = "const x = 1;";
    expect(removeCodeBlockWrappers(input)).toBe("const x = 1;");
  });

  it("should handle content with multiple lines", () => {
    const input = "```\nline 1\nline 2\n```";
    expect(removeCodeBlockWrappers(input)).toBe("line 1\nline 2");
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
