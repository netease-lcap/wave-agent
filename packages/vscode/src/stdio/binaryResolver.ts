/**
 * BinaryResolver — prepares the `wave` CLI for the extension.
 *
 * 1. WAVE_CLI_PATH env override (development)
 * 2. The CLI bundled inside the extension (dist/wave-cli, shipped in the
 *    vsix) is copied into `~/.wave/cli` — the extension dir is read-only, so
 *    the runtime copy lives under the user home. The CLI version tracks the
 *    extension version (shipped with the vsix).
 * 3. The grep tool's runtime dependency `@vscode/ripgrep` (JS wrapper +
 *    platform rg binary, ~5MB) is downloaded from the npmmirror registry on
 *    first use and cached in the runtime dir. A failed download does NOT
 *    block the CLI — grep simply reports "ripgrep is not available" until a
 *    later launch succeeds.
 *
 * Everything runs on the extension-host Node runtime (`process.execPath`); no
 * system Node.js/npm is required. Result is cached for the extension lifetime.
 */

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { x as extract } from "tar";
import { maxSatisfying } from "semver";

/** npm registry mirror for China users (faster than the default registry). */
export const NPM_REGISTRY = "https://registry.npmmirror.com";

let cachedPath: string | undefined;
let extensionPath: string | undefined;

/** Optional callback invoked when a download starts. */
export type InstallProgressCallback = (message: string) => void;

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

/** Runtime CLI dir under the user home (writable, mirrors a flat npm install). */
export function cliInstallDir(): string {
  return path.join(os.homedir(), ".wave", "cli");
}

/** Entry point of the runtime CLI (the version-probe shim). */
export function cliEntryPath(): string {
  return path.join(cliInstallDir(), "bin", "wave-code.js");
}

/** Where the downloaded ripgrep packages live inside the runtime CLI dir. */
function rgInstallDir(): string {
  return path.join(cliInstallDir(), "node_modules", "@vscode");
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
 * the runtime CLI dir (skipped when already downloaded). Returns true when
 * the rg binary is in place. Never throws — a failed download only disables
 * the grep tool until a later launch retries.
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
 * version differs (extension upgrade). The runtime `node_modules/`
 * (downloaded ripgrep) is preserved across copies so an already-downloaded
 * rg is never re-downloaded after an upgrade. Returns the runtime entry path.
 * @throws Error when the bundled CLI itself is missing (corrupt install).
 */
function prepareCli(): string {
  const entry = cliEntryPath();
  const bundledEntry = path.join(bundledCliDir(), "bin", "wave-code.js");
  if (!fileExists(bundledEntry)) {
    throw new Error(`内置 CLI 缺失（${bundledEntry}）。请重新安装扩展。`);
  }

  const needCopy =
    !fileExists(entry) ||
    bundledVersion() !== runtimeVersion() ||
    !fileExists(path.join(cliInstallDir(), "dist", "bundle", "wave.mjs"));

  if (needCopy) {
    fs.mkdirSync(cliInstallDir(), { recursive: true });
    // Replace the CLI files only — keep node_modules/ (the cached rg
    // download) so an upgrade does not force re-downloading it.
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

function bundledVersion(): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(bundledCliDir(), "package.json"), "utf-8"),
    ) as { version?: string };
    return pkg.version ?? "";
  } catch {
    return "";
  }
}

function runtimeVersion(): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(cliInstallDir(), "package.json"), "utf-8"),
    ) as { version?: string };
    return pkg.version ?? "";
  } catch {
    return "";
  }
}

/**
 * Resolve the `wave` CLI: WAVE_CLI_PATH override first (development), then
 * the CLI copied from the extension bundle into `~/.wave/cli`, ensuring the
 * ripgrep search dependency is downloaded.
 * @throws Error when the bundled CLI is missing (corrupt install) or the
 * ripgrep download fails — `@vscode/ripgrep` is a top-level import of the
 * bundled CLI, so without it wave.mjs cannot even start.
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
  const rgOk = await ensureRipgrep(onInstall);
  if (!rgOk) {
    throw new Error("grep 搜索依赖（ripgrep）下载失败。请检查网络连接后重试。");
  }
  cachedPath = entry;
  return cachedPath;
}

/**
 * Run `<cliPath> -v` through the host Node runtime (the extension-host
 * process, which is always a valid Node binary) and return the CLI's version
 * (e.g. "0.18.7"). Returns null if the CLI is missing/corrupt or the probe
 * fails/times out — callers treat null as an error rather than crashing.
 */
export function getCliVersion(cliPath: string): string | null {
  try {
    const output = execFileSync(process.execPath, [cliPath, "-v"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
    const line = output.trim().split("\n")[0]?.trim();
    if (!line) return null;
    // `wave -v` prints the bare version; tolerate a leading "v" just in case.
    return line.replace(/^v/, "");
  } catch {
    return null;
  }
}

/**
 * Ensure the `wave` CLI is ready: bundled CLI copied into `~/.wave/cli` and
 * ripgrep downloaded (best-effort). The CLI version tracks the extension
 * version, so there is no separate upgrade step.
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
