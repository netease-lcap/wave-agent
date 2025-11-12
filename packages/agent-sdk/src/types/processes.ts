/**
 * Background process and shell management types
 * Dependencies: None
 */

import type { ChildProcess } from "child_process";

export interface BackgroundShell {
  id: string;
  process: ChildProcess;
  command: string;
  startTime: number;
  status: "running" | "completed" | "killed";
  stdout: string;
  stderr: string;
  exitCode?: number;
  runtime?: number;
}
