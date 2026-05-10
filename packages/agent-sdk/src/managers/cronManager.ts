import { Container } from "../utils/container.js";
import { CronJob } from "../types/cron.js";
import { AIManager } from "./aiManager.js";
import { MessageManager } from "./messageManager.js";
import { CronExpressionParser } from "cron-parser";
import { logger } from "../utils/globalLogger.js";
import {
  readCronTasks,
  addCronTask,
  removeCronTasks,
  markCronTasksFired,
} from "../utils/cronTasks.js";
import {
  tryAcquireSchedulerLock,
  releaseSchedulerLock,
  registerSchedulerLockCleanup,
} from "../utils/cronTasksLock.js";

export class CronManager {
  private jobs = new Map<string, CronJob>();
  private interval: NodeJS.Timeout | null = null;
  private isOwner = false;
  private lockProbeTimer: NodeJS.Timeout | null = null;
  private cleanupSchedulerLock: (() => void) | null = null;
  private sessionId: string;

  constructor(
    private container: Container,
    sessionId?: string,
  ) {
    this.sessionId = sessionId ?? "unknown";
  }

  private get aiManager(): AIManager {
    return this.container.get<AIManager>("AIManager")!;
  }

  private get messageManager(): MessageManager {
    return this.container.get<MessageManager>("MessageManager")!;
  }

  public start(): void {
    if (this.interval) return;

    // Load durable tasks from file (best-effort, resilient to mocked fs in tests)
    const workdir = this.container.get<string>("Workdir") ?? process.cwd();
    try {
      const durableTasks = readCronTasks(workdir);
      for (const task of durableTasks) {
        // Recalculate runtime fields for loaded tasks
        try {
          const interval = CronExpressionParser.parse(task.cron);
          const nextRunDate = interval.next().toDate();
          const nextRun = nextRunDate.getTime();
          const secondRunDate = interval.next().toDate();
          const periodMs = secondRunDate.getTime() - nextRunDate.getTime();
          const jitteredNextRun = this.applyJitter(
            nextRun,
            periodMs,
            task.recurring,
            nextRunDate,
            task.id,
          );
          this.jobs.set(task.id, {
            ...task,
            nextRun: jitteredNextRun,
            periodMs,
          });
        } catch (e) {
          logger?.warn(
            `CronManager: Failed to restore durable task ${task.id}:`,
            e,
          );
        }
      }
    } catch (e) {
      logger?.warn("CronManager: failed to load durable tasks from disk:", e);
    }

    // Try to acquire scheduler lock (best-effort)
    try {
      this.tryLock(workdir);
    } catch (e) {
      logger?.warn("CronManager: failed to acquire scheduler lock:", e);
    }

    this.interval = setInterval(() => this.checkJobs(), 60000);
    this.interval.unref();

    // Register exit cleanup (best-effort)
    try {
      this.cleanupSchedulerLock = registerSchedulerLockCleanup({
        dir: workdir,
        sessionId: this.sessionId,
      });
    } catch (e) {
      logger?.warn("CronManager: failed to register lock cleanup:", e);
    }
  }

  private tryLock(workdir: string): void {
    tryAcquireSchedulerLock({ dir: workdir, sessionId: this.sessionId })
      .then((acquired) => {
        if (acquired) {
          this.isOwner = true;
          logger?.info("CronManager: acquired scheduler lock");
        } else {
          this.isOwner = false;
          logger?.info(
            "CronManager: another session owns the scheduler lock, will probe periodically",
          );
          // Set up periodic lock probe to take over if owner dies
          this.startLockProbe(workdir);
        }
      })
      .catch((err) => {
        logger?.error("CronManager: failed to acquire scheduler lock:", err);
      });
  }

  private startLockProbe(workdir: string): void {
    if (this.lockProbeTimer) return;
    this.lockProbeTimer = setInterval(() => {
      if (this.isOwner) {
        // Already acquired, stop probing
        if (this.lockProbeTimer) {
          clearInterval(this.lockProbeTimer);
          this.lockProbeTimer = null;
        }
        return;
      }
      tryAcquireSchedulerLock({ dir: workdir, sessionId: this.sessionId })
        .then((acquired) => {
          if (acquired) {
            this.isOwner = true;
            logger?.info("CronManager: acquired scheduler lock (takeover)");
            if (this.lockProbeTimer) {
              clearInterval(this.lockProbeTimer);
              this.lockProbeTimer = null;
            }
          }
        })
        .catch(() => {
          // Ignore probe errors
        });
    }, 5000);
    this.lockProbeTimer.unref();
  }

