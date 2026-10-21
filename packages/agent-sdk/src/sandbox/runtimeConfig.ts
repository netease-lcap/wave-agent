/**
 * `sandbox` 配置段 → sandbox-runtime 运行配置的转换。
 *
 * 这一层只做纯计算（读配置、拼路径、算默认值），不加载 sandbox-runtime、
 * 不碰进程，便于单测。真正的执行层在 `SandboxManager.ts`。
 */
import os from "node:os";
import path from "node:path";
import type {
  SandboxConfiguration,
  SandboxFilesystemConfiguration,
  SandboxNetworkConfiguration,
} from "../types/configuration.js";

/** sandbox-runtime 的 `SandboxRuntimeConfig` 形状（只列我们用到的字段）。 */
export interface SandboxRuntimeConfig {
  network: {
    allowedDomains: string[];
    deniedDomains: string[];
    allowUnixSockets?: string[];
    allowAllUnixSockets?: boolean;
    allowLocalBinding?: boolean;
  };
  filesystem: {
    denyRead: string[];
    allowRead: string[];
    allowWrite: string[];
    denyWrite: string[];
  };
  ignoreViolations?: Record<string, string[]>;
  ripgrep?: { command: string; args?: string[] };
}

/**
 * 沙箱内命令的临时目录。
 *
 * 独立于 `os.tmpdir()` 的根：沙箱把 `/tmp` 根当成可写等于把系统上所有进程的临时
 * 文件都交出去。这个目录必须同时是：可写路径之一、子进程的 `TMPDIR`、以及
 * Bash 记录新工作目录的临时文件落点。
 */
export function getSandboxTempDir(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : "user";
  return path.join(os.tmpdir(), `wave-sandbox-${uid}`);
}

/**
 * 默认可写目录（`~` 下）。包管理器与各类 CLI 的缓存，缺了它们沙箱一开
 * `npm install` / `pnpm` 等就全线失败；范围到此为止，不扩大到整个 home。
 */
const HOME_WRITE_DIRS = [
  ".npm",
  ".cache",
  ".local/share/pnpm",
  "Library/Caches",
  "Library/pnpm",
];

/** `~` 展开；相对路径按 `base` 解析；绝对路径原样。 */
function expandPath(entry: string, base: string): string {
  if (entry === "~") return os.homedir();
  if (entry.startsWith("~/")) return path.join(os.homedir(), entry.slice(2));
  if (path.isAbsolute(entry)) return entry;
  return path.resolve(base, entry);
}

/**
 * 沙箱配置文件的写入拒绝清单。
 *
 * 这四条不是「顺手加的」：`settings.json` 里的 `sandbox.*` 决定了下一条命令的
 * 边界，可写等于「改配置 → 下一条命令逃出去」，所以必须在沙箱层拒绝，而不是
 * 只在权限层判断。
 */
function settingsFilesToProtect(workdir: string): string[] {
  const home = os.homedir();
  const paths = [
    path.join(workdir, ".wave", "settings.json"),
    path.join(workdir, ".wave", "settings.local.json"),
    path.join(home, ".wave", "settings.json"),
    path.join(home, ".wave", "settings.local.json"),
  ];
  return paths;
}

function filesystemConfig(
  workdir: string,
  config: SandboxFilesystemConfiguration | undefined,
  additionalDirectories: string[],
): SandboxRuntimeConfig["filesystem"] {
  const home = os.homedir();
  const allowWrite = [
    workdir,
    getSandboxTempDir(),
    ...HOME_WRITE_DIRS.map((dir) => path.join(home, dir)),
  ];
  for (const entry of additionalDirectories) {
    allowWrite.push(expandPath(entry, workdir));
  }
  for (const entry of config?.allowWrite ?? []) {
    allowWrite.push(expandPath(entry, workdir));
  }

  const denyWrite = [
    ...settingsFilesToProtect(workdir),
    ...(config?.denyWrite ?? []).map((entry) => expandPath(entry, workdir)),
  ];

  return {
    denyRead: (config?.denyRead ?? []).map((entry) =>
      expandPath(entry, workdir),
    ),
    allowRead: (config?.allowRead ?? []).map((entry) =>
      expandPath(entry, workdir),
    ),
    allowWrite: [...new Set(allowWrite)],
    denyWrite: [...new Set(denyWrite)],
  };
}

function networkConfig(
  config: SandboxNetworkConfiguration | undefined,
): SandboxRuntimeConfig["network"] {
  return {
    allowedDomains: config?.allowedDomains ?? [],
    deniedDomains: config?.deniedDomains ?? [],
    allowUnixSockets: config?.allowUnixSockets,
    allowAllUnixSockets: config?.allowAllUnixSockets,
    allowLocalBinding: config?.allowLocalBinding,
  };
}

/**
 * 组装运行配置。
 *
 * `rgPath` 只在 Linux 上是必需的：bubblewrap 不能按 glob 过滤，read-deny 的
 * 通配要给 ripgrep 展开成具体路径。macOS 的 Seatbelt 直接吃正则，用不到。
 */
export function buildSandboxRuntimeConfig(options: {
  workdir: string;
  sandbox: SandboxConfiguration;
  additionalDirectories?: string[];
  rgPath?: string;
}): SandboxRuntimeConfig {
  const { workdir, sandbox, additionalDirectories = [], rgPath } = options;
  const config: SandboxRuntimeConfig = {
    network: networkConfig(sandbox.network),
    filesystem: filesystemConfig(
      workdir,
      sandbox.filesystem,
      additionalDirectories,
    ),
  };
  if (sandbox.ignoreViolations) {
    config.ignoreViolations = sandbox.ignoreViolations;
  }
  if (rgPath) {
    config.ripgrep = { command: rgPath };
  }
  return config;
}
