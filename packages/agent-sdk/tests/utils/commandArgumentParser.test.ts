import { describe, it, expect } from "vitest";
import {
  parseCommandArguments,
  substituteCommandParameters,
  parseSlashCommandInput,
  hasParameterPlaceholders,
  getUsedParameterPlaceholders,
} from "@/utils/commandArgumentParser.js";

describe("Command Argument Parser", () => {
  describe("parseCommandArguments", () => {
    it("should parse simple space-separated arguments", () => {
      expect(parseCommandArguments("arg1 arg2 arg3")).toEqual([
        "arg1",
        "arg2",
        "arg3",
      ]);
    });

    it("should handle quoted arguments with spaces", () => {
      expect(parseCommandArguments('arg1 "arg with spaces" arg3')).toEqual([
        "arg1",
        "arg with spaces",
        "arg3",
      ]);
    });

    it("should handle single quoted arguments", () => {
      expect(parseCommandArguments("arg1 'single quoted' arg3")).toEqual([
        "arg1",
        "single quoted",
        "arg3",
      ]);
    });

    it("should handle escaped quotes within arguments", () => {
      expect(parseCommandArguments('arg1 "escaped \\"quote\\"" arg3')).toEqual([
        "arg1",
        'escaped "quote"',
        "arg3",
      ]);
    });

    it("should handle mixed quote types", () => {
      expect(
        parseCommandArguments("arg1 \"double quotes\" 'single quotes' arg4"),
      ).toEqual(["arg1", "double quotes", "single quotes", "arg4"]);
    });

    it("should handle empty string", () => {
      expect(parseCommandArguments("")).toEqual([]);
    });

    it("should handle whitespace-only string", () => {
      expect(parseCommandArguments("   ")).toEqual([]);
    });

    it("should handle extra whitespace between arguments", () => {
      expect(parseCommandArguments("arg1    arg2   arg3")).toEqual([
        "arg1",
        "arg2",
        "arg3",
      ]);
    });

    it("should handle backslash escapes", () => {
      expect(parseCommandArguments("arg1 path\\\\to\\\\file arg3")).toEqual([
        "arg1",
        "path\\\\to\\\\file",
        "arg3",
      ]);
    });
  });

  describe("substituteCommandParameters", () => {
    it("should substitute $ARGUMENTS with all arguments", () => {
      const content = "Process issue #$ARGUMENTS";
      const args = "123 high-priority";
      expect(substituteCommandParameters(content, args)).toBe(
        "Process issue #123 high-priority",
      );
    });

    it("should substitute positional parameters", () => {
      const content = "Review PR #$1 with priority $2 and assign to $3";
      const args = "456 high alice";
      expect(substituteCommandParameters(content, args)).toBe(
        "Review PR #456 with priority high and assign to alice",
      );
    });

    it("should handle missing positional parameters", () => {
      const content = "Review PR #$1 with priority $2 and assign to $3";
      const args = "456";
      expect(substituteCommandParameters(content, args)).toBe(
        "Review PR #456 with priority  and assign to ",
      );
    });

    it("should handle quoted arguments with spaces", () => {
      const content = "Create commit with message: $1";
      const args = '"Fix bug in user authentication"';
      expect(substituteCommandParameters(content, args)).toBe(
        "Create commit with message: Fix bug in user authentication",
      );
    });

    it("should handle both $ARGUMENTS and positional parameters", () => {
      const content = "Command: $1, All args: [$ARGUMENTS], Second arg: $2";
      const args = "deploy staging --verbose";
      expect(substituteCommandParameters(content, args)).toBe(
        "Command: deploy, All args: [deploy staging --verbose], Second arg: staging",
      );
    });

    it("should handle high-numbered positional parameters correctly", () => {
      const content = "Args: $1 $10 $2";
      const args = "a b c d e f g h i j k";
      expect(substituteCommandParameters(content, args)).toBe("Args: a j b");
    });

    it("should handle no parameters in content", () => {
      const content = "No parameters here";
      const args = "some args";
      expect(substituteCommandParameters(content, args)).toBe(
        "No parameters here",
      );
    });

    it("should handle empty arguments", () => {
      const content = "Test $1 and $ARGUMENTS";
      const args = "";
      expect(substituteCommandParameters(content, args)).toBe("Test  and ");
    });

    it("should handle complex real-world example", () => {
      const content = `Fix issue #$1 following our coding standards:

1. Analyze the problem in $2 component
2. Apply fix with priority: $3
3. Test thoroughly

All details: $ARGUMENTS`;

      const args = '123 "user-auth" high-priority';
      expect(substituteCommandParameters(content, args)).toBe(
        `Fix issue #123 following our coding standards:

1. Analyze the problem in user-auth component
2. Apply fix with priority: high-priority
3. Test thoroughly

All details: 123 "user-auth" high-priority`,
      );
    });
  });

  describe("parseSlashCommandInput", () => {
    it("should parse command with arguments", () => {
      expect(parseSlashCommandInput("/fix-issue 123 high-priority")).toEqual({
        command: "fix-issue",
        args: "123 high-priority",
      });
    });

    it("should parse command without arguments", () => {
      expect(parseSlashCommandInput("/clear")).toEqual({
        command: "clear",
        args: "",
      });
    });

    it("should handle extra whitespace", () => {
      expect(parseSlashCommandInput("/fix-issue   123   high  ")).toEqual({
        command: "fix-issue",
        args: "123   high",
      });
    });

    it("should throw error for input without slash", () => {
      expect(() => parseSlashCommandInput("fix-issue 123")).toThrow(
        "Input must start with /",
      );
    });

    it("should handle quoted arguments", () => {
      expect(
        parseSlashCommandInput('/commit "Fix bug in authentication"'),
      ).toEqual({
        command: "commit",
        args: '"Fix bug in authentication"',
      });
    });
  });

  describe("hasParameterPlaceholders", () => {
    it("should detect $ARGUMENTS placeholder", () => {
      expect(hasParameterPlaceholders("Process $ARGUMENTS")).toBe(true);
    });

    it("should detect positional placeholders", () => {
      expect(hasParameterPlaceholders("Review $1 and $2")).toBe(true);
    });

    it("should detect mixed placeholders", () => {
      expect(hasParameterPlaceholders("$1: $ARGUMENTS")).toBe(true);
    });

    it("should return false for content without placeholders", () => {
      expect(hasParameterPlaceholders("No placeholders here")).toBe(false);
    });

    it("should not detect invalid placeholders", () => {
      expect(hasParameterPlaceholders("Invalid $ABC $")).toBe(false);
    });
  });

  describe("getUsedParameterPlaceholders", () => {
    it("should extract all unique placeholders", () => {
      const content = "Test $1 and $2 and $ARGUMENTS and $1 again";
      expect(getUsedParameterPlaceholders(content)).toEqual([
        "$1",
        "$2",
        "$ARGUMENTS",
      ]);
    });

    it("should return empty array for no placeholders", () => {
      expect(getUsedParameterPlaceholders("No placeholders")).toEqual([]);
    });

    it("should handle high-numbered placeholders", () => {
      const content = "Args: $1 $10 $100";
      expect(getUsedParameterPlaceholders(content)).toEqual([
        "$1",
        "$10",
        "$100",
      ]);
    });
  });
});
