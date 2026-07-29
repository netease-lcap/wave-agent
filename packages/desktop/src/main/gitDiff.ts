/**
 * Read-only workspace git-diff service for the diff panel (FR-043).
 * Runs git directly in the main process — this is a read-only query with
 * potentially large output and the stdio CLI has no reusable implementation,
 * so (unlike the FR-022 worktree write ops) it does NOT go through the CLI.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type WorkspaceFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';

export interface WorkspaceDiffFile {
  /** Repo-relative path (new path for renames). */
  path: string;
  status: WorkspaceFileStatus;
  /** Previous path, renames only. */
  oldPath?: string;
  additions: number;
  deletions: number;
  /** Unified-diff hunk lines (from the first @@ on), line-truncated. */
  hunks: string;
  truncated: boolean;
  /** Binary or unreadably large — no textual hunks available. */
  binary: boolean;
}

export type WorkspaceDiffResult =
  | { kind: 'not-a-repo' }
  | { kind: 'ok'; files: WorkspaceDiffFile[] };

/** Per-file hunk line cap — beyond this the panel shows a truncation note. */
export const MAX_DIFF_LINES = 2000;
/** Untracked files larger than this are treated as binary (never read). */
const MAX_UNTRACKED_BYTES = 2 * 1024 * 1024;
const GIT_BUFFER = 16 * 1024 * 1024;

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
    encoding: 'utf-8',
    maxBuffer: GIT_BUFFER,
  });
  return stdout;
}

interface StatusEntry {
  path: string;
  oldPath?: string;
  status: WorkspaceFileStatus;
}

function parsePorcelain(z: string): StatusEntry[] {
  const entries: StatusEntry[] = [];
  const parts = z.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i];
    if (!rec) continue;
    const x = rec[0];
    const y = rec[1];
    const p = rec.slice(3);
    // Rename/copy records carry a second NUL-separated path (the source).
    if (x === 'R' || y === 'R' || x === 'C' || y === 'C') {
      const oldPath = parts[++i] ?? '';
      entries.push({ path: p, oldPath, status: 'renamed' });
      continue;
    }
    const status: WorkspaceFileStatus =
      x === '?'
        ? 'untracked'
        : x === 'A' || y === 'A'
          ? 'added'
          : x === 'D' || y === 'D'
            ? 'deleted'
            : 'modified';
    entries.push({ path: p, status });
  }
  return entries;
}

function truncateHunks(hunks: string): { hunks: string; truncated: boolean } {
  const lines = hunks.split('\n');
  if (lines.length <= MAX_DIFF_LINES) return { hunks, truncated: false };
  return { hunks: lines.slice(0, MAX_DIFF_LINES).join('\n'), truncated: true };
}

async function diffForTracked(cwd: string, base: string[], entry: StatusEntry): Promise<WorkspaceDiffFile> {
  // numstat row: additions<TAB>deletions<TAB>path ('-' on both for binary)
  const num = await git(cwd, ['diff', ...base, '--numstat', '--', entry.path]).catch(() => '');
  const m = num.split('\n')[0]?.match(/^(\d+|-)\t(\d+|-)\t/);
  const binary = m ? m[1] === '-' : false;
  const additions = m && m[1] !== '-' ? parseInt(m[1], 10) : 0;
  const deletions = m && m[2] !== '-' ? parseInt(m[2], 10) : 0;

  let hunks = '';
  let truncated = false;
  if (!binary) {
    const patch = await git(cwd, ['diff', ...base, '--', entry.path]).catch(() => '');
    const at = patch.indexOf('@@');
    const body = at === -1 ? '' : patch.slice(at).trimEnd();
    ({ hunks, truncated } = truncateHunks(body));
  }
  return {
    path: entry.path,
    status: entry.status,
    oldPath: entry.oldPath,
    additions,
    deletions,
    hunks,
    truncated,
    binary,
  };
}

const UNREADABLE: Omit<WorkspaceDiffFile, 'path' | 'status'> = {
  additions: 0,
  deletions: 0,
  hunks: '',
  truncated: false,
  binary: true,
};

async function diffForUntracked(cwd: string, entry: StatusEntry): Promise<WorkspaceDiffFile> {
  const full = path.join(cwd, entry.path);
  try {
    const st = await fs.promises.stat(full);
    if (!st.isFile() || st.size > MAX_UNTRACKED_BYTES) {
      return { path: entry.path, status: 'untracked', ...UNREADABLE };
    }
    const buf = await fs.promises.readFile(full);
    if (buf.subarray(0, 8192).includes(0)) {
      return { path: entry.path, status: 'untracked', ...UNREADABLE };
    }
    const lines = buf.toString('utf-8').split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    const truncated = lines.length > MAX_DIFF_LINES;
    const shown = truncated ? lines.slice(0, MAX_DIFF_LINES) : lines;
    return {
      path: entry.path,
      status: 'untracked',
      additions: lines.length,
      deletions: 0,
      hunks: shown.map((l) => `+${l}`).join('\n'),
      truncated,
      binary: false,
    };
  } catch {
    // Race: the file vanished between `git status` and the read — skip it.
    return { path: entry.path, status: 'untracked', ...UNREADABLE };
  }
}

export async function getWorkspaceDiff(cwd: string): Promise<WorkspaceDiffResult> {
  try {
    await git(cwd, ['rev-parse', '--is-inside-work-tree']);
  } catch {
    return { kind: 'not-a-repo' };
  }

  // Without commits there is no HEAD to diff against — the staged tree is
  // the whole change set.
  const hasHead = await git(cwd, ['rev-parse', '--verify', 'HEAD']).then(
    () => true,
    () => false,
  );
  const base = hasHead ? ['HEAD'] : ['--cached'];

  const status = await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).catch(() => '');
  const entries = parsePorcelain(status);

  const files: WorkspaceDiffFile[] = [];
  for (const entry of entries) {
    files.push(
      entry.status === 'untracked'
        ? await diffForUntracked(cwd, entry)
        : await diffForTracked(cwd, base, entry),
    );
  }
  return { kind: 'ok', files };
}
