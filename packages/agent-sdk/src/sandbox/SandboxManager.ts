/**
 * OS 级 Bash 沙箱的执行层。
 *
 * 本类只做「判定 + 包装 + 收尾」三件事，真正的隔离由
 * `@anthropic-ai/sandbox-runtime` 提供（macOS `sandbox-exec`、Linux
 * `bubblewrap` + 代理）。运行时包**按需动态加载**：它是 ESM、带 12MB 的
 * vendor 二进制，并在加载时解析平台相关依赖——顶层 import 会把这段代价和
 * 失败风险带进每个宿主的 bundle（见 `AGENTS.md` 的 host import 边界）。
 *
 * 平台支持与 Claude Code 保持一致：macOS、Linux（含 WSL2）支持，Windows
 * 恒为不支持——不包装命令，命令照常走既有权限流程。
 */
import fs from "node:fs";
import path from "node:path";
import { logger } from "../utils/globalLogger.js";
import type {
  SandboxConfiguration,
  WaveConfiguration,
} from "../types/configuration.js";
import {
  buildSandboxRuntimeConfig,
  getSandboxTempDir,
} from "./runtimeConfig.js";
import {
  loadSandboxRuntime,
  resetSandboxRuntime,
} from "../utils/sandboxRuntime.js";
import type { SandboxRuntimeModule } from "../utils/sandboxRuntime.js";
import { ensureRuntimeDeps } from "../utils/runtimeDeps.js";
import { splitBashCommand, stripEnvVars } from "../utils/bashParser.js";

export interface SandboxDecision {
  /** 这条命令是否应该进沙箱。 */
  sandboxed: boolean;
  /** 不沙箱的原因（用于日志与「为什么没生效」的提示）。 */
  reason?: string;
}

export interface SandboxManagerDeps {
  /** 当前生效的合并配置（热重载后应返回新值）。 */
  getConfiguration: () => WaveConfiguration | null;
  workdir: string;
  /** ripgrep 可执行文件路径（Linux 展开 read-deny 通配用）。 */
  getRgPath?: () => string | undefined;
  /** 测试注入：替换动态加载。 */
  loadRuntime?: () => Promise<SandboxRuntimeModule | null>;
  /** 测试注入：覆盖平台判定。 */
  platform?: NodeJS.Platform;
}

/** WSL1 不支持 bubblewrap；WSL2 按 Linux 处理。 */
function isWsl1(): boolean {
  if (process.platform !== "linux") return false;
  try {
    const version = fs.readFileSync("/proc/version", "utf8");
    if (/WSL(\d+)/i.test(version)) {
      return /WSL1\b/i.test(version);
    }
    return /microsoft/i.test(version);
  } catch {
    return false;
  }
}

/** PATH 上找可执行的工具（不 spawn，热路径上不付进程开销）。 */
function findExecutable(
  name: string,
  envPath = process.env.PATH ?? "",
): string | null {
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // 继续找下一个目录
    }
  }
  return null;
}

/**
 * 把 `excludedCommands` 的一条模式与命令匹配。
 *
 * 支持三种写法（与权限规则同一套直觉）：`npm run test`（精确）、
 * `npm run test:*`（前缀）、`npm *`（通配）。匹配前会按 `&&`/`||`/`;` 拆子命令，
 * 并剥掉环境变量前缀——否则 `docker ps && curl evil.com` 只要第一个子命令命中
 * 排除清单就能把整条命令带出沙箱。
 */
export function commandMatchesExcludedPattern(
  command: string,
  pattern: string,
): boolean {
  const subcommands = (() => {
    try {
      return splitBashCommand(command);
    } catch {
      return [command];
    }
  })();

  const trimmedPattern = pattern.trim();
  if (!trimmedPattern) return false;

  const matches = (candidate: string): boolean => {
    if (trimmedPattern.endsWith(":*")) {
      const prefix = trimmedPattern.slice(0, -2);
      return candidate === prefix || candidate.startsWith(`${prefix} `);
    }
    if (trimmedPattern.includes("*")) {
      const regex = new RegExp(
        `^${trimmedPattern
          .split("*")
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join(".*")}$`,
      );
      return regex.test(candidate);
    }
    return candidate === trimmedPattern;
  };

  return subcommands.some((subcommand) => {
    const stripped = stripEnvVars(subcommand.trim()).trim();
    return matches(subcommand.trim()) || matches(stripped);
  });
}

