import { describe, it, expect } from "vitest";
import { estimateTokens } from "@/utils/tokenEstimate.js";

describe("estimateTokens", () => {
  it("should estimate ASCII text at ~4 chars/token", () => {
    const text = "The quick brown fox jumps over the lazy dog";
    expect(estimateTokens(text)).toBe(Math.ceil(text.length / 4));
  });

  it("should estimate CJK text at ~1 char/token (not 4x under-estimate)", () => {
    const text = "敏捷的棕色狐狸跳过了懒惰的狗";
    // All 14 chars are CJK → 14 tokens (naive would be 14/4 = 4)
    expect(estimateTokens(text)).toBe(text.length);
  });

  it("should handle mixed CJK + ASCII content", () => {
    const text = "hello 世界 hello world";
    // 8 ASCII chars (hello + space + space + hello + space) → but let's count precisely
    // "hello 世界 hello world"
    //  CJK: 世, 界 = 2
    //  non-CJK: "hello " (6) + " " (1) + " hello world" (12) = 19
    const cjkCount = 2;
    const otherCount = text.length - cjkCount; // 19
    expect(estimateTokens(text)).toBe(Math.ceil(cjkCount + otherCount / 4));
  });

  it("should use 2 chars/token for JSON files", () => {
    const json = '{"key":"value","num":123}';
    // No CJK, so ratio is 2
    expect(estimateTokens(json, "json")).toBe(Math.ceil(json.length / 2));
  });

  it("should use 2 chars/token for JSONL files", () => {
    const jsonl = '{"a":1}\n{"b":2}';
    expect(estimateTokens(jsonl, "jsonl")).toBe(Math.ceil(jsonl.length / 2));
  });

  it("should use 2 chars/token for JSONC files", () => {
    const jsonc = '// comment\n{"key":"value"}';
    expect(estimateTokens(jsonc, "jsonc")).toBe(Math.ceil(jsonc.length / 2));
  });

  it("should handle CJK in JSON (mixed ratios)", () => {
    const json = '{"name":"订单系统"}';
    const cjkCount = 4; // 订,单,系,统
    const otherCount = json.length - cjkCount;
    expect(estimateTokens(json, "json")).toBe(
      Math.ceil(cjkCount + otherCount / 2),
    );
  });

  it("should return 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("should handle Japanese (Hiragana + Katakana + Kanji)", () => {
    const text = "お誕生日おめでとう"; // 9 chars
    expect(estimateTokens(text)).toBe(9);
  });

  it("should handle Korean (Hangul)", () => {
    const text = "안녕하세요"; // 5 chars
    expect(estimateTokens(text)).toBe(5);
  });

  it("should estimate higher than naive length/4 for CJK-heavy content", () => {
    const text = "这是一个包含中文内容的测试行用于验证令牌估算的准确性";
    const naive = Math.ceil(text.length / 4);
    const cjkAware = estimateTokens(text);
    expect(cjkAware).toBeGreaterThan(naive);
    // Should be ~4x higher (1 token/char vs 0.25 token/char)
    expect(cjkAware).toBe(text.length);
  });

  it("should handle code with Chinese comments", () => {
    const code = `function add(a, b) {\n  // 计算两数之和\n  return a + b;\n}`;
    const cjkCount = 6; // 计,算,两,数,之,和
    const otherCount = code.length - cjkCount;
    expect(estimateTokens(code, "ts")).toBe(
      Math.ceil(cjkCount + otherCount / 4),
    );
  });
});
