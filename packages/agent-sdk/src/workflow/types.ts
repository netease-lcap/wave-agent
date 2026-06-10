export interface WorkflowMetaPhase {
  title: string;
  detail?: string;
  model?: string;
}

export interface WorkflowMeta {
  name: string;
  description: string;
  whenToUse?: string;
  phases?: WorkflowMetaPhase[];
}

export interface WorkflowPhaseState {
  title: string;
  agentCount: number;
  tokens: number;
  elapsed: number;
  startTime: number;
}

export interface WorkflowRun {
  runId: string;
  meta: WorkflowMeta;
  status: "running" | "paused" | "completed" | "failed" | "aborted";
  scriptPath: string;
  args?: unknown;
  startTime: number;
  endTime?: number;
  phases: WorkflowPhaseState[];
  totalAgents: number;
  totalTokens: number;
  result?: unknown;
  error?: string;
  /** Resolves when the background execution finishes (completed/failed/aborted) */
  completionPromise?: Promise<void>;
  /** If set, this run resumes from a previous run's journal */
  resumeFromRunId?: string;
}

export interface JournalEntry {
  agentIndex: number;
  prompt: string;
  opts: Record<string, unknown>;
  result: unknown;
  tokens: number;
}

export interface LogEntry {
  type: "log";
  message: string;
}

export type JournalLine = JournalEntry | LogEntry;

export interface BudgetInfo {
  total: number | null;
  spent: () => number;
  remaining: () => number;
}
