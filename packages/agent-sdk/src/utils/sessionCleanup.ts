/**
 * Session retention cleanup — aligned with Claude Code's cleanupOldSessionFiles()
 * (~/.claude-code/src/utils/cleanup.ts).
 *
 * Scans ~/.wave/projects for session .jsonl files (main `<uuid>.jsonl` and
 * `subagent-<uuid>.jsonl`) whose mtime is older than the retention cutoff and
 * deletes them, then removes project directories left empty. Auto-memory
 * (`memory/` subdirectories) is never touched.
 *
 * Retention is configurable via settings `cleanupPeriodDays` (default 30).
 * `0` disables cleanup. If settings are corrupt or fail validation while the
 * user explicitly set `cleanupPeriodDays`, cleanup is skipped entirely — the
 * same guard Claude Code uses to avoid deleting files when the configured
 * retention period cannot be trusted.
 */

import { existsSync, promises as fs } from "fs";
import { join } from "path";
import { logger } from "./globalLogger.js";
import { SESSION_DIR } from "../services/session.js";
import {
  loadMergedWaveConfig,
  validateConfigurationObject,
} from "../services/configurationService.js";
import { getProjectConfigPaths, getUserConfigPaths } from "./configPaths.js";

/** Default retention period in days (Claude Code DEFAULT_CLEANUP_PERIOD_DAYS). */
export const DEFAULT_CLEANUP_PERIOD_DAYS = 30;

export interface SessionCleanupResult {
  /** Number of session files deleted */
  deleted: number;
  /** Number of files/directories that failed to process */
  errors: number;
}

// Module-level flag: session cleanup runs once per process, on first agent
// container setup — aligned with CC's once-per-process startup housekeeping.
let cleanupScheduled = false;

/**
 * Resolve the effective cleanup period in days, or null to skip cleanup.
 *
 * null (skip) happens when:
 * - settings files exist but cannot be parsed/loaded (corrupt JSON, mid-write)
 * - settings validation fails AND the user explicitly set cleanupPeriodDays
 *
 * Missing settings entirely is NOT a skip: the default 30 days applies.
 */
export function resolveCleanupPeriodDays(workdir: string): number | null {
  let merged;
  try {
    merged = loadMergedWaveConfig(workdir);
  } catch (error) {
    logger.debug(
      `Session cleanup: skipping (failed to load settings: ${(error as Error).message})`,
    );
    return null;
  }

  // No config file at all → default retention. Config files exist but merged
  // config is null (corrupt JSON / empty file) → skip conservatively rather
  // than deleting based on a partial config.
  if (merged === null) {
    if (hasAnySettingsFile(workdir)) {
      logger.debug(
        "Session cleanup: skipping (settings file exists but could not be parsed)",
      );
      return null;
    }
    return DEFAULT_CLEANUP_PERIOD_DAYS;
  }

  // Guard (CC): validation errors + explicit cleanupPeriodDays → skip entirely.
  const validation = validateConfigurationObject(merged);
  if (validation.errors.length > 0 && merged.cleanupPeriodDays !== undefined) {
    logger.debug(
      "Session cleanup: skipping (settings have validation errors but cleanupPeriodDays was explicitly set). Fix settings errors to enable cleanup.",
    );
    return null;
  }

  return merged.cleanupPeriodDays ?? DEFAULT_CLEANUP_PERIOD_DAYS;
}

/**
 * Delete session .jsonl files in ~/.wave/projects older than periodDays,
 * then remove project directories left empty. Directories that still contain
 * anything (e.g. `memory/` auto-memory) are preserved. Never throws; errors
 * are counted and skipped, and a missing/unreadable projects dir is a silent
 * no-op.
 */
export async function cleanupOldSessionFiles(
  periodDays: number,
): Promise<SessionCleanupResult> {
  const result: SessionCleanupResult = { deleted: 0, errors: 0 };
  const cutoffDate = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

  let projectEntries;
  try {
    projectEntries = await fs.readdir(SESSION_DIR, { withFileTypes: true });
  } catch {
    // Projects dir doesn't exist or is unreadable — nothing to clean
    return result;
  }

  for (const projectEntry of projectEntries) {
    if (!projectEntry.isDirectory()) continue;
    const projectDir = join(SESSION_DIR, projectEntry.name);

    let entries;
    try {
      entries = await fs.readdir(projectDir, { withFileTypes: true });
    } catch {
      result.errors++;
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      try {
        if (await unlinkIfOld(join(projectDir, entry.name), cutoffDate)) {
          result.deleted++;
        }
      } catch {
        result.errors++;
      }
    }

    // Removes the project dir only if it is now empty; dirs still containing
    // files (e.g. memory/) or subdirectories are left untouched.
    await tryRmdir(projectDir);
  }

  return result;
}

/**
 * Kick off session cleanup in the background, once per process. Fire-and-forget:
 * never throws, never blocks agent startup. In test environments cleanup is a
 * no-op (same convention as the other startup cleanups in session.ts).
 */
export function runSessionCleanupInBackground(workdir: string): void {
  if (process.env.NODE_ENV === "test") return;
  if (cleanupScheduled) return;
  cleanupScheduled = true;

  void (async () => {
    try {
      const periodDays = resolveCleanupPeriodDays(workdir);
      if (periodDays === null) {
        return; // skip reason already logged in resolveCleanupPeriodDays
      }
      if (periodDays === 0) {
        logger.debug("Session cleanup: disabled (cleanupPeriodDays is 0)");
        return;
      }
      const result = await cleanupOldSessionFiles(periodDays);
      if (result.deleted > 0) {
        logger.debug(
          `Session cleanup: removed ${result.deleted} session file(s)`,
        );
      }
      if (result.errors > 0) {
        logger.warn(
          `Session cleanup: encountered ${result.errors} error(s) while cleaning session files`,
        );
      }
    } catch (error) {
      logger.warn(
        `Session cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  })();
}

/**
 * Whether any settings file exists that loadMergedWaveConfig would consider
 * (user settings.json + project settings.json/local.json).
 */
function hasAnySettingsFile(workdir: string): boolean {
  const userPaths = getUserConfigPaths();
  const projectPaths = getProjectConfigPaths(workdir);
  return [userPaths[0], projectPaths[1], projectPaths[0]].some((p) =>
    existsSync(p),
  );
}

async function unlinkIfOld(
  filePath: string,
  cutoffDate: Date,
): Promise<boolean> {
  const stats = await fs.stat(filePath);
  if (stats.mtime < cutoffDate) {
    await fs.unlink(filePath);
    return true;
  }
  return false;
}

async function tryRmdir(dirPath: string): Promise<void> {
  try {
    await fs.rmdir(dirPath);
  } catch {
    // Not empty or doesn't exist
  }
}
