/**
 * WSL 发行版主机（spec: docs/specs/desktop/desktop-wsl.md）。
 *
 * 发行版是「同一台 Windows 机器里的那个 Linux 环境」，所以主机身份、POSIX 路径、
 * CLI 推送这套语义与 SSH 远端一致，但传输层完全不同：不需要 daemon、不需要
 * `ssh -N -L` 隧道，发行版内的 `127.0.0.1` 在 Windows 侧就是 `localhost`。
 * 桌面端因此用 `wsl.exe` 直接拉起发行版内的 CLI 子进程（与本地会话同构），
 * 代价是会话随应用退出结束 —— 「真后台」仍是 SSH 远端独有的能力。
 *
 * 主机标识：`wsl:<发行版名>`。`local` 是本地哨兵，SSH 主机名是裸名，前缀让三者
 * 互不碰撞（发行版名叫 `local` 也不会被误认成本地）。
 */

import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { LOCAL_HOST, shellQuote } from "./sshHosts";

/** `wsl.exe --list --verbose` 的硬超时：正常情况下几百毫秒内返回。 */
const WSL_PROBE_TIMEOUT_MS = 10_000;
/** 一次性读全发行版列表，缓冲上限给宽一点（UTF-8 下几十字节一行）。 */
const WSL_PROBE_MAX_BUFFER = 8 * 1024 * 1024;
const WSL_HOST_PREFIX = "wsl:";

export interface WslDistro {
  name: string;
  /** 发行版的 WSL 版本（1 或 2）。只有 2 可用：会话要在发行版里跑 Linux 版 Node。 */
  version: number;
  /** 是不是 `wsl --list` 标的默认发行版（仅作信息，不参与默认选中）。 */
  isDefault: boolean;
  running: boolean;
}

/** WSL 只存在于 Windows；其他平台上相关入口整体不出现（spec 场景 18）。 */
export function isWslSupportedPlatform(): boolean {
  return process.platform === "win32";
}

export function wslHostId(distro: string): string {
  return `${WSL_HOST_PREFIX}${distro}`;
}

/** `wsl:Ubuntu` → `Ubuntu`；不是 WSL 主机时返回 null。 */
export function parseWslHostId(host: string): string | null {
  if (!host.startsWith(WSL_HOST_PREFIX)) return null;
  const distro = host.slice(WSL_HOST_PREFIX.length);
  return distro ? distro : null;
}

export function isWslHost(host: string): boolean {
  return parseWslHostId(host) !== null;
}

/**
 * Host label shown in the picker trigger, the session tree group header and the
 * menu's selected state — one function for all three (spec 场景 17).
 */
export function hostDisplayLabel(host: string): string {
  const distro = parseWslHostId(host);
  if (distro) return `${distro} (WSL)`;
  return host === LOCAL_HOST ? "本地" : host;
}

/**
 * `wsl.exe` 的绝对路径。System32 那份在 PATH 上通常能找到，但 GUI 应用继承的
 * PATH 未必完整，所以优先用绝对路径；文件不存在时退回裸名（Store 版 WSL）。
 */
export function wslExePath(): string {
  const root =
    process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "C:\\Windows";
  const absolute = path.win32.join(root, "System32", "wsl.exe");
  return fs.existsSync(absolute) ? absolute : "wsl.exe";
}

/**
 * Decode `wsl.exe` output. Its output encoding is not reliable: UTF-16LE by
 * default (BOM `FF FE`, plus a NUL in every ASCII character's high byte), UTF-8
 * only when `WSL_UTF8=1` is honoured. Both cases must decode — a mis-decoded
 * list is an empty list, which looks exactly like "WSL is not installed".
 */
export function decodeWslOutput(buf: Buffer): string {
  const utf16 =
    (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) || buf.includes(0);
  return buf.toString(utf16 ? "utf16le" : "utf8").replace(/^\uFEFF/, "");
}

