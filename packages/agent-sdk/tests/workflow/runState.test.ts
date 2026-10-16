import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { RunStateStore } from "../../src/workflow/runState.js";
import type { WorkflowRun } from "../../src/workflow/types.js";

describe("RunStateStore", () => {
  let tempDir: string;
  let store: RunStateStore;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "wave-runstate-"),
    );
    store = new RunStateStore(tempDir);
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  const createRun = (
    runId: string,
    overrides?: Partial<WorkflowRun>,
  ): WorkflowRun => ({
    runId,
    meta: { name: "test", description: "test run" },
    status: "completed",
    scriptPath: path.join(tempDir, runId, "script.js"),
    startTime: Date.now(),
    endTime: Date.now(),
    phases: [],
    totalAgents: 1,
    totalTokens: 100,
    ...overrides,
  });

  describe("save", () => {
    it("persists a run to run-state.json", async () => {
      const run = createRun("wf_test1");
      await store.save(run);

      const statePath = path.join(tempDir, "wf_test1", "run-state.json");
      const content = await fs.promises.readFile(statePath, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed.runId).toBe("wf_test1");
      expect(parsed.status).toBe("completed");
    });

    it("never leaves a truncated file for a concurrent reader", async () => {
      // Temp file + rename: the target is swapped whole, so a reader that
      // arrives mid-write sees the previous complete value — never the empty
      // file a plain writeFile leaves behind between its truncate and its
      // write. That window is where a reader got `Unexpected end of JSON
      // input` for run-state.json (Windows CI, on the notification path).
      const before = createRun("wf_atomic", { result: "old".repeat(3000) });
      await store.save(before);
      const statePath = path.join(tempDir, "wf_atomic", "run-state.json");

      const seenByReader: string[] = [];
      const realRename = fs.promises.rename.bind(fs.promises);
      const spy = vi
        .spyOn(fs.promises, "rename")
        .mockImplementation(async (from, to) => {
          // What a concurrent reader observes at the moment of the swap.
          seenByReader.push(fs.readFileSync(String(to), "utf-8"));
          return realRename(from, to);
        });
      try {
        await store.save({
          ...before,
          result: "new".repeat(3000),
        });
      } finally {
        spy.mockRestore();
      }

      expect(JSON.parse(seenByReader[0]).result).toBe("old".repeat(3000));
      const after = JSON.parse(await fs.promises.readFile(statePath, "utf-8"));
      expect(after.result).toBe("new".repeat(3000));
    });

    it("omits completionPromise from serialization", async () => {
      const run = createRun("wf_test2", {
        completionPromise: new Promise<void>(() => {}),
      });
      await store.save(run);

      const statePath = path.join(tempDir, "wf_test2", "run-state.json");
      const content = await fs.promises.readFile(statePath, "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed).not.toHaveProperty("completionPromise");
    });

    it("persists failedAgentIndex and failedAgentError", async () => {
      const run = createRun("wf_test3", {
        status: "failed",
        failedAgentIndex: 2,
        failedAgentError: "agent crashed",
      });
      await store.save(run);

      const loaded = await store.load("wf_test3");
      expect(loaded?.failedAgentIndex).toBe(2);
      expect(loaded?.failedAgentError).toBe("agent crashed");
    });
  });

  describe("load", () => {
    it("returns null for nonexistent run", async () => {
      const result = await store.load("wf_nonexistent");
      expect(result).toBeNull();
    });

    it("loads a previously saved run", async () => {
      const run = createRun("wf_test4", { totalAgents: 5, totalTokens: 999 });
      await store.save(run);

      const loaded = await store.load("wf_test4");
      expect(loaded).not.toBeNull();
      expect(loaded!.runId).toBe("wf_test4");
      expect(loaded!.totalAgents).toBe(5);
      expect(loaded!.totalTokens).toBe(999);
    });
  });

  describe("listRuns", () => {
    it("returns empty array when no runs exist", async () => {
      const runs = await store.listRuns();
      expect(runs).toEqual([]);
    });

    it("lists persisted run IDs", async () => {
      await store.save(createRun("wf_aaa1"));
      await store.save(createRun("wf_bbb2"));

      const runs = await store.listRuns();
      expect(runs).toContain("wf_aaa1");
      expect(runs).toContain("wf_bbb2");
    });

    it("skips directories without run-state.json", async () => {
      // Create a directory that looks like a run but has no run-state.json
      await fs.promises.mkdir(path.join(tempDir, "wf_orphan"), {
        recursive: true,
      });

      const runs = await store.listRuns();
      expect(runs).not.toContain("wf_orphan");
    });

    it("skips directories that don't start with wf_", async () => {
      await fs.promises.mkdir(path.join(tempDir, "other_dir"), {
        recursive: true,
      });
      await fs.promises.writeFile(
        path.join(tempDir, "other_dir", "run-state.json"),
        "{}",
      );

      const runs = await store.listRuns();
      expect(runs).not.toContain("other_dir");
    });

    it("handles nonexistent base directory gracefully", async () => {
      const badStore = new RunStateStore("/tmp/nonexistent-path-xyz-123");
      const runs = await badStore.listRuns();
      expect(runs).toEqual([]);
    });
  });
});
