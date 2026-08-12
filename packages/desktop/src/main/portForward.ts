/**
 * SSH port forwarding for the remote preview panel (spec: docs/specs/ui/desktop-app.md
 * scenarios 15-18). Clicking a localhost link in a remote session's message
 * forwards the remote service to the local loopback via `ssh -N -L` and the
 * preview pane loads the rewritten local address.
 *
 * Forwarding is demand-driven and session-scoped: the same (host, remote port)
 * is reused while any session references it, and the tunnel lives as long as
 * its referencing sessions — closing a preview panel, switching sessions or
 * hosts never releases it. Only deleting the session (releaseSession), the ssh
 * process dying on its own, or the app quitting (dispose) tears it down
 * (scenario 18).
 */

import * as net from "net";
import { spawn, type ChildProcess } from "child_process";
import { LOCAL_HOST, SSH_BASE_OPTIONS } from "./sshHosts";

/** Local port assignment attempts (remote port, remote port+1, …) before failing. */
const MAX_PORT_ATTEMPTS = 20;
/** How long a tunnel may take to come up before the forward is failed. */
const READY_TIMEOUT_MS = 15_000;
/** Probe interval while waiting for the tunnel's local port to accept. */
const READY_PROBE_MS = 200;
const MAX_PORT = 65_535;

export type ForwardState = "connecting" | "ready" | "failed";

interface ForwardWaiter {
  url: string;
  resolve: (result: ForwardResult) => void;
  reject: (err: Error) => void;
}

export interface ForwardEntry {
  host: string;
  remotePort: number;
  localPort: number;
  /** Session ids referencing this tunnel — the tunnel dies when the set empties. */
  sessionIds: Set<string>;
  state: ForwardState;
  proc: ChildProcess | null;
  waiters: ForwardWaiter[];
  error?: string;
}

export interface ForwardResult {
  /** Rewritten loopback URL the preview pane loads. */
  url: string;
  /** The original remote URL the user clicked (kept for comments). */
  originalUrl: string;
}

export interface AuthCallbackForward {
  /** Auth URL to open in the system browser — callback_url rewritten to the local forwarded port. */
  authUrl: string;
  /**
   * Tear the callback tunnel down. The login request only settles after the
   * code exchange, so the tunnel must stay up until the caller knows the login
   * is done (spec: SSO 登录 scenario 8).
   */
  close: () => void;
}

/**
 * Rewrite `url` to 127.0.0.1:<localPort>, preserving path/search/hash. The
 * hostname is pinned to 127.0.0.1 (not localhost) because the tunnel binds the
 * IPv4 loopback only — a browser resolving localhost to ::1 would miss it.
 */
export function rewriteForwardedUrl(url: string, localPort: number): string {
  const u = new URL(url);
  return `${u.protocol}//127.0.0.1:${localPort}${u.pathname}${u.search}${u.hash}`;
}

export class PortForwardManager {
  /** Session-scoped preview tunnels (acquire/releaseSession). */
  private entries = new Map<string, ForwardEntry>();
  /** One-shot SSO callback tunnels (forwardAuthCallback), closed on login settle. */
  private authEntries = new Map<string, ForwardEntry>();

  private key(host: string, remotePort: number): string {
    return `${host}\u0000${remotePort}`;
  }

  /** Whether `entry` is still tracked by this manager (either map). */
  private isTracked(entry: ForwardEntry): boolean {
    const key = this.key(entry.host, entry.remotePort);
    return (
      this.entries.get(key) === entry || this.authEntries.get(key) === entry
    );
  }

  /** Drop `entry` from whichever map tracks it. Idempotent. */
  private untrack(entry: ForwardEntry): void {
    const key = this.key(entry.host, entry.remotePort);
    if (this.entries.get(key) === entry) this.entries.delete(key);
    if (this.authEntries.get(key) === entry) this.authEntries.delete(key);
  }

