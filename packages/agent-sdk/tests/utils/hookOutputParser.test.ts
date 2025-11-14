/**
 * Hook Output Parser Unit Tests
 *
 * Comprehensive tests for the hookOutputParser.ts utility covering:
 * - Exit code parsing logic (0=success, 2=blocking, other=non-blocking error)
 * - JSON extraction from mixed output with various edge cases
 * - JSON validation for all hook types (PreToolUse, PostToolUse, UserPromptSubmit, Stop)
 * - Common field validation (continue, stopReason, systemMessage)
 * - Hook-specific field validation for each event type
 * - Error handling and fallback behavior
 * - Diagnostics functionality
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  HookOutputParser,
  parseHookOutput,
  validateHookJsonOutput,
  hasValidJsonOutput,
  getValidationSummary,
  formatValidationErrors,
} from "../../src/utils/hookOutputParser.js";
import type {
  HookOutputResult,
  HookValidationResult,
} from "../../src/types/hooks.js";

describe("HookOutputParser", () => {
  let parser: HookOutputParser;

  beforeEach(() => {
    parser = new HookOutputParser();
  });

  describe("Exit Code Parsing Logic", () => {
    const baseResult: HookOutputResult = {
      exitCode: 0,
      stdout: "",
      stderr: "",
      executionTime: 100,
      hookEvent: "PreToolUse",
    };

    it("should parse exit code 0 as success (continue=true)", () => {
      const result = parser.parseHookOutput({
        ...baseResult,
        exitCode: 0,
        stdout: "Hook executed successfully",
        stderr: "",
      });

      expect(result).toEqual({
        source: "exitcode",
        continue: true,
        errorMessages: ["Hook output: Hook executed successfully"],
      });
    });

    it("should parse exit code 2 as blocking (continue=false)", () => {
      const result = parser.parseHookOutput({
        ...baseResult,
        exitCode: 2,
        stderr: "Blocking execution due to security concern",
      });

      expect(result).toEqual({
        source: "exitcode",
        continue: false,
        stopReason: "Hook requested to block execution (exit code 2)",
        errorMessages: ["Blocking execution due to security concern"],
      });
    });

    it("should parse other exit codes as non-blocking errors (continue=true)", () => {
      const result = parser.parseHookOutput({
        ...baseResult,
        exitCode: 1,
        stderr: "Some non-blocking error occurred",
      });

      expect(result).toEqual({
        source: "exitcode",
        continue: true,
        systemMessage: "Hook completed with non-zero exit code 1",
        errorMessages: [
          "Non-blocking error: exit code 1",
          "Some non-blocking error occurred",
        ],
      });
    });

    it("should handle exit code with both stdout and stderr", () => {
      const result = parser.parseHookOutput({
        ...baseResult,
        exitCode: 3,
        stdout: "Warning: deprecated API used",
        stderr: "Error: configuration invalid",
      });

      expect(result).toEqual({
        source: "exitcode",
        continue: true,
        systemMessage: "Hook completed with non-zero exit code 3",
        errorMessages: [
          "Non-blocking error: exit code 3",
          "Error: configuration invalid",
          "Hook output: Warning: deprecated API used",
        ],
      });
    });

    it("should handle empty stdout and stderr", () => {
      const result = parser.parseHookOutput({
        ...baseResult,
        exitCode: 0,
        stdout: "",
        stderr: "",
      });

      expect(result).toEqual({
        source: "exitcode",
        continue: true,
        errorMessages: [],
      });
    });

    it("should handle whitespace-only stdout and stderr", () => {
      const result = parser.parseHookOutput({
        ...baseResult,
        exitCode: 0,
        stdout: "   \n\t  ",
        stderr: "  \n  ",
      });

      expect(result).toEqual({
        source: "exitcode",
        continue: true,
        errorMessages: [],
      });
    });
  });

  describe("JSON Extraction from Mixed Output", () => {
    /* const baseResult: HookOutputResult = {
      exitCode: 0,
      stdout: "",
      stderr: "",
      executionTime: 100,
      hookEvent: "PreToolUse"
    }; */

    it("should extract JSON from clean JSON-only output", () => {
      const json = '{"continue": true, "systemMessage": "All good"}';
      const extracted = parser.extractJsonFromOutput(json);
      expect(extracted).toBe(json);
    });

    it("should extract JSON from mixed output with text before", () => {
      const stdout = `Starting hook execution...
Loading configuration...
{"continue": true, "systemMessage": "Processing complete"}
Done.`;

      const extracted = parser.extractJsonFromOutput(stdout);
      expect(extracted).toBe(
        '{"continue": true, "systemMessage": "Processing complete"}',
      );
    });

    it("should extract JSON from mixed output with text after", () => {
      const stdout = `{"continue": false, "stopReason": "User intervention required"}
Cleaning up temporary files...
Hook execution completed.`;

      const extracted = parser.extractJsonFromOutput(stdout);
      expect(extracted).toBe(
        '{"continue": false, "stopReason": "User intervention required"}',
      );
    });

    it("should extract multiline JSON object", () => {
      const stdout = `Hook starting...
{
  "continue": true,
  "systemMessage": "Multi-line JSON",
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "Safe operation"
  }
}
Hook completed.`;

      const extracted = parser.extractJsonFromOutput(stdout);
      const expectedJson = `{
  "continue": true,
  "systemMessage": "Multi-line JSON",
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "Safe operation"
  }
}`;
      expect(extracted).toBe(expectedJson);
    });

    it("should handle nested JSON with multiple brace levels", () => {
      const stdout = `{
  "continue": true,
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "Analysis: {result: 'safe', confidence: 0.95}",
    "updatedInput": {
      "nested": {
        "deeply": {
          "value": "test"
        }
      }
    }
  }
}`;

      const extracted = parser.extractJsonFromOutput(stdout);
      expect(extracted).toBe(stdout.trim());
    });

    it("should return null for no JSON content", () => {
      const stdout = "Just plain text output without any JSON";
      const extracted = parser.extractJsonFromOutput(stdout);
      expect(extracted).toBeNull();
    });

    it("should return null for malformed JSON", () => {
      const stdout = `{
  "continue": true,
  "invalidJson": missing quotes
}`;
      const extracted = parser.extractJsonFromOutput(stdout);
      expect(extracted).toBeNull();
    });

    it("should handle incomplete JSON gracefully", () => {
      const stdout = `{
  "continue": true,
  "systemMessage": "Incomplete`;
      const extracted = parser.extractJsonFromOutput(stdout);
      expect(extracted).toBeNull();
    });

    it("should prefer first valid JSON object when multiple exist", () => {
      const stdout = `First log entry
{"continue": true, "systemMessage": "First JSON"}
More logging...
{"continue": false, "systemMessage": "Second JSON"}
End of output`;

      const extracted = parser.extractJsonFromOutput(stdout);
      expect(extracted).toBe(
        '{"continue": true, "systemMessage": "First JSON"}',
      );
    });

    it("should handle JSON arrays", () => {
      const stdout = `[{"item": 1}, {"item": 2}]`;
      const extracted = parser.extractJsonFromOutput(stdout);
      expect(extracted).toBe(stdout);
    });
  });

  describe("JSON Precedence Over Exit Codes", () => {
    const baseResult: HookOutputResult = {
      exitCode: 0,
      stdout: "",
      stderr: "",
      executionTime: 100,
      hookEvent: "PreToolUse",
    };

    it("should prefer valid JSON over successful exit code", () => {
      const result = parser.parseHookOutput({
        ...baseResult,
        exitCode: 0,
        stdout: '{"continue": false, "stopReason": "JSON says stop"}',
      });

      expect(result.source).toBe("json");
      expect(result.continue).toBe(false);
      expect(result.stopReason).toBe("JSON says stop");
    });

    it("should prefer valid JSON over blocking exit code", () => {
      const result = parser.parseHookOutput({
        ...baseResult,
        exitCode: 2,
        stdout:
          '{"continue": true, "systemMessage": "JSON overrides exit code"}',
      });

      expect(result.source).toBe("json");
      expect(result.continue).toBe(true);
      expect(result.systemMessage).toBe("JSON overrides exit code");
    });

    it("should prefer valid JSON over error exit code", () => {
      const result = parser.parseHookOutput({
        ...baseResult,
        exitCode: 1,
        stderr: "Some error occurred",
        stdout: '{"continue": true, "systemMessage": "Ignoring stderr error"}',
      });

      expect(result.source).toBe("json");
      expect(result.continue).toBe(true);
      expect(result.systemMessage).toBe("Ignoring stderr error");
      // Should have a warning about missing PreToolUse permission decision
      expect(result.errorMessages.length).toBeGreaterThan(0);
      expect(
        result.errorMessages.some((msg) =>
          msg.includes("missing permission decision"),
        ),
      ).toBe(true);
    });

    it("should fall back to exit code when JSON is invalid", () => {
      const result = parser.parseHookOutput({
        ...baseResult,
        exitCode: 2,
        stdout: '{"invalid": json, "missing": quotes}',
      });

      expect(result.source).toBe("exitcode");
      expect(result.continue).toBe(false);
      expect(result.stopReason).toBe(
        "Hook requested to block execution (exit code 2)",
      );
    });

    it("should fall back to exit code when no JSON found", () => {
      const result = parser.parseHookOutput({
        ...baseResult,
        exitCode: 1,
        stdout: "Just plain text output",
      });

      expect(result.source).toBe("exitcode");
      expect(result.continue).toBe(true);
      expect(result.systemMessage).toBe(
        "Hook completed with non-zero exit code 1",
      );
    });
  });

  describe("Common Field Validation", () => {
    it("should validate continue field correctly", () => {
      // Valid boolean values
      expect(
        parser.validateJsonOutput({ continue: true }, "PreToolUse").valid,
      ).toBe(true);
      expect(
        parser.validateJsonOutput({ continue: false }, "PreToolUse").valid,
      ).toBe(false); // fails because stopReason required

      // Invalid types
      const result1 = parser.validateJsonOutput(
        { continue: "true" },
        "PreToolUse",
      );
      expect(result1.valid).toBe(false);
      expect(
        result1.errors.some(
          (e) => e.field === "continue" && e.code === "INVALID_TYPE",
        ),
      ).toBe(true);

      const result2 = parser.validateJsonOutput({ continue: 1 }, "PreToolUse");
      expect(result2.valid).toBe(false);
      expect(
        result2.errors.some(
          (e) => e.field === "continue" && e.code === "INVALID_TYPE",
        ),
      ).toBe(true);
    });

    it("should validate stopReason requirement when continue is false", () => {
      // Missing stopReason when continue is false
      const result1 = parser.validateJsonOutput(
        { continue: false },
        "PreToolUse",
      );
      expect(result1.valid).toBe(false);
      expect(
        result1.errors.some(
          (e) => e.field === "stopReason" && e.code === "REQUIRED_FIELD",
        ),
      ).toBe(true);

      // Valid stopReason when continue is false
      const result2 = parser.validateJsonOutput(
        {
          continue: false,
          stopReason: "User requested stop",
        },
        "PreToolUse",
      );
      expect(result2.valid).toBe(true);

      // Invalid type for stopReason
      const result3 = parser.validateJsonOutput(
        {
          continue: false,
          stopReason: 123,
        },
        "PreToolUse",
      );
      expect(result3.valid).toBe(false);
      expect(
        result3.errors.some(
          (e) => e.field === "stopReason" && e.code === "INVALID_TYPE",
        ),
      ).toBe(true);

      // Empty stopReason
      const result4 = parser.validateJsonOutput(
        {
          continue: false,
          stopReason: "  ",
        },
        "PreToolUse",
      );
      expect(result4.valid).toBe(false);
      expect(
        result4.errors.some(
          (e) => e.field === "stopReason" && e.code === "EMPTY_REQUIRED_FIELD",
        ),
      ).toBe(true);
    });

    it("should warn about stopReason when continue is true", () => {
      const result = parser.validateJsonOutput(
        {
          continue: true,
          stopReason: "This will be ignored",
        },
        "PreToolUse",
      );

      expect(result.valid).toBe(true);
      expect(result.warnings.some((w) => w.field === "stopReason")).toBe(true);
    });

    it("should validate systemMessage field", () => {
      // Valid string
      const result1 = parser.validateJsonOutput(
        {
          systemMessage: "Valid message",
        },
        "PreToolUse",
      );
      expect(result1.valid).toBe(true);

      // Invalid type
      const result2 = parser.validateJsonOutput(
        {
          systemMessage: 123,
        },
        "PreToolUse",
      );
      expect(result2.valid).toBe(false);
      expect(
        result2.errors.some(
          (e) => e.field === "systemMessage" && e.code === "INVALID_TYPE",
        ),
      ).toBe(true);

      // Empty string warning
      const result3 = parser.validateJsonOutput(
        {
          systemMessage: "",
        },
        "PreToolUse",
      );
      expect(result3.valid).toBe(true);
      expect(result3.warnings.some((w) => w.field === "systemMessage")).toBe(
        true,
      );

      // Very long string warning
      const longMessage = "x".repeat(1001);
      const result4 = parser.validateJsonOutput(
        {
          systemMessage: longMessage,
        },
        "PreToolUse",
      );
      expect(result4.valid).toBe(true);
      expect(
        result4.warnings.some(
          (w) => w.field === "systemMessage" && w.message.includes("very long"),
        ),
      ).toBe(true);
    });

    it("should validate hookSpecificOutput structure", () => {
      // Valid object
      const result1 = parser.validateJsonOutput(
        {
          hookSpecificOutput: { hookEventName: "PreToolUse" },
        },
        "PreToolUse",
      );
      expect(result1.valid).toBe(false); // Will fail on PreToolUse specific validation but structure is ok

      // Valid null
      const result2 = parser.validateJsonOutput(
        {
          hookSpecificOutput: null,
        },
        "PreToolUse",
      );
      expect(result2.valid).toBe(true);

      // Invalid type
      const result3 = parser.validateJsonOutput(
        {
          hookSpecificOutput: "string",
        },
        "PreToolUse",
      );
      expect(result3.valid).toBe(false);
      expect(
        result3.errors.some(
          (e) => e.field === "hookSpecificOutput" && e.code === "INVALID_TYPE",
        ),
      ).toBe(true);
    });

    it("should warn about unknown fields", () => {
      const result = parser.validateJsonOutput(
        {
          continue: true,
          unknownField1: "value1",
          unknownField2: "value2",
        },
        "PreToolUse",
      );

      expect(result.valid).toBe(true);
      expect(
        result.warnings.some(
          (w) =>
            w.field === "root" &&
            w.message.includes("unknownField1, unknownField2"),
        ),
      ).toBe(true);
    });

    it("should warn about empty JSON objects", () => {
      const result = parser.validateJsonOutput({}, "PreToolUse");

      expect(result.valid).toBe(true);
      expect(
        result.warnings.some(
          (w) => w.field === "root" && w.message.includes("Empty JSON object"),
        ),
      ).toBe(true);
    });

    it("should warn about missing continue field", () => {
      const result = parser.validateJsonOutput(
        {
          systemMessage: "No continue field provided",
        },
        "PreToolUse",
      );

      expect(result.valid).toBe(true);
      expect(
        result.warnings.some(
          (w) => w.field === "continue" && w.message.includes("not specified"),
        ),
      ).toBe(true);
    });
  });

  describe("PreToolUse Hook Validation", () => {
    it("should validate valid PreToolUse output", () => {
      const validOutput = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: "Safe operation detected",
        },
      };

      const result = parser.validateJsonOutput(validOutput, "PreToolUse");
      expect(result.valid).toBe(true);
    });

    it("should require hookEventName to match PreToolUse", () => {
      const invalidOutput = {
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: "Wrong event name",
        },
      };

      const result = parser.validateJsonOutput(invalidOutput, "PreToolUse");
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field === "hookSpecificOutput.hookEventName" &&
            e.code === "EVENT_MISMATCH",
        ),
      ).toBe(true);
    });

    it("should require permissionDecision field", () => {
      const invalidOutput = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecisionReason: "Missing permission decision",
        },
      };

      const result = parser.validateJsonOutput(invalidOutput, "PreToolUse");
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field === "hookSpecificOutput.permissionDecision" &&
            e.code === "REQUIRED_FIELD",
        ),
      ).toBe(true);
    });

    it("should validate permissionDecision values", () => {
      const validDecisions = ["allow", "deny", "ask"];

      for (const decision of validDecisions) {
        const output = {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: decision,
            permissionDecisionReason: `Testing ${decision} decision`,
          },
        };

        const result = parser.validateJsonOutput(output, "PreToolUse");
        expect(result.valid).toBe(true);
      }

      // Invalid decision
      const invalidOutput = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "maybe",
          permissionDecisionReason: "Invalid decision",
        },
      };

      const result = parser.validateJsonOutput(invalidOutput, "PreToolUse");
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field === "hookSpecificOutput.permissionDecision" &&
            e.code === "INVALID_VALUE",
        ),
      ).toBe(true);
    });

    it("should require permissionDecisionReason field", () => {
      const invalidOutput = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
        },
      };

      const result = parser.validateJsonOutput(invalidOutput, "PreToolUse");
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field === "hookSpecificOutput.permissionDecisionReason" &&
            e.code === "REQUIRED_FIELD",
        ),
      ).toBe(true);
    });

    it("should validate permissionDecisionReason type and content", () => {
      // Invalid type
      const invalidTypeOutput = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: 123,
        },
      };

      const result1 = parser.validateJsonOutput(
        invalidTypeOutput,
        "PreToolUse",
      );
      expect(result1.valid).toBe(false);
      expect(
        result1.errors.some(
          (e) =>
            e.field === "hookSpecificOutput.permissionDecisionReason" &&
            e.code === "INVALID_TYPE",
        ),
      ).toBe(true);

      // Empty string
      const emptyReasonOutput = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: "  ",
        },
      };

      const result2 = parser.validateJsonOutput(
        emptyReasonOutput,
        "PreToolUse",
      );
      expect(result2.valid).toBe(false);
      expect(
        result2.errors.some(
          (e) =>
            e.field === "hookSpecificOutput.permissionDecisionReason" &&
            e.code === "EMPTY_REQUIRED_FIELD",
        ),
      ).toBe(true);
    });

    it("should validate optional updatedInput field", () => {
      // Valid object
      const validOutput = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: "Modifying input parameters",
          updatedInput: { newParam: "value" },
        },
      };

      const result1 = parser.validateJsonOutput(validOutput, "PreToolUse");
      expect(result1.valid).toBe(true);

      // Valid null
      const nullInputOutput = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: "No input modification needed",
          updatedInput: null,
        },
      };

      const result2 = parser.validateJsonOutput(nullInputOutput, "PreToolUse");
      expect(result2.valid).toBe(true);

      // Invalid type (array)
      const invalidArrayOutput = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: "Invalid input type",
          updatedInput: ["not", "an", "object"],
        },
      };

      const result3 = parser.validateJsonOutput(
        invalidArrayOutput,
        "PreToolUse",
      );
      expect(result3.valid).toBe(false);
      expect(
        result3.errors.some(
          (e) =>
            e.field === "hookSpecificOutput.updatedInput" &&
            e.code === "INVALID_TYPE",
        ),
      ).toBe(true);

      // Invalid type (string)
      const invalidStringOutput = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: "Invalid input type",
          updatedInput: "string input",
        },
      };

      const result4 = parser.validateJsonOutput(
        invalidStringOutput,
        "PreToolUse",
      );
      expect(result4.valid).toBe(false);
      expect(
        result4.errors.some(
          (e) =>
            e.field === "hookSpecificOutput.updatedInput" &&
            e.code === "INVALID_TYPE",
        ),
      ).toBe(true);
    });

    it("should warn about updatedInput when permission is denied", () => {
      const output = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "Operation not allowed",
          updatedInput: { unnecessary: "input" },
        },
      };

      const result = parser.validateJsonOutput(output, "PreToolUse");
      expect(result.valid).toBe(true);
      expect(
        result.warnings.some(
          (w) =>
            w.field === "hookSpecificOutput.updatedInput" &&
            w.message.includes("ignored"),
        ),
      ).toBe(true);
    });

    it("should warn about unknown fields in PreToolUse output", () => {
      const output = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: "Valid reason",
          unknownField: "should not be here",
          anotherUnknown: 123,
        },
      };

      const result = parser.validateJsonOutput(output, "PreToolUse");
      expect(result.valid).toBe(true);
      expect(
        result.warnings.some(
          (w) =>
            w.field === "hookSpecificOutput" &&
            w.message.includes("Unknown PreToolUse fields"),
        ),
      ).toBe(true);
    });

    it("should warn about missing hookSpecificOutput for PreToolUse", () => {
      const output = { continue: true };

      const result = parser.validateJsonOutput(output, "PreToolUse");
      expect(result.valid).toBe(true);
      expect(
        result.warnings.some(
          (w) =>
            w.field === "hookSpecificOutput" &&
            w.message.includes("missing permission decision"),
        ),
      ).toBe(true);
    });
  });

  describe("PostToolUse Hook Validation", () => {
    it("should validate valid PostToolUse output", () => {
      const validOutput = {
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          decision: "block",
          reason: "Tool execution produced suspicious output",
        },
      };

      const result = parser.validateJsonOutput(validOutput, "PostToolUse");
      expect(result.valid).toBe(true);
    });

    it("should allow PostToolUse output without decision (implicit allow)", () => {
      const validOutput = {
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: "Tool executed successfully",
        },
      };

      const result = parser.validateJsonOutput(validOutput, "PostToolUse");
      expect(result.valid).toBe(true);
    });

    it("should require hookEventName to match PostToolUse", () => {
      const invalidOutput = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          decision: "block",
          reason: "Wrong event name",
        },
      };

      const result = parser.validateJsonOutput(invalidOutput, "PostToolUse");
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field === "hookSpecificOutput.hookEventName" &&
            e.code === "EVENT_MISMATCH",
        ),
      ).toBe(true);
    });

    it("should validate decision field values", () => {
      // Valid decision
      const validOutput = {
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          decision: "block",
          reason: "Valid block decision",
        },
      };

      const result1 = parser.validateJsonOutput(validOutput, "PostToolUse");
      expect(result1.valid).toBe(true);

      // Invalid decision value
      const invalidOutput = {
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          decision: "allow",
          reason: "Invalid decision value",
        },
      };

      const result2 = parser.validateJsonOutput(invalidOutput, "PostToolUse");
      expect(result2.valid).toBe(false);
      expect(
        result2.errors.some(
          (e) =>
            e.field === "hookSpecificOutput.decision" &&
            e.code === "INVALID_VALUE",
        ),
      ).toBe(true);
    });

    it("should require reason when decision is block", () => {
      const invalidOutput = {
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          decision: "block",
        },
      };

      const result = parser.validateJsonOutput(invalidOutput, "PostToolUse");
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field === "hookSpecificOutput.reason" &&
            e.code === "REQUIRED_FIELD",
        ),
      ).toBe(true);
    });

    it("should validate reason type and content", () => {
      // Invalid type
      const invalidTypeOutput = {
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          decision: "block",
          reason: 123,
        },
      };

      const result1 = parser.validateJsonOutput(
        invalidTypeOutput,
        "PostToolUse",
      );
      expect(result1.valid).toBe(false);
      expect(
        result1.errors.some(
          (e) =>
            e.field === "hookSpecificOutput.reason" &&
            e.code === "INVALID_TYPE",
        ),
      ).toBe(true);

      // Empty reason
      const emptyReasonOutput = {
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          decision: "block",
          reason: "  ",
        },
      };

      const result2 = parser.validateJsonOutput(
        emptyReasonOutput,
        "PostToolUse",
      );
      expect(result2.valid).toBe(false);
      expect(
        result2.errors.some(
          (e) =>
            e.field === "hookSpecificOutput.reason" &&
            e.code === "EMPTY_REQUIRED_FIELD",
        ),
      ).toBe(true);
    });

    it("should warn about reason without blocking decision", () => {
      const output = {
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          reason: "This reason will be ignored",
        },
      };

      const result = parser.validateJsonOutput(output, "PostToolUse");
      expect(result.valid).toBe(true);
      expect(
        result.warnings.some(
          (w) =>
            w.field === "hookSpecificOutput.reason" &&
            w.message.includes("ignored"),
        ),
      ).toBe(true);
    });

    it("should validate additionalContext field", () => {
      // Valid string
      const validOutput = {
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: "Tool executed in 150ms",
        },
      };

      const result1 = parser.validateJsonOutput(validOutput, "PostToolUse");
      expect(result1.valid).toBe(true);

      // Invalid type
      const invalidOutput = {
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: 123,
        },
      };

      const result2 = parser.validateJsonOutput(invalidOutput, "PostToolUse");
      expect(result2.valid).toBe(false);
      expect(
        result2.errors.some(
          (e) =>
            e.field === "hookSpecificOutput.additionalContext" &&
            e.code === "INVALID_TYPE",
        ),
      ).toBe(true);

      // Empty string warning
      const emptyOutput = {
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: "",
        },
      };

      const result3 = parser.validateJsonOutput(emptyOutput, "PostToolUse");
      expect(result3.valid).toBe(true);
      expect(
        result3.warnings.some(
          (w) => w.field === "hookSpecificOutput.additionalContext",
        ),
      ).toBe(true);
    });

    it("should warn about unknown fields in PostToolUse output", () => {
      const output = {
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          unknownField: "should not be here",
        },
      };

      const result = parser.validateJsonOutput(output, "PostToolUse");
      expect(result.valid).toBe(true);
      expect(
        result.warnings.some(
          (w) =>
            w.field === "hookSpecificOutput" &&
            w.message.includes("Unknown PostToolUse fields"),
        ),
      ).toBe(true);
    });
  });

  describe("UserPromptSubmit Hook Validation", () => {
    it("should validate valid UserPromptSubmit output", () => {
      const validOutput = {
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          decision: "block",
          reason: "Prompt contains potentially harmful content",
        },
      };

      const result = parser.validateJsonOutput(validOutput, "UserPromptSubmit");
      expect(result.valid).toBe(true);
    });

    it("should allow UserPromptSubmit output without decision", () => {
      const validOutput = {
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: "User prompt processed successfully",
        },
      };

      const result = parser.validateJsonOutput(validOutput, "UserPromptSubmit");
      expect(result.valid).toBe(true);
    });

    it("should require hookEventName to match UserPromptSubmit", () => {
      const invalidOutput = {
        hookSpecificOutput: {
          hookEventName: "Stop",
          decision: "block",
          reason: "Wrong event name",
        },
      };

      const result = parser.validateJsonOutput(
        invalidOutput,
        "UserPromptSubmit",
      );
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field === "hookSpecificOutput.hookEventName" &&
            e.message.includes("UserPromptSubmit"),
        ),
      ).toBe(true);
    });

    it("should validate decision field (same as PostToolUse)", () => {
      // Valid decision
      const validOutput = {
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          decision: "block",
          reason: "Valid block decision",
        },
      };

      const result1 = parser.validateJsonOutput(
        validOutput,
        "UserPromptSubmit",
      );
      expect(result1.valid).toBe(true);

      // Invalid decision value
      const invalidOutput = {
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          decision: "allow",
          reason: "Invalid decision value",
        },
      };

      const result2 = parser.validateJsonOutput(
        invalidOutput,
        "UserPromptSubmit",
      );
      expect(result2.valid).toBe(false);
      expect(
        result2.errors.some(
          (e) =>
            e.field === "hookSpecificOutput.decision" &&
            e.code === "INVALID_VALUE",
        ),
      ).toBe(true);
    });

    it("should warn about unknown fields in UserPromptSubmit output", () => {
      const output = {
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          unknownField: "should not be here",
        },
      };

      const result = parser.validateJsonOutput(output, "UserPromptSubmit");
      expect(result.valid).toBe(true);
      expect(
        result.warnings.some(
          (w) =>
            w.field === "hookSpecificOutput" &&
            w.message.includes("Unknown UserPromptSubmit fields"),
        ),
      ).toBe(true);
    });
  });

  describe("Stop Hook Validation", () => {
    it("should validate valid Stop output", () => {
      const validOutput = {
        hookSpecificOutput: {
          hookEventName: "Stop",
          decision: "block",
          reason: "Session terminated due to security violation",
        },
      };

      const result = parser.validateJsonOutput(validOutput, "Stop");
      expect(result.valid).toBe(true);
    });

    it("should allow Stop output without decision", () => {
      const validOutput = {
        hookSpecificOutput: {
          hookEventName: "Stop",
        },
      };

      const result = parser.validateJsonOutput(validOutput, "Stop");
      expect(result.valid).toBe(true);
    });

    it("should require hookEventName to match Stop", () => {
      const invalidOutput = {
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          decision: "block",
          reason: "Wrong event name",
        },
      };

      const result = parser.validateJsonOutput(invalidOutput, "Stop");
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field === "hookSpecificOutput.hookEventName" &&
            e.message.includes("Stop"),
        ),
      ).toBe(true);
    });

    it("should validate decision field (only block allowed)", () => {
      // Valid decision
      const validOutput = {
        hookSpecificOutput: {
          hookEventName: "Stop",
          decision: "block",
          reason: "Valid block decision",
        },
      };

      const result1 = parser.validateJsonOutput(validOutput, "Stop");
      expect(result1.valid).toBe(true);

      // Invalid decision value
      const invalidOutput = {
        hookSpecificOutput: {
          hookEventName: "Stop",
          decision: "allow",
          reason: "Invalid decision value",
        },
      };

      const result2 = parser.validateJsonOutput(invalidOutput, "Stop");
      expect(result2.valid).toBe(false);
      expect(
        result2.errors.some(
          (e) =>
            e.field === "hookSpecificOutput.decision" &&
            e.code === "INVALID_VALUE",
        ),
      ).toBe(true);
    });

    it("should require reason when decision is block", () => {
      const invalidOutput = {
        hookSpecificOutput: {
          hookEventName: "Stop",
          decision: "block",
        },
      };

      const result = parser.validateJsonOutput(invalidOutput, "Stop");
      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) =>
            e.field === "hookSpecificOutput.reason" &&
            e.code === "REQUIRED_FIELD",
        ),
      ).toBe(true);
    });

    it("should not allow additionalContext in Stop output", () => {
      const output = {
        hookSpecificOutput: {
          hookEventName: "Stop",
          additionalContext: "This field is not allowed for Stop hooks",
        },
      };

      const result = parser.validateJsonOutput(output, "Stop");
      expect(result.valid).toBe(true);
      expect(
        result.warnings.some(
          (w) =>
            w.field === "hookSpecificOutput" &&
            w.message.includes("Unknown Stop fields"),
        ),
      ).toBe(true);
    });

    it("should warn about unknown fields in Stop output", () => {
      const output = {
        hookSpecificOutput: {
          hookEventName: "Stop",
          unknownField: "should not be here",
        },
      };

      const result = parser.validateJsonOutput(output, "Stop");
      expect(result.valid).toBe(true);
      expect(
        result.warnings.some(
          (w) =>
            w.field === "hookSpecificOutput" &&
            w.message.includes("Unknown Stop fields"),
        ),
      ).toBe(true);
    });
  });

  describe("Error Handling and Fallback Behavior", () => {
    const baseResult: HookOutputResult = {
      exitCode: 0,
      stdout: "",
      stderr: "",
      executionTime: 100,
      hookEvent: "PreToolUse",
    };

    it("should handle invalid JSON structure gracefully", () => {
      const result = parser.parseHookOutput({
        ...baseResult,
        exitCode: 0,
        stdout: "not json at all",
      });

      expect(result.source).toBe("exitcode");
      expect(result.continue).toBe(true);
      expect(result.errorMessages).toEqual(["Hook output: not json at all"]);
    });

    it("should handle malformed JSON and fall back to exit code", () => {
      const result = parser.parseHookOutput({
        ...baseResult,
        exitCode: 2,
        stdout: '{"continue": true, malformed json}',
      });

      expect(result.source).toBe("exitcode");
      expect(result.continue).toBe(false);
      expect(result.stopReason).toBe(
        "Hook requested to block execution (exit code 2)",
      );
    });

    it("should collect validation errors without throwing when parsing JSON", () => {
      const result = parser.parseHookOutput({
        ...baseResult,
        exitCode: 0,
        stdout: '{"continue": "invalid", "stopReason": 123}',
      });

      expect(result.source).toBe("json");
      expect(result.continue).toBe(true); // Coerced from string "invalid"
      expect(result.errorMessages.length).toBeGreaterThan(0);
      expect(
        result.errorMessages.some((msg) => msg.includes("continue:")),
      ).toBe(true);
    });

    it("should coerce invalid continue values", () => {
      // Test string "false" coercion
      const result1 = parser.parseHookOutput({
        ...baseResult,
        stdout: '{"continue": "false"}',
      });
      expect(result1.continue).toBe(false);

      // Test string "true" coercion
      const result2 = parser.parseHookOutput({
        ...baseResult,
        stdout: '{"continue": "true"}',
      });
      expect(result2.continue).toBe(true);

      // Test number 0 coercion
      const result3 = parser.parseHookOutput({
        ...baseResult,
        stdout: '{"continue": 0}',
      });
      expect(result3.continue).toBe(false);

      // Test number 1 coercion
      const result4 = parser.parseHookOutput({
        ...baseResult,
        stdout: '{"continue": 1}',
      });
      expect(result4.continue).toBe(true);

      // Test invalid value defaults to true
      const result5 = parser.parseHookOutput({
        ...baseResult,
        stdout: '{"continue": "maybe"}',
      });
      expect(result5.continue).toBe(true);
    });

    it("should coerce non-string stopReason and systemMessage", () => {
      const result = parser.parseHookOutput({
        ...baseResult,
        stdout: '{"stopReason": 123, "systemMessage": true}',
      });

      expect(result.stopReason).toBe("123");
      expect(result.systemMessage).toBe("true");
    });

    it("should add default stopReason when continue is false but no reason provided", () => {
      const result = parser.parseHookOutput({
        ...baseResult,
        stdout: '{"continue": false}',
      });

      expect(result.continue).toBe(false);
      expect(result.stopReason).toBe(
        "Hook requested to stop execution without providing a reason",
      );
    });

    it("should handle non-object JSON gracefully", () => {
      const result = parser.validateJsonOutput("just a string", "PreToolUse");

      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) => e.field === "root" && e.code === "INVALID_TYPE",
        ),
      ).toBe(true);
    });

    it("should handle null JSON gracefully", () => {
      const result = parser.validateJsonOutput(null, "PreToolUse");

      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) => e.field === "root" && e.code === "INVALID_TYPE",
        ),
      ).toBe(true);
    });

    it("should handle array JSON gracefully", () => {
      const result = parser.validateJsonOutput([1, 2, 3], "PreToolUse");

      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) => e.field === "root" && e.code === "INVALID_TYPE",
        ),
      ).toBe(true);
    });

    it("should preserve stderr messages in error output", () => {
      const result = parser.parseHookOutput({
        ...baseResult,
        exitCode: 1,
        stderr: "Critical error: database connection failed",
        stdout: "Hook completed with warnings",
      });

      expect(result.errorMessages).toContain(
        "Critical error: database connection failed",
      );
      expect(result.errorMessages).toContain(
        "Hook output: Hook completed with warnings",
      );
    });

    it("should handle empty hookSpecificOutput object validation", () => {
      const result = parser.validateJsonOutput(
        {
          hookSpecificOutput: {},
        },
        "PreToolUse",
      );

      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) => e.field === "hookSpecificOutput.hookEventName",
        ),
      ).toBe(true);
    });
  });

  describe("Diagnostics Functionality", () => {
    const baseResult: HookOutputResult = {
      exitCode: 0,
      stdout: "",
      stderr: "",
      executionTime: 100,
      hookEvent: "PreToolUse",
    };

    it("should provide basic diagnostics for empty output", () => {
      const diagnostics = parser.getDiagnostics({
        ...baseResult,
        stdout: "",
        stderr: "",
      });

      expect(diagnostics).toEqual({
        hasStdout: false,
        hasStderr: false,
        stdoutLooksLikeJson: false,
        jsonExtractable: false,
        jsonValid: false,
        validationSummary: undefined,
      });
    });

    it("should detect stdout and stderr presence", () => {
      const diagnostics = parser.getDiagnostics({
        ...baseResult,
        stdout: "Some output",
        stderr: "Some error",
      });

      expect(diagnostics.hasStdout).toBe(true);
      expect(diagnostics.hasStderr).toBe(true);
    });

    it("should detect JSON-like appearance", () => {
      const diagnostics = parser.getDiagnostics({
        ...baseResult,
        stdout: '{"continue": true}',
      });

      expect(diagnostics.stdoutLooksLikeJson).toBe(true);
      expect(diagnostics.jsonExtractable).toBe(true);
      expect(diagnostics.jsonValid).toBe(true);
    });

    it("should detect extractable but invalid JSON", () => {
      const diagnostics = parser.getDiagnostics({
        ...baseResult,
        stdout: '{"continue": true, invalid}',
      });

      expect(diagnostics.stdoutLooksLikeJson).toBe(true);
      expect(diagnostics.jsonExtractable).toBe(false);
      expect(diagnostics.jsonValid).toBe(false);
    });

    it("should provide validation summary for valid JSON", () => {
      const diagnostics = parser.getDiagnostics({
        ...baseResult,
        stdout: '{"continue": true, "systemMessage": "All good"}',
        hookEvent: "PreToolUse",
      });

      expect(diagnostics.validationSummary).toBeDefined();
      expect(diagnostics.validationSummary).toMatch(/warning/i); // Should have warnings about missing PreToolUse fields
    });

    it("should provide validation summary for invalid JSON", () => {
      const diagnostics = parser.getDiagnostics({
        ...baseResult,
        stdout: '{"continue": "invalid", "stopReason": 123}',
        hookEvent: "PreToolUse",
      });

      expect(diagnostics.jsonValid).toBe(true);
      expect(diagnostics.validationSummary).toBeDefined();
      expect(diagnostics.validationSummary).toMatch(/failed/i); // Should indicate validation failures
    });

    it("should handle whitespace-only output", () => {
      const diagnostics = parser.getDiagnostics({
        ...baseResult,
        stdout: "   \n\t  ",
        stderr: "  \n  ",
      });

      expect(diagnostics.hasStdout).toBe(false);
      expect(diagnostics.hasStderr).toBe(false);
    });

    it("should detect mixed output with JSON", () => {
      const diagnostics = parser.getDiagnostics({
        ...baseResult,
        stdout: `Starting process...
{"continue": true}
Process completed.`,
      });

      expect(diagnostics.hasStdout).toBe(true);
      expect(diagnostics.jsonExtractable).toBe(true);
      expect(diagnostics.jsonValid).toBe(true);
    });
  });

  describe("Utility Functions", () => {
    describe("parseHookOutput", () => {
      it("should be a convenience function for parser.parseHookOutput", () => {
        const result: HookOutputResult = {
          exitCode: 0,
          stdout: '{"continue": true}',
          stderr: "",
          executionTime: 100,
          hookEvent: "PreToolUse",
        };

        const parsed = parseHookOutput(result);
        expect(parsed.source).toBe("json");
        expect(parsed.continue).toBe(true);
      });
    });

    describe("validateHookJsonOutput", () => {
      it("should be a convenience function for parser.validateJsonOutput", () => {
        const json = { continue: true, systemMessage: "Test" };
        const validation = validateHookJsonOutput(json, "PreToolUse");

        expect(validation.valid).toBe(true);
        expect(validation.warnings.length).toBeGreaterThan(0); // Should have warnings about missing PreToolUse fields
      });
    });

    describe("hasValidJsonOutput", () => {
      it("should detect valid JSON in stdout", () => {
        const validJson = '{"continue": true, "systemMessage": "Valid"}';
        expect(hasValidJsonOutput(validJson)).toBe(true);
      });

      it("should detect invalid JSON in stdout", () => {
        expect(hasValidJsonOutput('{"invalid": json}')).toBe(false);
      });

      it("should handle empty or null stdout", () => {
        expect(hasValidJsonOutput("")).toBe(false);
        expect(hasValidJsonOutput("   ")).toBe(false);
      });

      it("should detect JSON in mixed content", () => {
        const mixedContent = `Debug: Starting process
{"continue": true}
Process completed`;
        expect(hasValidJsonOutput(mixedContent)).toBe(true);
      });
    });

    describe("getValidationSummary", () => {
      it("should format successful validation", () => {
        const validation: HookValidationResult = {
          valid: true,
          errors: [],
          warnings: [],
        };

        const summary = getValidationSummary(validation);
        expect(summary).toBe("✅ Validation passed");
      });

      it("should format failed validation", () => {
        const validation: HookValidationResult = {
          valid: false,
          errors: [
            {
              field: "continue",
              message: "Invalid type",
              code: "INVALID_TYPE",
            },
          ],
          warnings: [],
        };

        const summary = getValidationSummary(validation);
        expect(summary).toBe("❌ Validation failed with 1 error(s)");
      });

      it("should format validation with warnings", () => {
        const validation: HookValidationResult = {
          valid: true,
          errors: [],
          warnings: [
            {
              field: "continue",
              message: "Not specified",
              suggestion: "Add explicit value",
            },
          ],
        };

        const summary = getValidationSummary(validation);
        expect(summary).toBe("✅ Validation passed, ⚠️  1 warning(s)");
      });

      it("should format validation with errors and warnings", () => {
        const validation: HookValidationResult = {
          valid: false,
          errors: [
            {
              field: "continue",
              message: "Invalid type",
              code: "INVALID_TYPE",
            },
          ],
          warnings: [
            {
              field: "systemMessage",
              message: "Empty message",
              suggestion: "Provide content",
            },
          ],
        };

        const summary = getValidationSummary(validation);
        expect(summary).toBe(
          "❌ Validation failed with 1 error(s), ⚠️  1 warning(s)",
        );
      });
    });

    describe("formatValidationErrors", () => {
      it("should format validation errors and warnings", () => {
        const validation: HookValidationResult = {
          valid: false,
          errors: [
            {
              field: "continue",
              message: "Must be boolean",
              code: "INVALID_TYPE",
            },
            {
              field: "stopReason",
              message: "Required when continue is false",
              code: "REQUIRED_FIELD",
            },
          ],
          warnings: [
            {
              field: "systemMessage",
              message: "Empty message",
              suggestion: "Provide meaningful content",
            },
          ],
        };

        const formatted = formatValidationErrors(validation);

        expect(formatted).toHaveLength(3);
        expect(formatted[0]).toBe(
          "Error in continue: Must be boolean (INVALID_TYPE)",
        );
        expect(formatted[1]).toBe(
          "Error in stopReason: Required when continue is false (REQUIRED_FIELD)",
        );
        expect(formatted[2]).toBe(
          "Warning in systemMessage: Empty message - Provide meaningful content",
        );
      });

      it("should handle warnings without suggestions", () => {
        const validation: HookValidationResult = {
          valid: true,
          errors: [],
          warnings: [{ field: "root", message: "Unknown fields detected" }],
        };

        const formatted = formatValidationErrors(validation);

        expect(formatted).toHaveLength(1);
        expect(formatted[0]).toBe("Warning in root: Unknown fields detected");
      });

      it("should handle empty validation results", () => {
        const validation: HookValidationResult = {
          valid: true,
          errors: [],
          warnings: [],
        };

        const formatted = formatValidationErrors(validation);
        expect(formatted).toHaveLength(0);
      });
    });
  });

  describe("Integration Tests", () => {
    const baseResult: HookOutputResult = {
      exitCode: 0,
      stdout: "",
      stderr: "",
      executionTime: 100,
      hookEvent: "PreToolUse",
    };

    it("should handle complete PreToolUse workflow", () => {
      const result = parser.parseHookOutput({
        ...baseResult,
        stdout: `Hook execution started...
{
  "continue": true,
  "systemMessage": "Permission analysis complete",
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "Tool operation is safe for current context",
    "updatedInput": {
      "sanitizedParam": "cleaned_value"
    }
  }
}
Hook execution completed.`,
        hookEvent: "PreToolUse",
      });

      expect(result.source).toBe("json");
      expect(result.continue).toBe(true);
      expect(result.systemMessage).toBe("Permission analysis complete");
      expect(result.hookSpecificData?.hookEventName).toBe("PreToolUse");
      expect(result.errorMessages).toHaveLength(0);
    });

    it("should handle PostToolUse blocking scenario", () => {
      const result = parser.parseHookOutput({
        ...baseResult,
        stdout: `{
  "continue": false,
  "stopReason": "Tool output contains sensitive information",
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "decision": "block",
    "reason": "Detected API keys in tool response",
    "additionalContext": "Found 2 potential API keys that should not be logged"
  }
}`,
        hookEvent: "PostToolUse",
      });

      expect(result.source).toBe("json");
      expect(result.continue).toBe(false);
      expect(result.stopReason).toBe(
        "Tool output contains sensitive information",
      );
      expect(
        (result.hookSpecificData as unknown as Record<string, unknown>)
          ?.decision,
      ).toBe("block");
    });

    it("should handle validation errors with graceful degradation", () => {
      const result = parser.parseHookOutput({
        ...baseResult,
        stdout: `{
  "continue": "maybe",
  "stopReason": 42,
  "hookSpecificOutput": {
    "hookEventName": "WrongEventName",
    "permissionDecision": "perhaps"
  }
}`,
        hookEvent: "PreToolUse",
      });

      expect(result.source).toBe("json");
      expect(result.continue).toBe(true); // Coerced from "maybe"
      expect(result.stopReason).toBe("42"); // Coerced to string
      expect(result.errorMessages.length).toBeGreaterThan(0); // Should have validation errors
    });
  });
});
