import { describe, it, expect } from "vitest";
import { INIT_PROMPT } from "../../src/prompts/index.js";

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
    expect(INIT_PROMPT).toContain("High-level code architecture and structure");
  });

  it("should mention Cursor and Copilot rules", () => {
    expect(INIT_PROMPT).toContain(".cursor/rules/");
    expect(INIT_PROMPT).toContain(".cursorrules");
    expect(INIT_PROMPT).toContain(".github/copilot-instructions.md");
  });
});
