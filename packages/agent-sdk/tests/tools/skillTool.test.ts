import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Stats } from "fs";
import { TaskManager } from "../../src/services/taskManager.js";
import { SkillManager } from "../../src/managers/skillManager.js";
import { skillTool } from "../../src/tools/skillTool.js";
import { Container } from "../../src/utils/container.js";
import type { ToolContext } from "../../src/tools/types.js";

// Mock fs/promises
vi.mock("fs/promises", () => ({
  readdir: vi.fn(),
  stat: vi.fn(),
}));

// Mock os module
vi.mock("os", () => ({
  homedir: vi.fn(() => "/mock/home"),
}));

// Mock path module
vi.mock("path", async () => {
  const actual = await vi.importActual<typeof import("path")>("path");
  return {
    ...actual,
    join: vi.fn((...args) => args.join("/")),
  };
});

// Mock skill parser
vi.mock("../../src/utils/skillParser.js", () => ({
  parseSkillFile: vi.fn(),
  formatSkillError: vi.fn(),
}));

import { readdir, stat } from "fs/promises";

const mockReaddir = vi.mocked(readdir);
const mockStat = vi.mocked(stat);

describe("skillTool", () => {
  let skillManager: SkillManager;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock empty directory by default (no skills found)
    mockReaddir.mockResolvedValue([]);
    mockStat.mockResolvedValue({
      isDirectory: () => false,
      isFile: () => true,
    } as Stats);

    const container = new Container();

    skillManager = new SkillManager(container, {
      workdir: "/test/workdir",
    });
  });

  it("should have correct structure", async () => {
    expect(skillTool.name).toBe("Skill");
    expect(skillTool.config).toBeDefined();
    expect(skillTool.config.type).toBe("function");
    expect(skillTool.config.function.name).toBe("Skill");
    expect(typeof skillTool.execute).toBe("function");
    expect(typeof skillTool.formatCompactParams).toBe("function");
  });

  it("should format compact params correctly", async () => {
    const context = {
      workdir: "/test",
      taskManager: new TaskManager(new Container(), "test-session"),
    };

    const params = { skill_name: "test-skill" };
    const formatted = skillTool.formatCompactParams?.(params, context);

    expect(formatted).toBe("test-skill");
  });

  it("should handle missing skill_name parameter in formatCompactParams", async () => {
    const context = {
      workdir: "/test",
      taskManager: new TaskManager(new Container(), "test-session"),
    };

    const params = {};
    const formatted = skillTool.formatCompactParams?.(params, context);

    expect(formatted).toBe("unknown-skill");
  });

  it("should validate skill_name parameter", async () => {
    const context = {
      workdir: "/test",
      taskManager: new TaskManager(new Container(), "test-session"),
      skillManager,
    };

    const result = await skillTool.execute({}, context);

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "skill_name parameter is required and must be a string",
    );
  });

  it("should handle skill execution successfully", async () => {
    await skillManager.initialize();

    // Mock executeSkill to return success
    vi.spyOn(skillManager, "executeSkill").mockResolvedValue({
      content: "Test result",
      context: { skillName: "test-skill" },
    });

    const context = {
      workdir: "/test",
      taskManager: new TaskManager(new Container(), "test-session"),
      skillManager,
    };

    const result = await skillTool.execute(
      { skill_name: "test-skill" },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).toBe("Test result");
    expect(result.shortResult).toBe("Invoked skill: test-skill");
  });

  it("should add temporary rules if allowedTools are present", async () => {
    await skillManager.initialize();

    // Mock executeSkill to return success with allowedTools
    vi.spyOn(skillManager, "executeSkill").mockResolvedValue({
      content: "Test result",
      context: { skillName: "test-skill" },
      allowedTools: ["tool1", "tool2"],
    });

    const mockPermissionManager = {
      addTemporaryRules: vi.fn(),
    };

    const context = {
      workdir: "/test",
      taskManager: new TaskManager(new Container(), "test-session"),
      skillManager,
      permissionManager: mockPermissionManager,
    };

    const result = await skillTool.execute(
      { skill_name: "test-skill" },
      context as unknown as ToolContext,
    );

    expect(result.success).toBe(true);
    expect(mockPermissionManager.addTemporaryRules).toHaveBeenCalledWith([
      "tool1",
      "tool2",
    ]);
  });

  it("should handle skill execution errors", async () => {
    await skillManager.initialize();

    // Mock executeSkill to throw an error
    vi.spyOn(skillManager, "executeSkill").mockRejectedValue(
      new Error("Test error"),
    );

    const context = {
      workdir: "/test",
      taskManager: new TaskManager(new Container(), "test-session"),
      skillManager,
    };

    const result = await skillTool.execute({ skill_name: "test" }, context);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Test error");
  });

  it("should provide dynamic prompt with available skills", async () => {
    // Mock some skills for the prompt
    const mockSkills = [
      {
        name: "test-skill",
        type: "personal" as const,
        description: "Test skill",
        skillPath: "/path/to/test",
      },
      {
        name: "another-skill",
        type: "project" as const,
        description: "Another skill",
        skillPath: "/path/to/another",
      },
    ];

    const prompt = skillTool.prompt?.({ availableSkills: mockSkills });

    expect(prompt).toContain("Available skills:");
    expect(prompt).toContain("test-skill");
    expect(prompt).toContain("another-skill");
    expect(prompt).toContain(
      "Do not invoke the same skill repeatedly if it has already been called with the same arguments.",
    );
  });

  it("should handle empty skills list in prompt", async () => {
    const prompt = skillTool.prompt?.({ availableSkills: [] });

    expect(prompt).toContain("No skills are currently available");
    expect(prompt).toContain(
      "Execute a skill within the main conversation. When users ask you to perform tasks, check if any of the available skills match. Skills provide specialized capabilities and domain knowledge.",
    );
  });
});
