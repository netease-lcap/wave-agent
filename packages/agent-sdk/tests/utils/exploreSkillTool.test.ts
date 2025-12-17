import { describe, it, expect, beforeEach } from "vitest";
import { getBuiltinSubagents } from "../../src/utils/builtinSubagents.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";

describe("Explore Subagent Skill Tool Support", () => {
  let exploreConfig: SubagentConfiguration | undefined;

  beforeEach(() => {
    const builtins = getBuiltinSubagents();
    exploreConfig = builtins.find((s) => s.name === "Explore");
  });

  it("should have skill tool in Explore subagent tools list", () => {
    expect(exploreConfig).toBeDefined();
    expect(exploreConfig?.tools).toBeDefined();
    expect(exploreConfig?.tools).toContain("skill");
  });

  it("should have all expected read-only tools", () => {
    const expectedTools = ["Glob", "Grep", "Read", "Bash", "LS", "skill"];

    expect(exploreConfig?.tools).toBeDefined();

    // Check all expected tools are present
    expectedTools.forEach((tool) => {
      expect(exploreConfig?.tools).toContain(tool);
    });

    // Check no write tools are present
    const writeTools = ["Write", "Edit", "MultiEdit", "DeleteFile"];
    writeTools.forEach((tool) => {
      expect(exploreConfig?.tools).not.toContain(tool);
    });
  });

  it("should have fastModel configuration", () => {
    expect(exploreConfig?.model).toBe("fastModel");
  });

  it("should have proper virtual filePath", () => {
    expect(exploreConfig?.filePath).toBe("<builtin:Explore>");
  });

  it("should have builtin scope and lowest priority", () => {
    expect(exploreConfig?.scope).toBe("builtin");
    expect(exploreConfig?.priority).toBe(3);
  });
});
