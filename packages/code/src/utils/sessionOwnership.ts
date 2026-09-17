import { existsSync } from "fs";
import { PathEncoder } from "wave-agent-sdk";

/** POSIX single-quote wrapping for use inside a `cd <path> && ...` command. */
export function quotePath(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

export type SessionOwnership =
  | { kind: "current" }
  | { kind: "worktree"; resumeWorkdir: string }
  | { kind: "cross-project"; command: string };

/**
 * Decide how a selected session relates to the current working directory.
 *
 * Ownership is decided by comparing encoded directory names — the decoded
 * workdir is lossy for paths containing "-", but re-encoding it reproduces the
 * original encoded directory name exactly.
 *
 * - current:      session belongs to the current directory → resume in place
 * - worktree:     session belongs to a sibling same-repo worktree → resume
 *                 after chdir into it (skipped when the worktree dir is gone)
 * - cross-project: session belongs to another project → print a cd command
 */
export async function resolveSessionOwnership(
  session: { id: string; workdir: string },
  opts: { worktreePaths: string[]; currentWorkdir: string },
): Promise<SessionOwnership> {
  const encoder = new PathEncoder();
  // encode() resolves the path via realpath and throws ENOENT when the
  // directory no longer exists (e.g. a deleted worktree); fall back to the
  // pure string encodeSync so the picker still works for ghost sessions.
  let sessionEncoded: string;
  try {
    sessionEncoded = await encoder.encode(session.workdir);
  } catch {
    sessionEncoded = encoder.encodeSync(session.workdir);
  }
  const cwdEncoded = await encoder.encode(opts.currentWorkdir);

  if (sessionEncoded === cwdEncoded) {
    return { kind: "current" };
  }

  for (const wt of opts.worktreePaths) {
    let wtEncoded: string;
    try {
      wtEncoded = await encoder.encode(wt);
    } catch {
      wtEncoded = encoder.encodeSync(wt);
    }
    if (wtEncoded === sessionEncoded && existsSync(wt)) {
      return { kind: "worktree", resumeWorkdir: wt };
    }
  }

  return {
    kind: "cross-project",
    command: `cd ${quotePath(session.workdir)} && wave --restore ${session.id}`,
  };
}
