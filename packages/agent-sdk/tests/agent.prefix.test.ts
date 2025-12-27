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
    // @ts-expect-error - accessing private method for testing
    await agent.addPermissionRule("Bash(npm install lodash)");

    // 2. Verify it was saved as a prefix rule
    // @ts-expect-error - accessing private property for testing
    const rules = agent.permissionManager.getAllowedRules();
    expect(rules).toContain("Bash(npm install:*)");

    // 3. Verify a similar command is allowed
    // @ts-expect-error - accessing private property for testing
    const decision = await agent.permissionManager.checkPermission({
      toolName: "Bash",
      permissionMode: "default",
      toolInput: { command: "npm install express", workdir },
    });

    expect(decision.behavior).toBe("allow");
  });

  it("should NOT use prefix rules for blacklisted commands", async () => {
    const agent = await Agent.create({
      workdir,
      permissionMode: "default",
    });

    // 1. Simulate trusting a blacklisted command
    // @ts-expect-error - accessing private method for testing
    await agent.addPermissionRule("Bash(rm file.txt)");

    // 2. Verify it was saved as an EXACT rule, not a prefix rule
    // @ts-expect-error - accessing private property for testing
    const rules = agent.permissionManager.getAllowedRules();
    expect(rules).toContain("Bash(rm file.txt)");
    expect(rules).not.toContain("Bash(rm:*)");

    // 3. Verify a different rm command is NOT allowed
    // @ts-expect-error - accessing private property for testing
    const decision = await agent.permissionManager.checkPermission({
      toolName: "Bash",
      permissionMode: "default",
      toolInput: { command: "rm other.txt", workdir },
    });

    expect(decision.behavior).toBe("deny");
  });
});