/**
 * Parse `wsl.exe --list --verbose`:
 *
 * ```
 *   NAME            STATE           VERSION
 * * Ubuntu-24.04    Running         2
 *   Debian          Stopped         2
 * ```
 *
 * The NAME column may contain spaces (`Ubuntu 24.04 LTS`), STATE is one word,
 * VERSION is digits — taking the last two whitespace-separated tokens and
 * treating the rest as the name survives the fixed-width padding. The header
 * line falls out on its own (its last token is `VERSION`, not digits).
 */
export function parseWslDistroList(text: string): WslDistro[] {
  const distros: WslDistro[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\0/g, "").trimEnd();
    if (!line.trim()) continue;
    const match = /^\s*(\*)?\s*(.*?)\s+(\S+)\s+(\d+)\s*$/.exec(line);
    if (!match) continue;
    const name = match[2].trim();
    const version = Number(match[4]);
    if (!name || !Number.isFinite(version)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    distros.push({
      name,
      version,
      isDefault: match[1] === "*",
      running: /^running$/i.test(match[3]),
    });
  }
  return distros;
}

function runWslRaw(args: string[]): Promise<{ code: number; stdout: Buffer }> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(wslExePath(), args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        // WSL_UTF8 makes wsl.exe emit UTF-8; decodeWslOutput still handles the
        // UTF-16 case for WSL builds that ignore the variable.
        env: { ...process.env, WSL_UTF8: "1" },
      });
    } catch (error) {
      reject(error);
      return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child?.kill();
      reject(new Error("wsl.exe 超时未返回"));
    }, WSL_PROBE_TIMEOUT_MS);
    child.stdout?.on("data", (data: Buffer) => {
      if (bytes < WSL_PROBE_MAX_BUFFER) chunks.push(data);
      bytes += data.length;
    });
    // stderr is drained but discarded: the caller's actionable message comes
    // from the parsed list, not from wsl.exe's localized error text.
    child.stderr?.on("data", () => {});
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout: Buffer.concat(chunks) });
    });
  });
}

/**
 * Enumerate this machine's distros. Any failure (WSL missing, service down,
 * old wsl.exe without `--verbose`) yields `[]` — the picker then shows no WSL
 * group at all, which is what a machine without WSL looks like (spec 场景 1).
 */
export async function listWslDistros(): Promise<WslDistro[]> {
  if (!isWslSupportedPlatform()) return [];
  try {
    const { code, stdout } = await runWslRaw(["--list", "--verbose"]);
    if (code !== 0) return [];
    return parseWslDistroList(decodeWslOutput(stdout));
  } catch {
    return [];
  }
}

/**
 * Preflight before a session: the list is the single source of truth for
 * "installed" and "is it WSL 2". Errors are actionable and never say "not
 * installed" for a distro that exists but is WSL 1 (spec 场景 5).
 */
export async function assertWslDistroReady(distro: string): Promise<WslDistro> {
  const distros = await listWslDistros();
  if (distros.length === 0) {
    throw new Error(
      "未检测到 WSL 发行版。若尚未安装 WSL，请以管理员身份运行 `wsl --install` 并重启系统；若已安装，请运行 `wsl --status` 查看 WSL 服务状态",
    );
  }
  const wanted = distro.toLowerCase();
  const target = distros.find((d) => d.name.toLowerCase() === wanted);
  if (!target) {
    throw new Error(
      `WSL 发行版「${distro}」不存在。运行 \`wsl --list\` 查看已安装的发行版`,
    );
  }
  if (target.version !== 2) {
    throw new Error(
      `WSL 发行版「${distro}」是 WSL 1。会话需要在发行版内运行 Linux 版 Node.js，请先运行 \`wsl --set-version ${distro} 2\` 转换后再试`,
    );
  }
  return target;
}

/** Per-distro login shell, probed once and reused (mirrors the ssh path). */
const wslShellCache = new Map<string, Promise<string>>();

/** Test-only: drop the per-distro login shell cache. */
export function resetWslShellCache(): void {
  wslShellCache.clear();
}

