import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkflowManager } from "../../src/managers/workflowManager.js";
import { TurnBudgetLedger } from "../../src/managers/turnBudgetLedger.js";
import { Container } from "../../src/utils/container.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

function createMockContainer(sessionDir?: string) {
  const container = new Container();

  // Use a unique temp dir to avoid interference between test runs
  const testSessionDir =
    sessionDir ||
    path.join(os.tmpdir(), `wave-test-sessions-${process.pid}-${Date.now()}`);

  const mockBackgroundTaskManager = {
    generateId: vi.fn().mockReturnValue("task-1"),
    addTask: vi.fn(),
    getTask: vi.fn().mockReturnValue(null),
    notifyTasksChange: vi.fn(),
  };

  const mockMessageQueue = {
    enqueueNotification: vi.fn(),
  };

  const mockSubagentManager = {
    findSubagent: vi.fn().mockResolvedValue({ id: "general-purpose" }),
    createInstance: vi.fn().mockResolvedValue({
      subagentId: "sub-1",
      toolManager: { register: vi.fn() },
      permissionManager: { addTemporaryRules: vi.fn() },
      messageManager: {
        getMessages: vi.fn().mockReturnValue([]),
        getLatestTotalTokens: vi.fn().mockReturnValue(100),
        // Agent() records each subagent's transcript path; without it the call
        // fails for real now (agent() no longer swallows its own errors).
        getTranscriptPath: vi
          .fn()
          .mockReturnValue("/tmp/sessions/agent-transcript.jsonl"),
      },
    }),
    executeAgent: vi.fn().mockResolvedValue("result"),
    cleanupInstance: vi.fn(),
  };

  const testSessionId = "sess-test-0001";
  const mockMessageManager = {
    getSessionDir: vi.fn().mockReturnValue(testSessionDir),
    // Runs live under the PROJECT dir + this session's id (the session root made
    // every run visible to every project on the machine, and a project-level key
    // still leaked runs across the sessions sharing that project —
    // spec「从日志恢复工作流」场景 3).
    getProjectDir: vi.fn().mockReturnValue(testSessionDir),
    getSessionId: vi.fn().mockReturnValue(testSessionId),
  };

  container.register("BackgroundTaskManager", mockBackgroundTaskManager);
  container.register("MessageQueue", mockMessageQueue);
  container.register("SubagentManager", mockSubagentManager);
  container.register("MessageManager", mockMessageManager);
  container.register("workdir", "/tmp/wave-test");

  return {
    container,
    mockBackgroundTaskManager,
    mockMessageQueue,
    mockSubagentManager,
    mockMessageManager,
  };
}

