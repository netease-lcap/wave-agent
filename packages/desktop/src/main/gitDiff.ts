/**
 * Read-only workspace git-diff service for the diff panel.
 * Runs git directly in the main process — this is a read-only query with
 * potentially large output and the stdio CLI has no reusable implementation,
 * so (unlike the worktree write ops) it does NOT go through the CLI.
 */

import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { buildSshSpawnArgs, LOCAL_HOST, shellQuote } from "./sshHosts";

const execFileAsync = promisify(execFile);

export type WorkspaceFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "untracked";

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

/** One commit of the session's own range, newest first. */
export interface WorkspaceDiffCommit {
  sha: string;
  /** 7-char prefix, for the picker label. */
  shortSha: string;
  subject: string;
}

/** What the whole file list is measured against. */
export interface WorkspaceDiffBase {
  /** Display name: the default branch, "HEAD", or "索引". */
  label: string;
  /** Full sha of the base commit; null when the base is the index. */
  sha: string | null;
  kind: "default-branch" | "head" | "index";
  /** Resolved ref of the default branch, null for the other kinds. */
  ref: string | null;
}

/** Which range the file list covers. */
export type WorkspaceDiffScope =
  | { kind: "all" }
  | { kind: "commit"; sha: string; shortSha: string; subject: string };

export type WorkspaceDiffResult =
  | { kind: "not-a-repo" }
  | {
      kind: "ok";
      base: WorkspaceDiffBase;
      scope: WorkspaceDiffScope;
      commits: WorkspaceDiffCommit[];
      files: WorkspaceDiffFile[];
    };

/** Per-file hunk line cap — beyond this the panel shows a truncation note. */
export const MAX_DIFF_LINES = 2000;
/** Untracked files larger than this are treated as binary (never read). */
const MAX_UNTRACKED_BYTES = 2 * 1024 * 1024;
const GIT_BUFFER = 16 * 1024 * 1024;

/**
 * Run git in `cwd`. Remote hosts run `git -C <cwd> …` through ssh — every
 * token is shell-quoted because paths come from `diff --name-status -z` /
 * `ls-files -z` records and may contain spaces or shell metacharacters.
 */
async function git(host: string, cwd: string, args: string[]): Promise<string> {
  const options = { encoding: "utf-8" as const, maxBuffer: GIT_BUFFER };
  const { stdout } =
    host === LOCAL_HOST
      ? await execFileAsync("git", ["-C", cwd, ...args], options)
      : await execFileAsync(
          "ssh",
          buildSshSpawnArgs(
            host,
            ["git", "-C", shellQuote(cwd), ...args.map(shellQuote)].join(" "),
          ),
          options,
        );
  return stdout;
}

/** Remote `stat -c %s` — the byte size, or null when the path is unreadable. */
async function remoteStatSize(
  host: string,
  absPath: string,
): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      "ssh",
      buildSshSpawnArgs(host, `stat -c %s ${shellQuote(absPath)}`),
      { encoding: "utf-8", maxBuffer: 1024 * 1024 },
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
    "ssh",
    buildSshSpawnArgs(host, `cat ${shellQuote(absPath)}`),
    { encoding: "buffer", maxBuffer: GIT_BUFFER },
  );
  return stdout as Buffer;
}

/** Options shared by every diff invocation: renames on, no user color/ext hooks. */
const DIFF_OPTIONS = ["-M", "--no-color", "--no-ext-diff"];

function diffArgs(
  rev: string,
  format: string[],
  paths: string[] = [],
): string[] {
  return [
    "diff",
    rev,
    ...DIFF_OPTIONS,
    ...format,
    ...(paths.length > 0 ? ["--", ...paths] : []),
  ];
}

/** Non-empty NUL-separated records (all the -z outputs below use NUL). */
function parseZRecords(out: string): string[] {
  return out.split("\0").filter((record) => record !== "");
}

interface DiffEntry {
  path: string;
  oldPath?: string;
  status: WorkspaceFileStatus;
}

/** `--name-status` codes are a letter plus a similarity percentage (R100/C075). */
const NAME_STATUS_CODE = /^[A-Z]\d*$/;

