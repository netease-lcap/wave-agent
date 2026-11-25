/**
 * Worktree write guard for sessions that never *declared* a worktree.
 *
 * A session the daemon starts with `createWorktree` + `initialize`, one
 * re-attached from disk after a restart, and one a host merely re-opened at a
 * worktree path all arrive with nothing but a `workdir` — no `worktreeName`,
 * no `WorktreeSession`. They used to run with every input the guard reads
 * empty, so Write/Edit into the main repo went through (issue #3073). Only the
 * CLI's `-w` and `EnterWorktree` paths — the two that seed the state
 * themselves — were protected.
 *
 * Spec: docs/specs/multi-agent/worktree.md「bypassPermissions 模式下 Worktree
 * 安全拦截仍生效」.
 */

import {
  describe,
  it,
  expect,
  vi,
  afterEach,
  afterAll,
  beforeAll,
} from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";

import { Agent } from "@/agent.js";
import { createWorktree, removeWorktree } from "@/utils/worktreeUtils.js";
import type { WorktreeInfo } from "@/utils/worktreeUtils.js";
import type { Container } from "@/utils/container.js";
import type { ModManager } from "@/managers/modManager.js";
import type { ModToolCheckEvent } from "@/types/mods.js";

// Agent.create() must not reach the network or OTEL.
vi.mock("@/services/aiService");
vi.mock("@/telemetry/instrumentation.js", () => ({
  initializeTelemetry: vi.fn().mockResolvedValue(undefined),
  flushTelemetry: vi.fn().mockResolvedValue(undefined),
  getCurrentConfig: vi.fn().mockReturnValue(undefined),
  isInitialized: vi.fn().mockReturnValue(false),
}));
vi.mock("@/telemetry/events.js", () => ({
  logOTelEvent: vi.fn().mockResolvedValue(undefined),
  logRequestContentEvents: vi.fn().mockResolvedValue(undefined),
  resetContentEventState: vi.fn(),
}));

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

describe("worktree write scope without a declared worktree", () => {
  let repoRoot: string;
  let worktree: WorktreeInfo;
  const agents: Agent[] = [];

  beforeAll(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wave-wt-scope-"));
    git(repoRoot, ["init", "-b", "main", "-q"]);
    git(repoRoot, ["config", "user.name", "Wave Test"]);
    git(repoRoot, ["config", "user.email", "wave-test@example.com"]);
    fs.writeFileSync(path.join(repoRoot, "file.txt"), "v1\n");
    git(repoRoot, ["add", "."]);
    git(repoRoot, ["commit", "-m", "init", "-q"]);
    worktree = createWorktree("scope-check", repoRoot, { baseRef: "head" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    for (const agent of agents) {
      await agent.destroy();
    }
    agents.length = 0;
    await removeWorktree(worktree);
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  /**
   * Create a session the way a stdio host does for a worktree it already made
   * (the daemon's `create --worktree`, a restore, a re-opened conversation):
   * a workdir inside the worktree and no other worktree input at all.
   */
  async function openSessionAt(dir: string): Promise<Agent> {
    const agent = await Agent.create({
      apiKey: "test-key",
      workdir: dir,
      permissionMode: "bypassPermissions",
    });
    agents.push(agent);
    return agent;
  }

  /**
   * The guard's short code (`reason: "worktree-scope"`) is not part of
   * `PermissionDecision` — it reaches plugins through the `tool.check`
   * second decision source, so that is where it is observed.
   */
  function capturedToolChecks(agent: Agent): ModToolCheckEvent[] {
    const container = (agent as unknown as { container: Container }).container;
    const modManager = container.get<ModManager>("ModManager");
    expect(modManager).toBeDefined();
    const events: ModToolCheckEvent[] = [];
    vi.spyOn(modManager as ModManager, "dispatchToolCheck").mockImplementation(
      async (event) => {
        events.push(event);
        return {
          decision: event.decision,
          ...(event.reason === undefined ? {} : { reason: event.reason }),
        };
      },
    );
    return events;
  }

  it("denies a Write into the main repo and reports the worktree-scope reason", async () => {
    const agent = await openSessionAt(worktree.path);
    const toolChecks = capturedToolChecks(agent);

    const decision = await agent.checkPermission({
      toolName: "Write",
      permissionMode: "bypassPermissions",
      toolInput: { file_path: path.join(repoRoot, "main-file.txt") },
    });

    expect(decision.behavior).toBe("deny");
    expect(decision.message).toContain(
      "Access denied: You are currently in a worktree session",
    );
    expect(decision.message).toContain(worktree.path);
    expect(toolChecks).toHaveLength(1);
    expect(toolChecks[0].decision).toBe("deny");
    expect(toolChecks[0].reason).toBe("worktree-scope");
  });

  it("denies an Edit into the main repo", async () => {
    const agent = await openSessionAt(worktree.path);

    const decision = await agent.checkPermission({
      toolName: "Edit",
      permissionMode: "bypassPermissions",
      toolInput: { file_path: path.join(repoRoot, "file.txt") },
    });

    expect(decision.behavior).toBe("deny");
    expect(decision.message).toContain(
      "Access denied: You are currently in a worktree session",
    );
  });

  it("still allows a Write inside the worktree", async () => {
    const agent = await openSessionAt(worktree.path);

    const decision = await agent.checkPermission({
      toolName: "Write",
      permissionMode: "bypassPermissions",
      toolInput: { file_path: path.join(worktree.path, "inside.txt") },
    });

    expect(decision.behavior).toBe("allow");
  });

  it("leaves a session opened in the main repo alone", async () => {
    const agent = await openSessionAt(repoRoot);

    const decision = await agent.checkPermission({
      toolName: "Write",
      permissionMode: "bypassPermissions",
      toolInput: { file_path: path.join(repoRoot, "main-file.txt") },
    });

    expect(decision.behavior).toBe("allow");
  });
});
