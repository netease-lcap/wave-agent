/**
 * 外部进程（spec `ecosystem/plugin-mods.md`「外部进程」）。
 *
 * mod 的沙箱里没有 `child_process`，要跑外部程序只能走 `$.process.spawn`。与
 * `$.clock` 同一条纪律：**进程归宿主所有** —— 会话销毁或插件重载时由宿主
 * 一起杀掉；mod 自己开的进程留到会话之后，就是打到死会话上的孤儿。
 *
 * 形状与 Claude Code 的 `$.process.spawn` 一致：返回异步生成器，逐块产出
 * `{ stream, text }`，迭代正常结束时 `return { code, signal }`。生成器而不是
 * 回调，是因为外部进程的输出天然是有序流；用回调会把「谁在读、读到哪」的
 * 状态留给 mod 自己维护。
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import type {
  ModProcessChunk,
  ModProcessExit,
  ModRunResult,
  ModSpawnOptions,
} from "../types/mods.js";
import { MOD_LIMITS } from "../types/mods.js";
import { logger } from "../utils/globalLogger.js";

/** 该 mod 名下还活着的进程，用于限额与统一回收。 */
interface LiveProcess {
  child: ChildProcess;
}

export class ModProcessManager {
  private readonly live = new Map<string, Set<LiveProcess>>();
  private disposed = false;

  /** `defaultCwd` 每次都现取：会话里 `cd` 过之后起的进程该落在新目录。 */
  constructor(private readonly defaultCwd: () => string) {}

  /**
   * 起一个外部进程并返回它的输出流。
   *
   * 返回的是一层**薄包装**：`next()` 原样转给内部生成器，`return()` 先杀进程
   * 再回 `done`。这就是 Claude Code 的 streaming pull/close 协议（v2.1.280
   * changelog：「streaming pull/close protocol underlying features like
   * process.spawn」），社区拿它做 Cancel 按钮（issues#106170）。
   *
   * 为什么不能只靠生成器自己的 `finally`：对一个正 `await` 的生成器调
   * `return()` 会被排队，要等下一块输出才轮到 —— 一条静默的长跑进程（`tail -f`
   * 那类）因此永远杀不掉。杀进程必须由这层包装同步发起。
   */
  spawn(
    modId: string,
    options: unknown,
  ): AsyncGenerator<ModProcessChunk, ModProcessExit> {
    let close: (() => void) | undefined;
    const inner = this.runProcess(modId, options, (fn) => {
      close = fn;
    });
    const stopped: ModProcessExit = { code: null, signal: null };
    const stream: AsyncGenerator<ModProcessChunk, ModProcessExit> = {
      next: (value) => inner.next(value),
      return: async () => {
        close?.();
        return { done: true, value: stopped };
      },
      throw: (error) => inner.throw(error),
      [Symbol.asyncIterator]: () => stream,
    };
    return stream;
  }

