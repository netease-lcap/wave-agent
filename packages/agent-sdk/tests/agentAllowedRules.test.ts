import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "../src/agent.js";
import * as fs from "fs/promises";

vi.mock("fs/promises");
vi.mock("./services/session.js");

describe("Agent Allowed Rules", () => {
  const workdir = "/test/workdir";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.readFile).mockResolvedValue("");
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
  });

  it("should return both user and default rules in getAllowedRules", async () => {
    const agent = await Agent.create({
      workdir,
      permissionMode: "default",
    });

    await agent.addPermissionRule("Bash(npm install lodash)");

    const rules = agent.getAllowedRules();
    expect(rules).toContain("Bash(npm install*)");
    expect(rules).toContain("Bash(git status*)");
  });

  it("should return only user rules in getUserAllowedRules", async () => {
    const agent = await Agent.create({
      workdir,
      permissionMode: "default",
    });

    await agent.addPermissionRule("Bash(npm install lodash)");

    const rules = agent.getUserAllowedRules();
    expect(rules).toContain("Bash(npm install*)");
    expect(rules).not.toContain("Bash(git status*)");
  });

  it("should NOT add a rule if it's already in default rules", async () => {
    const agent = await Agent.create({
      workdir,
      permissionMode: "default",
    });

    await agent.addPermissionRule("Bash(git status)");

    const userRules = agent.getUserAllowedRules();
    expect(userRules).not.toContain("Bash(git status*)");
    expect(userRules).not.toContain("Bash(git status)");
  });
});
