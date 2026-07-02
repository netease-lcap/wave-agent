import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "../src/agent.js";
import * as fs from "fs/promises";

vi.mock("fs/promises");
vi.mock("./services/session.js");

describe("Agent hooks option", () => {
  const workdir = "/test/workdir";
  let activeAgent: Agent | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.readFile).mockResolvedValue("");
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    if (activeAgent) {
      await activeAgent.destroy();
      activeAgent = undefined;
    }
  });

  it("should load hooks from AgentOptions into HookManager", async () => {
    const hooks = {
      Stop: [
        {
          hooks: [{ type: "command" as const, command: "echo done" }],
        },
      ],
    };

    const agent = await Agent.create({
      workdir,
      permissionMode: "default",
      hooks,
    });
    activeAgent = agent;

    const hookManager = agent["hookManager"];
    expect(hookManager.hasHooks("Stop")).toBe(true);
    expect(hookManager.getConfiguration()).toEqual(hooks);
  });

  it("should not error when hooks option is not provided", async () => {
    const agent = await Agent.create({
      workdir,
      permissionMode: "default",
    });
    activeAgent = agent;

    const hookManager = agent["hookManager"];
    expect(hookManager.hasHooks("Stop")).toBe(false);
  });
});
