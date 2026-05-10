import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  renameSync,
} from "fs";
import { join } from "path";
import { randomUUID } from "crypto";
import { logger } from "./globalLogger.js";

const WAVE_DIR = ".wave";
const LOCK_FILE = "scheduled_tasks.lock";

export interface SchedulerLockOptions {
  dir?: string;
  sessionId?: string;
}

interface LockData {
  sessionId: string;
  pid: number;
  acquiredAt: number;
}

function getLockPath(dir: string): string {
  return join(dir, WAVE_DIR, LOCK_FILE);
}

function ensureWaveDir(dir: string): void {
  const waveDir = join(dir, WAVE_DIR);
  if (!existsSync(waveDir)) {
    mkdirSync(waveDir, { recursive: true });
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Try to acquire the scheduler lock using an atomic exclusive create.
 * If the lock already exists, checks PID liveness for stale recovery.
 * Returns true if this process now owns the lock.
 */
export async function tryAcquireSchedulerLock(
  opts: SchedulerLockOptions = {},
): Promise<boolean> {
  const dir = opts.dir ?? process.cwd();
  const sessionId = opts.sessionId ?? "unknown";
  const lockPath = getLockPath(dir);

  ensureWaveDir(dir);

  // Step 1: Try to create lock file with 'wx' flag (exclusive create)
  try {
    const lockData: LockData = {
      sessionId,
      pid: process.pid,
      acquiredAt: Date.now(),
    };
    const tmpPath = join(dir, WAVE_DIR, `${randomUUID()}.lock.tmp`);
    writeFileSync(tmpPath, JSON.stringify(lockData), { flag: "wx" });
    renameSync(tmpPath, lockPath);
    logger?.info(
      `CronSchedulerLock: acquired lock (pid=${process.pid}, session=${sessionId})`,
    );
    return true;
  } catch (err: unknown) {
    // EEXIST: file already exists — check if stale
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code !== "EEXIST"
    ) {
      logger?.error(`CronSchedulerLock: unexpected error creating lock:`, err);
      return false;
    }
  }

  // Step 2: File exists — read it and check PID liveness
  try {
    const raw = readFileSync(lockPath, "utf-8");
    const existing = JSON.parse(raw) as LockData;

    if (isPidAlive(existing.pid)) {
      // Another live session owns the lock
      return false;
    }

    // Stale lock — delete and retry
    logger?.info(
      `CronSchedulerLock: removing stale lock (dead pid=${existing.pid}, session=${existing.sessionId})`,
    );
    unlinkSync(lockPath);
  } catch {
    // If we can't read the lock, try to delete it anyway
    try {
      unlinkSync(lockPath);
    } catch {
      // Give up
      return false;
    }
  }

  // Step 3: Retry — try exclusive create again
  try {
    const lockData: LockData = {
      sessionId,
      pid: process.pid,
      acquiredAt: Date.now(),
    };
    const tmpPath = join(dir, WAVE_DIR, `${randomUUID()}.lock.tmp`);
    writeFileSync(tmpPath, JSON.stringify(lockData), { flag: "wx" });
    renameSync(tmpPath, lockPath);
    logger?.info(
      `CronSchedulerLock: acquired lock after stale recovery (pid=${process.pid}, session=${sessionId})`,
    );
    return true;
  } catch {
    // Another process beat us to it during the retry window
    return false;
  }
}

/**
 * Release the scheduler lock if this process owns it.
 */
export async function releaseSchedulerLock(
  opts: SchedulerLockOptions = {},
): Promise<void> {
  releaseSchedulerLockSync(opts);
}

/**
 * Synchronous version for use in process exit handlers where async is not available.
 */
export function releaseSchedulerLockSync(
  opts: SchedulerLockOptions = {},
): void {
  const dir = opts.dir ?? process.cwd();
  const lockPath = getLockPath(dir);

  try {
    const raw = readFileSync(lockPath, "utf-8");
    const existing = JSON.parse(raw) as LockData;

    if (existing.pid === process.pid) {
      unlinkSync(lockPath);
      logger?.info(`CronSchedulerLock: released lock (pid=${process.pid})`);
    }
  } catch {
    // Lock doesn't exist or can't be read — nothing to do
  }
}

/**
 * Register a cleanup handler to release the lock on process exit.
 * Returns a dispose function to remove the listeners (call in test teardown).
 */
export function registerSchedulerLockCleanup(
  opts: SchedulerLockOptions = {},
): () => void {
  const handler = () => {
    releaseSchedulerLockSync(opts);
  };
  process.on("exit", handler);
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
  return () => {
    process.off("exit", handler);
    process.off("SIGINT", handler);
    process.off("SIGTERM", handler);
  };
}
