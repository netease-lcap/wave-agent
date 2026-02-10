import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "../../src/agent.js";
import { SkillManager } from "../../src/managers/skillManager.js";
import * as fs from "fs/promises";

vi.mock("fs/promises");
vi.mock("../../src/managers/aiManager.js");
vi.mock("../../src/managers/mcpManager.js");
vi.mock("../../src/managers/skillManager.js");
vi.mock("../../src/services/session.js");

describe("Agent Foreground Task Management", () => {
  const workdir = "/test/workdir";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.readFile).mockResolvedValue("");
    vi.mocked(SkillManager.prototype.getAvailableSkills).mockReturnValue([]);
  });

  it("should register and unregister foreground tasks via Agent", async () => {
    const agent = await Agent.create({ workdir });
    const backgroundHandler = vi.fn().mockResolvedValue(undefined);

    agent.registerForegroundTask({
      id: "test-task",
      backgroundHandler,
    });

    // We can't easily access the private foregroundTaskManager,
    // but we can test the backgroundCurrentTask method
    await agent.backgroundCurrentTask();
    expect(backgroundHandler).toHaveBeenCalledTimes(1);
  });

  it("should call onBackgroundCurrentTask callback", async () => {
    const onBackgroundCurrentTask = vi.fn();
    const agent = await Agent.create({
      workdir,
      callbacks: { onBackgroundCurrentTask },
    });

    agent.registerForegroundTask({
      id: "test-task",
      backgroundHandler: vi.fn().mockResolvedValue(undefined),
    });

    await agent.backgroundCurrentTask();
    expect(onBackgroundCurrentTask).toHaveBeenCalledTimes(1);
  });
});
