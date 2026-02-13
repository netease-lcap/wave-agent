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
export type BackgroundTaskType = "shell" | "subagent";

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
}

export interface BackgroundShell extends BackgroundTaskBase {
  type: "shell";
  process: ChildProcess;
}

export interface BackgroundSubagent extends BackgroundTaskBase {
  type: "subagent";
  subagentId: string;
  subagentManager: {
    getInstance: (subagentId: string) => {
      aiManager: {
        abortAIMessage: () => void;
      };
    } | null;
  };
}

export type BackgroundTask = BackgroundShell | BackgroundSubagent;

export interface ForegroundTask {
  id: string;
  backgroundHandler: () => Promise<void>;
}

export interface IForegroundTaskManager {
  registerForegroundTask(task: ForegroundTask): void;
  unregisterForegroundTask(id: string): void;
}