/**
 * 已经装进运行时的配置指纹（键是运行时模块本身）。
 *
 * `sandbox-runtime` 的 `initialize()` 是**进程级且幂等**的（第二次直接 return），
 * 所以同一进程里第二个 `SandboxManager`（另一个会话 / Agent，各自的工作目录不
 * 同）的边界原本不会生效 —— 后起会话静默沿用先起会话的配置。运行时的
 * `updateConfig()` 才是换边界的那条通路（Claude Code 的 sandbox-adapter 也只用
 * 它，不重启代理与 CA），这里按指纹决定要不要推一次。
 *
 * 键用运行时模块对象：`resetSandboxRuntime()` 之后重新 `import()` 拿到的是同一个
 * 模块实例（Node 的模块缓存），指纹跟着它；测试注入的 fake 模块则各自独立。
 */
const installedConfigFingerprints = new WeakMap<SandboxRuntimeModule, string>();

export class SandboxManager {
  private readonly deps: SandboxManagerDeps;
  private initialized = false;
  private initializing: Promise<boolean> | null = null;
  private runtime: SandboxRuntimeModule | null = null;
  private readonly warned = new Set<string>();
  private depsCache: { ok: boolean; missing: string[] } | null = null;

  constructor(deps: SandboxManagerDeps) {
    this.deps = deps;
  }

  private get platform(): NodeJS.Platform {
    return this.deps.platform ?? process.platform;
  }

  private getSettings(): SandboxConfiguration | undefined {
    return this.deps.getConfiguration()?.sandbox;
  }

  /** 总开关（未配置 = 关）。 */
  isEnabled(): boolean {
    return this.getSettings()?.enabled === true;
  }

  isSupportedPlatform(): boolean {
    if (this.platform === "darwin") return true;
    if (this.platform === "linux") return !isWsl1();
    return false;
  }

  /** 运行时依赖探测（Linux 需要 bwrap + socat + rg；macOS 自带 sandbox-exec）。 */
  private checkDependencies(): { ok: boolean; missing: string[] } {
    if (this.depsCache) return this.depsCache;
    const missing: string[] = [];
    if (this.platform === "linux") {
      if (!findExecutable("bwrap")) missing.push("bubblewrap (bwrap)");
      if (!findExecutable("socat")) missing.push("socat");
      if (!this.deps.getRgPath?.() && !findExecutable("rg"))
        missing.push("ripgrep (rg)");
    }
    this.depsCache = { ok: missing.length === 0, missing };
    return this.depsCache;
  }

  /**
   * 沙箱此刻能不能真的跑：开关 + 平台 + 依赖。
   *
   * 权限层的自动放行必须用这个判定——「以为进了沙箱所以不用问」是安全判断，
   * 只按开关算会让依赖缺失时的命令变成「无边界且无人确认」。
   */
  isAvailable(): boolean {
    return (
      this.isEnabled() &&
      this.isSupportedPlatform() &&
      this.checkDependencies().ok
    );
  }

  /** 配了开关却没生效的可读原因（启动或首次使用时提示一次）。 */
  getUnavailableReason(): string | undefined {
    if (!this.isEnabled()) return undefined;
    if (!this.isSupportedPlatform()) {
      if (this.platform === "win32") {
        return "sandbox is not supported on Windows; commands run without it";
      }
      if (this.platform === "linux") {
        return "sandbox is not supported on WSL1 (requires WSL2)";
      }
      return `sandbox is not supported on ${this.platform}`;
    }
    const { ok, missing } = this.checkDependencies();
    if (!ok) {
      return `sandbox is enabled but dependencies are missing: ${missing.join(
        ", ",
      )} (apt install bubblewrap socat / npm i @vscode/ripgrep)`;
    }
    return undefined;
  }

  /** `failIfUnavailable` 是否生效（配了开关但跑不了时必须让命令失败）。 */
  shouldFailCommand(): boolean {
    return this.isEnabled() && this.getSettings()?.failIfUnavailable === true;
  }

