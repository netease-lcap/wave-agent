/**
 * Real-process tests for the "the shell exited, its group did not" path.
 *
 * Every case here spawns a real shell through the real `bashTool` (or a real
 * `Agent`) and inspects real PIDs — nothing is mocked, because "is this orphan
 * still alive?" only has an answer from the OS.
 *
 * Spec: docs/specs/core/bash-tools.md「shell 退出后留下的进程组」.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { bashTool } from "../../src/tools/bashTool.js";
import type { ToolContext } from "../../src/tools/types.js";
import { createMockTaskManager } from "../helpers/mockFactories.js";
import {
  ShellProcessReaper,
  type LeftoverProcessGroup,
} from "../../src/managers/shellProcessReaper.js";
import { isProcessGroupAlive } from "../../src/utils/processGroupProbe.js";

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

const isWindows = process.platform === "win32";
const isLinux = process.platform === "linux";

/** A real, empty directory. `mkdtemp` is banned in tests (.wave/rules/testing.md). */
function makeWorkdir(): string {
  const dir = path.join(
    os.tmpdir(),
    `wave-reaper-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Delete a workdir that a real shell just used as its cwd.
 *
 * On Windows the directory keeps a handle open for a moment after the process
 * that lived in it goes away, and `rmdir` answers `EBUSY` while it lasts — the
 * `check-windows` job failed on exactly that, intermittently (4 of 6 runs since
 * #3036), which is what makes it a *short* window rather than a live process
 * holding the directory: a leftover `sleep 60` whose cwd is the workdir does
 * not block the delete (verified on Windows here, and by the runs that passed).
 *
 * `maxRetries` / `retryDelay` are Node's own answer to `EBUSY` (it retries the
 * recursive delete with a linear backoff): ~1.5 s worst case, well inside the
 * hook timeout. Not a sleep masking the error — a clean run never waits at all.
 */
function removeWorkdir(dir: string): void {
  fs.rmSync(dir, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}

function makeContext(
  workdir: string,
  reaper?: ShellProcessReaper,
): ToolContext {
  // Only what the foreground path touches: no permission manager, so the
  // command spawns instead of asking.
  return {
    workdir,
    taskManager: createMockTaskManager(),
    shellProcessReaper: reaper,
    toolCallId: "call_reaper_test",
  };
}

async function waitForGroupGone(pgid: number): Promise<void> {
  await vi.waitFor(
    () => {
      expect(isProcessGroupAlive(pgid)).toBe(false);
    },
    { timeout: 3000 },
  );
}

/** Kill whatever the test left behind, so a failure cannot leak a `sleep`. */
function killGroupQuietly(pgid: number | undefined): void {
  if (pgid === undefined) return;
  try {
    process.kill(-pgid, "SIGKILL");
  } catch {
    // already gone
  }
}

describe("ShellProcessReaper with real shells", () => {
  const workdirs: string[] = [];
  const recorded: ShellProcessReaper[] = [];

  function workdir(): string {
    const dir = makeWorkdir();
    workdirs.push(dir);
    return dir;
  }

  function reaper(): ShellProcessReaper {
    const instance = new ShellProcessReaper();
    recorded.push(instance);
    return instance;
  }

  afterEach(() => {
    for (const instance of recorded) {
      for (const entry of instance.getRecordedGroups()) {
        killGroupQuietly(entry.pgid);
      }
      instance.dispose();
    }
    recorded.length = 0;
    for (const dir of workdirs) removeWorkdir(dir);
    workdirs.length = 0;
  });

  // Scenario 1: the shell exits, its leftovers *keep running* — recording must
  // never turn into killing; `nohup npm run dev &` is a legitimate command.
  it.skipIf(isWindows)(
    "records the group a foreground command left behind and keeps it alive",
    async () => {
      const instance = reaper();
      const result = await bashTool.execute(
        { command: "nohup sleep 60 >/dev/null 2>&1 & echo started" },
        makeContext(workdir(), instance),
      );
      expect(result.success).toBe(true);
      expect(result.content).toContain("started");

      const groups = instance.getRecordedGroups();
      expect(groups).toHaveLength(1);
      const entry = groups[0] as LeftoverProcessGroup;
      expect(entry.pgid).toBeGreaterThan(1);
      expect(entry.originId).toBe("call_reaper_test");
      expect(entry.command).toContain("nohup sleep 60");

      // Not killed on the spot: "alive for the whole session" is the contract.
      expect(isProcessGroupAlive(entry.pgid)).toBe(true);
    },
  );

  // Scenario 2: destroy() is where they die — SIGTERM, grace, SIGKILL.
  it.skipIf(isWindows)("reaps a recorded group on destroy", async () => {
    const instance = reaper();
    await bashTool.execute(
      { command: "nohup sleep 62 >/dev/null 2>&1 & echo started" },
      makeContext(workdir(), instance),
    );
    const entry = instance.getRecordedGroups()[0] as LeftoverProcessGroup;
    expect(entry).toBeDefined();
    expect(isProcessGroupAlive(entry.pgid)).toBe(true);

    instance.reap();

    await waitForGroupGone(entry.pgid);
  });

  // Scenario 3: nothing was left behind, so nothing is recorded. `echo` exits
  // and its group vanishes with it; an entry here could only ever be stale.
  it.skipIf(isWindows)(
    "records nothing for a plain foreground command",
    async () => {
      const instance = reaper();
      const result = await bashTool.execute(
        { command: "echo done" },
        makeContext(workdir(), instance),
      );
      expect(result.success).toBe(true);
      expect(instance.getRecordedGroups()).toHaveLength(0);
    },
  );

  // Scenario 8: the identity gate. A reused pid must never get a group killed,
  // so the recorded start token is re-checked at kill time. The reuse itself
  // cannot be staged, so the token is falsified instead — same code path.
  it.skipIf(!isLinux)(
    "does not signal a group whose recorded start token no longer matches",
    async () => {
      const instance = reaper();
      await bashTool.execute(
        { command: "nohup sleep 64 >/dev/null 2>&1 & echo started" },
        makeContext(workdir(), instance),
      );
      const entry = instance.getRecordedGroups()[0] as LeftoverProcessGroup;
      expect(entry.members.length).toBeGreaterThan(0);
      const member = entry.members[0]!;
      expect(member.startToken).toBeGreaterThan(0);
      member.startToken = -1; // "a different process now carries this pid"

      instance.reap();

      expect(isProcessGroupAlive(entry.pgid)).toBe(true);
      killGroupQuietly(entry.pgid);
    },
  );

  // Accepted boundary: `setsid` moves the process out of the shell's group on
  // purpose, so no group-based ledger can see it (stated in the spec).
  //
  // The trailing wait loop is load-bearing, not decoration. `setsid … &` only
  // *queues* the escape: if the shell exits before the child runs `setsid()`,
  // the probe legitimately sees it still sitting in the shell's group and
  // records it (CI hit exactly that window once). Waiting for the pid file
  // proves the new session exists before the shell is allowed to exit, which
  // turns "nothing in the group" from a matter of scheduling into a fact.
  it.skipIf(!isLinux)(
    "does not record a process that escaped via setsid",
    async () => {
      const instance = reaper();
      const dir = workdir();
      const pidFile = path.join(dir, "setsid.pid");
      await bashTool.execute(
        {
          command:
            `setsid bash -c 'echo $$ > "${pidFile}"; exec sleep 66' >/dev/null 2>&1 & ` +
            `while [ ! -s "${pidFile}" ]; do sleep 0.02; done; echo started`,
        },
        makeContext(dir, instance),
      );

      expect(instance.getRecordedGroups()).toHaveLength(0);

      await vi.waitFor(() => {
        expect(fs.existsSync(pidFile)).toBe(true);
      });
      killGroupQuietly(Number(fs.readFileSync(pidFile, "utf8").trim()));
    },
  );

  // Scenario 7: Windows has no process groups and the shell's pid cannot drive
  // `taskkill /T` once the shell is gone, so this is an explicit no-op there.
  it.skipIf(!isWindows)("records nothing on Windows", async () => {
    const instance = reaper();
    const result = await bashTool.execute(
      { command: "nohup sleep 60 >/dev/null 2>&1 & echo started" },
      makeContext(workdir(), instance),
    );
    expect(result.success).toBe(true);
    expect(instance.getRecordedGroups()).toHaveLength(0);
  });
});

describe("Agent.destroy() reaping a real session", () => {
  type RealAgent = {
    destroy: () => Promise<void>;
    toolManager: {
      execute: (
        name: string,
        args: Record<string, unknown>,
        context: { workdir: string; taskManager: unknown },
      ) => Promise<{ success: boolean; content: string }>;
    };
    taskManager: unknown;
  };

  const agents: RealAgent[] = [];
  const dirs: string[] = [];

  afterEach(async () => {
    for (const agent of agents) {
      try {
        await agent.destroy();
      } catch {
        // already destroyed by the test
      }
    }
    agents.length = 0;
    for (const dir of dirs) removeWorkdir(dir);
    dirs.length = 0;
  });

  async function createAgent(dir: string): Promise<RealAgent> {
    const { Agent } = await import("@/agent.js");
    const agent = await Agent.create({
      apiKey: "test-key",
      workdir: dir,
      permissionMode: "bypassPermissions",
    });
    const real = agent as unknown as RealAgent;
    agents.push(real);
    return real;
  }

  function runBash(
    agent: RealAgent,
    dir: string,
    args: Record<string, unknown>,
  ) {
    return agent.toolManager.execute("Bash", args, {
      workdir: dir,
      taskManager: agent.taskManager,
    });
  }

  function newDir(): string {
    const dir = makeWorkdir();
    dirs.push(dir);
    return dir;
  }

  async function readPid(file: string): Promise<number> {
    await vi.waitFor(() => {
      expect(fs.existsSync(file)).toBe(true);
    });
    return Number(fs.readFileSync(file, "utf8").trim());
  }

  async function expectDead(pid: number): Promise<void> {
    await vi.waitFor(
      () => {
        expect(() => process.kill(pid, 0)).toThrow();
      },
      { timeout: 3000 },
    );
  }

  // Scenario 2 through the real entry point: a real Agent, a real Bash call and
  // a real destroy(). The reaper doing the work here is the container's own.
  it.skipIf(isWindows)(
    "kills the group a foreground command left behind when the session is destroyed",
    async () => {
      const dir = newDir();
      const agent = await createAgent(dir);
      const pidFile = path.join(dir, "leftover.pid");
      await runBash(agent, dir, {
        command: `nohup sleep 70 >/dev/null 2>&1 & echo $! > "${pidFile}"; echo started`,
      });
      const pid = await readPid(pidFile);
      expect(() => process.kill(pid, 0)).not.toThrow();

      await agent.destroy();
      agents.length = 0;

      await expectDead(pid);
    },
  );

  // The class `cleanup()` alone cannot see: a background shell that exited
  // normally after starting something is already `completed` (not `running`),
  // so its leftovers depend on the exit-time ledger entry.
  it.skipIf(isWindows)(
    "kills the leftovers of a completed background shell at destroy",
    async () => {
      const dir = newDir();
      const agent = await createAgent(dir);
      const pidFile = path.join(dir, "bg-leftover.pid");
      const result = await runBash(agent, dir, {
        command: `nohup sleep 72 >/dev/null 2>&1 & echo $! > "${pidFile}"; echo bg-started`,
        run_in_background: true,
      });
      expect(result.success).toBe(true);
      const pid = await readPid(pidFile);

      await agent.destroy();
      agents.length = 0;

      await expectDead(pid);
    },
  );

  // Scenario 4: a background task that is *still running* at destroy keeps its
  // existing stop path — the ledger must not change that behaviour.
  it.skipIf(isWindows)(
    "still stops a running background task at destroy (no regression)",
    async () => {
      const dir = newDir();
      const agent = await createAgent(dir);
      const pidFile = path.join(dir, "running.pid");
      const result = await runBash(agent, dir, {
        command: `echo $$ > "${pidFile}"; sleep 74`,
        run_in_background: true,
      });
      expect(result.success).toBe(true);
      const pid = await readPid(pidFile);
      expect(() => process.kill(pid, 0)).not.toThrow();

      await agent.destroy();
      agents.length = 0;

      await expectDead(pid);
    },
  );
});
