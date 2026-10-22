/**
 * 「导出日志」: pack the text logs and the Crashpad minidumps into one archive
 * the user can hand to support.
 *
 * Why an archive at all: after a crash the user is looking at a dialog and a
 * dead window. Asking them to find `~/.wave/logs` (hidden on macOS) *and* the
 * platform-specific Crashpad directory is a guaranteed round of back-and-forth.
 *
 * Format: `.tar.gz`, not `.zip`. The repo has no zip library and this feature
 * does not justify a new dependency; `tar` is already a desktop runtime
 * dependency (remote CLI push), and both Finder and Windows 10+ open `.tar.gz`
 * natively.
 */

import { app, dialog } from "electron";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { c as createTarArchive } from "tar";
import { LOG_DIR } from "./hostLog";
import { crashDumpsDir } from "./crashReporter";

const ARCHIVE_PREFIX = "codewave-diagnostics-";
/** Names inside the archive — what a support engineer sees first. */
const LOGS_ENTRY = "logs";
const DUMPS_ENTRY = "crash-dumps";
const MANIFEST_ENTRY = "manifest.txt";

/** `codewave-diagnostics-20261022-153012.tar.gz` (local time: the user's clock). */
export function diagnosticsFileName(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  const stamp =
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${ARCHIVE_PREFIX}${stamp}.tar.gz`;
}

/**
 * Save-dialog default: the user's Desktop (that is where people look for an
 * exported file). Headless/Linux setups without an XDG desktop dir still work —
 * `getPath("desktop")` can throw, so fall back to the home directory.
 */
export function defaultDiagnosticsPath(date: Date): string {
  let base: string;
  try {
    base = app.getPath("desktop");
  } catch {
    base = os.homedir();
  }
  return path.join(base, diagnosticsFileName(date));
}

export type ExportDiagnosticsResult = {
  /** Where the archive was written; undefined when the user cancelled. */
  path?: string;
};

/**
 * Returns the archive path, or `undefined` if the user dismissed the dialog.
 * Throws on I/O failure — the recovery dialog turns that into its own message.
 */
export async function exportDiagnostics(): Promise<
  ExportDiagnosticsResult["path"]
> {
  const now = new Date();
  const result = await dialog.showSaveDialog({
    title: "导出诊断日志",
    defaultPath: defaultDiagnosticsPath(now),
    filters: [{ name: "诊断归档", extensions: ["tar.gz"] }],
    properties: ["createDirectory", "showOverwriteConfirmation"],
  });
  if (result.canceled || !result.filePath) return undefined;

  const target = result.filePath;
  const logsDir = LOG_DIR;
  const dumpsDir = crashDumpsDir();
  // Stage first, archive second: `tar` needs one common root to keep the
  // archive layout (logs/…, crash-dumps/…) stable regardless of where the two
  // source directories live on this platform.
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "codewave-diag-"));
  try {
    const entries: string[] = [];

    const logFiles = collectLogFiles(logsDir);
    if (logFiles.length > 0) {
      const dest = path.join(stage, LOGS_ENTRY);
      fs.mkdirSync(dest, { recursive: true });
      for (const file of logFiles) {
        fs.copyFileSync(path.join(logsDir, file), path.join(dest, file));
      }
      entries.push(LOGS_ENTRY);
    }

    // The directory exists as soon as Crashpad has written anything; an empty
    // or missing one is normal (fresh install, no crash yet).
    if (fs.existsSync(dumpsDir)) {
      const dest = path.join(stage, DUMPS_ENTRY);
      fs.cpSync(dumpsDir, dest, { recursive: true });
      entries.push(DUMPS_ENTRY);
    }

    fs.writeFileSync(
      path.join(stage, MANIFEST_ENTRY),
      JSON.stringify(
        {
          generatedAt: now.toISOString(),
          version: app.getVersion(),
          platform: process.platform,
          arch: process.arch,
          electron: process.versions.electron,
          logsDir,
          crashDumpsDir: dumpsDir,
          logFiles,
        },
        null,
        2,
      ),
    );
    entries.push(MANIFEST_ENTRY);

    fs.mkdirSync(path.dirname(target), { recursive: true });
    // `cwd: stage` + bare entry names = archive paths are `logs/desktop.log`,
    // never absolute paths with the user's name in them.
    await createTarArchive({ gzip: true, file: target, cwd: stage }, entries);
    return target;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

function collectLogFiles(logsDir: string): string[] {
  try {
    return fs
      .readdirSync(logsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".log"))
      .map((entry) => entry.name)
      .sort();
  } catch {
    // Missing logs directory: nothing to export from that side.
    return [];
  }
}