  /**
   * 跑完拿结果（spec「外部进程」）。
   *
   * 与 `spawn` 共用同一套限额与回收：`run` 结束之前占一个进程名额，会话销毁
   * 时同样被杀 —— 否则「一次调用最长 10 分钟」就是一条活过会话的后门。
   * 超时到点先把进程树收掉再报错，不留一个还在写文件的后台进程。
   *
   * 退出码非 0 **不报错**：`grep` 没匹配到就是 1，那不是异常。
   */
  run(modId: string, argv: unknown, options?: unknown): Promise<ModRunResult> {
    let parsed: ReturnType<typeof parseRunOptions>;
    try {
      parsed = parseRunOptions(argv, options, this.defaultCwd());
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.disposed) {
      return Promise.reject(new Error("会话已结束，不能再起外部进程"));
    }
    const set = this.processesFor(modId);
    if (set.size >= MOD_LIMITS.maxProcessesPerMod) {
      return Promise.reject(
        new Error(
          `外部进程上限 ${MOD_LIMITS.maxProcessesPerMod} 个（${modId}），先结束不用的进程`,
        ),
      );
    }

    return new Promise<ModRunResult>((resolve, reject) => {
      const [command, ...args] = parsed.argv;
      const child = spawn(command, args, {
        cwd: parsed.cwd,
        env: { ...process.env, ...parsed.env },
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
      const entry: LiveProcess = { child };
      set.add(entry);

      let stdout: Buffer[] = [];
      let stderr: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let isStdoutTruncated = false;
      let isStderrTruncated = false;
      let settled = false;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        set.delete(entry);
        fn();
      };

      const timer = setTimeout(() => {
        killTree(child);
        settle(() =>
          reject(
            new Error(
              `$.process.run 超过 ${parsed.timeoutMs} 毫秒，已结束该进程`,
            ),
          ),
        );
      }, parsed.timeoutMs);

      const take =
        (stream: "stdout" | "stderr") =>
        (chunk: Buffer): void => {
          const kept = stream === "stdout" ? stdoutBytes : stderrBytes;
          const room = MOD_LIMITS.runStreamBytes - kept;
          if (room <= 0) {
            // 超限之后照旧把管道读干净：不读，子进程会卡在写上，那个「跑完了
            // 拿结果」的调用就永远不结束。只是不再往结果里存。
            if (stream === "stdout") isStdoutTruncated = true;
            else isStderrTruncated = true;
            return;
          }
          const slice = chunk.length <= room ? chunk : chunk.subarray(0, room);
          if (chunk.length > room) {
            if (stream === "stdout") isStdoutTruncated = true;
            else isStderrTruncated = true;
          }
          if (stream === "stdout") {
            stdout.push(slice);
            stdoutBytes += slice.length;
          } else {
            stderr.push(slice);
            stderrBytes += slice.length;
          }
        };

      child.stdout?.on("data", take("stdout"));
      child.stderr?.on("data", take("stderr"));
      child.on("error", (error: Error) => settle(() => reject(error)));
      child.on("close", (code) => {
        settle(() =>
          resolve({
            exitCode: code,
            stdout: Buffer.concat(stdout).toString("utf8"),
            stderr: Buffer.concat(stderr).toString("utf8"),
            isStdoutTruncated,
            isStderrTruncated,
          }),
        );
      });

      if (parsed.stdin !== undefined) {
        child.stdin?.end(parsed.stdin);
      } else {
        child.stdin?.end();
      }
    });
  }

  /**
   * 进程本体：起进程、合并输出、收尾。
   *
   * 参数校验、限额与拒绝都在**第一次 `next()` 之前**完成（生成器函数体只在
   * 第一次拉取时执行），所以 mod 里的 `$.process.spawn(...)` 本身不会抛错，
   * 错误出现在 `for await` 上 —— 与 CC 的「调用返回流、失败在流上抛」一致。
   */
  private async *runProcess(
    modId: string,
    options: unknown,
    onStart: (close: () => void) => void,
  ): AsyncGenerator<ModProcessChunk, ModProcessExit> {
    const parsed = parseSpawnOptions(options, this.defaultCwd());
    if (this.disposed) {
      throw new Error("会话已结束，不能再起外部进程");
    }
    const set = this.processesFor(modId);
    if (set.size >= MOD_LIMITS.maxProcessesPerMod) {
      throw new Error(
        `外部进程上限 ${MOD_LIMITS.maxProcessesPerMod} 个（${modId}），先结束不用的进程`,
      );
    }

    const [command, ...args] = parsed.argv;
    const child = spawn(command, args, {
      cwd: parsed.cwd,
      env: { ...process.env, ...parsed.env },
      stdio: ["pipe", "pipe", "pipe"],
      // POSIX 上单独一个进程组，收尾时能连子孙一起杀（`kill(-pid)`）。
      detached: process.platform !== "win32",
    });
    const entry: LiveProcess = { child };
    set.add(entry);

    // 队列 + 唤醒：stdout/stderr 两个来源合并成一条有序流，消费者慢的时候
    // （`for await` 里干重活）输出先攒在队列里，由累计上限兜底。
    const queue: ModProcessChunk[] = [];
    let wake: (() => void) | undefined;
    let closed: ModProcessExit | undefined;
    let failure: Error | undefined;
    let totalBytes = 0;
    let killedByHost = false;

    const finish = (info: ModProcessExit) => {
      if (closed) return;
      closed = info;
      wake?.();
      wake = undefined;
    };

    const fail = (error: Error) => {
      if (failure) return;
      failure = error;
      wake?.();
      wake = undefined;
    };

    const push = (stream: "stdout" | "stderr", text: string) => {
      if (failure) return;
      totalBytes += Buffer.byteLength(text);
      if (totalBytes > MOD_LIMITS.processTotalBytes) {
        killedByHost = true;
        killTree(child);
        fail(
          new Error(
            `外部进程输出超过 ${MOD_LIMITS.processTotalBytes} 字节，已停止读取并结束该进程`,
          ),
        );
        return;
      }
      // 单块超过上限时切开：一块 64 KiB 是给消费者一个确定的处理粒度。
      for (let i = 0; i < text.length; i += MOD_LIMITS.processChunkChars) {
        queue.push({
          stream,
          text: text.slice(i, i + MOD_LIMITS.processChunkChars),
        });
      }
      wake?.();
      wake = undefined;
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => push("stdout", chunk));
    child.stderr?.on("data", (chunk: string) => push("stderr", chunk));
    child.on("error", (error: Error) => fail(error));
    child.on("close", (code, signal) => finish({ code, signal }));

    // 外部 `return()`（Cancel 按钮）走这条路：拿到 child 就能立刻发信号，不必
    // 等这个生成器被排队轮上。`killTree` 幂等，进程早已退出时什么也不做。
    onStart(() => {
      killedByHost = true;
      killTree(child);
    });

    if (parsed.input !== undefined) {
      // 一次性输入：写完就关，不支持长连 stdin（spec「外部进程」）。
      child.stdin?.end(parsed.input);
    } else {
      child.stdin?.end();
    }

    try {
      while (true) {
        if (failure) throw failure;
        const next = queue.shift();
        if (next) {
          yield next;
          continue;
        }
        if (closed) break;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
      return closed ?? { code: null, signal: null };
    } finally {
      // 消费者提前 `break`（流没结束）也要收尸：宿主收不到流的所有权，留着
      // 就是谁都管不到的孤儿进程。
      set.delete(entry);
      if (!closed) {
        killedByHost = true;
        killTree(child);
      }
      if (killedByHost && failure) {
        logger.warn(`[Wave] ${modId} 的外部进程已结束：${failure.message}`);
      }
    }
  }

  /** 会话销毁 / 插件重载：杀掉全部进程；给了 `modId` 就只杀那个 mod 的。 */
  killAll(modId?: string): void {
    if (modId === undefined) {
      for (const id of [...this.live.keys()]) this.killAll(id);
      return;
    }
    const set = this.live.get(modId);
    if (!set) return;
    for (const entry of [...set]) killTree(entry.child);
    this.live.delete(modId);
  }

  /** 进入终态：之后的 `spawn` 一律报错，已起的进程全部杀掉。 */
  dispose(): void {
    this.disposed = true;
    this.killAll();
  }

  private processesFor(modId: string): Set<LiveProcess> {
    let set = this.live.get(modId);
    if (!set) {
      set = new Set();
      this.live.set(modId, set);
    }
    return set;
  }
}

/** 结束一个进程**连同它的子进程树**。 */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } else {
      // `detached` 让它自成一个进程组，负 pid 就是整组。
      process.kill(-child.pid, "SIGTERM");
    }
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // 已经退出了：没有可收的尸。
    }
  }
}

