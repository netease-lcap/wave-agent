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
 * 3. The grep tool's runtime dependency `@vscode/ripgrep` (JS wrapper +
 *    platform rg binary, ~5MB) is downloaded from the npmmirror registry on
 *    first use and cached in the shared `~/.wave/cli/node_modules/@vscode`
 *    dir (shared by vscode/desktop/jetbrains). A failed download does NOT
 *    block the CLI — grep simply reports "ripgrep is not available" until a
 *    later launch succeeds.
 *
 * Everything runs on the Electron-bundled Node runtime (`process.execPath` +
 * `ELECTRON_RUN_AS_NODE=1`); no system Node.js/npm is required. Result is
 * cached for the app lifetime.
 */

import { createHash } from "node:crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { x as extract } from "tar";
import { maxSatisfying } from "semver";
import { app } from "electron";

/** npm registry mirror for China users (faster than the default registry). */
export const NPM_REGISTRY = "https://registry.npmmirror.com";

let cachedPath: string | undefined;

/** Optional callback invoked when a download starts. */
export type InstallProgressCallback = (message: string) => void;

/** Bundled CLI dir: `<resources>/wave-cli` packaged, `<app>/resources/wave-cli` in dev. */
export function bundledCliDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "wave-cli")
    : path.join(app.getAppPath(), "resources", "wave-cli");
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

/**
 * Where the downloaded ripgrep packages live. Shared by all three frontends
 * (vscode/desktop/jetbrains) — deliberately outside the per-end CLI dir so
 * each end's CLI copy never wipes the cached rg download.
 */
export function rgInstallDir(): string {
  return path.join(cliRootDir(), "node_modules", "@vscode");
}

/** Current platform's rg binary path after install. */
function rgBinaryPath(): string {
  return path.join(
    rgInstallDir(),
    `ripgrep-${process.platform}-${process.arch}`,
    "bin",
    process.platform === "win32" ? "rg.exe" : "rg",
  );
}

