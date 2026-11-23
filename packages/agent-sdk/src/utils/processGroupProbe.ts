/**
 * Process-group probes for the "the shell exited, its group did not" case.
 *
 * A foreground `Bash` call spawns its shell with `detached: true`, i.e. the
 * shell is the leader of its own process group. A command that backgrounds
 * itself (`nohup npm run dev &`, `node server.js &`) leaves those processes in
 * that same group after the shell exits: they are reparented to init
 * (`ppid=1`) but keep the group id, which is why the group — not the pid, and
 * certainly not the command line — is the only safe handle on them.
 *
 * Two questions are answered here, and nothing else:
 *
 * - {@link probeProcessGroup}: right after the shell exits, is anybody left in
 *   its group? On Linux the surviving members are snapshotted with their
 *   `starttime` token so a later kill can tell "the same process" from "a
 *   process that reuses the pid" (Claude Code's `startToken` / `kill_gate`).
 * - {@link isMemberAlive} / {@link isProcessGroupAlive}: at kill time, is the
 *   recorded group still the one we recorded?
 *
 * `setsid` is out of reach for both: the process leaves the group on purpose,
 * so no group-based ledger can see it. That is a stated boundary, not a bug.
 *
 * Windows is deliberately a no-op (`probeProcessGroup` reports "empty"): there
 * are no process groups, and once the shell is gone its pid cannot drive
 * `taskkill /T` any more. Claude Code's exit sweep returns early on Windows for
 * the same reason.
 */

import * as fs from "fs";

/** One surviving process, as it looked when the shell exited. */
export interface ProcessGroupMember {
  pid: number;
  /**
   * Linux only: field 22 of `/proc/<pid>/stat` (start time in clock ticks
   * since boot). Together with the pid it identifies a process across pid
   * reuse. Absent on platforms without `/proc`.
   */
  startToken?: number;
}

/** A process-group snapshot taken right after its leader exited. */
export interface ProcessGroupSnapshot {
  /** Anybody left in the group? */
  alive: boolean;
  /** Who was left, with identity tokens where the platform offers them. */
  members: ProcessGroupMember[];
}

interface ParsedProcStat {
  /** Single-letter state, e.g. `S`, `R`, `Z`. */
  state: string;
  ppid: number;
  pgid: number;
  startToken: number;
}

/**
 * Parse the interesting fields out of `/proc/<pid>/stat`.
 *
 * Field 2 is `comm` and is wrapped in parentheses while itself allowed to
 * contain spaces and parentheses (`(node (test))`), so the split has to start
 * after the **last** `)` — splitting on whitespace first would misalign every
 * field that follows.
 */
export function parseProcStat(stat: string): ParsedProcStat | undefined {
  const close = stat.lastIndexOf(")");
  if (close < 0) return undefined;
  const rest = stat.slice(close + 2).split(" ");
  // rest[0] is field 3 (state); field 22 (starttime) is therefore rest[19].
  if (rest.length < 20) return undefined;
  const state = rest[0];
  const ppid = Number(rest[1]);
  const pgid = Number(rest[2]);
  const startToken = Number(rest[19]);
  if (
    !state ||
    !Number.isInteger(ppid) ||
    !Number.isInteger(pgid) ||
    !Number.isInteger(startToken)
  ) {
    return undefined;
  }
  return { state, ppid, pgid, startToken };
}

function readProcStat(pid: number): ParsedProcStat | undefined {
  try {
    return parseProcStat(fs.readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    // ESRCH/ENOENT: the process is gone between the listing and the read.
    return undefined;
  }
}

/**
 * Does the process group exist at all?
 *
 * `process.kill(-pgid, 0)` throws ESRCH only when no process carries that group
 * id; EPERM means "somebody is there but not ours", which is still a living
 * group. The caller's own group is never probed (see `noteExitedShell`): a
 * negative pid that slipped through would signal us.
 */
export function isProcessGroupAlive(pgid: number): boolean {
  if (process.platform === "win32") return false;
  if (!Number.isInteger(pgid) || pgid <= 1) return false;
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/**
 * Is this the process group the host itself lives in? Signalling that group
 * would hit us.
 *
 * A shell spawned **without** `detached` shares our group and its pid is not our
 * pid, so `pgid === process.pid` is not enough — on Linux `/proc/self/stat`
 * names the real group id. Elsewhere the pid check is all we have; the
 * `detached` flag the caller passes is the primary guard.
 */
export function isOwnProcessGroup(pgid: number): boolean {
  if (pgid === process.pid) return true;
  return readProcStat(process.pid)?.pgid === pgid;
}

/**
 * Everybody still in the group, excluding ourselves and zombies.
 *
 * Linux-only: `/proc` is the one portable-enough source of "which processes
 * share this group id, and since when". Other POSIX platforms return an empty
 * list, and the ledger then falls back to "the group still exists" — see
 * `ShellProcessReaper`.
 */
export function listProcessGroupMembers(pgid: number): ProcessGroupMember[] {
  if (process.platform !== "linux") return [];
  let entries: string[];
  try {
    entries = fs.readdirSync("/proc");
  } catch {
    return [];
  }
  const members: ProcessGroupMember[] = [];
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (pid === process.pid) continue;
    const stat = readProcStat(pid);
    if (!stat || stat.pgid !== pgid) continue;
    // A zombie holds the group id until its new parent reaps it and cannot be
    // signalled; counting it would make the group look alive forever.
    if (stat.state === "Z") continue;
    members.push({ pid, startToken: stat.startToken });
  }
  return members;
}

/**
 * Is this the very process we recorded, rather than a pid-reused stranger?
 *
 * With a token (Linux) the pair (pid, starttime) has to match; without one the
 * check degrades to "something with that pid exists", which is the best a
 * platform without `/proc` can do.
 */
export function isMemberAlive(member: ProcessGroupMember): boolean {
  if (member.startToken === undefined) {
    try {
      process.kill(member.pid, 0);
      return true;
    } catch (error: unknown) {
      return (error as NodeJS.ErrnoException).code !== "ESRCH";
    }
  }
  const stat = readProcStat(member.pid);
  if (!stat || stat.state === "Z") return false;
  return stat.startToken === member.startToken;
}

/** Snapshot the group, or report it empty (Windows always reports empty). */
export function probeProcessGroup(pgid: number): ProcessGroupSnapshot {
  if (!isProcessGroupAlive(pgid)) return { alive: false, members: [] };
  return { alive: true, members: listProcessGroupMembers(pgid) };
}
