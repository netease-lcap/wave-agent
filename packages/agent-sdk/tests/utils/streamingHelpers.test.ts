import { describe, it, expect } from "vitest";
import { extractCompleteParams } from "../../src/utils/streamingHelpers.js";

describe("extractCompleteParams", () => {
  describe("string parameters", () => {
    it("should extract complete string parameters", () => {
      const json = '{"name": "John", "city": "New York"';
      const result = extractCompleteParams(json);

      expect(result).toEqual({
        name: "John",
        city: "New York",
      });
    });

    it("should handle escaped quotes in strings", () => {
      const json = '{"message": "He said \\"Hello\\"", "path": "C:\\\\Users"';
      const result = extractCompleteParams(json);

      expect(result).toEqual({
        message: 'He said "Hello"',
        path: "C:\\Users",
      });
    });

    it("should handle escaped newlines", () => {
      const json = '{"text": "Line 1\\nLine 2"';
      const result = extractCompleteParams(json);

      expect(result).toEqual({
        text: "Line 1\nLine 2",
      });
    });

    it("should include incomplete string parameters", () => {
      const json = '{"complete": "value", "incomplete": "unfinished';
      const result = extractCompleteParams(json);

      expect(result).toEqual({
        complete: "value",
        incomplete: "unfinished",
      });
    });
  });

  describe("number parameters", () => {
    it("should extract complete integer parameters", () => {
      const json = '{"age": 25, "count": 100}';
      const result = extractCompleteParams(json);

      expect(result).toEqual({
        age: 25,
        count: 100,
      });
    });

    it("should extract complete float parameters", () => {
      const json = '{"price": 19.99, "rating": 4.5}';
      const result = extractCompleteParams(json);

      expect(result).toEqual({
        price: 19.99,
        rating: 4.5,
      });
    });

    it("should handle incomplete number parameters gracefully", () => {
      const json = '{"complete": 42, "incomplete": 3.1';
      const result = extractCompleteParams(json);

      // For streaming, we show partial progress - 3.1 is a valid complete value
      expect(result).toEqual({
        complete: 42,
        incomplete: 3.1,
      });
    });
  });

  describe("boolean parameters", () => {
    it("should extract complete boolean parameters", () => {
      const json = '{"active": true, "disabled": false}';
      const result = extractCompleteParams(json);

      expect(result).toEqual({
        active: true,
        disabled: false,
      });
    });

    it("should ignore incomplete boolean parameters", () => {
      const json = '{"complete": true, "incomplete": tru';
      const result = extractCompleteParams(json);

      expect(result).toEqual({
        complete: true,
      });
    });
  });

  describe("null parameters", () => {
    it("should extract complete null parameters", () => {
      const json = '{"value": null, "optional": null}';
      const result = extractCompleteParams(json);

      expect(result).toEqual({
        value: null,
        optional: null,
      });
    });

    it("should ignore incomplete null parameters", () => {
      const json = '{"complete": null, "incomplete": nul';
      const result = extractCompleteParams(json);

      expect(result).toEqual({
        complete: null,
      });
    });
  });

  describe("mixed parameters", () => {
    it("should extract multiple types of complete parameters", () => {
      const json =
        '{"name": "Alice", "age": 30, "active": true, "data": null, "incomplete": "unfinished';
      const result = extractCompleteParams(json);

      expect(result).toEqual({
        name: "Alice",
        age: 30,
        active: true,
        data: null,
        incomplete: "unfinished",
      });
    });

    it("should handle complex nested incomplete JSON", () => {
      const json =
        '{"user": {"name": "John", "profile": {"age": 25, "city": "NYC"';
      const result = extractCompleteParams(json);

      // Should extract all complete parameters found in the JSON, including nested ones
      // This is actually useful for streaming - we want to show any completed params
      expect(result).toEqual({
        name: "John",
        age: 25,
        city: "NYC",
      });
    });
  });

  describe("edge cases", () => {
    it("should return empty object for empty string", () => {
      const result = extractCompleteParams("");
      expect(result).toEqual({});
    });

    it("should return empty object for null input", () => {
      const result = extractCompleteParams(null as unknown as string);
      expect(result).toEqual({});
    });

    it("should return empty object for undefined input", () => {
      const result = extractCompleteParams(undefined as unknown as string);
      expect(result).toEqual({});
    });

    it("should return empty object for non-string input", () => {
      const result = extractCompleteParams(123 as unknown as string);
      expect(result).toEqual({});
    });

    it("should handle malformed JSON gracefully", () => {
      const json = '{{{"broken": "json"';
      const result = extractCompleteParams(json);

      expect(result).toEqual({
        broken: "json",
      });
    });
  });

  describe("streaming scenarios", () => {
    it("should handle progressive parameter building", () => {
      // Simulate streaming JSON building up
      const stages = [
        '{"na',
        '{"name": "Jo',
        '{"name": "John"',
        '{"name": "John", "a',
        '{"name": "John", "age": 2',
        '{"name": "John", "age": 25',
        '{"name": "John", "age": 25}',
      ];

      const results = stages.map(extractCompleteParams);

      expect(results[0]).toEqual({});
      expect(results[1]).toEqual({ name: "Jo" });
      expect(results[2]).toEqual({ name: "John" });
      expect(results[3]).toEqual({ name: "John" });
      expect(results[4]).toEqual({ name: "John", age: 2 }); // Shows partial progress
      expect(results[5]).toEqual({ name: "John", age: 25 });
      expect(results[6]).toEqual({ name: "John", age: 25 });
    });
  });
});
