import { randomUUID } from "crypto";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { Container } from "../utils/container.js";
import { BackgroundTaskManager } from "./backgroundTaskManager.js";
import { MessageQueue } from "./messageQueue.js";
import { SubagentManager } from "./subagentManager.js";
import { taskNotificationToXml } from "../utils/notificationXml.js";
import { ConcurrencyLimiter } from "../workflow/concurrencyLimiter.js";
import { TurnBudgetLedger } from "./turnBudgetLedger.js";
import { ProgressReporter } from "../workflow/progressReporter.js";
import { Journal } from "../workflow/journal.js";
import {
  createWorkflowApis,
  type WorkflowApis,
} from "../workflow/workflowApis.js";
import {
  validateScript,
  parseScript,
  executeScript,
} from "../workflow/scriptRuntime.js";
import type { WorkflowRun } from "../workflow/types.js";
import { RunStateStore } from "../workflow/runState.js";
import { isWorkflowRunOversized } from "../workflow/workflowErrors.js";
import { logger } from "../utils/globalLogger.js";

/**
 * Per-workflow agent concurrency: min(16, max(2, cpus - 2)) — Claude Code's
 * formula, so a 1-3 core box still runs 2 agents instead of serialising.
 */
const DEFAULT_CONCURRENCY = () =>
  Math.min(16, Math.max(2, os.cpus().length - 2));

/** Failure details embedded in a notification summary before it is truncated. */
const MAX_FAILURES_IN_SUMMARY = 5;

/**
 * Script result chars carried in a completion notification. A research script
 * returns findings + sources + stats — useful as-is, but a run whose agents each
 * returned a long document could hand the model hundreds of KB it has to pay
 * for. Past this the notification carries a prefix plus the path of the full
 * result (spec「停止运行并如实上报失败」场景 9).
 */
const MAX_RESULT_CHARS_IN_SUMMARY = 8000;

/**
 * Script-log retention on the run (`WorkflowRun.logs`): past
 * `WORKFLOW_LOG_TRIM_THRESHOLD` accumulated lines the oldest are dropped down to
 * `MAX_WORKFLOW_LOG_LINES`. Same order of magnitude as Claude Code's cap on its
 * task-side progress entries (drop oldest past 1000, keep 500) — a workflow that
 * logs per item would otherwise grow `run-state.json` without bound.
 */
const WORKFLOW_LOG_TRIM_THRESHOLD = 1000;
const MAX_WORKFLOW_LOG_LINES = 500;

/** Append a script `log()` line to the run, trimming the oldest past the cap. */
function appendWorkflowLog(run: WorkflowRun, message: string): void {
  const logs = (run.logs ??= []);
  logs.push(message);
  if (logs.length > WORKFLOW_LOG_TRIM_THRESHOLD) {
    logs.splice(0, logs.length - MAX_WORKFLOW_LOG_LINES);
  }
}

/**
 * The script's `return` value, shaped for a completion notification.
 *
 * The value is arbitrary script output — a report object, or markup the script
 * fetched from the web — and the notification is read back with `<tag>…</tag>`
 * regexes, so a raw `<` that begins a tag can cut the block short (`</result>`)
 * or forge a field that is read after it (a payload containing
 * `<status>failed</status>` made a successful run parse as failed). Every raw
 * tag opener is escaped; the payload stays readable, HTML entities included.
 * Returns null when there is nothing worth sending, so the caller can leave the
 * block out entirely.
 *
 * `sanitizeResult` already guaranteed the value is JSON-serializable at the
 * script boundary, so stringify here cannot throw.
 */