  private warnOnce(key: string, message: string): void {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    logger.warn(`[sandbox] ${message}`);
  }

  private async loadRuntime(): Promise<SandboxRuntimeModule | null> {
    if (this.runtime) return this.runtime;
    this.runtime = this.deps.loadRuntime
      ? await this.deps.loadRuntime()
      : await loadSandboxRuntime();
    return this.runtime;
  }

  /**
   * 加载运行时，缺包时先按需下载一次再重试。
   *
   * `@anthropic-ai/sandbox-runtime` 不进宿主 bundle（12MB vendor），宿主副本
   * 的 CLI 也没有 node_modules，所以「装了没装」是运行期的事实。这里把它当
   * 第三个运行时依赖交给 `ensureRuntimeDeps`：只在真的启用沙箱、真的要跑第一条
   * 沙箱命令时付这一次下载；装好之后 `resetSandboxRuntime()` 让同一个进程
   * （daemon / 远程 CLI）重新解析。
   */
  private async loadRuntimeWithInstall(): Promise<SandboxRuntimeModule | null> {
    const loaded = await this.loadRuntime();
    if (loaded) return loaded;
    const installed = await ensureRuntimeDeps({ includeSandbox: true });
    if (!installed.available) {
      this.warnOnce(
        "runtime-missing",
        `sandbox-runtime is not installed and could not be downloaded${
          installed.reason ? `: ${installed.reason}` : ""
        }; commands run without the sandbox`,
      );
      return null;
    }
    resetSandboxRuntime();
    this.runtime = null;
    return this.loadRuntime();
  }

  private buildConfig() {
    const config = this.deps.getConfiguration();
    const settings = config?.sandbox;
    if (!settings) return null;
    return buildSandboxRuntimeConfig({
      workdir: this.deps.workdir,
      sandbox: settings,
      additionalDirectories: config?.permissions?.additionalDirectories ?? [],
      rgPath: this.deps.getRgPath?.(),
    });
  }

  /**
   * 把「这一份」配置推到运行时上。
   *
   * `initialize()` 是进程级的（第一次真正建代理 / CA，之后是空操作），
   * `updateConfig()` 才是同进程里换边界的手段。所以初始化时两步都做：先
   * `initialize`（进程里的第一次才有效），再 `updateConfig` 把配置钉成我们这份
   * —— 不能靠「`initialize` 刚才是空操作还是真跑了」来判断，那取决于谁先来。
   */
  private async installConfig(runtime: SandboxRuntimeModule): Promise<boolean> {
    const config = this.buildConfig();
    if (!config) return false;
    await runtime.SandboxManager.initialize(config);
    runtime.SandboxManager.updateConfig(config);
    installedConfigFingerprints.set(runtime, JSON.stringify(config));
    return true;
  }

  /**
   * 每条沙箱命令前对一次指纹：同进程里可能有多个 Agent（各自工作目录不同），
   * 边界必须跟着**当前**这条命令的调用方走。只按「本实例初始化过」判断会让后
   * 跑的命令用上别人的边界。
   */
  private syncRuntimeConfig(runtime: SandboxRuntimeModule): void {
    const config = this.buildConfig();
    if (!config) return;
    const fingerprint = JSON.stringify(config);
    if (installedConfigFingerprints.get(runtime) === fingerprint) return;
    try {
      runtime.SandboxManager.updateConfig(config);
      installedConfigFingerprints.set(runtime, fingerprint);
    } catch (error) {
      logger.warn(
        `[sandbox] failed to update the runtime configuration: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * 初始化运行时（幂等）。失败不抛：沙箱类能力按「降级 + 一次警告」处理，
   * 与 `failIfUnavailable` 的硬失败区分开。
   */
  async ensureInitialized(): Promise<boolean> {
    if (this.initialized) return true;
    if (this.initializing) return this.initializing;

    this.initializing = (async () => {
      const runtime = await this.loadRuntimeWithInstall();
      if (!runtime) return false;
      try {
        this.initialized = await this.installConfig(runtime);
        return this.initialized;
      } catch (error) {
        this.warnOnce(
          "init-failed",
          `sandbox failed to initialize, commands run without it: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return false;
      } finally {
        this.initializing = null;
      }
    })();

