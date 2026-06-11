import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkflowManager } from "../../src/managers/workflowManager.js";
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
  };

  const mockNotificationQueue = {
    enqueue: vi.fn(),
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
      },
    }),
    executeAgent: vi.fn().mockResolvedValue("result"),
    cleanupInstance: vi.fn(),
  };

  const mockMessageManager = {
    getSessionDir: vi.fn().mockReturnValue(testSessionDir),
  };

  container.register("BackgroundTaskManager", mockBackgroundTaskManager);
  container.register("NotificationQueue", mockNotificationQueue);
  container.register("SubagentManager", mockSubagentManager);
  container.register("MessageManager", mockMessageManager);
  container.register("workdir", "/tmp/wave-test");

  return {
    container,
    mockBackgroundTaskManager,
    mockNotificationQueue,
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

    it("accepts opts parameter", async () => {
      const script = `export const meta = { name: "test-wf", description: "A test" };\nreturn 1;`;
      const run = await manager.createRun(script, {}, { budget: 1000 });
      expect(run.runId).toMatch(/^wf_/);
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
      expect(mocks.mockNotificationQueue.enqueue).toHaveBeenCalled();
      expect(mocks.mockBackgroundTaskManager.addTask).toHaveBeenCalledWith(
        expect.objectContaining({
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
      expect(mocks.mockNotificationQueue.enqueue).toHaveBeenCalled();

      // Cleanup
      await fs.promises.rm(tmpDir, { recursive: true });
    });

    it("starts a run with budget from args", async () => {
      const tmpDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), "wf-test-"),
      );
      mocks = createMockContainer(tmpDir);
      manager = new WorkflowManager(mocks.container);

      const script = `export const meta = { name: "budget-wf", description: "With budget" };\nreturn 1;`;
      const run = await manager.createRun(script, { budget: 50000 });

      const task: Record<string, unknown> = { id: "task-1", status: "running" };
      mocks.mockBackgroundTaskManager.getTask.mockReturnValue(task);

      await manager.startRun(run.runId);
      await run.completionPromise;

      expect(run.status).toBe("completed");

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
      ).rejects.toThrow("Cannot resume: run wf_nope not found");
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
});