function summarizeRunResult(
  run: WorkflowRun,
  journalPath: string | undefined,
): string | null {
  const value = run.result;
  if (value === undefined || value === null) return null;

  // Compact JSON on purpose: this text is billed as context, and the model reads
  // the structure either way.
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  if (serialized === "" || serialized === "{}" || serialized === "[]") {
    return null;
  }

  const escaped = serialized.replace(/<(?=[a-zA-Z/!?])/g, "&lt;");
  if (escaped.length <= MAX_RESULT_CHARS_IN_SUMMARY) {
    return escaped;
  }

  const statePath = path.join(
    journalPath ? path.dirname(journalPath) : path.dirname(run.scriptPath),
    "run-state.json",
  );
  return (
    escaped.slice(0, MAX_RESULT_CHARS_IN_SUMMARY) +
    `\n… [result truncated at ${MAX_RESULT_CHARS_IN_SUMMARY} chars — the full value is in ${statePath}]`
  );
}

export class WorkflowManager {
  /**
   * In-memory runs, keyed by the runs directory they belong to — one entry per
   * session this Agent instance has lived through (`/clear` mints a new session
   * id on the SAME Agent). Keeping them apart is what makes the session boundary
   * hold in-process: after a clear the previous conversation's runs are neither
   * listed nor resumable, while a run that is still executing is not destroyed —
   * it stays reachable by its own id (`TaskStop` goes through the abort
   * controllers) and still reports its completion notification.
   */
  private runsByDir = new Map<string, Map<string, WorkflowRun>>();
  private abortControllers = new Map<string, AbortController>();
  private agentControllers = new Map<string, Map<number, AbortController>>();
  private container: Container;
  private stateStores = new Map<string, RunStateStore>();

  constructor(container: Container) {
    this.container = container;
    // Everything directory-dependent (runs + run-state store) resolves lazily:
    // both need MessageManager, which is registered after this constructor runs.
  }

  private get runs(): Map<string, WorkflowRun> {
    return this.runsFor(this.runsDir);
  }

  private runsFor(dir: string): Map<string, WorkflowRun> {
    let runs = this.runsByDir.get(dir);
    if (!runs) {
      runs = new Map<string, WorkflowRun>();
      this.runsByDir.set(dir, runs);
    }
    return runs;
  }

  private get stateStore(): RunStateStore {
    return this.stateStoreFor(this.runsDir);
  }

  private stateStoreFor(dir: string): RunStateStore {
    let store = this.stateStores.get(dir);
    if (!store) {
      store = new RunStateStore(dir);
      this.stateStores.set(dir, store);
    }
    return store;
  }

  /**
   * Directory of the run itself (`<runsDir>/<runId>`): script.js, `agents/`
   * metadata, everything that belongs to this one run. Derived from the run's
   * own script path rather than from `runsDir`: a run outlives the session id it
   * started under when `/clear` mints a new one mid-flight, and its files must
   * keep being written where the run actually lives.
   */
  private runDirOf(run: WorkflowRun): string {
    return path.dirname(run.scriptPath);
  }

  /**
   * The runs directory the run lives in — the parent of `runDirOf`, i.e.
   * `<project>/workflows/<sessionId>`. Journals and run-state live HERE (one
   * per run id), not inside the run's own directory: `listRuns()` and the resume
   * path both look for `<runsDir>/<runId>/…`, so writing them a level deeper
   * would make every finished run invisible to the next process and every
   * resume start from an empty journal.
   */
  private runsDirOf(run: WorkflowRun): string {
    return path.dirname(this.runDirOf(run));
  }