/**
 * 校验 `$.process.spawn` 的参数。
 *
 * `argv` 必须是数组（不走 shell）—— 字符串形式会把「外部脚本传进来的一句话」
 * 变成一次 shell 解析，是插件作者最容易写错也最危险的一处。
 */
function parseSpawnOptions(
  options: unknown,
  defaultCwd: string,
): Required<Pick<ModSpawnOptions, "argv" | "cwd">> &
  Pick<ModSpawnOptions, "env" | "input"> {
  if (!options || typeof options !== "object") {
    throw new Error("$.process.spawn 需要一个 { argv } 参数");
  }
  const raw = options as Record<string, unknown>;
  if (!Array.isArray(raw.argv) || raw.argv.length === 0) {
    throw new Error("$.process.spawn 的 argv 必须是非空数组（不走 shell）");
  }
  const argv = raw.argv.map((item) => {
    if (typeof item !== "string") {
      throw new Error("$.process.spawn 的 argv 只能包含字符串");
    }
    return item;
  });
  const cwd = typeof raw.cwd === "string" && raw.cwd ? raw.cwd : defaultCwd;
  const env: Record<string, string> = {};
  if (raw.env !== undefined) {
    if (!raw.env || typeof raw.env !== "object" || Array.isArray(raw.env)) {
      throw new Error("$.process.spawn 的 env 必须是对象");
    }
    for (const [key, value] of Object.entries(raw.env)) {
      if (typeof value === "string") env[key] = value;
    }
  }
  if (raw.input !== undefined && typeof raw.input !== "string") {
    throw new Error("$.process.spawn 的 input 必须是字符串");
  }
  return {
    argv,
    cwd,
    ...(raw.env === undefined ? {} : { env }),
    ...(raw.input === undefined ? {} : { input: raw.input as string }),
  };
}

