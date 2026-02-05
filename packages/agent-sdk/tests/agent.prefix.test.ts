import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "../src/agent.js";
import * as fs from "fs/promises";

vi.mock("fs/promises");
vi.mock("./services/session.js");

describe("Agent Prefix Matching Integration", () => {
  const workdir = "/test/workdir";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.readFile).mockResolvedValue("");
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
  });

  it("should automatically save and use prefix rules for smart commands", async () => {
    const agent = await Agent.create({
      workdir,
      permissionMode: "default",
    });

    // 1. Simulate trusting a command that has a smart prefix
    // In a real scenario, this comes from the Confirmation component decision
    await agent.addPermissionRule("Bash(npm install lodash)");

    // 2. Verify it was saved as a prefix rule
    const rules = agent.getAllowedRules();
    expect(rules).toContain("Bash(npm install*)");

    // 3. Verify a similar command is allowed
    const decision = await agent.checkPermission({
      toolName: "Bash",
      permissionMode: "default",
      toolInput: { command: "npm install express", workdir },
    });

    expect(decision.behavior).toBe("allow");
  });

  it("should NOT save blacklisted commands as persistent rules", async () => {
    const agent = await Agent.create({
      workdir,
      permissionMode: "default",
    });

    // 1. Simulate trusting a blacklisted command
    await agent.addPermissionRule("Bash(rm file.txt)");

    // 2. Verify it was NOT saved at all
    const rules = agent.getAllowedRules();
    expect(rules).not.toContain("Bash(rm file.txt)");
    expect(rules).not.toContain("Bash(rm*)");
  });
});
