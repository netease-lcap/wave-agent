export interface CronJob {
  id: string;
  cron: string;
  prompt: string;
  recurring: boolean;
  createdAt: number;
  nextRun: number;
  periodMs: number;
}