/**
 * The distro user's login shell. Probed with a plain `sh -c` (no shell
 * dependency yet), then every command runs under it with `-lic`: `-l` loads
 * .profile/.zprofile, `-i` loads .bashrc/.zshrc — the combination covers where
 * nvm-style version managers put node on PATH, exactly like the ssh path.
 */
export function getWslLoginShell(distro: string): Promise<string> {
  let cached = wslShellCache.get(distro);
  if (!cached) {
    cached = runWslRaw(["-d", distro, "-e", "sh", "-c", 'printf %s "$SHELL"'])
      .then(({ stdout }) => decodeWslOutput(stdout).trim() || "/bin/sh")
      .catch(() => "/bin/sh");
    wslShellCache.set(distro, cached);
  }
  return cached;
}

/** Wrap a command so it runs in the distro user's login shell. */
export async function withWslLoginShell(
  distro: string,
  command: string,
): Promise<string> {
  const shell = await getWslLoginShell(distro);
  return `${shell} -lic ${shellQuote(command)}`;
}

export interface WslExecSpec {
  file: string;
  args: string[];
}

/** `wsl.exe -d <distro> -e <login shell> -lic '<command>'`. */
export async function buildWslExecSpec(
  distro: string,
  command: string,
): Promise<WslExecSpec> {
  const shell = await getWslLoginShell(distro);
  return {
    file: wslExePath(),
    args: ["-d", distro, "-e", shell, "-lic", command],
  };
}

/**
 * Spawn spec for a command run by `sh` (no login shell): pure file transfers
 * need no PATH, and the login shell's interactive rc noise would only pollute
 * a stream's stderr summary.
 */
export function buildWslRawSpec(distro: string, command: string): WslExecSpec {
  return {
    file: wslExePath(),
    args: ["-d", distro, "-e", "sh", "-c", command],
  };
}

/**
 * Spawn spec for the session's CLI child.
 *
 * The CLI is exec'd by the distro's own node binary with **no interactive
 * login shell** in the chain: an INTERACTIVE login shell writes its rc/motd
 * output to **stdout**, and stdout is the JSON-RPC channel of `--stdio`. A
 * user's first login in a day therefore injects lines like "To run a command
 * as administrator…" into the protocol stream (verified on a real Ubuntu-24.04
 * distro).
 *
 * An absolute node path alone is not enough: `wsl.exe -e` starts the process
 * with the distro's **default** PATH, which contains no node (nvm/fnm only add
 * their directory from rc files) — and the CLI's children inherit exactly that
 * PATH. Every `node .wave/hooks/x.mjs`-shaped hook then dies with `/bin/sh:
 * node: not found`, and so does every bash-tool call spawn'ing node or pnpm.
 * The same one-shot login-shell probe that resolves node therefore also
 * captures `$PATH`, injected here by a non-interactive `sh` before exec: the
 * CLI's environment matches the user's own terminal (which is what the SSH
 * daemon already gets by being started from a login shell) while stdout stays
 * byte-clean.
 */
export async function buildWslCliSpawnSpec(
  distro: string,
  shimPath: string,
): Promise<WslExecSpec> {
  const { nodePath, loginPath } = await getWslNodeEnv(distro);
  // No login-shell PATH (an exotic rc that clobbers it) → at least the node
  // directory, which is what every hook/tool needs.
  const cliPath = loginPath || path.posix.dirname(nodePath);
  const inner =
    `PATH=${shellQuote(cliPath)}; export PATH; ` +
    `exec ${shellQuote(nodePath)} ${shellQuote(shimPath)} --stdio`;
  return {
    file: wslExePath(),
    args: ["-d", distro, "-e", "sh", "-c", inner],
  };
}

/** Marker line that carries the login shell's PATH in the node probe. */
const PATH_MARKER = "WAVE_WSL_PATH=";

/**
 * One-shot login-shell probe: node's absolute path, then the PATH it was found
 * on. The leading `printf` severs the answer from an rc file's last line when
 * it has no trailing newline; the marker line keeps the PATH from being
 * mistaken for the node path.
 */
