import { describe, it, expect } from "vitest";
import {
  INIT_PROMPT,
  buildSystemPrompt,
  buildPlanModePrompt,
} from "../../src/constants/prompts.js";
import { ENTER_PLAN_MODE_TOOL_NAME } from "../../src/constants/tools.js";

describe("prompts", () => {
  describe("INIT_PROMPT", () => {
    it("should contain the mandatory AGENTS.md prefix", () => {
      expect(INIT_PROMPT).toContain("# AGENTS.md");
      expect(INIT_PROMPT).toContain(
        "This file provides guidance to Agent when working with code in this repository.",
      );
    });

    it("should instruct to analyze build, lint, and test commands", () => {
      expect(INIT_PROMPT).toContain("how to build, lint, and run tests");
    });

    it("should instruct to analyze high-level architecture", () => {
      expect(INIT_PROMPT).toContain(
        "High-level code architecture and structure",
      );
    });

    it("should mention Cursor and Copilot rules", () => {
      expect(INIT_PROMPT).toContain(".cursor/rules/");
      expect(INIT_PROMPT).toContain(".cursorrules");
      expect(INIT_PROMPT).toContain(".github/copilot-instructions.md");
    });
  });

  describe("buildSystemPrompt", () => {
    it("should include PLANNING_POLICY when EnterPlanMode tool is available", () => {
      const prompt = buildSystemPrompt("Base", [
        { name: ENTER_PLAN_MODE_TOOL_NAME },
      ]);
      expect(prompt).toContain("# Planning Guidelines");
      expect(prompt).toContain("Prefer using EnterPlanMode");
    });

    it("should not include PLANNING_POLICY when EnterPlanMode tool is not available", () => {
      const prompt = buildSystemPrompt("Base", [{ name: "OtherTool" }]);
      expect(prompt).not.toContain("# Planning Guidelines");
    });
  });

  describe("buildPlanModePrompt", () => {
    it("should include plan file path when planExists is true", () => {
      const prompt = buildPlanModePrompt("/path/to/plan.md", true);
      expect(prompt).toContain("/path/to/plan.md");
      expect(prompt).toContain("A plan file already exists");
    });

    it("should include plan file path when planExists is false", () => {
      const prompt = buildPlanModePrompt("/path/to/plan.md", false);
      expect(prompt).toContain("/path/to/plan.md");
      expect(prompt).toContain("No plan file exists yet");
    });
  });
});