    return this.initializing;
  }

  /**
   * 判定一条命令是否进沙箱，并在需要时把运行时准备好。
   *
   * 这个判定同时被两处使用：Bash 工具决定怎么 spawn，权限管理器决定能不能
   * 免确认——两处必须拿到同一个答案。
   */
  async decide(
    command: string,
    dangerouslyDisableSandbox?: boolean,
  ): Promise<SandboxDecision> {
    const settings = this.getSettings();
    if (!settings?.enabled) return { sandboxed: false, reason: "disabled" };

    const reason = this.getUnavailableReason();
    if (reason) {
      this.warnOnce("unavailable", reason);
      return { sandboxed: false, reason };
    }

    if (
      dangerouslyDisableSandbox &&
      (settings.allowUnsandboxedCommands ?? true)
    ) {
      return { sandboxed: false, reason: "requested-by-model" };
    }

    for (const pattern of settings.excludedCommands ?? []) {
      if (commandMatchesExcludedPattern(command, pattern)) {
        return { sandboxed: false, reason: `excluded:${pattern}` };
      }
    }

    const ready = await this.ensureInitialized();
    if (!ready) return { sandboxed: false, reason: "initialization-failed" };
    return { sandboxed: true };
  }

  /**
   * 把命令包装成沙箱内的调用。返回 `null` 表示包装失败（调用方按
   * `failIfUnavailable` 决定失败还是降级）。
   */
  async wrap(
    command: string,
    shellPath?: string,
    commandId?: string,
  ): Promise<string | null> {
    // 必须先 initialize：`wrapWithSandbox` 用的是运行时里那份已注册的配置，没
    // 初始化就包装，命令会按运行时的默认配置跑 —— 边界看起来存在，实际不是我们
    // 算出来的那套。生产路径上 `decide()` 总先跑一遍，这里兜住直接调用的场景。
    if (!(await this.ensureInitialized())) return null;
    const runtime = this.runtime;
    if (!runtime) return null;
    // 同进程里另一个 Agent 可能刚刚换过边界（运行时配置是进程级的），这条命令
    // 必须按**本会话**的配置跑。
    this.syncRuntimeConfig(runtime);
    try {
      return await runtime.SandboxManager.wrapWithSandbox(
        command,
        shellPath,
        undefined,
        undefined,
        commandId ? { commandId } : undefined,
      );
    } catch (error) {
      this.warnOnce(
        "wrap-failed",
        `failed to wrap a command with the sandbox: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /** 把这次调用里被拦的操作拼到输出尾部，让模型知道是沙箱而不是命令写错了。 */
  annotate(commandId: string, output: string): string {
    const runtime = this.runtime;
    if (!runtime) return output;
    try {
      return runtime.SandboxManager.annotateStderrWithSandboxFailures(
        commandId,
        output,
      );
    } catch {
      return output;
    }
  }

  /** 每条沙箱命令跑完后的收尾（Linux 的 bwrap 会在宿主留下零字节占位文件）。 */
  cleanup(): void {
    try {
      this.runtime?.SandboxManager.cleanupAfterCommand();
    } catch (error) {
      logger.debug(
        `[sandbox] cleanup failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** 配置热重载：把新的白名单/可写路径推给运行时。 */
  refresh(): void {
    if (!this.initialized || !this.runtime) return;
    const config = this.buildConfig();
    if (!config) return;
    try {
      this.runtime.SandboxManager.updateConfig(config);
      installedConfigFingerprints.set(this.runtime, JSON.stringify(config));
    } catch (error) {
      logger.warn(
        `[sandbox] failed to update configuration: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** 沙箱内命令的临时目录（同时进可写清单与子进程的 TMPDIR）。 */
  getTempDir(): string {
    return getSandboxTempDir();
  }

  /** 确保临时目录存在且仅本用户可读写。 */
  prepareTempDir(): string {
    const dir = this.getTempDir();
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch (error) {
      logger.debug(
        `[sandbox] failed to create temp dir ${dir}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    return dir;
  }
}
