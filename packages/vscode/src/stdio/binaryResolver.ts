/**
 * BinaryResolver — prepares the `wave` CLI for the extension.
 *
 * 1. WAVE_CLI_PATH env override (development)
 * 2. The CLI bundled inside the extension (dist/wave-cli, shipped in the
 *    vsix) is copied into `~/.wave/cli/vscode` — the extension dir is
 *    read-only, so the runtime copy lives under the user home. Whether to
 *    copy is decided by content: the runtime `dist/bundle/wave.mjs` is
 *    re-copied only when its sha256 differs from the bundled one — a version
 *    string cannot be trusted as "same CLI" (local dev reinstalls and
 *    GUI-only releases can ship new bytes without bumping the version). Each
 *    frontend (vscode/desktop/jetbrains) keeps its own subdir so different
 *    versions never overwrite each other.
 *
 * Runtime dependencies (`sharp` for images, `@vscode/ripgrep` for grep) are not
 * handled here: the CLI installs them itself on startup into the shared
 * `~/.wave/cli/node_modules` dir (see `runtimeDeps.ts` in the SDK), and a failed
 * download only degrades the tool that needs it — it never blocks startup.
 *
 * Everything runs on the extension-host Node runtime (`process.execPath`); no
 * system Node.js/npm is required. Result is cached for the extension lifetime.
 */

import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

let cachedPath: string | undefined;
let extensionPath: string | undefined;

/**
 * Decode output of cmd.exe builtins (`where`, `which`). On Chinese Windows
 * those write the system OEM code page (CP936/GBK); decoding GBK bytes as
 * UTF-8 corrupts non-ASCII path segments (`C:\Users\刘一奇\...` → U+FFFD).
 * Try UTF-8 first (covers non-Windows and chcp 65001), fall back to GBK on
 * U+FFFD — same policy as stdioClient.decodeStderr. Exported for reuse
 * (loginPath decodes `where git` output the same way).
 */
export function decodeCommandOutput(out: string | Buffer): string {
  const buf = Buffer.isBuffer(out) ? out : Buffer.from(out);
  const utf8 = buf.toString("utf-8");
  if (!utf8.includes("\uFFFD")) return utf8;
  try {
    return new TextDecoder("gbk").decode(buf);
  } catch {
    return utf8;
  }
}

/** Set the extension install path (used to locate the bundled CLI). */
export function setExtensionPath(p: string): void {
  extensionPath = p;
}

/** Bundled CLI dir inside the extension: `<ext>/dist/wave-cli`. */
export function bundledCliDir(): string {
  if (!extensionPath) {
    throw new Error("无法解析 wave CLI：缺少扩展路径。");
  }
  return path.join(extensionPath, "dist", "wave-cli");
}

/** Shared root dir for all CLI runtime data under the user home. */
function cliRootDir(): string {
  return path.join(os.homedir(), ".wave", "cli");
}

/**
 * Runtime CLI dir under the user home (writable, mirrors a flat npm
 * install). Per-end: vscode/desktop/jetbrains each own their own subdir so
 * they never overwrite each other's CLI copy.
 */
export function cliInstallDir(): string {
  return path.join(cliRootDir(), "vscode");
}

/** Entry point of the runtime CLI (the version-probe shim). */
export function cliEntryPath(): string {
  return path.join(cliInstallDir(), "bin", "wave-code.js");
}

/** Check if a file exists at the given path. */
function fileExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/**
 * Copy the bundled CLI into the runtime dir when missing or when the bundled
 * bundle bytes differ from the runtime copy. Content comparison instead of a
 * version-string check: dev reinstalls refresh the extension without bumping
 * its version, so an unchanged version number cannot be trusted as "same
 * CLI". The runtime dependencies the CLI installs itself live in the shared
 * `~/.wave/cli/node_modules` dir — outside this per-end dir — so an upgrade
 * never forces re-downloading them. Returns the runtime entry path.
 * @throws Error when the bundled CLI itself is missing (corrupt install).
 */
function prepareCli(): string {
  const entry = cliEntryPath();
  const bundledEntry = path.join(bundledCliDir(), "bin", "wave-code.js");
  if (!fileExists(bundledEntry)) {
    throw new Error(`内置 CLI 缺失（${bundledEntry}）。请重新安装扩展。`);
  }

  const runtimeBundle = path.join(
    cliInstallDir(),
    "dist",
    "bundle",
    "wave.mjs",
  );
  const needCopy =
    !fileExists(entry) ||
    !fileExists(runtimeBundle) ||
    fileHash(path.join(bundledCliDir(), "dist", "bundle", "wave.mjs")) !==
      fileHash(runtimeBundle);

  if (needCopy) {
    fs.mkdirSync(cliInstallDir(), { recursive: true });
    // Replace the CLI files only — the downloaded runtime dependencies live in
    // the shared ~/.wave/cli dir, so an upgrade never forces re-downloading
    // them.
    fs.rmSync(path.join(cliInstallDir(), "dist"), {
      recursive: true,
      force: true,
    });
    fs.rmSync(entry, { force: true });
    fs.rmSync(path.join(cliInstallDir(), "package.json"), { force: true });
    fs.cpSync(bundledCliDir(), cliInstallDir(), { recursive: true });
  }
  return entry;
}

/** sha256 of a file's bytes, or "" when it can't be read (missing/corrupt). */
function fileHash(p: string): string {
  try {
    return createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  } catch {
    return "";
  }
}

/**
 * Resolve the `wave` CLI: WAVE_CLI_PATH override first (development), then the
 * CLI copied from the extension bundle into `~/.wave/cli/vscode`.
 * @throws Error when the bundled CLI is missing (corrupt install).
 */
export async function resolveWaveBinary(): Promise<string> {
  if (cachedPath) return cachedPath;

  const envPath = process.env.WAVE_CLI_PATH;
  if (envPath && fileExists(envPath)) {
    cachedPath = envPath;
    return cachedPath;
  }

  cachedPath = prepareCli();
  return cachedPath;
}

/**
 * Ensure the `wave` CLI is ready: bundled CLI copied into `~/.wave/cli/vscode`
 * (content comparison — a changed `wave.mjs` re-copies even when the version
 * string is unchanged).
 */
export async function ensureCliUpToDate(): Promise<string> {
  return resolveWaveBinary();
}

/** Reset cached path — for testing only. */
export function _resetCacheForTesting(): void {
  cachedPath = undefined;
}
