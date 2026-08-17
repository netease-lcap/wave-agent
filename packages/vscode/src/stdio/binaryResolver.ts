/**
 * BinaryResolver — locates or installs the `wave` CLI binary.
 *
 * 1. Check PATH for `wave`
 * 2. If missing, run `npm install -g wave-code[@<version>]`
 * 3. Resolve via npm global prefix
 *
 * Result is cached for the extension lifetime.
 */

import { execSync, execFile, execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { parseVersion, compareVersions } from "../services/version";

/** npm registry mirror for China users (faster than the default registry). */
export const NPM_REGISTRY = "https://registry.npmmirror.com";

/**
 * Strict semver — versions are interpolated into shell commands (on Windows
 * through cmd.exe), so a non-semver version must never reach the shell.
 */
const SEMVER_RE = /^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

/**
 * `wave-code` package specifier for install/upgrade commands: pins the exact
 * version when one is known, otherwise the bare package (resolves to @latest).
 * Throws "Invalid version" on non-semver input (same no-shell-injection
 * guarantee as upgradeWaveBinary).
 */
function waveCodeSpec(targetVersion?: string): string {
  if (targetVersion == null) return "wave-code";
  if (!SEMVER_RE.test(targetVersion)) {
    throw new Error(`Invalid version: ${targetVersion}`);
  }
  return `wave-code@${targetVersion}`;
}

let cachedPath: string | undefined;

/**
 * Decode output of cmd.exe builtins (`where`, `which`). On Chinese Windows
 * those write the system OEM code page (CP936/GBK); decoding GBK bytes as
 * UTF-8 corrupts non-ASCII path segments (`C:\Users\刘一奇\...` → U+FFFD),
 * and spawning the corrupted path fails with ERROR_PATH_NOT_FOUND. Try UTF-8
 * first (covers non-Windows and chcp 65001), fall back to GBK on U+FFFD —
 * same policy as stdioClient.decodeStderr. Exported for reuse (loginPath
 * decodes `where git` output the same way).
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

/**
 * Pick the executable line from `which`/`where` output. On Windows `where`
 * lists the extensionless bash launcher first (e.g. `C:\Program Files\nodejs\npm`)
 * followed by `npm.cmd` — cmd.exe cannot execute the bash launcher, so prefer
 * `.cmd`/`.exe`/`.bat` lines.
 */
function pickExecutableLine(lookupOutput: string): string {
  const lines = lookupOutput
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (process.platform === "win32") {
    const cmdLine = lines.find((l) => /\.(cmd|exe|bat)$/i.test(l));
    if (cmdLine) return cmdLine;
  }
  return lines[0] ?? "";
}

/**
 * With `shell: true` on Windows, Node concatenates file+args into the cmd.exe
 * command line WITHOUT quoting the file — a path containing spaces (e.g.
 * `C:\Program Files\nodejs\npm.cmd`) is split at the space and fails with
 * "'C:\Program' is not recognized". Pre-quote it.
 */
function quoteForShell(executable: string): string {
  return process.platform === "win32" ? `"${executable}"` : executable;
}

/** Minimum Node.js major version required by `wave --stdio`. */
const MIN_NODE_MAJOR = 22;

/**
 * Error thrown when Node.js/npm cannot be found on the system.
 * Callers catch this to show a user-friendly "install Node.js" message
 * instead of a cryptic npm failure.
 */
export class NodeJsNotFoundError extends Error {
  constructor() {
    super(
      "未检测到 Node.js/npm。请先安装 Node.js (https://nodejs.org)，然后重启编辑器。",
    );
    this.name = "NodeJsNotFoundError";
  }
}

/**
 * Error thrown when the system Node.js version is below the minimum required.
 * Callers catch this to show a user-friendly "upgrade Node.js" message.
 */
export class NodeJsVersionError extends Error {
  constructor(currentVersion: string) {
    super(
      `Node.js 版本过低（当前 ${currentVersion}，需要 >= ${MIN_NODE_MAJOR}）。请升级 Node.js (https://nodejs.org)，然后重启编辑器。`,
    );
    this.name = "NodeJsVersionError";
  }
}

/**
 * Find `node` executable: PATH first, then `process.execPath` (the Node
 * running the extension host, which is always a valid node binary).
 */
function findNode(): string {
  const cmd = process.platform === "win32" ? "where node" : "which node";
  try {
    const result = decodeCommandOutput(
      execSync(cmd, { encoding: "buffer", stdio: "pipe" }),
    ).trim();
    if (result) return result.split("\n")[0].trim();
  } catch {
    // not on PATH
  }
  // process.execPath is always a Node binary (the extension host runtime).
  return process.execPath;
}

/**
 * Check that the system Node.js is >= MIN_NODE_MAJOR.
 * @throws {NodeJsVersionError} if the version is below the minimum.
 */
function checkNodeVersion(): void {
  const node = findNode();
  const output = execFileSync(node, ["-v"], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const match = output.match(/^v?(\d+)/);
  if (!match) throw new NodeJsVersionError(output);
  const major = parseInt(match[1], 10);
  if (major < MIN_NODE_MAJOR) throw new NodeJsVersionError(`v${major}`);
}

/**
 * Find `npm` CLI executable.
 * Checks PATH first, then falls back to the directory of the running Node binary.
 * @throws {NodeJsNotFoundError} if npm cannot be located anywhere.
 */
function findNpm(): string {
  const cmd = process.platform === "win32" ? "where npm" : "which npm";
  try {
    const result = decodeCommandOutput(
      execSync(cmd, { encoding: "buffer", stdio: "pipe" }),
    ).trim();
    if (result) return pickExecutableLine(result);
  } catch {
    // not on PATH
  }

  // Fallback: look relative to process.execPath (the Node running VS Code)
  const nodeDir = path.dirname(process.execPath);
  const candidates =
    process.platform === "win32"
      ? [path.join(nodeDir, "npm.cmd"), path.join(nodeDir, "npm")]
      : [path.join(nodeDir, "npm"), path.join(nodeDir, "..", "bin", "npm")];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  throw new NodeJsNotFoundError();
}

/** Resolve the npm global bin directory. */
function getNpmGlobalBin(): string {
  const npm = findNpm();
  const prefix = decodeCommandOutput(
    execSync(`"${npm}" prefix -g`, {
      encoding: "buffer",
      stdio: "pipe",
    }),
  ).trim();
  return process.platform === "win32" ? prefix : path.join(prefix, "bin");
}

/** Check if a file exists at the given path. */
function fileExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/** Optional callback invoked when an npm install/upgrade starts. */
export type InstallProgressCallback = (message: string) => void;

/**
 * Resolve the `wave` binary, auto-installing via npm when missing. When
 * [targetVersion] is provided the install pins that exact version — a first
 * install must never grab a mismatched @latest (spec: stdio-transport.md
 * 「CLI 二进制自动解析与安装」 scenario 3).
 */
export function resolveWaveBinary(
  onInstall?: InstallProgressCallback,
  targetVersion?: string,
): string {
  if (cachedPath) return cachedPath;

  // 0. Verify Node.js >= 22 — wave --stdio requires it.
  checkNodeVersion();

  // 1. Try PATH
  const whichCmd = process.platform === "win32" ? "where wave" : "which wave";
  try {
    const result = decodeCommandOutput(
      execSync(whichCmd, { encoding: "buffer", stdio: "pipe" }),
    ).trim();
    if (result) {
      cachedPath = pickExecutableLine(result);
      return cachedPath;
    }
  } catch {
    // not on PATH
  }

  // 2. Try npm global bin directory (might already be installed)
  let globalBin: string;
  try {
    globalBin = getNpmGlobalBin();
  } catch (e) {
    // NodeJsNotFoundError / NodeJsVersionError have user-friendly messages — propagate.
    if (e instanceof NodeJsNotFoundError || e instanceof NodeJsVersionError)
      throw e;
    throw new Error(
      `Failed to determine npm global directory. Please install wave-code manually: npm install -g ${targetVersion ? `wave-code@${targetVersion}` : "wave-code"} --registry=${NPM_REGISTRY}`,
    );
  }

  const waveName = process.platform === "win32" ? "wave.cmd" : "wave";
  const globalPath = path.join(globalBin, waveName);
  if (fileExists(globalPath)) {
    cachedPath = globalPath;
    return cachedPath;
  }

  // 3. Install globally — pin the exact version (same as the upgrade path).
  const spec = waveCodeSpec(targetVersion);
  console.log(`[Wave] wave binary not found, installing ${spec} globally...`);
  onInstall?.(
    targetVersion
      ? `正在安装 wave-code@${targetVersion}，请稍候…`
      : "正在安装 wave-code，请稍候…",
  );
  const npm = findNpm();
  execSync(`"${npm}" install -g ${spec} --registry=${NPM_REGISTRY}`, {
    encoding: "utf-8",
    stdio: "pipe",
  });

  // 4. Check npm global bin again
  if (fileExists(globalPath)) {
    cachedPath = globalPath;
    return cachedPath;
  }

  // 5. Try PATH again (install may have added it)
  try {
    const result = decodeCommandOutput(
      execSync(whichCmd, { encoding: "buffer", stdio: "pipe" }),
    ).trim();
    if (result) {
      cachedPath = pickExecutableLine(result);
      return cachedPath;
    }
  } catch {
    // still not found
  }

  throw new Error(
    `wave binary not found after installation. Please install manually: npm install -g ${targetVersion ? `wave-code@${targetVersion}` : "wave-code"} --registry=${NPM_REGISTRY}`,
  );
}

/**
 * Run `<binaryPath> -v` and return the CLI's version (e.g. "0.18.7").
 * Returns null if the binary is missing, corrupt, or `-v` fails/times out —
 * callers treat null as "needs upgrade" rather than crashing.
 */
export function getCliVersion(binaryPath: string): string | null {
  try {
    const output = execFileSync(quoteForShell(binaryPath), ["-v"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
      // `wave` is `wave.cmd` on Windows; Node refuses to execFileSync a
      // `.cmd` without a shell.
      shell: process.platform === "win32",
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
 * Ensure the `wave` CLI exists and its version is >= targetVersion.
 * Returns the (possibly upgraded) binary path.
 *
 * 1. resolveWaveBinary() — auto-installs via npm if missing.
 * 2. getCliVersion(path) — read the installed CLI version via `wave -v`.
 * 3. If null (binary corrupt/unreadable) or older than target → upgrade to
 *    targetVersion (which resets the cache and re-resolves).
 */
export async function ensureCliUpToDate(
  targetVersion: string,
  onInstall?: InstallProgressCallback,
): Promise<string> {
  const binaryPath = resolveWaveBinary(onInstall, targetVersion);
  const current = getCliVersion(binaryPath);
  if (current !== null) {
    const cur = parseVersion(current);
    const target = parseVersion(targetVersion);
    if (cur && target && compareVersions(cur, target) >= 0) {
      return binaryPath;
    }
  }
  // current is null (corrupt) or older than target → upgrade.
  return upgradeWaveBinary(targetVersion, onInstall);
}

/** Reset cached binary path. Public so callers can force re-resolve after an upgrade. */
export function resetCache(): void {
  cachedPath = undefined;
}

/**
 * Upgrade the globally-installed `wave-code` CLI to a specific version.
 * Uses `execFile` (not a shell string) to avoid shell injection of the version arg.
 * Resets the cached path on success and returns the freshly-resolved binary path.
 */
export async function upgradeWaveBinary(
  targetVersion: string,
  onInstall?: InstallProgressCallback,
): Promise<string> {
  // Validate the version before it touches a shell. targetVersion originates
  // from the extension's package.json (trusted), but on Windows execFile runs
  // through cmd.exe (see shell option below); a strict semver check preserves
  // the "no shell injection of the version arg" guarantee this function held
  // when it used execFile without a shell.
  const spec = waveCodeSpec(targetVersion);

  onInstall?.(`正在升级 wave-code 到 v${targetVersion}，请稍候…`);
  const npm = findNpm();
  await new Promise<void>((resolve, reject) => {
    execFile(
      quoteForShell(npm),
      ["install", "-g", spec, `--registry=${NPM_REGISTRY}`],
      // `npm` is `npm.cmd` on Windows; Node refuses to execFile a `.cmd`
      // without a shell (ERR_CHILD_PROCESS_INVALID_COMMAND_FILE). The
      // validated version above contains no shell metacharacters.
      { encoding: "utf-8", shell: process.platform === "win32" },
      (err) => {
        if (err) reject(err);
        else resolve();
      },
    );
  });
  cachedPath = undefined; // invalidate cache so resolveWaveBinary picks up the new binary
  return resolveWaveBinary();
}

/** Reset cached path — for testing only. */
export function _resetCacheForTesting(): void {
  cachedPath = undefined;
}
