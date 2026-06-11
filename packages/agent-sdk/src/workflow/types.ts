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
  /** Index of the agent that caused the workflow to fail */
  failedAgentIndex?: number;
  /** Error message from the failed agent */
  failedAgentError?: string;
}

export interface JournalEntry {
  agentIndex: number;
  prompt: string;
  opts: Record<string, unknown>;
  result: unknown;
  tokens: number;
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
