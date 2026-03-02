import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "../src/agent.js";
import * as fs from "fs/promises";

vi.mock("fs/promises");
vi.mock("./services/session.js");

describe("Default Allowed Git Rules", () => {
  const workdir = "/test/workdir";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.readFile).mockResolvedValue("");
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
  });

  it("should allow read-only git commands by default", async () => {
    const agent = await Agent.create({
      workdir,
      permissionMode: "default",
    });

    const gitCommands = [
      "git status",
      "git diff",
      "git log",
      "git show",
      "git branch",
      "git tag",
      "git remote",
      "git ls-files",
      "git rev-parse",
      "git config --list",
      "git config -l",
      "git cat-file -p HEAD",
      "git count-objects",
    ];

    for (const command of gitCommands) {
      const decision = await agent.checkPermission({
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command, workdir },
      });
      expect(decision.behavior).toBe("allow");
    }
  });

  it("should NOT allow destructive git commands by default", async () => {
    const agent = await Agent.create({
      workdir,
      permissionMode: "default",
    });

    const destructiveGitCommands = [
      "git reset --hard",
      "git clean -fd",
      "git commit -m 'test'",
      "git push",
      "git pull",
      "git checkout main",
    ];

    for (const command of destructiveGitCommands) {
      const decision = await agent.checkPermission({
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command, workdir },
      });
      expect(decision.behavior).toBe("deny");
    }
  });

  it("should allow safe commands by default", async () => {
    const agent = await Agent.create({
      workdir,
      permissionMode: "default",
    });

    const safeCommands = [
      "echo hello",
      "which node",
      "type ls",
      "hostname",
      "whoami",
      "date",
      "uptime",
    ];

    for (const command of safeCommands) {
      const decision = await agent.checkPermission({
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command, workdir },
      });
      expect(decision.behavior).toBe("allow");
    }
  });
});