  /**
   * Write a run's state and WAIT for it before the caller moves on.
   *
   * Both terminal paths call this before enqueueing the completion
   * notification, because that notification tells the model where the full
   * result lives (`… [result truncated at 8000 chars — the full value is in
   * <run-state.json>]`) and a reader that reaches the file before the write
   * lands reads a zero-byte file. Fire-and-forget here loses that race readily
   * on Windows (the CI failure was `Unexpected end of JSON input` on exactly
   * this read). Same reasoning as the interrupted-run sweep below.
   *
   * Swallows the error after logging: a failed state write must not turn a
   * completed run into a failed one.
   */
  private async persistRunState(
    runsDir: string,
    run: WorkflowRun,
  ): Promise<void> {
    try {
      await this.stateStoreFor(runsDir).save(run);
    } catch (err) {
      logger.warn(
        `[Workflow] Failed to persist run state: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private get backgroundTaskManager(): BackgroundTaskManager {
    return this.container.get<BackgroundTaskManager>("BackgroundTaskManager")!;
  }

  private get messageQueue(): MessageQueue {
    return this.container.get<MessageQueue>("MessageQueue")!;
  }

  private get subagentManager(): SubagentManager {
    return this.container.get<SubagentManager>("SubagentManager")!;
  }

  private get workdir(): string {
    return this.container.get<string>("workdir") || process.cwd();
  }

  /**
   * The turn's output-token ledger. It is registered by the agent container
   * setup, so this resolves the SAME instance the main agent loop counts into
   * and every concurrent workflow of the turn reads (spec
   * multi-agent/workflow.md 场景 5). A standalone container (tests, embedders)
   * gets its own, whose `total` stays null — no cap, no shared spend.
   */
  private get turnBudgetLedger(): TurnBudgetLedger {
    const existing = this.container.get<TurnBudgetLedger>("TurnBudgetLedger");
    if (existing) return existing;
    const ledger = new TurnBudgetLedger();
    this.container.register("TurnBudgetLedger", ledger);
    return ledger;
  }

  /**
   * The turn's token target, or null when the user gave none — the number the
   * start receipt states back to the model, next to the agent call cap
   * (spec「预算与规模硬上限」场景 8: the model must be able to name the
   * constraint it just launched under before the user asks).
   */
  getTurnTokenTarget(): number | null {
    return this.turnBudgetLedger.total;
  }

  /**
   * Directory holding the runs of THIS session: two levels, both load-bearing.
   *
   * 1. The project directory (`<projects>/<encoded workdir>` — the directory the
   *    transcript lives in), NOT the session root: keying runs off
   *    `~/.wave/projects` made `listRuns()` — and therefore `/workflows` and
   *    `resumeFromRunId` — see every run of every project on the machine.
   * 2. The session id, because a run belongs to the conversation that started
   *    it. Claude Code draws the same line — `resumeFromRunId`'s schema says
   *    "Same-session only. Stop the prior run first before resuming", and a run's
   *    journal can only be re-read by the session that owns it. Restoring a
   *    session keeps its id, so its runs stay reachable.
   *
   * Both come from the same place as the transcript path, so they are consistent
   * by construction (spec multi-agent/workflow.md「从日志恢复工作流」场景 3).
   */
  private get runsDir(): string {
    const messageManager =
      this.container.get<import("./messageManager.js").MessageManager>(
        "MessageManager",
      );
    if (!messageManager) {
      // No MessageManager means no session identity at all (embedders, tests):
      // there is nothing to scope by, so fall back to the shared project root.
      return path.join(os.homedir(), ".wave", "projects", "workflows");
    }
    return path.join(
      messageManager.getProjectDir(),
      "workflows",
      messageManager.getSessionId(),
    );
  }

  /**
   * Create a new workflow run from a script string or file path.
   * Persists the script to the session directory.
   */
  async createRun(
    script: string,
    args?: unknown,
    opts?: { resumeFromRunId?: string },
  ): Promise<WorkflowRun> {
    // Validate script
    const validation = validateScript(script);
    if (!validation.valid) {
      throw new Error(
        `Script validation failed:\n${validation.errors.join("\n")}`,
      );
    }

    // Parse meta for the run object
    const { meta } = parseScript(script);

    // Validate resumeFromRunId if provided
    if (opts?.resumeFromRunId) {
      const prevRun = this.runs.get(opts.resumeFromRunId);
      if (!prevRun) {
        throw new Error(
          `Cannot resume: run ${opts.resumeFromRunId} not found in this session`,
        );
      }
    }

    // Generate run ID and persist script
    const runId = `wf_${randomUUID().slice(0, 8)}`;
    const runDir = path.join(this.runsDir, runId);
    await fs.promises.mkdir(path.join(runDir, "agents"), { recursive: true });
    const scriptPath = path.join(runDir, "script.js");
    await fs.promises.writeFile(scriptPath, script, "utf-8");

    const run: WorkflowRun = {
      runId,
      meta,
      status: "running",
      scriptPath,
      args,
      startTime: Date.now(),
      phases: [],
      totalAgents: 0,
      totalTokens: 0,
      failures: [],
      resumeFromRunId: opts?.resumeFromRunId,
      logs: [],
    };

    this.runs.set(runId, run);

    // Persist run state — into the RUNS directory (the store appends the run id
    // itself), which is where `listRuns()` and the resume path look for it.
    //
    // Awaited, so every snapshot of this run reaches the file in the order it
    // was taken. Fire-and-forget here means a slow first write can land AFTER
    // the terminal snapshot and overwrite it — the run file then says "running,
    // no result" forever (and on Windows this is the same race that surfaced as
    // `Unexpected end of JSON input`: a reader reaching the file mid-write).
    await this.persistRunState(this.runsDir, run);

    return run;
  }

  /**
   * Start executing a workflow run in the background.
   * Returns immediately; the workflow runs asynchronously.
   */
  async startRun(
    runId: string,
    opts?: { retryAgentIndex?: number },
  ): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Workflow run ${runId} not found`);
    if (run.status !== "running")
      throw new Error(`Workflow run ${runId} is not in running state`);

    const abortController = new AbortController();
    this.abortControllers.set(runId, abortController);
    const runAgentControllers = new Map<number, AbortController>();
    this.agentControllers.set(runId, runAgentControllers);

    // Read script from file
    const script = await fs.promises.readFile(run.scriptPath, "utf-8");

    // Set up infrastructure
    const concurrencyLimiter = new ConcurrencyLimiter(DEFAULT_CONCURRENCY());
    // The budget the script reads comes from the turn's shared ledger, not from
    // the run's args: `args.budget` was a wave-only magic key with no counterpart
    // in Claude Code, and the token target is a property of the turn (parsed off
    // the user's message), not of a run.
    const ledger = this.turnBudgetLedger;
    const progressReporter = new ProgressReporter(run.meta, runId);

    // Forward progress events: mirror live counts onto the WorkflowRun and
    // trigger a UI refresh so /workflows updates mid-execution (not just at
    // completion). The UI reads getWorkflowRuns() -> listRuns(), which returns
    // these same in-memory run objects.
    const onProgress = (
      event: import("../workflow/types.js").WorkflowProgressEvent,
    ) => {
      logger.debug(
        `[Workflow:${runId}] progress: ${event.type} phase=${event.phaseIndex} agent=${event.agentIndex}`,
      );
      run.phases = progressReporter.getPhaseStates();
      run.totalAgents = progressReporter.totalAgents;
      run.totalTokens = progressReporter.totalTokens;
      this.logSizeCrossing(run);
      this.backgroundTaskManager.notifyTasksChange();
    };
    progressReporter.onEvent(onProgress);

    // Journal — load previous journal if resuming. Pinned to the runs directory
    // the run belongs to (see `runsDirOf`), not to the session's current one.
    const runDir = this.runDirOf(run);
    const runsDir = this.runsDirOf(run);
    let journal: Journal;
    let initialAgentCount = 0;
    if (run.resumeFromRunId || opts?.retryAgentIndex !== undefined) {
      // Try new-format path first, fall back to old format
      const sourceRunId = run.resumeFromRunId || runId;
      const newJournalPath = path.join(runsDir, sourceRunId, "journal.jsonl");
      const oldJournalPath = path.join(runsDir, `journal-${sourceRunId}.jsonl`);
      const journalPath = (await fs.promises
        .access(newJournalPath)
        .then(() => true)
        .catch(() => false))
        ? newJournalPath
        : oldJournalPath;
      journal = await Journal.load(journalPath);

      // When retrying a specific agent, remove its failed entry
      if (opts?.retryAgentIndex !== undefined) {
        journal.removeFailedEntry(opts.retryAgentIndex);
      }

      // Count existing agent entries to offset the counter
      initialAgentCount = journal.agentEntryCount;
      // Re-open for appending (load() doesn't open the write stream)
      await journal.init();
      logger.info(
        `[Workflow] Resuming from ${sourceRunId} with ${initialAgentCount} cached agent results`,
      );
    } else {
      const journalPath = path.join(runsDir, runId, "journal.jsonl");
      journal = new Journal(journalPath);
      await journal.init();
    }

    // Register as background task. The task id IS the runId: the receipt and
    // the completion notification both surface the runId (notification
    // <task-id>, receipt "Run ID"), so `TaskStop({task_id: "wf_..."})` must
    // resolve to this same registry key. Generating a separate
    // `task_<pid>_<n>` id here left the model with an id it could not stop.
    const taskId = runId;
    this.backgroundTaskManager.addTask({
      id: taskId,
      type: "workflow",
      status: "running",
      startTime: Date.now(),
      stdout: "",
      stderr: "",
      description: `Workflow: ${run.meta.name}`,
      runId,
      onStop: () => {
        abortController.abort();
      },
    });

    // Create workflow APIs
    const apis = createWorkflowApis({
      subagentManager: this.subagentManager,
      concurrencyLimiter,
      ledger,
      progressReporter,
      journal,
      abortSignal: abortController.signal,
      args: run.args,
      initialAgentCount,
      runDir,
      agentControllers: runAgentControllers,
      onLog: (message: string) => {
        logger.info(`[Workflow:${runId}] ${message}`);
        appendWorkflowLog(run, message);
        // Push the new line. The progress events push on every phase/agent
        // change, but a script that only logs between agents would otherwise
        // leave both dialogs on a stale tail until the next phase flips.
        this.backgroundTaskManager.notifyTasksChange();
      },
    });

    // Execute in background
    run.completionPromise = (async () => {
      try {
        const { result } = await executeScript(
          script,
          apis,
          abortController.signal,
        );

        // Update run state
        run.status = "completed";
        run.endTime = Date.now();
        run.result = result;
        run.phases = progressReporter.getPhaseStates();
        run.totalAgents = progressReporter.totalAgents;
        run.totalTokens = progressReporter.totalTokens;
        run.failures = apis.getFailures();

        // Persist final state — awaited, because the notification below sends
        // the model to this file for the truncated-away tail of the result.
        await this.persistRunState(runsDir, run);

        // Close journal
        await journal.close();

        // Update background task status
        const task = this.backgroundTaskManager.getTask(taskId);
        if (task) {
          task.status = "completed";
          task.endTime = Date.now();
        }
        // Push the terminal snapshot: without it the last snapshot holds the
        // "running" registration and UI consumers (background-task gate) never
        // see the workflow finish.
        this.backgroundTaskManager.notifyTasksChange();

        // Enqueue completion notification
        const journalPath = journal.filePath;
        const resultForModel = summarizeRunResult(run, journalPath);
        this.messageQueue.enqueueNotification(
          taskNotificationToXml({
            type: "task_notification",
            taskId: runId,
            taskType: "workflow",
            status: "completed",
            summary: this.buildRunSummary(run, apis, "completed"),
            ...(journalPath && { outputFile: journalPath }),
            ...(resultForModel && { result: resultForModel }),
          }),
        );

        const failureCount = (run.failures ?? []).length;
        logger.info(
          `[Workflow] Run ${runId} completed: ${run.totalAgents} agents, ${run.totalTokens} tokens${failureCount > 0 ? `, ${failureCount} failure(s)` : ""}`,
        );
      } catch (error) {
        // Only update if stopRun hasn't already set the status
        if (run.status === "running") {
          if (abortController.signal.aborted) {
            run.status = "aborted";
          } else {
            run.status = "failed";
            run.error = error instanceof Error ? error.message : String(error);
          }
          run.endTime = Date.now();
        }
        run.phases = progressReporter.getPhaseStates();
        run.totalAgents = progressReporter.totalAgents;
        run.totalTokens = progressReporter.totalTokens;
        run.failures = apis.getFailures();

        // Persist failure/abort state (awaited for the same reason as the
        // completion path: the status a reader sees must not lag the
        // notification that reports it).
        await this.persistRunState(runsDir, run);

        await journal.close();

        // Update background task status
        const task = this.backgroundTaskManager.getTask(taskId);
        if (task) {
          task.status = abortController.signal.aborted ? "killed" : "failed";
          task.stderr = run.error || "";
          task.endTime = Date.now();
        }
        // Push the terminal snapshot (see the completion branch above).
        this.backgroundTaskManager.notifyTasksChange();

        // The failed run points at the same files as a completed one: the journal
        // carries every agent's prompt/result and `agents/<index>.meta.json` links
        // each one to its transcript, so the model can read before concluding
        // (spec「停止运行并如实上报失败」场景 6).
        const failureJournalPath = journal.filePath;
        this.messageQueue.enqueueNotification(
          taskNotificationToXml({
            type: "task_notification",
            taskId: runId,
            taskType: "workflow",
            status: run.status === "aborted" ? "aborted" : "failed",
            summary: this.buildRunSummary(
              run,
              apis,
              run.status === "aborted" ? "aborted" : "failed",
            ),
            ...(failureJournalPath && { outputFile: failureJournalPath }),
          }),
        );

        logger.warn(
          `[Workflow] Run ${runId} ${run.status}: ${run.error || "aborted"}`,
        );
      } finally {
        this.abortControllers.delete(runId);
        this.agentControllers.delete(runId);
      }
    })();

    // Don't await — let it run in background
    run.completionPromise.catch(() => {}); // Prevent unhandled rejection
  }

  /**
   * Log the moment a run crosses a size threshold. Crossing marks the run as
   * oversized in the workflow UI (spec「预算与规模硬上限」场景 7); the model is
   * not told, so this log line is the only trace left for whoever debugs a run
   * that got big.
   *
   * The `run.sizeWarning` assignment here is what makes it fire once (the field
   * is sticky, and the counters only grow); the authoritative verdict for the
   * snapshot is derived in `listRuns()`, which is also what covers a run read
   * back from disk.
   */
  private logSizeCrossing(run: WorkflowRun): void {
    if (run.sizeWarning || !isWorkflowRunOversized(run)) return;

    run.sizeWarning = true;
    logger.warn(
      `[Workflow] Run ${run.runId} crossed the size threshold: ${run.totalAgents} agents, ${run.totalTokens} tokens`,
    );
  }

  /**
   * Text of the completion/failure notification.
   *
   * The information surface follows the spec (「停止运行并如实上报失败」场景 4
   * 与 6 / 「预算与规模硬上限」): the per-agent tallies in a `<usage>` block, the
   * failure details recorded by pipeline()/parallel()/the script itself, where the
   * per-agent result files live, and Claude Code's resume instruction verbatim
   * (evidence §4: "relaunch with Workflow({scriptPath, resumeFromRunId}) …
   * completed agent() calls return cached"). The run id it tells the model to
   * reuse travels in the same notification's `<task-id>` (the runId IS the
   * background task id). It stays inside the existing `<summary>` tag — no new
   * XML tags, the decoder (utils/notificationXml.ts) only knows the ones that are
   * there, so the `<usage>`/`<agents_*>` names are text inside the summary, not
   * tags the decoder has to learn.
   */
  private buildRunSummary(
    run: WorkflowRun,
    apis: WorkflowApis,
    outcome: "completed" | "failed" | "aborted",
  ): string {
    const stats = apis.getStats();
    const failures = apis.getFailures();

    // The headline carries NO counts (Claude Code's verbatim shape:
    // `Dynamic workflow "<name>" completed` / `failed: <error>` / `was stopped`).
    // "0 failed" sitting next to a `Failures:` line reads as a contradiction —
    // the tallies belong in the `<usage>` block below, where the tag names also
    // say what is being counted (agents, not runs).
    const headline =
      outcome === "completed"
        ? `Dynamic workflow "${run.meta.name}" completed`
        : `Dynamic workflow "${run.meta.name}" ${outcome}${run.error ? `: ${run.error}` : ""}`;

    // Claude Code's `<usage>` block verbatim in tag names and units. `agent_count`
    // is every agent() call that started, `agents_done` are the ones that returned
    // a result, `agents_error` the ones that threw, `agents_skipped` the user
    // skips (counted apart from errors, see the kernel) and `agents_empty_result`
    // the ones that returned `null`/`undefined`/an empty container.
    const durationMs = (run.endTime ?? Date.now()) - run.startTime;
    const usage =
      `<usage>` +
      `<agent_count>${run.totalAgents}</agent_count>` +
      `<agents_done>${stats.completed}</agents_done>` +
      `<agents_error>${stats.failed}</agents_error>` +
      `<agents_skipped>${stats.skipped}</agents_skipped>` +
      `<agents_empty_result>${stats.empty}</agents_empty_result>` +
      `<subagent_tokens>${run.totalTokens}</subagent_tokens>` +
      `<tool_uses>${stats.toolUses}</tool_uses>` +
      `<duration_ms>${durationMs}</duration_ms>` +
      `</usage>`;

    const parts = [headline, usage];

    if (failures.length > 0) {
      const shown = failures.slice(0, MAX_FAILURES_IN_SUMMARY);
      const hidden = failures.length - shown.length;
      parts.push(
        `Failures: ${shown.join("; ")}${hidden > 0 ? `; … (+${hidden} more)` : ""}`,
      );
    }

    parts.push(
      // Derived from the run's own script path rather than from `runsDir`: a run
      // outlives the session id it started under when `/clear` mints a new one
      // mid-flight, and the notification has to point at the files that exist.
      `Agent results: ${path.join(path.dirname(run.scriptPath), "agents", "<index>.meta.json")}`,
    );
    parts.push(
      `To pick up where it left off, relaunch with Workflow({scriptPath, resumeFromRunId}) using the run id from the summary — completed agent() calls return cached.`,
    );

    return parts.join("\n");
  }

  /**
   * Resume a workflow run from its journal.
   */
  async resumeRun(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Workflow run ${runId} not found`);

    run.status = "running";
    await this.startRun(runId);
  }

  /**
   * Stop a running workflow.
   */
  stopRun(runId: string): void {
    const controller = this.abortControllers.get(runId);
    if (controller) {
      controller.abort();
    }
    const run = this.runs.get(runId);
    if (run && run.status === "running") {
      run.status = "aborted";
      run.endTime = Date.now();
    }
  }

  /**
   * Skip a specific agent in a running workflow.
   * Aborts the agent's controller and lets the workflow continue.
   */
  skipAgent(runId: string, agentIndex: number): void {
    const run = this.runs.get(runId);
    if (!run || run.status !== "running") return;

    const agentController = this.agentControllers.get(runId)?.get(agentIndex);
    if (agentController) {
      agentController.abort();
    }
  }

  /**
   * Retry a specific agent by removing its journal entry and resuming.
   */
  async retryAgent(runId: string, agentIndex: number): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Workflow run ${runId} not found`);

    // Stop the current execution
    this.stopRun(runId);

    // The journal will have cached results; when we resume,
    // the agent_failed entry for this index will cause getCachedResult
    // to return undefined, forcing re-execution
    run.status = "running";
    run.error = undefined;
    run.failedAgentIndex = undefined;
    run.failedAgentError = undefined;
    await this.startRun(runId, { retryAgentIndex: agentIndex });
  }