  /**
   * Resolve a preview URL to a forwarded loopback address. Local hosts pass
   * through unchanged. For remote hosts, a tunnel for (host, remote port) is
   * started on demand and reused while any session holds a reference.
   */
  acquire(
    host: string,
    url: string,
    sessionId?: string,
  ): Promise<ForwardResult> {
    if (host === LOCAL_HOST) return Promise.resolve({ url, originalUrl: url });
    let remotePort: number;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return Promise.reject(new Error("仅支持 http/https 链接"));
      }
      remotePort = Number(
        parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      );
    } catch {
      return Promise.reject(new Error("无法解析链接"));
    }
    if (
      !Number.isInteger(remotePort) ||
      remotePort < 1 ||
      remotePort > MAX_PORT
    ) {
      return Promise.reject(new Error(`无效的端口：${remotePort}`));
    }
    const key = this.key(host, remotePort);
    const existing = this.entries.get(key);
    if (existing && existing.state !== "failed") {
      // Idempotent per session — re-clicking the same link does not double-count.
      if (sessionId) existing.sessionIds.add(sessionId);
      if (existing.state === "ready")
        return Promise.resolve(this.resultFor(existing, url));
      // Connecting — park on the shared waiter list; resolved/rejected when the
      // tunnel settles.
      return new Promise<ForwardResult>((resolve, reject) => {
        existing.waiters.push({ url, resolve, reject });
      });
    }
    // Set the entry into the map synchronously so a concurrent acquire of the
    // same (host, port) sees it instead of starting a second tunnel.
    const entry: ForwardEntry = {
      host,
      remotePort,
      localPort: 0,
      sessionIds: sessionId ? new Set([sessionId]) : new Set(),
      state: "connecting",
      proc: null,
      waiters: [],
    };
    this.entries.set(key, entry);
    return this.startForward(entry).then(() => this.resultFor(entry, url));
  }

  /**
   * Forward the callback port of a remote host's SSO auth URL to the local
   * loopback (spec: SSO 登录 scenario 8). The daemon's callback server listens
   * on the REMOTE 127.0.0.1 — a browser on this machine redirects to its own
   * local 127.0.0.1, so without the tunnel the auth code never reaches the
   * daemon and the login hangs until timeout. `callback_url` is rewritten to
   * the local forwarded port; call `close()` once the login request settles.
   */
  async forwardAuthCallback(
    host: string,
    authUrl: string,
  ): Promise<AuthCallbackForward> {
    const remotePort = this.parseCallbackPort(authUrl);
    const entry: ForwardEntry = {
      host,
      remotePort,
      localPort: 0,
      sessionIds: new Set(),
      state: "connecting",
      proc: null,
      waiters: [],
    };
    this.authEntries.set(this.key(host, remotePort), entry);
    try {
      await this.spawnForward(entry);
    } catch (err) {
      // spawnForward already failForward()ed on error; untrack is idempotent.
      this.untrack(entry);
      throw err;
    }
    const rewritten = new URL(authUrl);
    rewritten.searchParams.set(
      "callback_url",
      `http://127.0.0.1:${entry.localPort}`,
    );
    return {
      authUrl: rewritten.toString(),
      close: () => this.stopForward(entry),
    };
  }

  private parseCallbackPort(authUrl: string): number {
    try {
      const u = new URL(authUrl);
      const callbackUrl = u.searchParams.get("callback_url");
      if (!callbackUrl) throw new Error("缺少 callback_url 参数");
      const callback = new URL(callbackUrl);
      if (callback.protocol !== "http:")
        throw new Error(`不支持的协议 ${callback.protocol}`);
      const port = Number(callback.port || 80);
      if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
        throw new Error(`无效的回调端口：${callback.port}`);
      }
      return port;
    } catch (err) {
      throw new Error(
        `无法解析 SSO 回调地址：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Drop a session's references — every tunnel referenced only by this session
   * dies. The tunnel is session-scoped (scenario 18): closing a preview panel,
   * switching sessions/hosts or clicking a different link never releases;
   * deleting the session does.
   */
  releaseSession(sessionId: string): void {
    for (const entry of this.entries.values()) {
      if (entry.sessionIds.delete(sessionId) && entry.sessionIds.size === 0) {
        this.stopForward(entry);
      }
    }
  }

  /** Kill every tunnel — app quit (scenario 18). */
  dispose(): void {
    for (const entry of [...this.entries.values()]) this.stopForward(entry);
    for (const entry of [...this.authEntries.values()]) this.stopForward(entry);
  }

  private resultFor(entry: ForwardEntry, url: string): ForwardResult {
    return { url: rewriteForwardedUrl(url, entry.localPort), originalUrl: url };
  }

  private async startForward(entry: ForwardEntry): Promise<void> {
    try {
      await this.spawnForward(entry);
    } catch (err) {
      this.failForward(entry, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  private async spawnForward(entry: ForwardEntry): Promise<void> {
    const localPort = await this.pickLocalPort(entry.remotePort);
    entry.localPort = localPort;
    // The SSO callback server binds the remote 127.0.0.1 explicitly, so the
    // remote end must be 127.0.0.1 (not localhost, which ssh may resolve to ::1
    // and miss an IPv4-only listener). Preview tunnels use localhost (the
    // service may listen on either loopback).
    const remoteEnd =
      this.authEntries.get(this.key(entry.host, entry.remotePort)) === entry
        ? `127.0.0.1:${entry.remotePort}`
        : `localhost:${entry.remotePort}`;
    // `-N -L` are ssh OPTIONS and must precede the hostname — buildSshSpawnArgs
    // (remote-command form) is not applicable here.
    const proc = spawn(
      "ssh",
      [
        ...SSH_BASE_OPTIONS,
        "-N",
        "-L",
        `127.0.0.1:${localPort}:${remoteEnd}`,
        entry.host,
      ],
      { stdio: "ignore" },
    );
    entry.proc = proc;
    proc.on("error", (err) => {
      this.failForward(entry, `转发进程启动失败：${err.message}`);
    });
    proc.on("exit", (code, signal) => {
      if (!this.isTracked(entry)) return; // intentional stop
      // The tunnel died on its own (remote unreachable / connection dropped) —
      // fail so the pane shows an actionable error (scenario 16).
      this.failForward(
        entry,
        code !== null
          ? `转发连接已断开（退出码 ${code}）`
          : `转发进程被信号终止（${signal}）`,
      );
    });
    await this.waitForReady(entry);
    if (entry.state !== "connecting")
      throw new Error(entry.error ?? "转发建立失败");
    entry.state = "ready";
    for (const w of entry.waiters) w.resolve(this.resultFor(entry, w.url));
    entry.waiters = [];
  }

  /**
   * Wait until the tunnel's local port accepts connections. ssh binds the
   * local end as soon as the session is established, so a successful connect
   * means the tunnel is up (scenario 15).
   */
  private waitForReady(entry: ForwardEntry): Promise<void> {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + READY_TIMEOUT_MS;
      const attempt = (): void => {
        if (entry.state !== "connecting") {
          reject(new Error(entry.error ?? "转发建立失败"));
          return;
        }
        if (Date.now() >= deadline) {
          this.failForward(
            entry,
            "转发建立超时：无法连接远端主机，或远端服务未监听该端口",
          );
          reject(new Error(entry.error));
          return;
        }
        const socket = net.connect({
          host: "127.0.0.1",
          port: entry.localPort,
        });
        socket.once("connect", () => {
          socket.destroy();
          resolve();
        });
        socket.once("error", () => {
          socket.destroy();
          setTimeout(attempt, READY_PROBE_MS);
        });
      };
      attempt();
    });
  }

  private async pickLocalPort(preferred: number): Promise<number> {
    for (let i = 0; i < MAX_PORT_ATTEMPTS; i++) {
      const candidate = preferred + i;
      if (candidate > MAX_PORT) break;
      if (this.isLocalPortTaken(candidate)) continue;
      if (await this.canBind(candidate)) return candidate;
    }
    throw new Error(
      `本地端口分配失败：${preferred}–${Math.min(preferred + MAX_PORT_ATTEMPTS - 1, MAX_PORT)} 均不可用`,
    );
  }

  /** Ports already assigned to live tunnels of this manager (preview + auth). */
  private isLocalPortTaken(port: number): boolean {
    for (const entry of this.entries.values()) {
      if (entry.state !== "failed" && entry.localPort === port) return true;
    }
    for (const entry of this.authEntries.values()) {
      if (entry.state !== "failed" && entry.localPort === port) return true;
    }
    return false;
  }

  private canBind(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.listen({ host: "127.0.0.1", port }, () => {
        server.close(() => resolve(true));
      });
    });
  }

  /** Mark failed, reject waiters, drop the entry, kill the process. Idempotent. */
  private failForward(entry: ForwardEntry, error: string): void {
    if (entry.state === "failed") return;
    entry.state = "failed";
    entry.error = error;
    this.untrack(entry);
    for (const w of entry.waiters) w.reject(new Error(error));
    entry.waiters = [];
    this.killProc(entry);
  }

  /** Intentional teardown (last session released / login settled / dispose) — silent, no waiters rejected. */
  private stopForward(entry: ForwardEntry): void {
    entry.state = "failed";
    this.untrack(entry);
    entry.waiters = [];
    this.killProc(entry);
  }

  private killProc(entry: ForwardEntry): void {
    if (!entry.proc) return;
    try {
      entry.proc.kill();
    } catch {
      // already dead
    }
    entry.proc = null;
  }
}
