import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { CronJob } from "../types/cron.js";

const WAVE_DIR = ".wave";
const TASKS_FILE = "scheduled_tasks.json";

/**
 * Runtime-only flags that should never be persisted to disk.
 */
const RUNTIME_FLAGS = ["nextRun", "periodMs"] as const;

function getFilePath(dir: string): string {
  return join(dir, WAVE_DIR, TASKS_FILE);
}

export function getCronTasksFilePath(dir: string = process.cwd()): string {
  return getFilePath(dir);
}

function ensureWaveDir(dir: string): void {
  const waveDir = join(dir, WAVE_DIR);
  if (!existsSync(waveDir)) {
    mkdirSync(waveDir, { recursive: true });
  }
}

function stripRuntimeFlags(job: CronJob): Record<string, unknown> {
  const stripped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(job)) {
    if (!(RUNTIME_FLAGS as readonly string[]).includes(key)) {
      stripped[key] = value;
    }
  }
  return stripped;
}

function parseFile(dir: string): CronJob[] {
  const filePath = getFilePath(dir);
  if (!existsSync(filePath)) return [];
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.tasks)) {
      return [];
    }
    const tasks: CronJob[] = [];
    for (const entry of parsed.tasks) {
      if (
        typeof entry === "object" &&
        entry !== null &&
        typeof entry.id === "string" &&
        typeof entry.cron === "string" &&
        typeof entry.prompt === "string" &&
        typeof entry.recurring === "boolean" &&
        typeof entry.createdAt === "number"
      ) {
        tasks.push(entry as CronJob);
      }
      // Drop malformed entries silently
    }
    return tasks;
  } catch {
    return [];
  }
}

function writeToFile(jobs: CronJob[], dir: string): void {
  ensureWaveDir(dir);
  const filePath = getFilePath(dir);
  const payload = {
    tasks: jobs.map(stripRuntimeFlags),
  };
  const json = JSON.stringify(payload, null, 2);
  // Atomic write: write to temp file then rename
  const tmpFile = join(dir, WAVE_DIR, `${randomUUID()}.tmp`);
  writeFileSync(tmpFile, json, "utf-8");
  renameSync(tmpFile, filePath);
}

export function readCronTasks(dir: string = process.cwd()): CronJob[] {
  return parseFile(dir);
}

export function writeCronTasks(
  tasks: CronJob[],
  dir: string = process.cwd(),
): void {
  writeToFile(tasks, dir);
}

export function addCronTask(job: CronJob, dir: string = process.cwd()): void {
  const existing = readCronTasks(dir);
  existing.push(job);
  writeToFile(existing, dir);
}

export function removeCronTasks(
  ids: string[],
  dir: string = process.cwd(),
): void {
  const existing = readCronTasks(dir);
  const idSet = new Set(ids);
  const filtered = existing.filter((t) => !idSet.has(t.id));
  writeToFile(filtered, dir);
}

export function markCronTasksFired(
  ids: string[],
  firedAt: number,
  dir: string = process.cwd(),
): void {
  const existing = readCronTasks(dir);
  const idSet = new Set(ids);
  for (const task of existing) {
    if (idSet.has(task.id)) {
      task.lastFiredAt = firedAt;
    }
  }
  writeToFile(existing, dir);
}
