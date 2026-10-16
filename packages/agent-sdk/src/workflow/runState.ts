import * as fs from "fs";
import * as path from "path";
import { atomicWriteFile } from "../utils/atomicWrite.js";
import type { WorkflowRun } from "./types.js";

/**
 * Persists WorkflowRun state to <runDir>/run-state.json.
 * Enables run recovery across process restarts.
 */
export class RunStateStore {
  constructor(private baseDir: string) {}

  /** Persist a run's state to disk */
  async save(run: WorkflowRun): Promise<void> {
    const runDir = path.join(this.baseDir, run.runId);
    await fs.promises.mkdir(runDir, { recursive: true });
    const statePath = path.join(runDir, "run-state.json");
    // Omit non-serializable fields
    const { completionPromise, ...serializable } = run;
    void completionPromise;
    // Atomic (temp + rename): this file is rewritten while others read it — the
    // recovery path (`load`), the /workflows view, and the model itself, which a
    // completion notification points here for the full result. A plain
    // writeFile empties the target before it fills it, and a reader in that
    // window gets a zero-byte file that `JSON.parse` rejects.
    await atomicWriteFile(statePath, JSON.stringify(serializable, null, 2));
  }

  /** Load a single run's state from disk */
  async load(runId: string): Promise<WorkflowRun | null> {
    const statePath = path.join(this.baseDir, runId, "run-state.json");
    try {
      const content = await fs.promises.readFile(statePath, "utf-8");
      return JSON.parse(content) as WorkflowRun;
    } catch {
      return null;
    }
  }

  /** List all persisted run IDs */
  async listRuns(): Promise<string[]> {
    try {
      const entries = await fs.promises.readdir(this.baseDir, {
        withFileTypes: true,
      });
      const runIds: string[] = [];
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith("wf_")) {
          const statePath = path.join(
            this.baseDir,
            entry.name,
            "run-state.json",
          );
          try {
            await fs.promises.access(statePath);
            runIds.push(entry.name);
          } catch {
            // Directory exists but no run-state.json — skip
          }
        }
      }
      return runIds;
    } catch {
      return [];
    }
  }
}