  /**
   * Kill a running workflow — aborts all agent controllers plus the run controller.
   */
  killRun(runId: string): void {
    // Abort all per-agent controllers
    const agentControllers = this.agentControllers.get(runId);
    if (agentControllers) {
      for (const controller of agentControllers.values()) {
        controller.abort();
      }
    }

    // Abort the run controller
    const controller = this.abortControllers.get(runId);
    if (controller) {
      controller.abort();
    }

    const run = this.runs.get(runId);
    if (run && run.status === "running") {
      run.status = "aborted";
      run.endTime = Date.now();
    }
  }

  /**
   * List all workflow runs (includes in-memory and persisted).
   *
   * Loading the list is also where stale `running` states converge: a run only
   * lives in the process that started it, so a persisted run that is still
   * marked `running` while this process has no in-memory record of it was
   * interrupted by a process exit (host closed, Ctrl-C, crash) and must stop
   * claiming to run (spec「停止运行并如实上报失败」场景 8 — no cross-process
   * takeover is required or attempted). The correction is written back to disk
   * and announced once per interrupted run, so a later process — and the user —
   * inherits the truth instead of an eternally "running" ghost.
   */
  async listRuns(): Promise<WorkflowRun[]> {
    // Load persisted runs that aren't already in memory
    const persistedIds = await this.stateStore.listRuns();
    const interrupted: WorkflowRun[] = [];
    for (const runId of persistedIds) {
      if (!this.runs.has(runId)) {
        const run = await this.stateStore.load(runId);
        if (run) {
          if (run.status === "running") {
            this.markInterrupted(run);
            interrupted.push(run);
          }
          this.runs.set(runId, run);
        }
      }
    }

    for (const run of interrupted) {
      // Awaited, not fire-and-forget: the point of the correction is that the
      // next reader — the next process, the /workflows detail view — sees an
      // ended run, and returning before the write lands would hand out the
      // ghost we just buried.
      try {
        await this.stateStore.save(run);
      } catch (err) {
        logger.warn(
          `[Workflow] Failed to persist interrupted state: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      this.notifyInterrupted(run);
    }

    // The oversized marker is derived here, at the one boundary every UI
    // surface reads (`getWorkflowRuns()`), rather than tracked as state: the
    // verdict is a function of the counters, so a run read back from disk is
    // marked exactly like a live one, and nothing has to be persisted
    // (spec「预算与规模硬上限」场景 7).
    const runs = Array.from(this.runs.values());
    for (const run of runs) {
      run.sizeWarning = isWorkflowRunOversized(run);
    }

    return runs;
  }

  /**
   * Turn a stale `running` run into an aborted one, in place. The status word is
   * the existing `aborted` (the same state a user-requested stop produces) — the
   * difference from a stop is the error text, which says who ended it.
   */
  private markInterrupted(run: WorkflowRun): void {
    run.status = "aborted";
    run.endTime = run.endTime ?? Date.now();
    run.error = "interrupted: the process that was running it exited";
  }

  /**
   * One notification per interrupted run, pointing at the resume path. It goes
   * through the same queue as a completion notification, so the model finds out
   * the run is gone instead of waiting forever for a notification that will
   * never arrive.
   */
  private notifyInterrupted(run: WorkflowRun): void {
    this.messageQueue.enqueueNotification(
      taskNotificationToXml({
        type: "task_notification",
        taskId: run.runId,
        taskType: "workflow",
        status: "aborted",
        summary: this.buildInterruptedSummary(run),
      }),
    );

    logger.warn(`[Workflow] Run ${run.runId} marked interrupted on load`);
  }

  /** Resume guidance for a run whose process exited (see `listRuns`). */
  private buildInterruptedSummary(run: WorkflowRun): string {
    return (
      `Dynamic workflow "${run.meta.name}" was interrupted: the process running it exited. ` +
      `To pick up where it left off, relaunch with Workflow({scriptPath, resumeFromRunId: "${run.runId}"}) ` +
      `using the run id from this summary — completed agent() calls return cached.`
    );
  }

  /**
   * Get a specific workflow run.
   */
  getRun(runId: string): WorkflowRun | undefined {
    return this.runs.get(runId);
  }

  /**
   * Clean up all running workflows.
   */
  cleanup(): void {
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    this.abortControllers.clear();
    for (const agentMap of this.agentControllers.values()) {
      for (const controller of agentMap.values()) {
        controller.abort();
      }
    }
    this.agentControllers.clear();
    // Every session this Agent instance lived through: teardown is not scoped.
    for (const runs of this.runsByDir.values()) {
      for (const run of runs.values()) {
        if (run.status === "running") {
          run.status = "aborted";
          run.endTime = Date.now();
        }
      }
    }
  }
}