/**
 * Parse `git diff --name-status -z`. Records are `<code>\0<path>\0`, except
 * renames/copies which are `<code>\0<old path>\0<new path>\0` — NOTE the order
 * is the opposite of `status --porcelain -z` (which puts the new path first).
 */
export function parseNameStatusZ(z: string): DiffEntry[] {
  const parts = z.split("\0");
  const entries: DiffEntry[] = [];
  let i = 0;
  while (i < parts.length) {
    const code = parts[i++];
    if (!NAME_STATUS_CODE.test(code)) continue;
    if (code[0] === "R" || code[0] === "C") {
      const oldPath = parts[i++] ?? "";
      const newPath = parts[i++] ?? "";
      if (newPath) entries.push({ path: newPath, oldPath, status: "renamed" });
      continue;
    }
    const filePath = parts[i++] ?? "";
    if (!filePath) continue;
    const status: WorkspaceFileStatus =
      code[0] === "A" ? "added" : code[0] === "D" ? "deleted" : "modified";
    entries.push({ path: filePath, status });
  }
  return entries;
}

interface FileStats {
  additions: number;
  deletions: number;
  binary: boolean;
}

const NUMSTAT_ROW = /^(\d+|-)\t(\d+|-)\t/;

/**
 * Parse `git diff --numstat -z` into a map keyed by the NEW path. Rows are
 * `add\tdel\t<path>\0` with `-` on both sides for binary files; a rename row
 * has an EMPTY path field and the two paths follow as separate records
 * (`add\tdel\t\0<old>\0<new>\0`), mirroring the name-status order.
 */
export function parseNumstatZ(z: string): Map<string, FileStats> {
  const parts = z.split("\0");
  const stats = new Map<string, FileStats>();
  let i = 0;
  while (i < parts.length) {
    const row = parts[i++];
    const m = NUMSTAT_ROW.exec(row);
    // A path record that is not a row belongs to a rename we already consumed.
    if (!m) continue;
    const value: FileStats = {
      additions: m[1] === "-" ? 0 : Number.parseInt(m[1], 10),
      deletions: m[2] === "-" ? 0 : Number.parseInt(m[2], 10),
      binary: m[1] === "-",
    };
    // Everything after the two tab-delimited numbers is the path — taken from
    // the row itself, so paths containing tabs survive.
    const inlinePath = row.slice(m[0].length);
    if (inlinePath) {
      stats.set(inlinePath, value);
      continue;
    }
    const newPath = parts[i + 1] ?? "";
    i += 2;
    if (newPath) stats.set(newPath, value);
  }
  return stats;
}

function truncateHunks(hunks: string): { hunks: string; truncated: boolean } {
  const lines = hunks.split("\n");
  if (lines.length <= MAX_DIFF_LINES) return { hunks, truncated: false };
  return { hunks: lines.slice(0, MAX_DIFF_LINES).join("\n"), truncated: true };
}

interface ResolvedBase {
  base: WorkspaceDiffBase;
  /** Revision to diff against (`--cached` before the first commit). */
  rev: string;
  /** Range start for the commit list; null when there is nothing to list. */
  commitsFrom: string | null;
}

/**
 * The base is the point this session branched off the repository's default
 * branch, so the panel shows the agent's commits AND the uncommitted worktree
 * in one diff (which `HEAD` cannot — it hides everything already committed).
 *
 * `refs/remotes/origin/HEAD` names that branch; without it (a repo that never
 * had a default branch set) fall back to a local `main`/`master`, and without
 * either — or without a common ancestor — fall back to `HEAD`.
 */
