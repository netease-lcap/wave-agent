import { describe, it, expect } from "vitest";
import {
  parseCustomHeaders,
  recoverTruncatedJson,
} from "@/utils/stringUtils.js";

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
