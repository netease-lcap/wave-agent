import { describe, it, expect } from "vitest";
import { extractCompleteParams } from "../../src/utils/jsonExtractor";

describe("jsonExtractor", () => {
  describe("extractCompleteParams", () => {
    it("should extract complete string parameters from incomplete JSON", () => {
      const incompleteJson =
        '{"target_file": "src/test.ts", "code_edit": "some code';
      const result = extractCompleteParams(incompleteJson);

      expect(result).toEqual({
        target_file: "src/test.ts",
      });
    });

    it("should extract complete number parameters", () => {
      const incompleteJson =
        '{"start_line": 10, "end_line": 20, "incomplete_param": "unfinished';
      const result = extractCompleteParams(incompleteJson);

      expect(result).toEqual({
        start_line: 10,
        end_line: 20,
      });
    });

    it("should extract complete boolean parameters", () => {
      const incompleteJson =
        '{"case_sensitive": true, "recursive": false, "pattern": "unfinished';
      const result = extractCompleteParams(incompleteJson);

      expect(result).toEqual({
        case_sensitive: true,
        recursive: false,
      });
    });

    it("should extract complete null parameters", () => {
      const incompleteJson = '{"optional_param": null, "another": "unfinished';
      const result = extractCompleteParams(incompleteJson);

      expect(result).toEqual({
        optional_param: null,
      });
    });

    it("should handle mixed complete and incomplete parameters", () => {
      const incompleteJson =
        '{"file": "test.txt", "line": 42, "active": true, "description": "this is incomplete text';
      const result = extractCompleteParams(incompleteJson);

      expect(result).toEqual({
        file: "test.txt",
        line: 42,
        active: true,
      });
    });

    it("should return empty object for invalid input", () => {
      expect(extractCompleteParams("")).toEqual({});
      expect(extractCompleteParams("invalid json")).toEqual({});
      expect(extractCompleteParams("{}")).toEqual({});
    });

    it("should handle floating point numbers", () => {
      const incompleteJson =
        '{"version": 1.5, "rate": 0.75, "name": "incomplete';
      const result = extractCompleteParams(incompleteJson);

      expect(result).toEqual({
        version: 1.5,
        rate: 0.75,
      });
    });

    it("should handle parameters with spaces in values", () => {
      const incompleteJson =
        '{"query": "search term", "path": "/some/path", "incomplete": "not finished';
      const result = extractCompleteParams(incompleteJson);

      expect(result).toEqual({
        query: "search term",
        path: "/some/path",
      });
    });

    it("should handle empty string values", () => {
      const incompleteJson =
        '{"empty": "", "filled": "value", "incomplete": "not done';
      const result = extractCompleteParams(incompleteJson);

      expect(result).toEqual({
        empty: "",
        filled: "value",
      });
    });
  });
});
