import { describe, it, expect } from "vitest";
import {
  expandLongTextPlaceholders,
  getAtSelectorPosition,
  getSlashSelectorPosition,
  getWordEnd,
  getProjectedState,
  SELECTOR_TRIGGERS,
} from "../../src/utils/inputUtils.js";

describe("inputUtils", () => {
  describe("expandLongTextPlaceholders", () => {
    it("should expand placeholders correctly", () => {
      const text = "Check this [LongText#1] and [LongText#2]";
      const longTextMap = {
        "[LongText#1]": "First long text content",
        "[LongText#2]": "Second long text content",
      };
      const result = expandLongTextPlaceholders(text, longTextMap);
      expect(result).toBe(
        "Check this First long text content and Second long text content",
      );
    });

    it("should return original text if no placeholders found", () => {
      const text = "Normal text";
      const result = expandLongTextPlaceholders(text, {});
      expect(result).toBe("Normal text");
    });

    it("should return original text if placeholder mapping is missing", () => {
      const text = "[LongText#99]";
      const result = expandLongTextPlaceholders(text, {});
      expect(result).toBe("[LongText#99]");
    });
  });

  describe("getAtSelectorPosition", () => {
    it("should return position of @ at start of string", () => {
      expect(getAtSelectorPosition("@file", 1)).toBe(0);
    });

    it("should return position of @ after space", () => {
      expect(getAtSelectorPosition("read @file", 6)).toBe(5);
    });

    it("should return -1 if @ is not preceded by space", () => {
      expect(getAtSelectorPosition("email@domain", 7)).toBe(-1);
    });

    it("should return -1 if no @ is found", () => {
      expect(getAtSelectorPosition("no selector", 5)).toBe(-1);
    });
  });

  describe("getSlashSelectorPosition", () => {
    it("should return position of / at start of string", () => {
      expect(getSlashSelectorPosition("/cmd", 1)).toBe(0);
    });

    it("should return position of / after space", () => {
      expect(getSlashSelectorPosition("exec /cmd", 6)).toBe(5);
    });

    it("should return -1 if / is not preceded by space", () => {
      expect(getSlashSelectorPosition("dir/file", 5)).toBe(-1);
    });
  });

  describe("getWordEnd", () => {
    it("should find end of word before space", () => {
      expect(getWordEnd("hello world", 0)).toBe(5);
    });

    it("should return length of string if no space", () => {
      expect(getWordEnd("hello", 0)).toBe(5);
    });
  });

  describe("getProjectedState", () => {
    it("should project new text and cursor position correctly", () => {
      const { newInputText, newCursorPosition } = getProjectedState(
        "hello ",
        6,
        "@",
      );
      expect(newInputText).toBe("hello @");
      expect(newCursorPosition).toBe(7);
    });

    it("should handle insertion in middle of text", () => {
      const { newInputText, newCursorPosition } = getProjectedState(
        "he world",
        2,
        "llo",
      );
      expect(newInputText).toBe("hello world");
      expect(newCursorPosition).toBe(5);
    });
  });

  describe("SELECTOR_TRIGGERS", () => {
    it("should identify @ trigger", () => {
      const trigger = SELECTOR_TRIGGERS.find((t) => t.char === "@");
      expect(trigger).toBeDefined();
      expect(trigger?.shouldActivate("@", 1, "@")).toBe(true);
      expect(trigger?.shouldActivate("@", 6, "read @")).toBe(true);
      expect(trigger?.shouldActivate("@", 6, "email@")).toBe(false);
    });

    it("should identify / trigger", () => {
      const trigger = SELECTOR_TRIGGERS.find((t) => t.char === "/");
      expect(trigger).toBeDefined();
      expect(trigger?.shouldActivate("/", 1, "/", false)).toBe(true);
      expect(trigger?.shouldActivate("/", 5, "run /", false)).toBe(true);
      // Should not activate if file selector is already showing
      expect(trigger?.shouldActivate("/", 5, "run /", true)).toBe(false);
    });
  });
});