/**
 * 校验 `$.process.run` 的参数。
 *
 * 与 `spawn` 的差别是形状本身：`argv` 走位置参数、一次性输入叫 `stdin`
 * （Claude Code 的 `$.process.run` 就是这么写的，照抄）。
 */
function parseRunOptions(
  argv: unknown,
  options: unknown,
  defaultCwd: string,
): {
  argv: string[];
  cwd: string;
  env?: Record<string, string>;
  stdin?: string;
  timeoutMs: number;
} {
  if (!Array.isArray(argv) || argv.length === 0) {
    throw new Error("$.process.run 的第一个参数必须是非空数组（不走 shell）");
  }
  const list = argv.map((item) => {
    if (typeof item !== "string") {
      throw new Error("$.process.run 的 argv 只能包含字符串");
    }
    return item;
  });
  if (options !== undefined && (typeof options !== "object" || !options)) {
    throw new Error("$.process.run 的第二个参数必须是对象");
  }
  const raw = (options ?? {}) as Record<string, unknown>;

  const cwd = typeof raw.cwd === "string" && raw.cwd ? raw.cwd : defaultCwd;
  const env: Record<string, string> = {};
  if (raw.env !== undefined) {
    if (!raw.env || typeof raw.env !== "object" || Array.isArray(raw.env)) {
      throw new Error("$.process.run 的 env 必须是对象");
    }
    for (const [key, value] of Object.entries(raw.env)) {
      if (typeof value === "string") env[key] = value;
    }
  }
  if (raw.stdin !== undefined && typeof raw.stdin !== "string") {
    throw new Error("$.process.run 的 stdin 必须是字符串");
  }

  const asked =
    raw.timeoutMs === undefined
      ? MOD_LIMITS.runTimeoutMs
      : Number(raw.timeoutMs);
  if (!Number.isFinite(asked) || asked <= 0) {
    throw new Error("$.process.run 的 timeoutMs 必须是正数");
  }
  const timeoutMs = Math.min(Math.floor(asked), MOD_LIMITS.maxRunTimeoutMs);

  return {
    argv: list,
    cwd,
    ...(raw.env === undefined ? {} : { env }),
    ...(raw.stdin === undefined ? {} : { stdin: raw.stdin as string }),
    timeoutMs,
  };
}
