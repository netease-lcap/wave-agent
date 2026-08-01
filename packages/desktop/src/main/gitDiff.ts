/**
 * Read-only workspace git-diff service for the diff panel.
 * Runs git directly in the main process — this is a read-only query with
 * potentially large output and the stdio CLI has no reusable implementation,
 * so (unlike the worktree write ops) it does NOT go through the CLI.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { buildSshSpawnArgs, LOCAL_HOST, shellQuote } from './sshHosts';

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

/**
 * Run git in `cwd`. Remote hosts run `git -C <cwd> …` through ssh — every
 * token is shell-quoted because paths come from `status --porcelain -z`
 * records and may contain spaces or shell metacharacters.
 */
async function git(host: string, cwd: string, args: string[]): Promise<string> {
  const options = { encoding: 'utf-8' as const, maxBuffer: GIT_BUFFER };
  const { stdout } =
    host === LOCAL_HOST
      ? await execFileAsync('git', ['-C', cwd, ...args], options)
      : await execFileAsync(
          'ssh',
          buildSshSpawnArgs(host, ['git', '-C', shellQuote(cwd), ...args.map(shellQuote)].join(' ')),
          options,
        );
  return stdout;
}

/** Remote `stat -c %s` — the byte size, or null when the path is unreadable. */
async function remoteStatSize(host: string, absPath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      'ssh',
      buildSshSpawnArgs(host, `stat -c %s ${shellQuote(absPath)}`),
      { encoding: 'utf-8', maxBuffer: 1024 * 1024 },
    );
    const size = Number.parseInt(stdout.trim(), 10);
    return Number.isInteger(size) && size >= 0 ? size : null;
  } catch {
    return null;
  }
}

/** Remote `cat` — the raw file bytes (throws when unreadable). */
async function remoteCat(host: string, absPath: string): Promise<Buffer> {
  const { stdout } = await execFileAsync(
    'ssh',
    buildSshSpawnArgs(host, `cat ${shellQuote(absPath)}`),
    { encoding: 'buffer', maxBuffer: GIT_BUFFER },
  );
  return stdout as Buffer;
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

async function diffForTracked(
  host: string,
  repoRoot: string,
  base: string[],
  entry: StatusEntry,
): Promise<WorkspaceDiffFile> {
  // numstat row: additions<TAB>deletions<TAB>path ('-' on both for binary)
  const num = await git(host, repoRoot, ['diff', ...base, '--numstat', '--', entry.path]).catch(() => '');
  const m = num.split('\n')[0]?.match(/^(\d+|-)\t(\d+|-)\t/);
  const binary = m ? m[1] === '-' : false;
  const additions = m && m[1] !== '-' ? parseInt(m[1], 10) : 0;
  const deletions = m && m[2] !== '-' ? parseInt(m[2], 10) : 0;

  let hunks = '';
  let truncated = false;
  if (!binary) {
    const patch = await git(host, repoRoot, ['diff', ...base, '--', entry.path]).catch(() => '');
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

/**
 * Read an untracked file's content, or null when it is unreadable or
 * oversized. Remote files are fetched via ssh (`stat` for the size so
 * oversized files are never downloaded, then `cat` for the bytes).
 */
async function readUntrackedFile(host: string, absPath: string): Promise<{ content: Buffer } | null> {
  if (host === LOCAL_HOST) {
    const st = await fs.promises.stat(absPath);
    if (!st.isFile() || st.size > MAX_UNTRACKED_BYTES) return null;
    return { content: await fs.promises.readFile(absPath) };
  }
  const size = await remoteStatSize(host, absPath);
  if (size === null || size > MAX_UNTRACKED_BYTES) return null;
  return { content: await remoteCat(host, absPath) };
}

async function diffForUntracked(host: string, repoRoot: string, entry: StatusEntry): Promise<WorkspaceDiffFile> {
  const full = path.join(repoRoot, entry.path);
  try {
    const file = await readUntrackedFile(host, full);
    if (!file) {
      return { path: entry.path, status: 'untracked', ...UNREADABLE };
    }
    const buf = file.content;
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

export async function getWorkspaceDiff(cwd: string, host: string = LOCAL_HOST): Promise<WorkspaceDiffResult> {
  try {
    await git(host, cwd, ['rev-parse', '--is-inside-work-tree']);
  } catch {
    return { kind: 'not-a-repo' };
  }

  // `git status --porcelain` always emits paths relative to the repo root,
  // but `cwd` may be a subdirectory. Resolving untracked files (path.join)
  // and matching pathspecs both need root-relative paths, so normalize to
  // the toplevel; fall back to cwd if rev-parse is unavailable.
  const root = (await git(host, cwd, ['rev-parse', '--show-toplevel']).catch(() => '')).trim() || cwd;

  // Without commits there is no HEAD to diff against — the staged tree is
  // the whole change set.
  const hasHead = await git(host, cwd, ['rev-parse', '--verify', 'HEAD']).then(
    () => true,
    () => false,
  );
  const base = hasHead ? ['HEAD'] : ['--cached'];

  const status = await git(host, cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).catch(() => '');
  const entries = parsePorcelain(status);

  const files: WorkspaceDiffFile[] = [];
  for (const entry of entries) {
    files.push(
      entry.status === 'untracked'
        ? await diffForUntracked(host, root, entry)
        : await diffForTracked(host, root, base, entry),
    );
  }
  return { kind: 'ok', files };
}
