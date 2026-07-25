/**
 * Background process and shell management types
 * Dependencies: None
 */

import type { ChildProcess } from "child_process";

export type BackgroundTaskStatus =
  | "running"
  | "completed"
  | "failed"
  | "killed";
export type BackgroundTaskType = "shell" | "subagent" | "workflow";

export interface BackgroundTaskBase {
  id: string;
  type: BackgroundTaskType;
  status: BackgroundTaskStatus;
  startTime: number;
  endTime?: number;
  command?: string; // for shell
  description?: string; // for subagent
  stdout: string;
  stderr: string;
  exitCode?: number;
  runtime?: number;
  /**
   * Optional callback to be executed when the task is stopped.
   * This allows tasks to define their own cleanup/abortion logic.
   */
  onStop?: () => void | Promise<void>;
  /**
   * Optional subagent ID associated with this task.
   * Used for cleanup when the task is stopped.
   */
  subagentId?: string;
  /**
   * Optional path to the real-time output log file.
   */
  outputPath?: string;
}

export interface BackgroundShell extends BackgroundTaskBase {
  type: "shell";
  process: ChildProcess;
}

export interface BackgroundSubagent extends BackgroundTaskBase {
  type: "subagent";
}

export interface BackgroundWorkflow extends BackgroundTaskBase {
  type: "workflow";
  runId: string;
}

export type BackgroundTask =
  | BackgroundShell
  | BackgroundSubagent
  | BackgroundWorkflow;

/**
 * Serializable summary of a BackgroundTask, used for notifications where the
 * full stdout/stderr and non-serializable process/onStop fields must be
 * stripped to control payload size. Output is fetched on demand via
 * getBackgroundTaskOutput.
 */
export interface BackgroundTaskSummary {
  id: string;
  type: BackgroundTaskType;
  status: BackgroundTaskStatus;
  startTime: number;
  endTime?: number;
  command?: string;
  description?: string;
  exitCode?: number;
  runtime?: number;
  outputPath?: string;
}

/** Output snapshot returned by getBackgroundTaskOutput. */
export interface BackgroundTaskOutput {
  stdout: string;
  stderr: string;
  status: BackgroundTaskStatus;
  outputPath?: string;
  type: BackgroundTaskType;
  exitCode?: number;
}

export interface ForegroundTask {
  id: string;
  backgroundHandler: () => Promise<void>;
}

export interface IForegroundTaskManager {
  registerForegroundTask(task: ForegroundTask): void;
  unregisterForegroundTask(id: string): void;
}
