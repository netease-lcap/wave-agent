import { randomUUID } from "crypto";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { Container } from "../utils/container.js";
import { BackgroundTaskManager } from "./backgroundTaskManager.js";
import { NotificationQueue } from "./notificationQueue.js";
import { SubagentManager } from "./subagentManager.js";
import { taskNotificationToXml } from "../utils/notificationXml.js";
import { ConcurrencyLimiter } from "../workflow/concurrencyLimiter.js";
import { BudgetTracker } from "../workflow/budgetTracker.js";
import { ProgressReporter } from "../workflow/progressReporter.js";
import { Journal } from "../workflow/journal.js";
import { createWorkflowApis } from "../workflow/workflowApis.js";
import {
  validateScript,
  parseScript,
  executeScript,
} from "../workflow/scriptRuntime.js";
import type { WorkflowRun } from "../workflow/types.js";
import { RunStateStore } from "../workflow/runState.js";
import { logger } from "../utils/globalLogger.js";

const DEFAULT_CONCURRENCY = () =>
  Math.max(1, Math.min(16, os.cpus().length - 2));

export class WorkflowManager {
  private runs = new Map<string, WorkflowRun>();
  private abortControllers = new Map<string, AbortController>();
  private agentControllers = new Map<string, Map<number, AbortController>>();
  private container: Container;
  private runStateStore: RunStateStore | null = null;

  constructor(container: Container) {
    this.container = container;
    // Initialize RunStateStore lazily (sessionDir depends on MessageManager)
  }

  private get stateStore(): RunStateStore {
    if (!this.runStateStore) {
      this.runStateStore = new RunStateStore(
        path.join(this.sessionDir, "workflows"),
      );
    }
    return this.runStateStore;
  }

  private get backgroundTaskManager(): BackgroundTaskManager {
    return this.container.get<BackgroundTaskManager>("BackgroundTaskManager")!;
  }

  private get notificationQueue(): NotificationQueue {
    return this.container.get<NotificationQueue>("NotificationQueue")!;
  }

  private get subagentManager(): SubagentManager {
    return this.container.get<SubagentManager>("SubagentManager")!;
  }

  private get workdir(): string {
    return this.container.get<string>("workdir") || process.cwd();
  }

  private get sessionDir(): string {
    const messageManager =
      this.container.get<import("./messageManager.js").MessageManager>(
        "MessageManager",
      );
    return (
      messageManager?.getSessionDir() ||
      path.join(os.homedir(), ".wave", "sessions")
    );
  }

  /**
   * Create a new workflow run from a script string or file path.
   * Persists the script to the session directory.
   */
  async createRun(
    script: string,
    args?: unknown,
    opts?: { budget?: number | null; resumeFromRunId?: string },
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
        throw new Error(`Cannot resume: run ${opts.resumeFromRunId} not found`);
      }
    }

    // Generate run ID and persist script
    const runId = `wf_${randomUUID().slice(0, 8)}`;
    const runDir = path.join(this.sessionDir, "workflows", runId);
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
      resumeFromRunId: opts?.resumeFromRunId,
    };

    this.runs.set(runId, run);

    // Persist run state
    this.stateStore.save(run).catch((err) => {
      logger.warn(
        `[Workflow] Failed to persist run state: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

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
    const budgetTracker = new BudgetTracker(
      run.args &&
      typeof run.args === "object" &&
      "budget" in (run.args as Record<string, unknown>)
        ? ((run.args as Record<string, unknown>).budget as number | null)
        : null,
    );
    const progressReporter = new ProgressReporter(run.meta, runId);

    // Forward progress events via onProgress callback
    const onProgress = (
      event: import("../workflow/types.js").WorkflowProgressEvent,
    ) => {
      logger.debug(
        `[Workflow:${runId}] progress: ${event.type} phase=${event.phaseIndex} agent=${event.agentIndex}`,
      );
    };
    progressReporter.onEvent(onProgress);

    // Journal — load previous journal if resuming
    let journal: Journal;
    let initialAgentCount = 0;
    if (run.resumeFromRunId || opts?.retryAgentIndex !== undefined) {
      // Try new-format path first, fall back to old format
      const sourceRunId = run.resumeFromRunId || runId;
      const newJournalPath = path.join(
        this.sessionDir,
        "workflows",
        sourceRunId,
        "journal.jsonl",
      );
      const oldJournalPath = path.join(
        this.sessionDir,
        "workflows",
        `journal-${sourceRunId}.jsonl`,
      );
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
      const journalPath = path.join(
        this.sessionDir,
        "workflows",
        runId,
        "journal.jsonl",
      );
      journal = new Journal(journalPath);
      await journal.init();
    }

    // Register as background task
    const taskId = this.backgroundTaskManager.generateId();
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
      budgetTracker,
      progressReporter,
      journal,
      abortSignal: abortController.signal,
      args: run.args,
      initialAgentCount,
      sessionDir: this.sessionDir,
      runDir: path.join(this.sessionDir, "workflows", runId),
      agentControllers: runAgentControllers,
      onProgress: (event) => {
        logger.debug(
          `[Workflow:${runId}] progress: ${event.type} phase=${event.phaseIndex} agent=${event.agentIndex}`,
        );
      },
      onLog: (message: string) => {
        logger.info(`[Workflow:${runId}] ${message}`);
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

        // Persist final state
        this.stateStore.save(run).catch(() => {});

        // Close journal
        await journal.close();

        // Update background task status
        const task = this.backgroundTaskManager.getTask(taskId);
        if (task) {
          task.status = "completed";
          task.endTime = Date.now();
        }

        // Enqueue completion notification
        const journalPath = journal.filePath;
        this.notificationQueue.enqueue(
          taskNotificationToXml({
            type: "task_notification",
            taskId: runId,
            taskType: "workflow",
            status: "completed",
            summary: `Workflow "${run.meta.name}" completed — ${run.totalAgents} agents, ${(run.totalTokens / 1000).toFixed(1)}k tokens`,
            ...(journalPath && { outputFile: journalPath }),
          }),
        );

        logger.info(
          `[Workflow] Run ${runId} completed: ${run.totalAgents} agents, ${run.totalTokens} tokens`,
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

        // Persist failure/abort state
        this.stateStore.save(run).catch(() => {});

        await journal.close();

        // Update background task status
        const task = this.backgroundTaskManager.getTask(taskId);
        if (task) {
          task.status = abortController.signal.aborted ? "killed" : "failed";
          task.stderr = run.error || "";
          task.endTime = Date.now();
        }

        this.notificationQueue.enqueue(
          taskNotificationToXml({
            type: "task_notification",
            taskId: runId,
            taskType: "workflow",
            status: run.status === "aborted" ? "aborted" : "failed",
            summary: `Workflow "${run.meta.name}" ${run.status}${run.error ? `: ${run.error}` : ""}`,
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
   */
  async listRuns(): Promise<WorkflowRun[]> {
    // Load persisted runs that aren't already in memory
    const persistedIds = await this.stateStore.listRuns();
    for (const runId of persistedIds) {
      if (!this.runs.has(runId)) {
        const run = await this.stateStore.load(runId);
        if (run) {
          this.runs.set(runId, run);
        }
      }
    }
    return Array.from(this.runs.values());
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
    for (const run of this.runs.values()) {
      if (run.status === "running") {
        run.status = "aborted";
        run.endTime = Date.now();
      }
    }
  }
}
