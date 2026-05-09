export interface CronJob {
  id: string;
  cron: string;
  prompt: string;
  recurring: boolean;
  createdAt: number;
  nextRun: number;
  periodMs: number;
  /** When true, the job is persisted to .wave/scheduled_tasks.json. */
  durable?: boolean;
  /** Timestamp of the last time a durable recurring job fired. */
  lastFiredAt?: number;
}