/** Check if a file exists at the given path. */
function fileExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/** Download a URL to a Buffer (Node 22+ built-in fetch). */
async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`下载失败（HTTP ${res.status}）：${url}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Extract a `.tgz` (gzip tar) into [dest], stripping the top `package/` dir. */
async function extractTarball(buffer: Buffer, dest: string): Promise<void> {
  const tmpFile = path.join(
    os.tmpdir(),
    `wave-rg-${process.pid}-${Math.random().toString(36).slice(2)}.tgz`,
  );
  fs.writeFileSync(tmpFile, buffer);
  try {
    await extract({ file: tmpFile, cwd: dest, strip: 1 });
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}

/** Resolve the registry tarball URL for `pkg@version` (from package metadata). */
async function tarballUrl(pkg: string, version: string): Promise<string> {
  const res = await fetch(`${NPM_REGISTRY}/${pkg}`, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`获取 ${pkg} 元数据失败（HTTP ${res.status}）`);
  }
  const meta = (await res.json()) as {
    versions?: Record<string, { dist?: { tarball?: string } }>;
  };
  const dist = meta.versions?.[version]?.dist?.tarball;
  if (!dist) {
    throw new Error(`未找到 ${pkg}@${version} 的下载地址`);
  }
  return dist;
}

/** Highest version of `@vscode/ripgrep` satisfying the CLI's declared range. */
async function resolveRipgrepVersion(range: string): Promise<string> {
  const res = await fetch(`${NPM_REGISTRY}/@vscode/ripgrep`, {
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`获取 @vscode/ripgrep 元数据失败（HTTP ${res.status}）`);
  }
  const meta = (await res.json()) as { versions?: Record<string, unknown> };
  const versions = Object.keys(meta.versions ?? {});
  const best = maxSatisfying(versions, range);
  if (!best) {
    throw new Error(`没有满足 ${range} 的 @vscode/ripgrep 版本`);
  }
  return best;
}

/**
 * Download the ripgrep JS wrapper and the current platform's rg binary into
 * the runtime CLI dir. Returns true when the rg binary is in place. Never
 * throws — a failed download only disables the grep tool until a later
 * launch retries.
 */
export async function ensureRipgrep(
  onInstall?: InstallProgressCallback,
): Promise<boolean> {
  if (fileExists(rgBinaryPath())) return true;
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(cliInstallDir(), "package.json"), "utf-8"),
    ) as { dependencies?: Record<string, string> };
    const rgRange = pkg.dependencies?.["@vscode/ripgrep"];
    if (!rgRange) return true; // CLI has no grep dependency — nothing to do.

    onInstall?.("正在下载 grep 搜索依赖（ripgrep），请稍候…");
    const rgVersion = await resolveRipgrepVersion(rgRange);
    const dir = rgInstallDir();
    fs.mkdirSync(dir, { recursive: true });
    // Each tarball strips its top `package/` dir, so extract into its own
    // package dir — the JS wrapper and the platform binary must NOT share
    // a directory (wave.mjs resolves `@vscode/ripgrep` via createRequire).
    // tar refuses to cd into a missing cwd, so create the dirs first.
    const jsDir = path.join(dir, "ripgrep");
    const platformDir = `ripgrep-${process.platform}-${process.arch}`;
    const binDir = path.join(dir, platformDir);
    fs.mkdirSync(jsDir, { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });
    await extractTarball(
      await downloadBuffer(await tarballUrl("@vscode/ripgrep", rgVersion)),
      jsDir,
    );
    await extractTarball(
      await downloadBuffer(
        await tarballUrl(`@vscode/${platformDir}`, rgVersion),
      ),
      binDir,
    );
    return fileExists(rgBinaryPath());
  } catch (error) {
    console.warn("[Wave] ripgrep 下载失败，grep 工具暂不可用：", error);
    return false;
  }
}

/**
 * Copy the bundled CLI into the runtime dir when missing or when the bundled
 * bundle bytes differ from the runtime copy. Content comparison instead of a
 * version-string check: local dev reinstalls (`desktop:install`) refresh the
 * app without bumping its version, so an unchanged version number cannot be
 * trusted as "same CLI". The cached rg download lives in the shared
 * `~/.wave/cli/node_modules/@vscode` dir — outside this per-end dir — so an
 * already-downloaded rg is never re-downloaded after an upgrade. Returns the
 * runtime entry path.
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
    // Replace the CLI files only — the cached rg download lives in the
    // shared ~/.wave/cli dir, so an upgrade never forces re-downloading it.
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
 * (development), then the CLI copied from the bundle into `~/.wave/cli/desktop`,
 * ensuring the ripgrep search dependency is downloaded (best-effort).
 * @throws Error only when the bundled CLI is missing (corrupt install).
 */
export async function resolveWaveBinary(
  _targetVersion?: string,
  onInstall?: InstallProgressCallback,
): Promise<string> {
  if (cachedPath) return cachedPath;

  const envPath = process.env.WAVE_CLI_PATH;
  if (envPath && fileExists(envPath)) {
    cachedPath = envPath;
    return cachedPath;
  }

  const entry = prepareCli();
  // `@vscode/ripgrep` is a top-level import of the bundled CLI — without it
  // wave.mjs cannot even start. A failed download must therefore surface as
  // a clear init error (with a retry hint), not as an opaque MODULE_NOT_FOUND
  // crash from the CLI child process.
  const rgOk = await ensureRipgrep(onInstall);
  if (!rgOk) {
    throw new Error(
      "grep 搜索依赖（ripgrep）下载失败。请检查网络连接后重启应用重试。",
    );
  }
  cachedPath = entry;
  return cachedPath;
}

/**
 * Ensure the CLI for local sessions is ready: bundled CLI copied into
 * `~/.wave/cli/desktop` and ripgrep downloaded (best-effort). The CLI
 * version tracks the app version, so there is no separate upgrade step.
 */
export async function ensureCliUpToDate(
  targetVersion?: string,
  onInstall?: InstallProgressCallback,
): Promise<string> {
  return resolveWaveBinary(targetVersion, onInstall);
}

/** Reset cached path — for testing only. */
export function _resetCacheForTesting(): void {
  cachedPath = undefined;
}
