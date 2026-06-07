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
}

export interface JournalEntry {
  agentIndex: number;
  prompt: string;
  opts: Record<string, unknown>;
  result: unknown;
  tokens: number;
}

export interface BudgetInfo {
  total: number | null;
  spent: () => number;
  remaining: () => number;
}
