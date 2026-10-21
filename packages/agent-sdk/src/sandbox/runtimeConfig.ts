/**
 * `sandbox` 配置段 → sandbox-runtime 运行配置的转换。
 *
 * 这一层只做纯计算（读配置、拼路径、算默认值），不加载 sandbox-runtime、
 * 不碰进程，便于单测。真正的执行层在 `SandboxManager.ts`。
 */
import fs from "node:fs";
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

/**
 * 归一到内核眼中的真实路径。
 *
 * macOS 上 `/var` 是 `/private/var` 的软链，而 Seatbelt 按真实路径匹配规则；
 * `sandbox-runtime` 只把「原样拼写」的 `denyWrite` 塞进 profile（读 deny 会补
 * 「原样 + realpath」两种拼写，写 deny 不会）。于是 `os.tmpdir()` 下的工作目录
 * （`/var/folders/...`）里用相对路径写 `.wave/settings.json`，那条 deny 会静默
 * 失效 —— 正好是「改配置 → 下一条命令逃出沙箱」这一条。统一在这里归一之后，
 * 四种清单都不再依赖「用户给的拼写恰好是规范路径」。
 *
 * 还不存在的路径（例如尚未生成的 `settings.json`）只归一它已存在的上层：软链
 * 只可能出现在目录上，最后一段原样拼回即可；通配符同理，只归一它的基目录。
 */
export function canonicalizePath(entry: string): string {
  const tail: string[] = [];
  let current = entry;
  for (;;) {
    try {
      const real = fs.realpathSync(current);
      return tail.length === 0 ? real : path.join(real, ...tail.reverse());
    } catch {
      const parent = path.dirname(current);
      // 一路到根都解析不了（路径本身不合法）：原样返回，别把配置改坏。
      if (parent === current) return entry;
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

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
  // 派生路径（可写根、受保护的 settings 文件）都从归一后的工作目录算，否则会拼出
  // 一半 `/var/...` 一半 `/private/var/...` 的清单，见 canonicalizePath。
  const base = canonicalizePath(workdir);
  const allowWrite = [
    base,
    getSandboxTempDir(),
    ...HOME_WRITE_DIRS.map((dir) => path.join(os.homedir(), dir)),
  ];
  for (const entry of additionalDirectories) {
    allowWrite.push(expandPath(entry, base));
  }
  for (const entry of config?.allowWrite ?? []) {
    allowWrite.push(expandPath(entry, base));
  }

  const denyWrite = [
    ...settingsFilesToProtect(base),
    ...(config?.denyWrite ?? []).map((entry) => expandPath(entry, base)),
  ];

  return {
    denyRead: (config?.denyRead ?? []).map((entry) =>
      canonicalizePath(expandPath(entry, base)),
    ),
    allowRead: (config?.allowRead ?? []).map((entry) =>
      canonicalizePath(expandPath(entry, base)),
    ),
    allowWrite: [...new Set(allowWrite.map(canonicalizePath))],
    denyWrite: [...new Set(denyWrite.map(canonicalizePath))],
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
