/**
 * StdioClient — low-level JSON-RPC transport over a child process.
 *
 * Spawns `wave --stdio`, writes requests to stdin, reads responses and
 * notifications from stdout (one JSON object per line).
 */

import { type ChildProcess, spawn } from "child_process";
import { createInterface } from "readline";

export type NotificationHandler = (params: unknown, sessionId?: string) => void;
export type StderrHandler = (data: string) => void;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/** Keep a bounded tail of stderr (bytes) for inclusion in the exit error. */
const STDERR_TAIL_LIMIT = 4096;

/**
 * Decode stderr bytes: UTF-8 when valid, otherwise GBK (Windows console
 * code page 936). cmd.exe and native Windows tools emit GBK on Chinese
 * systems; decoding those bytes as UTF-8 yields U+FFFD garbage and the real
 * error message is lost.
 */
function decodeStderr(buf: Buffer): string {
  const utf8 = buf.toString("utf-8");
  if (!utf8.includes("\uFFFD")) return utf8;
  try {
    return new TextDecoder("gbk").decode(buf);
  } catch {
    return utf8;
  }
}

export class StdioClient {
  private proc: ChildProcess;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private handlers = new Map<string, Set<NotificationHandler>>();
  private disposed = false;
  /** Raw stderr bytes, bounded to the last STDERR_TAIL_LIMIT bytes. */
  private stderrChunks: Buffer[] = [];
  private stderrBytes = 0;
  private onStderr?: StderrHandler;

  constructor(
    binaryPath: string,
    args: string[] = [],
    env?: Record<string, string>,
    onStderr?: StderrHandler,
  ) {
    this.onStderr = onStderr;
    // The bundled CLI is a `.mjs` script executed by the extension-host Node
    // runtime (process.execPath). A script is spawned directly with an args
    // array and no shell — cleaner than the old `wave.cmd` shim path.
    // WAVE_CLI_PATH overrides may point at other executables (e.g. a
    // `wave.cmd` shim), which keep the legacy shell behaviour: Node (since
    // the CVE-2024-27980 patch) refuses to spawn `.cmd`/`.bat` without a
    // shell, and with `shell: true` the executable must be pre-quoted so a
    // path containing spaces is not split.
    const isScript = /\.(mjs|js|cjs)$/i.test(binaryPath);
    const command = isScript ? process.execPath : binaryPath;
    const spawnArgs = isScript ? [binaryPath, ...args] : args;
    const shell = !isScript && process.platform === "win32";
    const spawnCommand =
      shell && process.platform === "win32" ? `"${command}"` : command;
    this.proc = spawn(spawnCommand, spawnArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
      shell,
    });

    const rl = createInterface({ input: this.proc.stdout! });
    rl.on("line", (line) => this.handleLine(line));

    this.proc.stderr!.on("data", (data: Buffer) => {
      // Keep raw bytes (not per-chunk strings) so the exit error can be
      // decoded exactly, without splitting a multi-byte character across
      // chunk boundaries.
      this.stderrChunks.push(data);
      this.stderrBytes += data.length;
      while (
        this.stderrChunks.length > 1 &&
        this.stderrBytes - this.stderrChunks[0].length >= STDERR_TAIL_LIMIT
      ) {
        this.stderrBytes -= this.stderrChunks[0].length;
        this.stderrChunks.shift();
      }
      const trimmed = decodeStderr(data).trimEnd();
      if (trimmed) this.onStderr?.(trimmed);
    });

    this.proc.on("exit", (code, signal) => {
      const stderr = decodeStderr(Buffer.concat(this.stderrChunks)).trim();
      const parts = [
        `wave --stdio process exited (code: ${code}, signal: ${signal})`,
      ];
      if (stderr) parts.push(`stderr:\n${stderr}`);
      const error = new Error(parts.join("\n"));
      for (const p of this.pending.values()) {
        p.reject(error);
      }
      this.pending.clear();
      this.disposed = true;
    });

    this.proc.on("error", (err) => {
      console.error("[wave-stdio] Process error:", err);
    });
  }

  // ── Public API ────────────────────────────────────────────────

  async request(
    method: string,
    params?: unknown,
    sessionId?: string,
  ): Promise<unknown> {
    if (this.disposed) {
      throw new Error(
        "连接已断开。wave 进程已退出，请重启编辑器或检查 CLI 安装。",
      );
    }
    const id = this.nextId++;
    const envelope: Record<string, unknown> = { id, method, params };
    if (sessionId) envelope.sessionId = sessionId;
    const message = JSON.stringify(envelope) + "\n";

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin!.write(message);
    });
  }

  notify(method: string, params?: unknown, sessionId?: string): void {
    if (this.disposed) return;
    const envelope: Record<string, unknown> = { method, params };
    if (sessionId) envelope.sessionId = sessionId;
    const message = JSON.stringify(envelope) + "\n";
    this.proc.stdin!.write(message);
  }

  onNotification(method: string, handler: NotificationHandler): void {
    let set = this.handlers.get(method);
    if (!set) {
      set = new Set();
      this.handlers.set(method, set);
    }
    set.add(handler);
  }

  offNotification(method: string, handler: NotificationHandler): void {
    this.handlers.get(method)?.delete(handler);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.proc.kill();
  }

  // ── Internal ──────────────────────────────────────────────────

  private handleLine(line: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      console.error("[wave-stdio] Failed to parse:", line);
      return;
    }

    if (typeof msg !== "object" || msg === null) return;
    const obj = msg as Record<string, unknown>;

    // Response (has id + result/error)
    if ("id" in obj && ("result" in obj || "error" in obj)) {
      const id = Number(obj.id);
      const pending = this.pending.get(id);
      if (pending) {
        this.pending.delete(id);
        if (obj.error) {
          const err = obj.error as { code: number; message: string };
          pending.reject(new Error(err.message));
        } else {
          pending.resolve(obj.result);
        }
      }
      return;
    }

    // Notification (has method, no id)
    if ("method" in obj && !("id" in obj)) {
      const method = obj.method as string;
      const params = obj.params;
      const sessionId =
        typeof obj.sessionId === "string" ? obj.sessionId : undefined;
      const set = this.handlers.get(method);
      if (set) {
        for (const handler of set) {
          handler(params, sessionId);
        }
      }
      return;
    }
  }
}