const NODE_ENV_PROBE =
  `printf '\\n'; command -v node; ` + `printf '\\n${PATH_MARKER}%s\\n' "$PATH"`;

/** Where node lives in the distro, and the login shell's PATH. */
export interface WslNodeEnv {
  /** Absolute path of `node` — the CLI is exec'd by it directly. */
  nodePath: string;
  /**
   * The login shell's PATH. Injected into the CLI child so **its** children
   * (hooks, bash tool, MCP servers) resolve `node`, `pnpm`, … exactly like a
   * command run in the user's own terminal.
   */
  loginPath: string;
}

/**
 * Split the node probe's stdout into its two answers, tolerating whatever an
 * interactive rc file printed first (Ubuntu's "To run a command as
 * administrator…" banner, motd, version-manager chatter): the PATH is the last
 * marker line, the node path is the last absolute path printed before it.
 */
export function parseWslNodeEnv(stdout: string): WslNodeEnv {
  const lines = stdout.split(/\r?\n/);
  let loginPath = "";
  let markerIndex = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith(PATH_MARKER)) {
      loginPath = line.slice(PATH_MARKER.length).trim();
      markerIndex = i;
      break;
    }
  }
  const before = markerIndex >= 0 ? lines.slice(0, markerIndex) : lines;
  let nodePath = "";
  for (let i = before.length - 1; i >= 0; i--) {
    const line = before[i].trim();
    if (!line) continue;
    const match = /(?:^|\s)(\/\S*)$/.exec(line);
    if (match) {
      nodePath = match[1];
      break;
    }
  }
  return { nodePath, loginPath };
}

/** Per-distro node environment, probed once through the login shell. */
const wslNodeEnvCache = new Map<string, Promise<WslNodeEnv>>();

/** Test-only: drop the per-distro node environment cache. */
export function resetWslNodePathCache(): void {
  wslNodeEnvCache.clear();
}

/**
 * Resolve node's absolute path **and** the login shell's PATH in one probe, so
 * nvm/volta-style PATH additions are honoured — the same environment the
 * caller's `node -v` probe validated. Throws an actionable error when the
 * shell reports no node (the probe passed, so this is a broken PATH, not a
 * missing install).
 */
export function getWslNodeEnv(distro: string): Promise<WslNodeEnv> {
  const cached = wslNodeEnvCache.get(distro);
  if (cached) return cached;
  const probe = (async () => {
    const shell = await getWslLoginShell(distro);
    const { stdout } = await runWslRaw([
      "-d",
      distro,
      "-e",
      shell,
      "-lic",
      NODE_ENV_PROBE,
    ]);
    const nodeEnv = parseWslNodeEnv(decodeWslOutput(stdout));
    if (!nodeEnv.nodePath.startsWith("/")) {
      throw new Error(
        `WSL 发行版「${distro}」内未找到 node（登录 shell 的 PATH 里没有）。请在发行版内安装 Node.js ≥ 22 后重试`,
      );
    }
    return nodeEnv;
  })();
  wslNodeEnvCache.set(distro, probe);
  probe.catch(() => wslNodeEnvCache.delete(distro));
  return probe;
}

/** `node` as an absolute path inside the distro. */
export async function getWslNodePath(distro: string): Promise<string> {
  return (await getWslNodeEnv(distro)).nodePath;
}

/**
 * Windows-side view of a distro path (`\\wsl.localhost\<distro>\<path>`), used
 * for the few places that must hand a path to a Windows API instead of the
 * session's CLI (「在系统中打开」). Returns null for anything that is not an
 * absolute POSIX path — the share cannot express it, and a `..`/trailing-dot
 * segment would be silently rewritten by Windows.
 */
export function wslUncPath(distro: string, posixPath: string): string | null {
  if (!posixPath.startsWith("/")) return null;
  if (posixPath.includes("\0") || posixPath.includes("\\")) return null;
  const segments = posixPath.split("/").slice(1);
  if (segments.some((s) => s === "..")) return null;
  return `\\\\wsl.localhost\\${distro}${posixPath.replace(/\//g, "\\")}`;
}
