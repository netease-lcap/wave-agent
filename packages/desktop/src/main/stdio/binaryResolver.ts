/**
 * BinaryResolver — prepares the `wave` CLI for local sessions.
 *
 * 1. WAVE_CLI_PATH env override (development)
 * 2. The CLI bundled inside the app (resources/wave-cli, shipped in the
 *    installer) is copied into `~/.wave/cli/desktop` — the packaged install
 *    dir is read-only on macOS/Windows, so the runtime copy lives under the
 *    user home. The runtime copy is refreshed whenever its bundle bytes drift
 *    from the app's (app upgrades AND same-version dev reinstalls like
 *    `desktop:install`). Each frontend (vscode/desktop/jetbrains) keeps its
 *    own subdir so different versions never overwrite each other.
 *
 * Runtime dependencies (`sharp` for images, `@vscode/ripgrep` for grep) are not
 * handled here: the CLI installs them itself on startup into the shared
 * `~/.wave/cli/node_modules` dir (see `runtimeDeps.ts` in the SDK), and a failed
 * download only degrades the tool that needs it — it never blocks startup.
 *
 * Everything runs on the Electron-bundled Node runtime (`process.execPath` +
 * `ELECTRON_RUN_AS_NODE=1`); no system Node.js/npm is required. Result is
 * cached for the app lifetime.
 */

import { createHash } from "node:crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { app } from "electron";

let cachedPath: string | undefined;

/** Bundled CLI dir: `<resources>/wave-cli` packaged, `<app>/resources/wave-cli` in dev. */
export function bundledCliDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "wave-cli")
    : path.join(app.getAppPath(), "resources", "wave-cli");
}

/**
 * The CLI bytes this app ships (resources/wave-cli). Remote hosts receive this
 * same bundle over ssh; the sync target is the bundled bundle's sha256 (never a
 * version string — GUI-only releases can ship new bytes without bumping the
 * version, see desktop-shell.md 「内置 CLI 一致保障」), so it is read from the
 * bundle itself, never from `app.getVersion()`.
 */
export interface BundledCliSource {
  /** Absolute local dir holding the bundled CLI (bin/dist/package.json). */
  dir: string;
  /** sha256 of `dir/dist/bundle/wave.mjs` — the remote sync target. */
  bundleSha256: string;
}

/** Read the bundled CLI metadata. @throws actionable error on a corrupt app. */
export function loadBundledCliSource(): BundledCliSource {
  const dir = bundledCliDir();
  try {
    fs.readFileSync(path.join(dir, "package.json"), "utf-8");
  } catch {
    throw new Error(
      `内置 CLI 缺失（${path.join(dir, "package.json")}）。请重新安装应用。`,
    );
  }
  const bundleSha256 = fileHash(path.join(dir, "dist", "bundle", "wave.mjs"));
  if (!bundleSha256) {
    throw new Error(
      `内置 CLI 缺失（${path.join(dir, "dist", "bundle", "wave.mjs")}）。请重新安装应用。`,
    );
  }
  return { dir, bundleSha256 };
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
  return path.join(cliRootDir(), "desktop");
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
 * version-string check: local dev reinstalls (`desktop:install`) refresh the
 * app without bumping its version, so an unchanged version number cannot be
 * trusted as "same CLI". The runtime dependencies the CLI installs itself live
 * in the shared `~/.wave/cli/node_modules` dir — outside this per-end dir — so
 * an upgrade never forces re-downloading them. Returns the runtime entry path.
 * @throws Error when the bundled CLI itself is missing (corrupt install).
 */
function prepareCli(): string {
  const entry = cliEntryPath();
  const bundledEntry = path.join(bundledCliDir(), "bin", "wave-code.js");
  if (!fileExists(bundledEntry)) {
    throw new Error(`内置 CLI 缺失（${bundledEntry}）。请重新安装应用。`);
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
 * Resolve the `wave` CLI for local sessions: WAVE_CLI_PATH override first
 * (development), then the CLI copied from the bundle into `~/.wave/cli/desktop`.
 * @throws Error only when the bundled CLI is missing (corrupt install).
 */
export async function resolveWaveBinary(
  _targetVersion?: string,
): Promise<string> {
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
 * Ensure the CLI for local sessions is ready: bundled CLI copied into
 * `~/.wave/cli/desktop`. The CLI version tracks the app version, so there is no
 * separate upgrade step.
 */
export async function ensureCliUpToDate(
  targetVersion?: string,
): Promise<string> {
  return resolveWaveBinary(targetVersion);
}

/** Reset cached path — for testing only. */
export function _resetCacheForTesting(): void {
  cachedPath = undefined;
}
