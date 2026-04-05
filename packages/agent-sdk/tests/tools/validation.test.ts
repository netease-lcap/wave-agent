import { describe, it, expect } from "vitest";
import { validationError, requireString } from "../../src/tools/validation.js";

describe("validation utilities", () => {
  describe("validationError", () => {
    it("should return a failed ToolResult with the given message", () => {
      const result = validationError("Test error message");

      expect(result.success).toBe(false);
      expect(result.content).toBe("");
      expect(result.error).toBe("Test error message");
    });
  });

  describe("requireString", () => {
    it("should return error when parameter is undefined", () => {
      const result = requireString({}, "file_path");

      expect(result).not.toBeNull();
      expect(result!.success).toBe(false);
      expect(result!.error).toBe("Missing required parameter: file_path");
    });

    it("should return error when parameter is null", () => {
      const result = requireString({ file_path: null }, "file_path");

      expect(result).not.toBeNull();
      expect(result!.success).toBe(false);
      expect(result!.error).toBe("Missing required parameter: file_path");
    });

    it("should return error when parameter is explicitly undefined", () => {
      const result = requireString({ file_path: undefined }, "file_path");

      expect(result).not.toBeNull();
      expect(result!.success).toBe(false);
      expect(result!.error).toBe("Missing required parameter: file_path");
    });

    it("should return error when parameter is not a string", () => {
      const result = requireString({ file_path: 123 }, "file_path");

      expect(result).not.toBeNull();
      expect(result!.success).toBe(false);
      expect(result!.error).toBe(
        "Parameter file_path must be a string, got number",
      );
    });

    it("should return error when parameter is an empty string", () => {
      const result = requireString({ file_path: "" }, "file_path");

      expect(result).not.toBeNull();
      expect(result!.success).toBe(false);
      expect(result!.error).toBe("Parameter file_path cannot be empty");
    });

    it("should return error when parameter is a whitespace-only string", () => {
      const result = requireString({ file_path: "   " }, "file_path");

      expect(result).not.toBeNull();
      expect(result!.success).toBe(false);
      expect(result!.error).toBe("Parameter file_path cannot be empty");
    });

    it("should return null when parameter is a valid non-empty string", () => {
      const result = requireString({ file_path: "/test/file.ts" }, "file_path");

      expect(result).toBeNull();
    });
  });
});