describe("WorkflowManager", () => {
  let manager: WorkflowManager;
  let mocks: ReturnType<typeof createMockContainer>;

  beforeEach(() => {
    mocks = createMockContainer();
    manager = new WorkflowManager(mocks.container);
  });

  describe("createRun", () => {
    it("creates a run from a valid script", async () => {
      const script = `export const meta = { name: "test-wf", description: "A test" };\nreturn await agent("hello");`;
      const run = await manager.createRun(script);

      expect(run.runId).toMatch(/^wf_/);
      expect(run.meta.name).toBe("test-wf");
      expect(run.meta.description).toBe("A test");
      expect(run.status).toBe("running");
    });

    it("throws on invalid script", async () => {
      const script = `const x = require('fs');`;
      await expect(manager.createRun(script)).rejects.toThrow(
        "Script validation failed",
      );
    });

    it("accepts args parameter", async () => {
      const script = `export const meta = { name: "test-wf", description: "A test" };\nreturn 1;`;
      const run = await manager.createRun(script, { input: "hello" });
      expect(run.args).toEqual({ input: "hello" });
    });

    it("keeps the run free of any budget input (the budget lives on the turn)", async () => {
      const script = `export const meta = { name: "test-wf", description: "A test" };\nreturn 1;`;
      // A run can no longer be handed a budget: `args.budget` was a wave-only
      // magic key, and the token target belongs to the turn (parsed off the
      // user's message, read through the shared ledger).
      const run = await manager.createRun(script, { input: "hello" });
      expect(run.args).toEqual({ input: "hello" });
      expect(run.failures).toEqual([]);
    });
  });

  describe("listRuns", () => {
    it("returns empty list initially", async () => {
      expect(await manager.listRuns()).toEqual([]);
    });

    it("returns created runs", async () => {
      const script = `export const meta = { name: "test-wf", description: "A test" };\nreturn 1;`;
      await manager.createRun(script);
      expect(await manager.listRuns()).toHaveLength(1);
    });
  });

  describe("getRun", () => {
    it("returns undefined for unknown run", () => {
      expect(manager.getRun("unknown")).toBeUndefined();
    });

    it("returns a created run by ID", async () => {
      const script = `export const meta = { name: "test-wf", description: "A test" };\nreturn 1;`;
      const run = await manager.createRun(script);
      expect(manager.getRun(run.runId)).toBe(run);
    });
  });

  describe("run directory", () => {
    const script = `export const meta = { name: "iso", description: "d" };\nreturn 1;`;

    it("keys runs off the project directory + the session id, never the machine-wide session root", async () => {
      // A fabricated project dir: every filesystem write is mocked, so nothing
      // touches disk (and no temp dir is created).
      const projectDir = path.join(os.tmpdir(), "wave-project-isolation");
      mocks = createMockContainer(projectDir);
      manager = new WorkflowManager(mocks.container);
      const sessionId = mocks.mockMessageManager.getSessionId();

      const mkdir = vi
        .spyOn(fs.promises, "mkdir")
        .mockResolvedValue(undefined as never);
      const writeFile = vi
        .spyOn(fs.promises, "writeFile")
        .mockResolvedValue(undefined as never);
      const readdir = vi
        .spyOn(fs.promises, "readdir")
        .mockResolvedValue([] as never);
      try {
        const run = await manager.createRun(script);

        // The script and every later artifact of the run live under the PROJECT
        // directory (+ this session's id) — the same root the transcript uses —
        // so a run started in another worktree is neither listed nor resumable
        // here (场景 3).
        expect(run.scriptPath).toBe(
          path.join(projectDir, "workflows", sessionId, run.runId, "script.js"),
        );
        expect(writeFile).toHaveBeenCalledWith(
          run.scriptPath,
          expect.any(String),
          "utf-8",
        );
        // Listing reads that same directory, which is what makes a foreign run
        // invisible: another worktree's runs are not in this list (场景 3).
        expect((await manager.listRuns()).map((r) => r.runId)).toEqual([
          run.runId,
        ]);
        expect(readdir).toHaveBeenCalledWith(
          path.join(projectDir, "workflows", sessionId),
          expect.anything(),
        );

        // The session root is the whole machine's `/projects` folder: asking for
        // it is exactly the bug this pins down.
        expect(mocks.mockMessageManager.getProjectDir).toHaveBeenCalled();
        expect(mocks.mockMessageManager.getSessionId).toHaveBeenCalled();
        expect(mocks.mockMessageManager.getSessionDir).not.toHaveBeenCalled();
      } finally {
        mkdir.mockRestore();
        writeFile.mockRestore();
        readdir.mockRestore();
      }
    });

    it("hides the runs of another session in the same project (Same-session only)", async () => {
      const projectDir = path.join(os.tmpdir(), "wave-session-isolation");
      mocks = createMockContainer(projectDir);
      const first = new WorkflowManager(mocks.container);
      const firstSessionId = mocks.mockMessageManager.getSessionId();

      const mkdir = vi
        .spyOn(fs.promises, "mkdir")
        .mockResolvedValue(undefined as never);
      const writeFile = vi
        .spyOn(fs.promises, "writeFile")
        .mockResolvedValue(undefined as never);
      const readdir = vi
        .spyOn(fs.promises, "readdir")
        .mockResolvedValue([] as never);
      try {
        const firstRun = await first.createRun(script);

        // Same project, another conversation: `/clear`, a second CLI session or a
        // second desktop pane all mint a new session id under the same project
        // directory. Its manager must resolve a different runs directory.
        mocks.mockMessageManager.getSessionId.mockReturnValue("sess-second");
        const second = new WorkflowManager(mocks.container);
        readdir.mockClear();
        await second.listRuns();

        expect(firstSessionId).not.toBe("sess-second");
        expect(firstRun.scriptPath).toContain(
          path.join("workflows", firstSessionId, firstRun.runId),
        );
        expect(readdir).toHaveBeenCalledWith(
          path.join(projectDir, "workflows", "sess-second"),
          expect.anything(),
        );
        expect(readdir).not.toHaveBeenCalledWith(
          path.join(projectDir, "workflows", firstSessionId),
          expect.anything(),
        );
        // And a run id from the other session is not resumable from here.
        await expect(
          second.createRun(script, undefined, {
            resumeFromRunId: firstRun.runId,
          }),
        ).rejects.toThrow(
          `Cannot resume: run ${firstRun.runId} not found in this session`,
        );
      } finally {
        mkdir.mockRestore();
        writeFile.mockRestore();
        readdir.mockRestore();
      }
    });

    it("moves the view to the new session when /clear re-ids the same Agent", async () => {
      const projectDir = path.join(os.tmpdir(), "wave-clear-isolation");
      mocks = createMockContainer(projectDir);
      // The SAME manager: `/clear` calls messageManager.clearMessages(), which
      // mints a new session id without recreating the Agent (or this manager).
      manager = new WorkflowManager(mocks.container);

      const mkdir = vi
        .spyOn(fs.promises, "mkdir")
        .mockResolvedValue(undefined as never);
      const writeFile = vi
        .spyOn(fs.promises, "writeFile")
        .mockResolvedValue(undefined as never);
      const readdir = vi
        .spyOn(fs.promises, "readdir")
        .mockResolvedValue([] as never);
      try {
        const before = await manager.createRun(script);

        mocks.mockMessageManager.getSessionId.mockReturnValue("sess-cleared");
        readdir.mockClear();

        // Not listed, not fetchable, not resumable any more (场景 3)...
        expect(manager.getRun(before.runId)).toBeUndefined();
        expect((await manager.listRuns()).map((r) => r.runId)).toEqual([]);
        expect(readdir).toHaveBeenCalledWith(
          path.join(projectDir, "workflows", "sess-cleared"),
          expect.anything(),
        );
        await expect(
          manager.createRun(script, undefined, {
            resumeFromRunId: before.runId,
          }),
        ).rejects.toThrow(
          `Cannot resume: run ${before.runId} not found in this session`,
        );
        // ...because the previous session's run is not destroyed, only out of
        // view: it keeps living (and reporting) under its own session.
        expect(before.status).toBe("running");
      } finally {
        mkdir.mockRestore();
        writeFile.mockRestore();
        readdir.mockRestore();
      }
    });
  });

  describe("stopRun", () => {
    it("does nothing for unknown run", () => {
      expect(() => manager.stopRun("unknown")).not.toThrow();
    });

    it("sets status to aborted for a running run", async () => {
      const script = `export const meta = { name: "test-wf", description: "A test" };\nreturn 1;`;
      const run = await manager.createRun(script);
      manager.stopRun(run.runId);
      expect(run.status).toBe("aborted");
      expect(run.endTime).toBeDefined();
    });

    it("does not change status of non-running run", async () => {
      const script = `export const meta = { name: "test-wf", description: "A test" };\nreturn 1;`;
      const run = await manager.createRun(script);
      run.status = "completed";
      manager.stopRun(run.runId);
      expect(run.status).toBe("completed");
    });
  });

  describe("startRun", () => {
    it("throws for unknown run", async () => {
      await expect(manager.startRun("unknown")).rejects.toThrow("not found");
    });

    it("throws for non-running run", async () => {
      const script = `export const meta = { name: "test-wf", description: "A test" };\nreturn 1;`;
      const run = await manager.createRun(script);
      run.status = "completed";
      await expect(manager.startRun(run.runId)).rejects.toThrow(
        "not in running state",
      );
    });

    it("starts a run and completes successfully", async () => {
      // Use a real temp directory for the session
      const tmpDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), "wf-test-"),
      );
      mocks = createMockContainer(tmpDir);
      manager = new WorkflowManager(mocks.container);

      // Simple script that just returns a value (no agent call)
      const script = `export const meta = { name: "simple-wf", description: "Simple test" };\nreturn 42;`;
      const run = await manager.createRun(script);

      // Mock background task manager to return the task
      const task: Record<string, unknown> = { id: "task-1", status: "running" };
      mocks.mockBackgroundTaskManager.getTask.mockReturnValue(task);

      let onStopCallback: (() => void) | undefined;
      mocks.mockBackgroundTaskManager.addTask.mockImplementation(
        (t: Record<string, unknown>) => {
          onStopCallback = t.onStop as () => void;
        },
      );

      await manager.startRun(run.runId);

      // Verify onStop callback is registered
      expect(onStopCallback).toBeDefined();

      // Wait for the background execution to complete
      await run.completionPromise;

      expect(run.status).toBe("completed");
      expect(run.result).toBe(42);
      expect(run.endTime).toBeDefined();
      expect(mocks.mockMessageQueue.enqueueNotification).toHaveBeenCalled();
      // The registry key must be the runId: the tool receipt and the completion
      // notification both advertise the runId as the handle, so TaskStop(
      // {task_id: runId}) has to resolve against this same id.
      expect(mocks.mockBackgroundTaskManager.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
          id: run.runId,
          runId: run.runId,
          type: "workflow",
          description: "Workflow: simple-wf",
        }),
      );

      // Cleanup
      await fs.promises.rm(tmpDir, { recursive: true });
    });

    it("starts a run that fails with an error", async () => {
      const tmpDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), "wf-test-"),
      );
      mocks = createMockContainer(tmpDir);
      manager = new WorkflowManager(mocks.container);

      // Script that throws
      const script = `export const meta = { name: "fail-wf", description: "Fails" };\nthrow new Error("script error");`;
      const run = await manager.createRun(script);

      const task: Record<string, unknown> = { id: "task-1", status: "running" };
      mocks.mockBackgroundTaskManager.getTask.mockReturnValue(task);

      await manager.startRun(run.runId);

      // Wait for the background execution to complete
      await run.completionPromise;

      expect(run.status).toBe("failed");
      expect(run.error).toBe("script error");
      expect(mocks.mockMessageQueue.enqueueNotification).toHaveBeenCalled();

      // A failed run reports through the same information surface as a completed
      // one — tallies, where the per-agent results live, how to resume — so the
      // model can read before concluding (场景 4 与 6).
      const xml = mocks.mockMessageQueue.enqueueNotification.mock
        .calls[0][0] as string;
      expect(xml).toContain("<status>failed</status>");
      expect(xml).toContain(`Dynamic workflow "fail-wf" failed: script error`);
      // The headline carries no counts; they live in the <usage> block, whose
      // tag names say what is counted (agents) — "N failed" next to a
      // "Failures:" line read as a contradiction (场景 4).
      expect(xml).toContain(
        "<usage><agent_count>0</agent_count><agents_done>0</agents_done><agents_error>0</agents_error><agents_skipped>0</agents_skipped><agents_empty_result>0</agents_empty_result>",
      );
      expect(xml).not.toContain("completed, 0 failed");
      expect(xml).toContain("Agent results: ");
      expect(xml).toContain("<output-file>");

      // Cleanup
      await fs.promises.rm(tmpDir, { recursive: true });
    });

    it("reads the budget from the shared turn ledger, not from args", async () => {
      const tmpDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), "wf-test-"),
      );
      mocks = createMockContainer(tmpDir);
      manager = new WorkflowManager(mocks.container);

      // The ledger is the turn's: the main loop and every workflow count into it
      const ledger = new TurnBudgetLedger();
      ledger.beginTurn(500_000);
      ledger.addOutputTokens(1_250);
      mocks.container.register("TurnBudgetLedger", ledger);

      const script = [
        "export const meta = { name: 'budget-wf', description: 'With budget' };",
        "return { total: budget.total, spent: budget.spent(), remaining: budget.remaining() };",
      ].join("\n");
      // `args.budget` must have no effect on the number the script reads
      const run = await manager.createRun(script, { budget: 1 });

      const task: Record<string, unknown> = { id: "task-1", status: "running" };
      mocks.mockBackgroundTaskManager.getTask.mockReturnValue(task);

      await manager.startRun(run.runId);
      await run.completionPromise;

      expect(run.status).toBe("completed");
      expect(run.result).toEqual({
        total: 500_000,
        spent: 1_250,
        remaining: 498_750,
      });

      // Cleanup
      await fs.promises.rm(tmpDir, { recursive: true });
    });

    it("fails the run when an uncaught agent() error escapes the script", async () => {
      const tmpDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), "wf-test-"),
      );
      mocks = createMockContainer(tmpDir);
      manager = new WorkflowManager(mocks.container);

      const script = [
        "export const meta = { name: 'agent-fail', description: 'd' };",
        "return await agent('work');",
      ].join("\n");
      const run = await manager.createRun(script);

      const task: Record<string, unknown> = { id: "task-1", status: "running" };
      mocks.mockBackgroundTaskManager.getTask.mockReturnValue(task);
      (
        mocks.mockSubagentManager.executeAgent as ReturnType<typeof vi.fn>
      ).mockRejectedValue(new Error("API error"));

      await manager.startRun(run.runId);
      await run.completionPromise;

      // agent() failures are catchable, not silently folded into null, so an
      // uncaught one fails the whole script.
      expect(run.status).toBe("failed");
      expect(run.error).toBe("API error");

      // Cleanup
      await fs.promises.rm(tmpDir, { recursive: true });
    });

    it("reports counts and failure details in the completion notification", async () => {
      const tmpDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), "wf-test-"),
      );
      mocks = createMockContainer(tmpDir);
      manager = new WorkflowManager(mocks.container);

      const script = [
        "export const meta = { name: 'detail-wf', description: 'd' };",
        "const results = await pipeline([1, 2], async (_prev, item) => {",
        "  if (item === 2) throw new Error('boom');",
        "  return await agent('work ' + item);",
        "});",
        "return results;",
      ].join("\n");
      const run = await manager.createRun(script);

      const task: Record<string, unknown> = { id: "task-1", status: "running" };
      mocks.mockBackgroundTaskManager.getTask.mockReturnValue(task);

      await manager.startRun(run.runId);
      await run.completionPromise;

      expect(run.status).toBe("completed");
      expect(run.result).toEqual(["result", null]);
      expect(run.failures).toEqual(["pipeline[1] failed: boom"]);

      const xml = mocks.mockMessageQueue.enqueueNotification.mock
        .calls[0][0] as string;
      expect(xml).toContain("<summary>");
      expect(xml).toContain(`Dynamic workflow "detail-wf" completed`);
      // Item 2 threw inside the stage, BEFORE any agent() ran, so the run has one
      // agent and one failure — the failure is not an agent error (agent errors
      // are counted where agent() itself threw) and the dropped item never became
      // an agent at all.
      expect(xml).toContain("<agent_count>1</agent_count>");
      expect(xml).toContain("<agents_done>1</agents_done>");
      expect(xml).toContain("<agents_error>0</agents_error>");
      expect(xml).toContain("<tool_uses>");
      expect(xml).toContain("<duration_ms>");
      expect(xml).toContain("Failures: pipeline[1] failed: boom");
      // The recovery instruction travels with the summary (verbatim Claude Code,
      // evidence §4); the run id it refers to is this notification's <task-id>.
      expect(xml).toContain(
        `relaunch with Workflow({scriptPath, resumeFromRunId}) using the run id from the summary — completed agent() calls return cached.`,
      );
      expect(xml).toContain(`<task-id>${run.runId}</task-id>`);
      expect(xml).toContain("<output-file>");

      // Cleanup
      await fs.promises.rm(tmpDir, { recursive: true });
    });

    it("handles aborted runs", async () => {
      const tmpDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), "wf-test-"),
      );
      mocks = createMockContainer(tmpDir);
      manager = new WorkflowManager(mocks.container);

      // Script that takes a long time (will be aborted)
      const script = `export const meta = { name: "slow-wf", description: "Slow" };\nawait new Promise(r => setTimeout(r, 60000));\nreturn 1;`;
      const run = await manager.createRun(script);

      const task: Record<string, unknown> = { id: "task-1", status: "running" };
      mocks.mockBackgroundTaskManager.getTask.mockReturnValue(task);

      await manager.startRun(run.runId);

      // Stop it — abort signal will race with the script
      manager.stopRun(run.runId);

      // Wait for the background execution to handle the abort
      await run.completionPromise;

      // Status should be aborted
      expect(run.status).toBe("aborted");

      // Cleanup
      await fs.promises.rm(tmpDir, { recursive: true });
    });
  });

  describe("resumeRun", () => {
    it("throws for unknown run", async () => {
      await expect(manager.resumeRun("unknown")).rejects.toThrow("not found");
    });

    it("resets status to running and starts", async () => {
      const tmpDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), "wf-test-"),
      );
      mocks = createMockContainer(tmpDir);
      manager = new WorkflowManager(mocks.container);

      const script = `export const meta = { name: "resume-wf", description: "Resume test" };\nreturn 1;`;
      const run = await manager.createRun(script);

      const task: Record<string, unknown> = { id: "task-1", status: "running" };
      mocks.mockBackgroundTaskManager.getTask.mockReturnValue(task);

      await manager.resumeRun(run.runId);

      await run.completionPromise;
      // Should have completed after resume
      expect(run.status).toBe("completed");

      // Cleanup
      await fs.promises.rm(tmpDir, { recursive: true });
    });
  });

  describe("createRun with resumeFromRunId", () => {
    it("throws if resumeFromRunId does not exist", async () => {
      const script = `export const meta = { name: "test-wf", description: "A test" };\nreturn 1;`;
      await expect(
        manager.createRun(script, undefined, { resumeFromRunId: "wf_nope" }),
      ).rejects.toThrow("Cannot resume: run wf_nope not found in this session");
    });

    it("stores resumeFromRunId on the run", async () => {
      const script = `export const meta = { name: "test-wf", description: "A test" };\nreturn 1;`;
      const prevRun = await manager.createRun(script);
      const newRun = await manager.createRun(script, undefined, {
        resumeFromRunId: prevRun.runId,
      });
      expect(newRun.resumeFromRunId).toBe(prevRun.runId);
    });
  });

  describe("cleanup", () => {
    it("aborts all running workflows", async () => {
      const script = `export const meta = { name: "test-wf", description: "A test" };\nreturn 1;`;
      const run1 = await manager.createRun(script);
      const run2 = await manager.createRun(script);
      manager.cleanup();
      expect(run1.status).toBe("aborted");
      expect(run2.status).toBe("aborted");
    });

    it("does not change completed workflows", async () => {
      const script = `export const meta = { name: "test-wf", description: "A test" };\nreturn 1;`;
      const run = await manager.createRun(script);
      run.status = "completed";
      manager.cleanup();
      expect(run.status).toBe("completed");
    });
  });

  describe("killRun", () => {
    it("aborts a running workflow", async () => {
      const script = `export const meta = { name: "test-wf", description: "A test" };\nawait new Promise(r => setTimeout(r, 60000));\nreturn 1;`;
      const run = await manager.createRun(script);

      const task: Record<string, unknown> = { id: "task-1", status: "running" };
      mocks.mockBackgroundTaskManager.getTask.mockReturnValue(task);

      await manager.startRun(run.runId);
      manager.killRun(run.runId);

      await run.completionPromise;
      expect(run.status).toBe("aborted");
    });
  });

  describe("skipAgent", () => {
    it("does nothing for non-running run", () => {
      // Should not throw
      manager.skipAgent("wf_nonexistent", 0);
    });
  });

  describe("retryAgent", () => {
    it("throws for unknown run", async () => {
      await expect(manager.retryAgent("wf_nonexistent", 0)).rejects.toThrow(
        "not found",
      );
    });
  });

  describe("live progress updates", () => {
    // Verifies that WorkflowRun fields (phases, totalAgents, totalTokens)
    // update live during execution, not only at completion — so the
    // /workflows UI reflects progress mid-run.
    it("updates run phases/agents/tokens and notifies mid-run, not only at completion", async () => {
      const tmpDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), "wf-progress-"),
      );

      const notifyTasksChange = vi.fn();
      // Agent() blocks on these gates so the test can observe mid-run state.
      let resolveScan: () => void = () => {};
      let resolveSynth: () => void = () => {};
      const scanGate = new Promise<void>((r) => {
        resolveScan = r;
      });
      const synthGate = new Promise<void>((r) => {
        resolveSynth = r;
      });

      const container = new Container();
      container.register("BackgroundTaskManager", {
        generateId: vi.fn().mockReturnValue("task-progress"),
        addTask: vi.fn(),
        getTask: vi
          .fn()
          .mockReturnValue({ id: "task-progress", status: "running" }),
        notifyTasksChange,
      });
      container.register("MessageQueue", { enqueueNotification: vi.fn() });
      container.register("SubagentManager", {
        findSubagent: vi.fn().mockResolvedValue({ id: "general-purpose" }),
        createInstance: vi.fn().mockResolvedValue({
          subagentId: "sub-1",
          toolManager: { register: vi.fn() },
          permissionManager: { addTemporaryRules: vi.fn() },
          messageManager: {
            getMessages: vi.fn().mockReturnValue([
              {
                role: "assistant",
                blocks: [],
                usage: { total_tokens: 1234 },
              },
            ]),
            getTranscriptPath: vi.fn().mockReturnValue(undefined),
          },
        }),
        // Block scan agents on the scan gate, synth agent on the synth gate.
        executeAgent: vi
          .fn()
          .mockImplementation(async (_inst: unknown, _prompt: string) => {
            if (_prompt.startsWith("scan")) {
              await scanGate;
            } else {
              await synthGate;
            }
            return "result";
          }),
        cleanupInstance: vi.fn(),
      });
      container.register("MessageManager", {
        getSessionDir: vi.fn().mockReturnValue(tmpDir),
        getProjectDir: vi.fn().mockReturnValue(tmpDir),
        getSessionId: vi.fn().mockReturnValue("sess-live-progress"),
      });
      container.register("workdir", tmpDir);

      const progressManager = new WorkflowManager(container);

      const script = [
        "export const meta = { name: 'live-progress', description: 'd', phases: [{ title: 'Scan' }, { title: 'Synthesize' }] }",
        "phase('Scan')",
        "await parallel([() => agent('scan-a'), () => agent('scan-b')])",
        "phase('Synthesize')",
        "await agent('synthesize')",
        "return 'done'",
      ].join("\n");
      const run = await progressManager.createRun(script);
      await progressManager.startRun(run.runId);

      // Wait until the scan agents have started (agent_started events
      // propagate asynchronously; polling beats a fixed sleep on slow CI).
      await vi.waitFor(() => {
        expect(progressManager.getRun(run.runId)!.totalAgents).toBe(2);
      });

      // --- MID-RUN snapshot: scan agents started, not yet completed ---
      const midRun = progressManager.getRun(run.runId)!;
      expect(midRun.status).toBe("running");
      expect(midRun.totalAgents).toBe(2);
      expect(midRun.totalTokens).toBe(0);
      expect(midRun.phases).toHaveLength(2);
      expect(midRun.phases[0].agentCount).toBe(2); // Scan phase
      expect(midRun.phases[1].agentCount).toBe(0); // Synthesize not started
      // notifyTasksChange fired for the phase/agent_started events.
      expect(notifyTasksChange).toHaveBeenCalled();

      // Release scan agents -> they complete and Synthesize starts. Wait
      // until the synth agent has started and scan tokens are counted.
      resolveScan();
      await vi.waitFor(() => {
        const r = progressManager.getRun(run.runId)!;
        expect(r.totalAgents).toBe(3);
        expect(r.totalTokens).toBe(2468); // 2 scan agents * 1234 tokens
        expect(r.phases[1].agentCount).toBe(1); // synth agent started
      });

      // --- After scan completes, before synth completes ---
      const afterScan = progressManager.getRun(run.runId)!;
      expect(afterScan.status).toBe("running");
      expect(afterScan.totalAgents).toBe(3);
      expect(afterScan.totalTokens).toBe(2468); // 2 scan agents * 1234 tokens
      expect(afterScan.phases[0].tokens).toBe(2468);
      expect(afterScan.phases[1].agentCount).toBe(1); // synth agent started

      // Release synth -> run completes.
      resolveSynth();
      await run.completionPromise;

      // --- Final snapshot ---
      expect(run.status).toBe("completed");
      expect(run.totalAgents).toBe(3);
      expect(run.totalTokens).toBe(3702); // 3 agents * 1234 tokens
      expect(run.phases[0].tokens).toBe(2468);
      expect(run.phases[1].tokens).toBe(1234);

      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    });
  });
});
