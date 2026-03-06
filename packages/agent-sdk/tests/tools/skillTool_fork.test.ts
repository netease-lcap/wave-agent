import { describe, it, expect, vi, beforeEach } from "vitest";
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
vi.mock("path", () => ({
  join: vi.fn((...args) => args.join("/")),
}));

// Mock skill parser
vi.mock("../../src/utils/skillParser.js", () => ({
  parseSkillFile: vi.fn(),
  formatSkillError: vi.fn(),
}));

import { readdir } from "fs/promises";

const mockReaddir = vi.mocked(readdir);

describe("skillTool fork", () => {
  let skillManager: SkillManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockReaddir.mockResolvedValue([]);
    const container = new Container();
    skillManager = new SkillManager(container, {
      workdir: "/test/workdir",
    });
  });

  it("should format compact params without fork info", async () => {
    await skillManager.initialize();
    vi.spyOn(skillManager, "getSkillMetadata").mockReturnValue({
      name: "fork-skill",
      description: "A forked skill",
      type: "personal",
      skillPath: "/path/to/skill",
      context: "fork",
      agent: "general-purpose",
    });

    const context = {
      workdir: "/test",
      taskManager: new TaskManager(new Container(), "test-session"),
      skillManager,
    };

    const params = { skill_name: "fork-skill" };
    const formatted = skillTool.formatCompactParams?.(
      params,
      context as unknown as ToolContext,
    );

    expect(formatted).toBe("fork-skill");
  });

  it("should format compact params with default agent for fork", async () => {
    await skillManager.initialize();
    vi.spyOn(skillManager, "getSkillMetadata").mockReturnValue({
      name: "fork-skill",
      description: "A forked skill",
      type: "personal",
      skillPath: "/path/to/skill",
      context: "fork",
    });

    const context = {
      workdir: "/test",
      taskManager: new TaskManager(new Container(), "test-session"),
      skillManager,
    };

    const params = { skill_name: "fork-skill" };
    const formatted = skillTool.formatCompactParams?.(
      params,
      context as unknown as ToolContext,
    );

    expect(formatted).toBe("fork-skill");
  });

  it("should not include fork info in prompt", async () => {
    const mockSkills = [
      {
        name: "fork-skill",
        type: "personal" as const,
        description: "A forked skill",
        skillPath: "/path/to/skill",
        context: "fork" as const,
        agent: "general-purpose",
      },
    ];

    const prompt = skillTool.prompt?.({ availableSkills: mockSkills });

    expect(prompt).toContain("fork-skill");
    expect(prompt).not.toContain("[fork: general-purpose]");
  });

  it("should execute skill in fork context", async () => {
    await skillManager.initialize();

    const skillMetadata = {
      name: "fork-skill",
      description: "A forked skill",
      type: "personal" as const,
      skillPath: "/path/to/skill",
      context: "fork" as const,
      agent: "general-purpose",
    };

    vi.spyOn(skillManager, "getSkillMetadata").mockReturnValue(skillMetadata);
    vi.spyOn(skillManager, "executeSkill").mockResolvedValue({
      content: "Skill content to execute",
      context: { skillName: "fork-skill" },
    });

    const mockSubagentInstance = {
      subagentId: "subagent-123",
      messageManager: {
        getMessages: vi.fn().mockReturnValue([]),
        getlatestTotalTokens: vi.fn().mockReturnValue(100),
      },
      lastTools: [],
    };

    const mockSubagentManager = {
      findSubagent: vi.fn().mockResolvedValue({ name: "general-purpose" }),
      createInstance: vi.fn().mockResolvedValue(mockSubagentInstance),
      executeAgent: vi.fn().mockResolvedValue("Subagent execution result"),
      cleanupInstance: vi.fn(),
    };

    const context = {
      workdir: "/test",
      taskManager: new TaskManager(new Container(), "test-session"),
      skillManager,
      subagentManager: mockSubagentManager,
      onShortResultUpdate: vi.fn(),
    };

    const result = await skillTool.execute(
      { skill_name: "fork-skill" },
      context as unknown as ToolContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toBe("Subagent execution result");
    expect(result.shortResult).toContain("Invoked skill: fork-skill");
    expect(result.shortResult).not.toContain("(forked to general-purpose)");
    expect(mockSubagentManager.findSubagent).toHaveBeenCalledWith(
      "general-purpose",
    );
    expect(mockSubagentManager.createInstance).toHaveBeenCalled();
    expect(mockSubagentManager.executeAgent).toHaveBeenCalledWith(
      mockSubagentInstance,
      "Skill content to execute",
      undefined,
      false,
    );
    expect(mockSubagentManager.cleanupInstance).toHaveBeenCalledWith(
      "subagent-123",
    );
  });

  it("should handle missing subagent manager in fork context", async () => {
    await skillManager.initialize();

    vi.spyOn(skillManager, "getSkillMetadata").mockReturnValue({
      name: "fork-skill",
      description: "A forked skill",
      type: "personal",
      skillPath: "/path/to/skill",
      context: "fork",
    });

    const context = {
      workdir: "/test",
      taskManager: new TaskManager(new Container(), "test-session"),
      skillManager,
      // subagentManager is missing
    };

    const result = await skillTool.execute(
      { skill_name: "fork-skill" },
      context as unknown as ToolContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("Subagent manager not available in tool context");
  });

  it("should handle missing subagent configuration", async () => {
    await skillManager.initialize();

    vi.spyOn(skillManager, "getSkillMetadata").mockReturnValue({
      name: "fork-skill",
      description: "A forked skill",
      type: "personal",
      skillPath: "/path/to/skill",
      context: "fork",
      agent: "non-existent-agent",
    });

    const mockSubagentManager = {
      findSubagent: vi.fn().mockResolvedValue(null),
    };

    const context = {
      workdir: "/test",
      taskManager: new TaskManager(new Container(), "test-session"),
      skillManager,
      subagentManager: mockSubagentManager,
    };

    const result = await skillTool.execute(
      { skill_name: "fork-skill" },
      context as unknown as ToolContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain(
      'No subagent found matching "non-existent-agent"',
    );
  });
});
