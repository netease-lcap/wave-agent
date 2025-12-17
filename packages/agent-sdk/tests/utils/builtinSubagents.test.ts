import { describe, it, expect } from "vitest";
import { getBuiltinSubagents } from "../../src/utils/builtinSubagents.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";

describe("Built-in Subagents", () => {
  describe("getBuiltinSubagents", () => {
    it("should return array of built-in subagent configurations", () => {
      const builtins = getBuiltinSubagents();

      expect(Array.isArray(builtins)).toBe(true);
      expect(builtins.length).toBeGreaterThan(0);
    });

    it("should include Explore subagent", () => {
      const builtins = getBuiltinSubagents();
      const explore = builtins.find((s) => s.name === "Explore");

      expect(explore).toBeDefined();
      expect(explore?.name).toBe("Explore");
      expect(explore?.scope).toBe("builtin");
      expect(explore?.priority).toBe(3);
    });

    it("should have valid SubagentConfiguration structure", () => {
      const builtins = getBuiltinSubagents();

      builtins.forEach((config: SubagentConfiguration) => {
        // Required fields
        expect(typeof config.name).toBe("string");
        expect(config.name.length).toBeGreaterThan(0);

        expect(typeof config.description).toBe("string");
        expect(config.description.length).toBeGreaterThan(0);

        expect(typeof config.systemPrompt).toBe("string");
        expect(config.systemPrompt.length).toBeGreaterThan(0);

        expect(typeof config.filePath).toBe("string");
        expect(config.filePath.startsWith("<builtin:")).toBe(true);

        expect(config.scope).toBe("builtin");
        expect(config.priority).toBe(3);

        // Optional fields
        if (config.tools) {
          expect(Array.isArray(config.tools)).toBe(true);
        }

        if (config.model) {
          expect(typeof config.model).toBe("string");
        }
      });
    });

    it("should have proper virtual filePath format", () => {
      const builtins = getBuiltinSubagents();

      builtins.forEach((config) => {
        expect(config.filePath).toBe(`<builtin:${config.name}>`);
      });
    });

    it("should have fastModel for Explore agent", () => {
      const builtins = getBuiltinSubagents();
      const explore = builtins.find((s) => s.name === "Explore");

      expect(explore?.model).toBe("fastModel");
    });

    it("should have appropriate tools for Explore agent", () => {
      const builtins = getBuiltinSubagents();
      const explore = builtins.find((s) => s.name === "Explore");

      expect(explore?.tools).toContain("Glob");
      expect(explore?.tools).toContain("Grep");
      expect(explore?.tools).toContain("Read");
      expect(explore?.tools).toContain("Bash");
      expect(explore?.tools).toContain("LS");
      expect(explore?.tools).toContain("skill");
      expect(explore?.tools).not.toContain("Write");
      expect(explore?.tools).not.toContain("Edit");
    });
  });
});