async function resolveDiffBase(
  host: string,
  cwd: string,
  headSha: string | null,
): Promise<ResolvedBase> {
  if (!headSha) {
    return {
      base: { label: "索引", sha: null, kind: "index", ref: null },
      rev: "--cached",
      commitsFrom: null,
    };
  }

  const remoteHead = (
    await git(host, cwd, [
      "symbolic-ref",
      "-q",
      "--short",
      "refs/remotes/origin/HEAD",
    ]).catch(() => "")
  ).trim();
  const candidates: { ref: string; label: string }[] = [];
  if (remoteHead)
    candidates.push({ ref: `refs/remotes/${remoteHead}`, label: remoteHead });
  candidates.push({ ref: "refs/heads/main", label: "main" });
  candidates.push({ ref: "refs/heads/master", label: "master" });

  for (const candidate of candidates) {
    const exists = await git(host, cwd, [
      "rev-parse",
      "--verify",
      "--quiet",
      `${candidate.ref}^{commit}`,
    ]).then(
      () => true,
      () => false,
    );
    if (!exists) continue;
    const mergeBase = (
      await git(host, cwd, ["merge-base", "HEAD", candidate.ref]).catch(
        () => "",
      )
    ).trim();
    // A default branch exists but has no fork point with HEAD (unrelated
    // histories): the spec asks for the HEAD fallback, not for probing on.
    if (!mergeBase) break;
    return {
      base: {
        label: candidate.label,
        sha: mergeBase,
        kind: "default-branch",
        ref: candidate.ref,
      },
      rev: mergeBase,
      commitsFrom: mergeBase,
    };
  }
  return {
    base: { label: "HEAD", sha: headSha, kind: "head", ref: null },
    rev: "HEAD",
    // HEAD..HEAD is empty by construction, so no log call is needed.
    commitsFrom: null,
  };
}

/** The session's own commits (merges excluded — they replay others' work). */
async function listCommits(
  host: string,
  cwd: string,
  from: string,
): Promise<WorkspaceDiffCommit[]> {
  const out = await git(host, cwd, [
    "log",
    "-z",
    "--no-merges",
    "--topo-order",
    "--pretty=oneline",
    `${from}..HEAD`,
  ]).catch(() => "");
  const commits: WorkspaceDiffCommit[] = [];
  for (const record of parseZRecords(out)) {
    // `--pretty=oneline` = "<full sha> <subject>".
    const space = record.indexOf(" ");
    if (space <= 0) continue;
    const sha = record.slice(0, space);
    commits.push({
      sha,
      shortSha: sha.slice(0, 7),
      subject: record.slice(space + 1),
    });
  }
  return commits;
}

