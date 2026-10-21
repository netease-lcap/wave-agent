/**
 * `@anthropic-ai/sandbox-runtime` 的动态加载与探测。
 *
 * ## 为什么是运行时解析而不是顶层 import
 *
 * 这个包是 ESM、带 12MB 的 vendor 二进制（其中 7.3MB 是 Windows 后端），
 * `engines` 还要求 Node >= 22.12。顶层 import 会把这笔体积与「可能加载失败」
 * 带进每个宿主的 bundle —— 见 `AGENTS.md` 的 host import 边界与
 * `scripts/check-sdk-surface.mjs`。所以模块名放在变量里：字面量会被打包器
 * 静态解析并尝试内联整个 vendor 目录。
 *
 * ## 为什么探测走 `isPackageOnDisk`
 *
 * 包不存在时 `import()` 会失败并被 Node 记住（见 `utils/packageOnDisk.ts` 里
 * 记录的 ripgrep 事故），而按需下载的包恰恰是「先不在、装完就在」。分开探测
 * 之后，`resetSandboxRuntime()` 能让同一个长驻进程（daemon / 远程 CLI）在装好
 * 之后重新解析。
 */
import { createRequire } from "node:module";
import { isPackageOnDisk } from "./packageOnDisk.js";
import { logger } from "./globalLogger.js";

/** sandbox-runtime 里我们用到的接口（按需加载，不静态依赖它的类型）。 */
export interface SandboxRuntimeModule {
  SandboxManager: {
    initialize(config: unknown, askCallback?: unknown): Promise<void>;
    wrapWithSandbox(
      command: string,
      binShell?: string,
      customConfig?: unknown,
      abortSignal?: AbortSignal,
      options?: { commandId?: string; commandText?: string },
    ): Promise<string>;
    annotateStderrWithSandboxFailures(
      commandId: string,
      stderr: string,
    ): string;
    updateConfig(config: unknown): void;
    cleanupAfterCommand(): void;
    isSupportedPlatform(): boolean;
  };
}

/** 包名（下载器与加载器共用一份字面量）。 */
export const SANDBOX_RUNTIME_PACKAGE = "@anthropic-ai/sandbox-runtime";

const SANDBOX_RUNTIME_SPECIFIER: string = SANDBOX_RUNTIME_PACKAGE;

let runtimePromise: Promise<SandboxRuntimeModule | null> | undefined;
let probed = false;
let cachedAvailable: boolean | undefined;

/** 包是否已经在 [requireFn] 能看到的 node_modules 里（不触发 import）。 */
export function isSandboxRuntimeOnDisk(requireFn: NodeRequire): boolean {
  return isPackageOnDisk(requireFn, SANDBOX_RUNTIME_PACKAGE);
}

/**
 * 本进程此刻能不能用上这个包——与 `getRgPath()` 同一套语义：解析一次并记住，
 * 装好之后由 {@link resetSandboxRuntime} 复位。探测分成两步是必须的：包不存在
 * 时 `import()` 的失败会被 Node 记住（见 `packageOnDisk.ts` 里记录的 ripgrep
 * 事故），所以这里只看磁盘，不碰加载。
 */
export function isSandboxRuntimeAvailable(): boolean {
  if (!probed) {
    probed = true;
    cachedAvailable = isSandboxRuntimeOnDisk(createRequire(import.meta.url));
  }
  return cachedAvailable === true;
}

/** 动态加载运行时；加载失败返回 `null` 并只警告一次。 */
export async function loadSandboxRuntime(): Promise<SandboxRuntimeModule | null> {
  if (!runtimePromise) {
    runtimePromise = import(SANDBOX_RUNTIME_SPECIFIER)
      .then((mod) => mod as unknown as SandboxRuntimeModule)
      .catch((error: unknown) => {
        logger.warn(
          `[sandbox] sandbox-runtime is not available: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return null;
      });
  }
  return runtimePromise;
}

/**
 * 忘掉已加载/已失败的运行时与已记住的可用性，下次重新解析。
 * 运行时依赖装好之后调用；测试也用它复位。
 */
export function resetSandboxRuntime(): void {
  runtimePromise = undefined;
  probed = false;
  cachedAvailable = undefined;
}
