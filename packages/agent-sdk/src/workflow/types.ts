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
  /**
   * Run-level failure details recorded by pipeline()/parallel()
   * (`pipeline[3] failed: <message>`), in Claude Code's format. Token-budget
   * drops are not listed per slot — they add one aggregate
   * `pipeline: 2 slot(s) dropped — token budget exceeded` entry instead, so
   * "ran out of budget" is never reported as a broken agent.
   *
   * Optional so hosts that build run objects themselves (older persisted
   * run-state.json, UI fixtures) stay valid — read it as `run.failures ?? []`.
   */
  failures?: string[];
  /** Resolves when the background execution finishes (completed/failed/aborted) */
  completionPromise?: Promise<void>;
  /** If set, this run resumes from a previous run's journal */
  resumeFromRunId?: string;
  /** Index of the agent that caused the workflow to fail */
  failedAgentIndex?: number;
  /** Error message from the failed agent */
  failedAgentError?: string;
}

/**
 * Serializable workflow run for stdio transport, with the non-serializable
 * `completionPromise` stripped. Returned by the `getWorkflowRuns` RPC.
 */
export type SerializableWorkflowRun = Omit<WorkflowRun, "completionPromise">;

export interface JournalEntry {
  agentIndex: number;
  prompt: string;
  opts: Record<string, unknown>;
  result: unknown;
  tokens: number;
  /**
   * Tool calls this agent made. Optional so journals written before the count
   * existed still parse (a resumed run reports 0 for those agents).
   */
  toolUses?: number;
  /** Subagent instance ID for linking to the full conversation transcript */
  subagentId?: string;
  /** Path to the subagent's transcript JSONL file */
  transcriptPath?: string;
}

export interface AgentMeta {
  agentType: string;
  subagentId: string;
  transcriptPath: string;
  label?: string;
  phase?: string;
}

export interface LogEntry {
  type: "log";
  message: string;
}

export interface AgentFailedEntry {
  type: "agent_failed";
  agentIndex: number;
  error: string;
}

export type JournalLine = JournalEntry | LogEntry | AgentFailedEntry;

export interface BudgetInfo {
  total: number | null;
  spent: () => number;
  remaining: () => number;
}

export interface WorkflowProgressEvent {
  type:
    | "phase_started"
    | "phase_completed"
    | "agent_started"
    | "agent_completed"
    | "agent_failed";
  runId: string;
  phaseIndex: number;
  agentIndex?: number;
  timestamp: number;
}
