import { describe, it, expect } from "vitest";
import {
  getLastLines,
  parseCustomHeaders,
  recoverTruncatedJson,
  removeCodeBlockWrappers,
} from "@/utils/stringUtils.js";

describe("getLastLines", () => {
  it("should return empty string for empty input", () => {
    expect(getLastLines("", 5)).toBe("");
  });

  it("should return empty string for count <= 0", () => {
    expect(getLastLines("some text", 0)).toBe("");
    expect(getLastLines("some text", -1)).toBe("");
  });

  it("should return all lines if input has fewer lines than count", () => {
    const input = "line 1\nline 2";
    expect(getLastLines(input, 5)).toBe("line 1\nline 2");
  });

  it("should return all lines if input has exactly count lines", () => {
    const input = "line 1\nline 2";
    expect(getLastLines(input, 2)).toBe("line 1\nline 2");
  });

  it("should return the last N lines correctly", () => {
    const input = "line 1\nline 2\nline 3\nline 4\nline 5";
    expect(getLastLines(input, 3)).toBe("line 3\nline 4\nline 5");
  });

  it("should handle trailing newline correctly", () => {
    const input = "line 1\nline 2\n";
    // If it ends with \n, the last "line" is actually empty,
    // but typically getLastLines would include the text after the last \n.
    // "line 1\nline 2\n" -> lines are ["line 1", "line 2", ""]
    // last 2 lines should be "line 2\n"
    expect(getLastLines(input, 2)).toBe("line 2\n");
  });

  it("should handle single line input correctly", () => {
    const input = "line 1";
    expect(getLastLines(input, 1)).toBe("line 1");
    expect(getLastLines(input, 5)).toBe("line 1");
  });

  it("should handle input without newlines", () => {
    const input = "no newlines here";
    expect(getLastLines(input, 1)).toBe("no newlines here");
  });

  it("should handle multiple newlines at the start", () => {
    const input = "\n\nline 1";
    expect(getLastLines(input, 1)).toBe("line 1");
    expect(getLastLines(input, 2)).toBe("\nline 1");
    expect(getLastLines(input, 3)).toBe("\n\nline 1");
    expect(getLastLines(input, 4)).toBe("\n\nline 1");
  });
});

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

describe("recoverTruncatedJson", () => {
  it("should return valid JSON unchanged", () => {
    expect(recoverTruncatedJson('{"a": 1}')).toBe('{"a": 1}');
  });

  it("should recover JSON missing one closing brace", () => {
    expect(recoverTruncatedJson('{"a": 1')).toBe('{"a": 1}');
  });

  it("should recover JSON missing multiple closing braces", () => {
    expect(recoverTruncatedJson('{"a": {"b": 2')).toBe('{"a": {"b": 2}}');
  });

  it("should not modify JSON that is already closed", () => {
    expect(recoverTruncatedJson('{"a": {"b": [1, 2]}}')).toBe(
      '{"a": {"b": [1, 2]}}',
    );
  });

  it("should handle strings containing braces without counting them", () => {
    expect(recoverTruncatedJson(`{"a": "hello}`)).toBe(`{"a": "hello}"}`);
  });

  it("should handle escaped quotes inside strings", () => {
    expect(recoverTruncatedJson(`{"a": "say \\"hi\\"`)).toBe(
      `{"a": "say \\"hi\\""}`,
    );
  });

  it("should return unchanged string for unclosed brackets", () => {
    // Unclosed brackets cannot be safely recovered
    expect(recoverTruncatedJson('{"a": [1, 2')).toBe('{"a": [1, 2');
  });

  it("should close unclosed string before closing braces", () => {
    expect(recoverTruncatedJson(`{"a": "hello}`)).toBe(`{"a": "hello}"}`);
  });

  it("should handle empty object missing closing brace", () => {
    expect(recoverTruncatedJson("{")).toBe("{}");
  });

  it("should handle deeply nested truncation", () => {
    expect(recoverTruncatedJson('{"a": {"b": {"c": 3')).toBe(
      '{"a": {"b": {"c": 3}}}',
    );
  });
});
