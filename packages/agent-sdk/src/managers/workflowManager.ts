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
import { logger } from "../utils/globalLogger.js";

const DEFAULT_CONCURRENCY = () =>
  Math.max(1, Math.min(16, os.cpus().length - 2));

export class WorkflowManager {
  private runs = new Map<string, WorkflowRun>();
  private abortControllers = new Map<string, AbortController>();
  private container: Container;

  constructor(container: Container) {
    this.container = container;
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
    const scriptDir = path.join(this.sessionDir, "workflows");
    await fs.promises.mkdir(scriptDir, { recursive: true });
    const scriptPath = path.join(scriptDir, `${runId}.js`);
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
    return run;
  }

  /**
   * Start executing a workflow run in the background.
   * Returns immediately; the workflow runs asynchronously.
   */
  async startRun(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run) throw new Error(`Workflow run ${runId} not found`);
    if (run.status !== "running")
      throw new Error(`Workflow run ${runId} is not in running state`);

    const abortController = new AbortController();
    this.abortControllers.set(runId, abortController);

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
    const progressReporter = new ProgressReporter(run.meta);

    // Journal — load previous journal if resuming
    let journal: Journal;
    let initialAgentCount = 0;
    if (run.resumeFromRunId) {
      const prevJournalPath = path.join(
        this.sessionDir,
        "workflows",
        `journal-${run.resumeFromRunId}.jsonl`,
      );
      journal = await Journal.load(prevJournalPath);
      // Count existing agent entries to offset the counter
      initialAgentCount = journal.agentEntryCount;
      // Re-open for appending (load() doesn't open the write stream)
      await journal.init();
      logger.info(
        `[Workflow] Resuming from ${run.resumeFromRunId} with ${initialAgentCount} cached agent results`,
      );
    } else {
      const journalPath = path.join(
        this.sessionDir,
        "workflows",
        `journal-${runId}.jsonl`,
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

        // Close journal
        await journal.close();

        // Update background task status
        const task = this.backgroundTaskManager.getTask(taskId);
        if (task) {
          task.status = "completed";
          task.endTime = Date.now();
        }

        // Enqueue completion notification
        this.notificationQueue.enqueue(
          taskNotificationToXml({
            type: "task_notification",
            taskId: runId,
            taskType: "workflow",
            status: "completed",
            summary: `Workflow "${run.meta.name}" completed — ${run.totalAgents} agents, ${(run.totalTokens / 1000).toFixed(1)}k tokens`,
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
   * List all workflow runs.
   */
  listRuns(): WorkflowRun[] {
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
    for (const run of this.runs.values()) {
      if (run.status === "running") {
        run.status = "aborted";
        run.endTime = Date.now();
      }
    }
  }
}
