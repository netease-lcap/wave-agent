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
  /**
   * Agent slots the script has declared, including ones not started yet —
   * `parallel()` / `pipeline()` report their width the moment they are called.
   * Never below `totalAgents`: a script that only loops on `agent()` declares
   * nothing, and there the started count is the best estimate there is.
   *
   * Optional so hosts that build run objects themselves (older persisted
   * run-state.json, UI fixtures) stay valid — read it as `run.scheduledAgents ??
   * run.totalAgents`.
   */
  scheduledAgents?: number;
  /**
   * The thresholds this run was judged against, after the
   * `WAVE_WORKFLOW_SIZE_WARNING_*` env overrides. Carried on the snapshot so the
   * UI can print the numbers that actually applied instead of the constants
   * (spec「预算与规模硬上限」场景 7). Optional for the same reason as above —
   * read it as `run.sizeLimits ?? <the constants>`.
   */
  sizeLimits?: { agents: number; tokens: number };
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
  /**
   * Lines the script wrote with `log()` / `console.log()`. They live on the run
   * (not only in the journal) so the two places a run is inspected — the
   * `/workflows` dialog and the `/tasks` panel — can show them while it is
   * running and after it ends; the journal stays the structured, resumable
   * record of agent results, and only the completion notification points at it.
   *
   * Capped, and persisted with the rest of the run state: a long workflow logs
   * inside a loop, and `run-state.json` is rewritten on every progress event.
   * Optional so runs persisted before the field existed stay valid — read it as
   * `run.logs ?? []`.
   */
  logs?: string[];
  /**
   * Whether this run has crossed either size threshold, i.e. whether the
   * workflow UI should mark it as oversized (spec「预算与规模硬上限」场景 7).
   * Derived from `totalAgents` / `totalTokens` when the run snapshot is handed
   * to a UI (`listRuns()`), never persisted and never sent to the model — the
   * marker is the human's cue to stop the run.
   */
  sizeWarning?: boolean;
  /** Index of the agent that caused the workflow to fail */
  failedAgentIndex?: number;
  /** Error message from the failed agent */
  failedAgentError?: string;
  /**
   * Per-agent state, one entry per `agent()` call that got as far as starting
   * (or being replayed from the resume journal). Read by the workflow detail
   * view's agent list — spec `multi-agent/workflow.md`「查看单个 agent 的执行详情」.
   *
   * Deliberately lightweight: the hosts re-push the whole run list on every
   * progress event (and the remote page gets it as one frame), so this carries
   * counters and ≤400-char previews, never tool-call lines or full results. The
   * agent's activity log (`agents/<index>.log`) is read on demand instead.
   *
   * Optional so runs persisted before the field existed stay valid — read it as
   * `run.agents ?? []`.
   */
  agents?: WorkflowAgentState[];
}

/**
 * One agent's entry in a run's agent list.
 *
 * `status` mirrors what happened to this `agent()` call: `running` while the
 * subagent is in flight, `completed` when it returned a result, `failed` when
 * the error propagated, `skipped` when the user skipped it (the only path that
 * resolves to `null`), and `interrupted` when the process ended under it (the
 * run itself is swept to `aborted` on the next read).
 */
export type WorkflowAgentStatus =
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "interrupted";

export interface WorkflowAgentState {
  /** The `agent()` call index within the run (also the activity log's file name). */
  index: number;
  /** `opts.label`, when the script gave one. */
  label?: string;
  agentType?: string;
  /** Phase the agent started in (explicit `opts.phase`, else the current one). */
  phase?: string;
  model?: string;
  status: WorkflowAgentStatus;
  startTime?: number;
  endTime?: number;
  tokens?: number;
  toolUses?: number;
  /** First {@link WORKFLOW_AGENT_PREVIEW_CHARS} chars of the prompt it received. */
  promptPreview?: string;
  /** First {@link WORKFLOW_AGENT_PREVIEW_CHARS} chars of its result (or error). */
  resultPreview?: string;
  /** Failure message, for `failed` / `skipped` / `interrupted` entries. */
  error?: string;
  /**
   * Replayed from a previous run's journal: no subagent ran, so there is no
   * activity log to show.
   */
  cached?: boolean;
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