async function diffForTracked(
  host: string,
  repoRoot: string,
  rev: string,
  entry: DiffEntry,
  stats: FileStats | undefined,
): Promise<WorkspaceDiffFile> {
  const binary = stats?.binary ?? false;
  const additions = stats?.additions ?? 0;
  const deletions = stats?.deletions ?? 0;

  let hunks = "";
  let truncated = false;
  // A binary file has no textual patch, and a file whose net change is empty
  // (pure rename, mode-only change) has no hunks — skip the extra call.
  if (!binary && additions + deletions > 0) {
    // Both paths must be passed: limiting the pathspec to the new path turns
    // rename detection off, and the patch then reads as a full file rewrite.
    const paths = entry.oldPath ? [entry.oldPath, entry.path] : [entry.path];
    const patch = await git(host, repoRoot, diffArgs(rev, [], paths)).catch(
      () => "",
    );
    const lines = patch.split("\n");
    const at = lines.findIndex((line) => line.startsWith("@@"));
    const body = at === -1 ? "" : lines.slice(at).join("\n").trimEnd();
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

const UNREADABLE: Omit<WorkspaceDiffFile, "path" | "status"> = {
  additions: 0,
  deletions: 0,
  hunks: "",
  truncated: false,
  binary: true,
};

/**
 * Read an untracked file's content, or null when it is unreadable or
 * oversized. Remote files are fetched via ssh (`stat` for the size so
 * oversized files are never downloaded, then `cat` for the bytes).
 */
async function readUntrackedFile(
  host: string,
  absPath: string,
): Promise<{ content: Buffer } | null> {
  if (host === LOCAL_HOST) {
    const st = await fs.promises.stat(absPath);
    if (!st.isFile() || st.size > MAX_UNTRACKED_BYTES) return null;
    return { content: await fs.promises.readFile(absPath) };
  }
  const size = await remoteStatSize(host, absPath);
  if (size === null || size > MAX_UNTRACKED_BYTES) return null;
  return { content: await remoteCat(host, absPath) };
}

async function diffForUntracked(
  host: string,
  repoRoot: string,
  relPath: string,
): Promise<WorkspaceDiffFile> {
  const full = path.join(repoRoot, relPath);
  try {
    const file = await readUntrackedFile(host, full);
    if (!file) {
      return { path: relPath, status: "untracked", ...UNREADABLE };
    }
    const buf = file.content;
    if (buf.subarray(0, 8192).includes(0)) {
      return { path: relPath, status: "untracked", ...UNREADABLE };
    }
    const lines = buf.toString("utf-8").split("\n");
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    const truncated = lines.length > MAX_DIFF_LINES;
    const shown = truncated ? lines.slice(0, MAX_DIFF_LINES) : lines;
    return {
      path: relPath,
      status: "untracked",
      additions: lines.length,
      deletions: 0,
      hunks: shown.map((l) => `+${l}`).join("\n"),
      truncated,
      binary: false,
    };
  } catch {
    // Race: the file vanished between `ls-files` and the read — skip it.
    return { path: relPath, status: "untracked", ...UNREADABLE };
  }
}

/**
 * @param options.commit Restrict the file list to one commit of the session's
 *   own range. Ignored when that commit is not in the range any more (a rebase
 *   leaves the old object dangling, so existence is not the test — membership
 *   is); the reply's `scope` then says which range was actually used.
 */
export async function getWorkspaceDiff(
  cwd: string,
  host: string = LOCAL_HOST,
  options: { commit?: string } = {},
): Promise<WorkspaceDiffResult> {
  try {
    await git(host, cwd, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return { kind: "not-a-repo" };
  }

  // `cwd` may be a subdirectory, and git is cwd-sensitive in two ways that both
  // corrupt the result: it resolves pathspecs relative to the cwd (so a
  // root-relative diff path matches nothing) and `ls-files` both scopes and
  // prints its output relative to it (so untracked files outside the cwd go
  // missing and the rest come back without their prefix). Resolve the toplevel
  // once and run everything from there; fall back to cwd if rev-parse is
  // unavailable.
  const root =
    (
      await git(host, cwd, ["rev-parse", "--show-toplevel"]).catch(() => "")
    ).trim() || cwd;

  const headSha =
    (
      await git(host, root, ["rev-parse", "--verify", "HEAD"]).catch(() => "")
    ).trim() || null;
  const resolved = await resolveDiffBase(host, root, headSha);

  const commits = resolved.commitsFrom
    ? await listCommits(host, root, resolved.commitsFrom)
    : [];
  const picked = options.commit
    ? commits.find((commit) => commit.sha === options.commit)
    : undefined;
  const scope: WorkspaceDiffScope = picked
    ? { kind: "commit", ...picked }
    : { kind: "all" };
  // `<sha>^!` is the commit's own diff (and prints the whole tree for a root
  // commit, which `<sha>^ <sha>` cannot).
  const rev = picked ? `${picked.sha}^!` : resolved.rev;

  const entries = parseNameStatusZ(
    await git(host, root, diffArgs(rev, ["--name-status", "-z"])).catch(
      () => "",
    ),
  );
  const stats = parseNumstatZ(
    await git(host, root, diffArgs(rev, ["--numstat", "-z"])).catch(() => ""),
  );

  const files: WorkspaceDiffFile[] = [];
  for (const entry of entries) {
    files.push(
      await diffForTracked(host, root, rev, entry, stats.get(entry.path)),
    );
  }
  // Untracked files live in the worktree, so they only belong to the
  // all-changes range — a single commit cannot contain them.
  if (scope.kind === "all") {
    const untracked = await git(host, root, [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
    ]).catch(() => "");
    for (const relPath of parseZRecords(untracked)) {
      files.push(await diffForUntracked(host, root, relPath));
    }
  }
  return { kind: "ok", base: resolved.base, scope, commits, files };
}
