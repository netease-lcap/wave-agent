import { Container } from "../utils/container.js";
import { CronJob } from "../types/cron.js";
import { AIManager } from "./aiManager.js";
import { MessageManager } from "./messageManager.js";
import { CronExpressionParser } from "cron-parser";
import { logger } from "../utils/globalLogger.js";

export class CronManager {
  private jobs = new Map<string, CronJob>();
  private interval: NodeJS.Timeout | null = null;

  constructor(private container: Container) {}

  private get aiManager(): AIManager {
    return this.container.get<AIManager>("AIManager")!;
  }

  private get messageManager(): MessageManager {
    return this.container.get<MessageManager>("MessageManager")!;
  }

  public start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => this.checkJobs(), 60000); // Check every minute
    this.interval.unref();
  }

  public stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
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
    return newJob;
  }

  public deleteJob(id: string): boolean {
    return this.jobs.delete(id);
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

    for (const [id, job] of this.jobs.entries()) {
      // Expiration: Recurring jobs MUST auto-expire after 7 days
      if (job.recurring && now - job.createdAt > 7 * 24 * 60 * 60 * 1000) {
        this.jobs.delete(id);
        continue;
      }

      if (now >= job.nextRun) {
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
          } catch (e) {
            logger?.error(
              `CronManager: Failed to parse cron for recurring job ${id}`,
              e,
            );
            this.jobs.delete(id);
          }
        } else {
          this.jobs.delete(id);
        }
      }
    }
  }
}
