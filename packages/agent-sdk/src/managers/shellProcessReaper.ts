/**
 * The per-agent ledger of process groups a shell left behind.
 *
 * `Bash` spawns its shell `detached`, so anything the command backgrounds
 * (`nohup npm run dev &`, `node server.js &`) stays in exactly one process
 * group — the shell's own. When the shell exits normally those processes are
 * reparented to init and keep running; nothing in this SDK held their pid, so
 * a session that started a dev server could leave it alive for days (observed:
 * a `node dist/server.js` whose `ppid` was 1 and whose cwd was a removed
 * worktree, killed by hand nine days later).
 *
 * The contract here is "**probe on exit, kill on destroy**", deliberately not
 * "kill on exit":
 *
 * - when a shell exits, ask whether its group still has members and, if so,
 *   record them ({@link ShellProcessReaper.noteExitedShell});
 * - when the session is destroyed ({@link ShellProcessReaper.reap}), send
 *   `SIGTERM` to those groups and `SIGKILL` the survivors after a grace
 *   period;
 * - when the host process exits, do one last synchronous `SIGTERM` sweep
 *   ({@link ShellProcessReaper} installs the hook itself).
 *
 * Killing at exit time instead would break the legitimate use — `nohup npm run
 * dev &` is a reasonable thing to run from this tool — which is also why
 * Claude Code keeps such shells in `liveShellCommands` and only kills them on
 * shutdown / at exit, never right after the shell returns.
 *
 * Scope: one instance per agent (registered in the DI container), so a subagent
 * reaps its own leftovers and a daemon hosting several sessions never kills
 * another session's processes.
 */

import { killProcessTree } from "../utils/killProcessTree.js";
import { logger } from "../utils/globalLogger.js";
import {
  isMemberAlive,
  isOwnProcessGroup,
  isProcessGroupAlive,
  probeProcessGroup,
  type ProcessGroupMember,
} from "../utils/processGroupProbe.js";

/** A process group recorded after its shell exited, and still believed alive. */
export interface LeftoverProcessGroup {
  /** POSIX group id, which is the detached shell's pid. */
  pgid: number;
  /** Who was left when the shell exited (empty where the platform has no list). */
  members: ProcessGroupMember[];
  /** Tool call id, or background task id — for logs only. */
  originId: string;
  /** The command line, truncated, for logs only. */
  command: string;
  recordedAt: number;
}

/** How long the polite signal gets before the forced one follows. */
const KILL_GRACE_MS = 1000;

/** Long enough to recognise the command in a log line, short enough to read. */
const MAX_LOGGED_COMMAND_CHARS = 120;

/**
 * Every reaper that currently exists, so the process needs exactly **one**
 * `exit` listener no matter how many agents a daemon hosts (one listener per
 * agent would hit Node's default max-listeners limit at eleven sessions and
 * print a warning into the host's stderr).
 */
const liveReapers = new Set<ShellProcessReaper>();
let exitSweepInstalled = false;

function installExitSweep(): void {
  if (exitSweepInstalled) return;
  exitSweepInstalled = true;
  // `prependListener`: run before other exit handlers that might already be
  // tearing down state the probes read.
  process.prependListener("exit", () => {
    for (const reaper of liveReapers) reaper.sweepOnExit();
  });
}

export class ShellProcessReaper {
  private readonly groups = new Map<number, LeftoverProcessGroup>();
  private disposed = false;

  constructor() {
    liveReapers.add(this);
    installExitSweep();
  }

  /** Snapshot of the ledger — for tests, logs and diagnostics. */
  public getRecordedGroups(): readonly LeftoverProcessGroup[] {
    return [...this.groups.values()];
  }