  public stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.lockProbeTimer) {
      clearInterval(this.lockProbeTimer);
      this.lockProbeTimer = null;
    }
    if (this.cleanupSchedulerLock) {
      this.cleanupSchedulerLock();
      this.cleanupSchedulerLock = null;
    }
    const workdir = this.container.get<string>("Workdir") ?? process.cwd();
    if (this.isOwner) {
      releaseSchedulerLock({ dir: workdir, sessionId: this.sessionId }).catch(
        () => {
          // Best-effort cleanup
        },
      );
    }
  }

  public createJob(
    job: Omit<CronJob, "id" | "createdAt" | "nextRun" | "periodMs">,
  ): CronJob {
    const id = Math.random().toString(36).substring(2, 11);
    const createdAt = Date.now();

    const interval = CronExpressionParser.parse(job.cron);
    const nextRunDate = interval.next().toDate();
    const nextRun = nextRunDate.getTime();

    // Calculate periodMs
    const secondRunDate = interval.next().toDate();
    const periodMs = secondRunDate.getTime() - nextRunDate.getTime();

    // Apply Jitter
    const jitteredNextRun = this.applyJitter(
      nextRun,
      periodMs,
      job.recurring,
      nextRunDate,
      id,
    );

    const newJob: CronJob = {
      ...job,
      id,
      createdAt,
      nextRun: jitteredNextRun,
      periodMs,
    };

    this.jobs.set(id, newJob);

    // Persist durable jobs to file
    if (job.durable) {
      try {
        const workdir = this.container.get<string>("Workdir") ?? process.cwd();
        addCronTask(newJob, workdir);
      } catch (e) {
        logger?.warn(
          `CronManager: failed to persist durable job ${id} to disk:`,
          e,
        );
      }
    }

    return newJob;
  }

  public deleteJob(id: string): boolean {
    const job = this.jobs.get(id);
    const deleted = this.jobs.delete(id);

    // Remove durable jobs from file
    if (deleted && job?.durable) {
      try {
        const workdir = this.container.get<string>("Workdir") ?? process.cwd();
        removeCronTasks([id], workdir);
      } catch (e) {
        logger?.warn(
          `CronManager: failed to remove durable job ${id} from disk:`,
          e,
        );
      }
    }

    return deleted;
  }

  public listJobs(): CronJob[] {
    return Array.from(this.jobs.values());
  }

  private applyJitter(
    nextRun: number,
    periodMs: number,
    recurring: boolean,
    nextRunDate: Date,
    id: string,
  ): number {
    const deterministicRandom = this.getDeterministicRandom(id);
    if (recurring) {
      // Recurring: Random delay up to 10% of period (max 15 min)
      const maxJitter = Math.min(periodMs * 0.1, 15 * 60 * 1000);
      return nextRun + deterministicRandom * maxJitter;
    } else {
      // One-shot: Random early fire up to 90s if scheduled on :00 or :30
      const minutes = nextRunDate.getMinutes();
      const seconds = nextRunDate.getSeconds();
      if ((minutes === 0 || minutes === 30) && seconds === 0) {
        return nextRun - deterministicRandom * 90 * 1000;
      }
    }
    return nextRun;
  }

  private getDeterministicRandom(id: string): number {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      const char = id.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0; // Convert to 32bit integer
    }
    // Use a simple LCG-like approach to get a value between 0 and 1
    const x = Math.sin(hash) * 10000;
    return x - Math.floor(x);
  }

  private async checkJobs(): Promise<void> {
    const now = Date.now();
    const aiManager = this.aiManager;
    const messageManager = this.messageManager;
    const workdir = this.container.get<string>("Workdir") ?? process.cwd();

    for (const [id, job] of this.jobs.entries()) {
      // Expiration: Recurring jobs MUST auto-expire after 7 days
      if (job.recurring && now - job.createdAt > 7 * 24 * 60 * 60 * 1000) {
        this.jobs.delete(id);
        if (job.durable) {
          try {
            removeCronTasks([id], workdir);
          } catch (e) {
            logger?.warn(
              `CronManager: failed to remove expired durable job ${id} from disk:`,
              e,
            );
          }
        }
        continue;
      }

      if (now >= job.nextRun) {
        // Durable tasks only fire if we hold the scheduler lock
        if (job.durable && !this.isOwner) {
          continue;
        }

        // Idle-Check: Only fire jobs if AIManager.isLoading is false
        if (aiManager.isLoading) {
          logger?.debug(`CronManager: Skipping job ${id} because AI is busy`);
          continue;
        }

        logger?.info(`CronManager: Firing job ${id}: ${job.prompt}`);

        // Execution
        messageManager.addUserMessage({ content: job.prompt });
        aiManager.sendAIMessage().catch((err) => {
          logger?.error(`CronManager: Failed to execute job ${id}`, err);
        });

        if (job.recurring) {
          // Schedule next run
          try {
            const interval = CronExpressionParser.parse(job.cron, {
              currentDate: new Date(job.nextRun + 1000),
            });
            const nextRunDate = interval.next().toDate();
            const nextRun = nextRunDate.getTime();
            job.nextRun = this.applyJitter(
              nextRun,
              job.periodMs,
              true,
              nextRunDate,
              id,
            );

            // For durable recurring tasks, batch-write lastFiredAt
            if (job.durable) {
              try {
                markCronTasksFired([id], now, workdir);
              } catch (e) {
                logger?.warn(
                  `CronManager: failed to update lastFiredAt for durable job ${id}:`,
                  e,
                );
              }
            }
          } catch (e) {
            logger?.error(
              `CronManager: Failed to parse cron for recurring job ${id}`,
              e,
            );
            this.jobs.delete(id);
            if (job.durable) {
              try {
                removeCronTasks([id], workdir);
              } catch (fileErr) {
                logger?.warn(
                  `CronManager: failed to remove durable job ${id} from disk:`,
                  fileErr,
                );
              }
            }
          }
        } else {
          this.jobs.delete(id);
          if (job.durable) {
            try {
              removeCronTasks([id], workdir);
            } catch (e) {
              logger?.warn(
                `CronManager: failed to remove durable job ${id} from disk:`,
                e,
              );
            }
          }
        }
      }
    }
  }
}
