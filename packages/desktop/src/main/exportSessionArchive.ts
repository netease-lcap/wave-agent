/**
 * 「导出会话转录」: pack the raw transcript, a readable version and a manifest
 * into one `.tar.gz` the user can hand to support or open in another editor
 * (spec commands/export-command.md「桌面端」).
 *
 * Same shape and same format decision as `exportDiagnostics.ts`: stage into a
 * temp dir, `tar` once, clean up in `finally`, and use `.tar.gz` rather than
 * `.zip` (the repo has no zip library, `tar` is already a desktop runtime
 * dependency, and both Finder and Windows 10+ open `.tar.gz` natively).
 *
 * What differs is **where the bytes come from**. The transcript may live on
 * another machine entirely (an ssh host, a WSL distro), so the main process
 * cannot open it: everything in `SessionArchiveContents` has already been
 * fetched over the stdio RPC from the process that owns the file, and this
 * module only writes.
 */
import { app } from "electron";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { c as createTarArchive } from "tar";

/** Names inside the archive — raw evidence first, readable version second. */
const JSONL_ENTRY = "transcript.jsonl";
const MARKDOWN_ENTRY = "transcript.md";
const MANIFEST_ENTRY = "manifest.json";

/**
 * `wave-session-20261022-153012-1a2b3c4d.tar.gz` (local time — the user's
 * clock, like the diagnostics archive).
 *
 * The session id's first 8 characters keep two exports of the same session
 * distinguishable in a downloads folder without pasting a 36-character uuid
 * into a filename.
 */
export function sessionArchiveFileName(date: Date, sessionId: string): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `wave-session-${stamp}-${sessionId.slice(0, 8)}.tar.gz`;
}

/**
 * Save-dialog default: the user's Desktop (that is where people look for an
 * exported file). Headless/Linux setups without an XDG desktop dir still work —
 * `getPath("desktop")` can throw, so fall back to the home directory.
 */
export function defaultSessionArchivePath(
  date: Date,
  sessionId: string,
): string {
  let base: string;
  try {
    base = app.getPath("desktop");
  } catch {
    base = os.homedir();
  }
  return path.join(base, sessionArchiveFileName(date, sessionId));
}

export interface SessionArchiveContents {
  /**
   * The raw transcript bytes **exactly as they sit on the session host**, or
   * `null` when the transcript is over the export cap (then the archive carries
   * only the readable version, and the caller says so).
   */
  jsonl: Buffer | null;
  /** `transcript.md` — the readable version, rendered where the file lives. */
  markdown: string;
  /**
   * `manifest.json`, already serialized. Built next to the transcript (that is
   * where the session facts are), so this module never re-derives them.
   */
  manifestJson: string;
}

/**
 * Writes the archive and returns its path. Throws on I/O failure — the caller
 * turns that into its own toast.
 */
export async function writeSessionArchive(
  target: string,
  contents: SessionArchiveContents,
): Promise<string> {
  // Stage first, archive second: `tar` needs one common root so the archive
  // layout is `transcript.md`, never an absolute path with the user's name in it.
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "wave-session-export-"));
  try {
    const entries: string[] = [];
    if (contents.jsonl) {
      fs.writeFileSync(path.join(stage, JSONL_ENTRY), contents.jsonl);
      entries.push(JSONL_ENTRY);
    }
    fs.writeFileSync(
      path.join(stage, MARKDOWN_ENTRY),
      contents.markdown,
      "utf8",
    );
    entries.push(MARKDOWN_ENTRY);
    fs.writeFileSync(
      path.join(stage, MANIFEST_ENTRY),
      contents.manifestJson,
      "utf8",
    );
    entries.push(MANIFEST_ENTRY);

    fs.mkdirSync(path.dirname(target), { recursive: true });
    await createTarArchive({ gzip: true, file: target, cwd: stage }, entries);
    return target;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}