  /**
   * "This shell has exited — did it leave anybody in its group?"
   *
   * Called from the shell's own `exit` handler (foreground) and from the
   * background task's (a background shell can leave processes behind the same
   * way). Records only; never signals.
   *
   * @param pgid - the shell's pid, which is its process group id because it was
   *   spawned `detached`. `undefined` when spawn never produced a pid.
   * @param detached - whether the shell really led its own group. A
   *   non-detached shell (the PowerShell provider) shares *our* group, and
   *   recording that id would make `reap()` signal the host process.
   */
  public noteExitedShell(input: {
    pgid: number | undefined;
    detached: boolean;
    originId: string;
    command: string;
  }): void {
    if (this.disposed) return;
    const { pgid } = input;
    if (!input.detached) return;
    // Never the host's own group (a negative pid of 0/1 would signal us), and
    // never a group we already hold.
    if (pgid === undefined || !Number.isInteger(pgid) || pgid <= 1) return;
    if (isOwnProcessGroup(pgid)) return;
    if (this.groups.has(pgid)) return;

    const snapshot = probeProcessGroup(pgid);
    // Nothing left behind: do not keep an entry that could only ever be stale.
    if (!snapshot.alive) return;

    const entry: LeftoverProcessGroup = {
      pgid,
      members: snapshot.members,
      originId: input.originId,
      command: input.command.slice(0, MAX_LOGGED_COMMAND_CHARS),
      recordedAt: Date.now(),
    };
    this.groups.set(pgid, entry);
    logger.debug(
      `[ShellProcessReaper] process group ${pgid} outlived its shell (${entry.members.length} member(s)); recorded for ${entry.originId}: ${entry.command}`,
    );
  }

  /**
   * Terminate every recorded group: `SIGTERM` now, `SIGKILL` the survivors
   * after {@link KILL_GRACE_MS}. Called from `Agent.destroy()`.
   *
   * Not awaited on purpose (same shape as `BackgroundTaskManager.cleanup`):
   * the grace timer is deliberately **not** unref'd, because the caller is
   * usually a process on its way out and an unref'd timer would never fire —
   * leaving exactly the orphan this exists to remove.
   */
  public reap(): void {
    const entries = [...this.groups.values()];
    this.groups.clear();
    if (entries.length === 0) return;

    const verified: LeftoverProcessGroup[] = [];
    for (const entry of entries) {
      if (this.isStillTheSame(entry)) {
        verified.push(entry);
      } else {
        logger.debug(
          `[ShellProcessReaper] process group ${entry.pgid} is gone or no longer the one we recorded; nothing to stop`,
        );
      }
    }
    if (verified.length === 0) return;

    for (const entry of verified) {
      logger.debug(
        `[ShellProcessReaper] terminating leftover process group ${entry.pgid} (${entry.command})`,
      );
      void killProcessTree(entry.pgid, "SIGTERM");
    }

    setTimeout(() => {
      for (const entry of verified) {
        if (!this.isStillTheSame(entry)) continue;
        logger.warn(
          `[ShellProcessReaper] forcing leftover process group ${entry.pgid} after ${KILL_GRACE_MS}ms (${entry.command})`,
        );
        void killProcessTree(entry.pgid, "SIGKILL");
      }
    }, KILL_GRACE_MS);
  }

  /**
   * Stop tracking everything. Called at the end of `Agent.destroy()` so a
   * daemon does not accumulate one exit sweep per session ever opened.
   */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.groups.clear();
    liveReapers.delete(this);
  }

  /**
   * Last chance: the host process is exiting and there is no event loop left.
   *
   * Only a synchronous signal fits — no timer can escalate to `SIGKILL`, and
   * Claude Code's `Atomics.wait` busy-wait (its `IXt`) would block the exit for
   * the whole grace window. So this is best effort by definition, and
   * `Agent.destroy()` stays the reliable path.
   */
  public sweepOnExit(): void {
    const entries = [...this.groups.values()];
    this.groups.clear();
    for (const entry of entries) {
      if (!this.isStillTheSame(entry)) continue;
      try {
        process.kill(-entry.pgid, "SIGTERM");
        logger.debug(
          `[ShellProcessReaper] sent SIGTERM to leftover process group ${entry.pgid} while exiting`,
        );
      } catch (error: unknown) {
        logger.debug(
          `[ShellProcessReaper] could not signal process group ${entry.pgid} while exiting:`,
          error,
        );
      }
    }
  }

  /**
   * Identity gate. On Linux at least one recorded member must still be the very
   * process we recorded (same pid **and** same starttime), so a reused pid can
   * never get a group killed. Without start tokens the best available answer is
   * "the group still exists".
   */
  private isStillTheSame(entry: LeftoverProcessGroup): boolean {
    if (entry.members.length > 0) {
      return entry.members.some((member) => isMemberAlive(member));
    }
    return isProcessGroupAlive(entry.pgid);
  }
}
