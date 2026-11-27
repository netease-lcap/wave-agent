import { promises as fs } from "fs";
import { basename, join } from "path";
import { homedir } from "os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ChatCompletionFunctionTool } from "openai/resources.js";
import {
  createMcpToolPlugin,
  findToolServer,
  mcpToolFlatName,
} from "../utils/mcpUtils.js";
import { HookBlockedToolError } from "../types/hooks.js";
import { recordToolActivity } from "../telemetry/metrics.js";
import { entrypointOf } from "../telemetry/attributes.js";
import type { StandardAttributeContext } from "../telemetry/attributes.js";
import { reportMcpConnectionFailure } from "../telemetry/failureEvents.js";
import {
  McpConfigError,
  classifyMcpFailure,
  sanitizeMcpFailureMessage,
} from "../utils/mcpFailure.js";
import type { McpDialStage, McpFailureReason } from "../utils/mcpFailure.js";
import { detectMcpActivity } from "../telemetry/toolActivity.js";
import type { ToolPlugin, ToolResult, ToolContext } from "../tools/types.js";
import { Container } from "../utils/container.js";
import { killProcessTree } from "../utils/killProcessTree.js";
import {
  mcpConfigFingerprint,
  mcpToolsCacheKey,
  readMcpToolsCache,
  saveCachedTools,
} from "../utils/mcpToolsCache.js";
import { truncateMcpInstructions } from "../utils/mcpInstructions.js";
import type { ConfigurationService } from "../services/configurationService.js";
import type {
  Logger,
  McpServerConfig,
  McpConfig,
  McpTool,
  McpToolCallResult,
  McpServerStatus,
} from "../types/index.js";

interface McpConnection {
  client: Client;
  transport: Transport;
  process: null; // StdioClientTransport manages process internally
}

/**
 * How long a turn may wait for MCP dials before it builds its tool config
 * without them (spec ecosystem/mcp.md「连接 MCP 服务器的时机与超时」场景 3).
 *
 * The deadline is a *waiting* budget, not a connection timeout: the dial keeps
 * running in the background and simply is not waited for any more. Aligned with
 * Claude Code 2.1.329's `MCP_CONNECT_TIMEOUT_MS` default.
 */
export const MCP_CONNECT_DEADLINE_MS = 5000;

/**
 * How many stdio servers may be dialing at once (spec ecosystem/mcp.md 场景 5):
 * spawning a whole config at once starts one `uvx`/`npx` tree each, which is
 * what a batch size keeps from happening. Aligned with Claude Code 2.1.329's
 * `MCP_SERVER_CONNECTION_BATCH_SIZE` default.
 */
export const MCP_CONNECT_BATCH_SIZE = 3;

/**
 * How many transport-level errors in a row recycle a connection
 * (spec ecosystem/mcp.md 边界情况「下行通知流（SSE GET）断开不等于服务器不可用」).
 *
 * A dead downstream notification stream — an SSE GET body timeout, `terminated`,
 * the SDK giving up on reconnecting — does **not** mean the server is gone:
 * `tools/call` is its own POST and keeps working. So the first two errors only
 * count (the server stays `connected`, tools and `instructions` included) and
 * the third one closes the transport and dials again. Same shape as Claude Code
 * 2.1.331, which counts transport-level errors and closes at
 * `consecutiveErrors >= 3` (`2990:4586-4595`, `2990:7050`).
 */
export const MCP_TRANSPORT_ERROR_LIMIT = 3;

/**
 * How long a teardown queued behind in-flight tool calls waits before cutting
 * them off anyway (Claude Code waits for `callsInProgress === 0` before closing,
 * `2990:7118-7121`).
 *
 * A tool call has no timeout of its own, so an unbounded wait would leave a
 * broken transport alive for as long as one hung call keeps the counter
 * non-zero. A minute is far beyond any call this repo expects (`sendFile`,
 * HTTP bridges) and short enough that the recycle still happens within the same
 * conversation.
 */
export const MCP_CALLS_DRAIN_TIMEOUT_MS = 60_000;

/**
 * Reconnect backoff, aligned with Claude Code 2.1.331 (`1115:25-28`,
 * `1115:288-293`): `10s · 2^(n-1)` capped at 300s, and after
 * `MCP_RECONNECT_MAX_ATTEMPTS` consecutive failures a single 600s cooldown
 * before the next turn may redial the server.
 */
export const MCP_RECONNECT_BASE_DELAY_MS = 10_000;
export const MCP_RECONNECT_MAX_DELAY_MS = 300_000;
export const MCP_RECONNECT_MAX_ATTEMPTS = 10;
export const MCP_RECONNECT_COOLDOWN_MS = 600_000;

/**
 * Is this transport error one of the "the downstream notification stream died"
 * kind rather than "the server refused to connect"?
 *
 * Used for logging and for the manager's `messageStreamLost` marker only — the
 * *counting* applies to every `transport.onerror`, because the SDK funnels POST
 * failures through the same callback. The literals are the ones the SDK actually
 * emits (`streamableHttp.js`: `SSE stream disconnected: …`,
 * `Failed to reconnect …`, `Maximum reconnection attempts … exceeded`) plus what
 * undici surfaces underneath (`Body Timeout Error`, `terminated`).
 */
function isDownstreamStreamError(message: string): boolean {
  return [
    "SSE stream disconnected",
    "Failed to reconnect",
    "Maximum reconnection attempts",
    "Body Timeout Error",
    "body timeout",
    "terminated",
    "socket hang up",
    "other side closed",
    "ECONNRESET",
    "EPIPE",
  ].some((fragment) => message.includes(fragment));
}

/** Which path started the automatic dials, for failure telemetry. */
type DialPhase = "initialize" | "lazy";

/**
 * Why a dial decided not to spawn anything. None of these are failures — no
 * process was started and no connection was attempted — so none of them
 * reaches the failure telemetry (spec ecosystem/mcp.md 边界情况「没有真正尝试的
 * 连接不算失败」). They exist so the skip is still explainable from the log.
 */
type McpDialSkipReason =
  | "not_registered"
  | "destroyed"
  | "disconnecting"
  | "user_disconnected";

/** Human wording for a skip, for the one debug line each one leaves behind. */
const SKIP_REASON_TEXT: Record<McpDialSkipReason, string> = {
  not_registered: "it is not registered (removed, or never added)",
  destroyed: "the manager was already destroyed",
  disconnecting: "a user-initiated teardown is in flight",
  user_disconnected: "the user disconnected it earlier in this session",
};

/**
 * What a dial came back with.
 *
 * The dial used to answer `boolean`, which threw away the reason it already
 * had in `updateServerStatus()` and made "we never tried" indistinguishable
 * from "it failed" (and from "it connected but its owner was gone"). The
 * boolean is still what the public API returns; only the internal paths read
 * this shape. Aligned with Claude Code 2.1.331's
 * `{type: 'failed', error, errorCode}` (`2990:7476-7500`).
 */
type McpDialOutcome =
  | { ok: true }
  | { ok: false; kind: "skipped"; skip: McpDialSkipReason }
  | { ok: false; kind: "abandoned" }
  | { ok: false; kind: "failed"; reason: McpFailureReason; error?: unknown };

/**
 * One dial that has already been *promised* to the session: `run` does the
 * work, `done` settles when it is over however it ended.
 */
interface ScheduledDial {
  done: Promise<void>;
  run: () => Promise<void>;
}

/**
 * pid of the process a transport spawned, for stdio transports only (http/sse
 * have none). Read *before* closing: once the direct child (`uvx`) is gone its
 * children are re-parented and can no longer be reached from this pid.
 */
function transportPid(transport: Transport): number | undefined {
  const pid = (transport as { pid?: unknown }).pid;
  return typeof pid === "number" && pid > 0 ? pid : undefined;
}

export interface McpManagerCallbacks {
  onMcpServersChange?: (servers: McpServerStatus[]) => void;
}

import { logger } from "../utils/globalLogger.js";

export interface McpManagerOptions {
  callbacks?: McpManagerCallbacks;
  logger?: Logger;
  /** Pre-configured MCP servers passed from constructor options */
  mcpServers?: Record<string, McpServerConfig>;
}

/**
 * Expand environment variables in a string value.
 * Supports ${VAR} and ${VAR:-default} patterns.
 */
const WAVE_TEMPLATE_VARS = ["WAVE_PLUGIN_ROOT", "CLAUDE_PLUGIN_ROOT"];

/**
 * Expand environment variables in a string value.
 * Supports ${VAR} and ${VAR:-default} patterns.
 *
 * @param env - Merged env to resolve against (session snapshot over OS env).
 *              Defaults to `process.env` for backward compatibility with tests
 *              and standalone callers.
 */
export function expandEnvVars(
  value: string,
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
    const [varName, ...rest] = expr.split(":-");
    const defaultValue = rest.join(":-");
    // Skip Wave-specific template variables — they are handled at spawn time
    if (WAVE_TEMPLATE_VARS.includes(varName)) {
      return _match; // return original ${...} string untouched
    }
    return env[varName] ?? process.env[varName] ?? defaultValue;
  });
}

/**
 * Walk an MCP config and resolve environment variables in all string fields.
 * Expands ${VAR} against the session env snapshot (over OS env); falls back to
 * process.env. WAVE_PLUGIN_ROOT is skipped — handled at spawn time.
 */
export function resolveMcpConfig(
  config: McpConfig,
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): McpConfig {
  const resolved: McpConfig = { mcpServers: {} };

  for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
    const resolvedServer: McpServerConfig = { ...serverConfig };

    if (resolvedServer.command) {
      resolvedServer.command = expandEnvVars(resolvedServer.command, env);
    }

    if (resolvedServer.args) {
      resolvedServer.args = resolvedServer.args.map((a) =>
        expandEnvVars(a, env),
      );
    }

    if (resolvedServer.env) {
      const resolvedEnv: Record<string, string> = {};
      for (const [key, val] of Object.entries(resolvedServer.env)) {
        resolvedEnv[key] = expandEnvVars(val, env);
      }
      resolvedServer.env = resolvedEnv;
    }

    if (resolvedServer.url) {
      resolvedServer.url = expandEnvVars(resolvedServer.url, env);
    }

    if (resolvedServer.headers) {
      const resolvedHeaders: Record<string, string> = {};
      for (const [key, val] of Object.entries(resolvedServer.headers)) {
        resolvedHeaders[key] = expandEnvVars(val, env);
      }
      resolvedServer.headers = resolvedHeaders;
    }

    resolved.mcpServers[name] = resolvedServer;
  }

  return resolved;
}

export class McpManager {
  private config: McpConfig | null = null;
  private servers: Map<string, McpServerStatus> = new Map();
  private connections: Map<string, McpConnection> = new Map();
  private configPath: string = "";
  private userConfigPath: string = "";
  private workdir: string = "";
  private callbacks: McpManagerCallbacks;
  private mcpServers: Record<string, McpServerConfig> | undefined;

  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  /**
   * Consecutive failed reconnect attempts per server (reset by a successful
   * dial). Drives the backoff from `reconnectDelay()` and the 600 s cooldown
   * after `MCP_RECONNECT_MAX_ATTEMPTS`.
   */
  private reconnectAttempts: Map<string, number> = new Map();
  /** Earliest moment the next automatic dial may start for that server. */
  private reconnectEligibleAt: Map<string, number> = new Map();
  /**
   * Consecutive transport-level errors on the live transport. Not an error state:
   * below `MCP_TRANSPORT_ERROR_LIMIT` the server stays usable.
   */
  private transportErrors: Map<string, number> = new Map();
  /**
   * The server's downstream notification stream is gone (or being re-dialed by
   * the SDK) while `tools/call` still works. Diagnostics only — the same reason
   * Claude Code's `messageStreamLost` does not take the server out of the pool.
   */
  private messageStreamLost: Set<string> = new Set();
  /** Tool calls in flight per server; a teardown queues behind these. */
  private callsInProgress: Map<string, number> = new Map();
  /** Resolvers woken when that server's in-flight calls reach zero. */
  private callDrainWaiters: Map<string, Array<() => void>> = new Map();
  /** One queued recycle per server, so a burst of errors cannot stack teardowns. */
  private recycling: Set<string> = new Set();
  /** Explicit disconnectServer teardowns currently in flight */
  private disconnecting: Set<string> = new Set();
  /**
   * Servers the *user* disconnected. The automatic dial must not undo that
   * decision (spec ecosystem/mcp.md「手动断开不得被自动重连撤销」); only an
   * explicit `connectMcpServer()` clears it.
   */
  private userDisconnected: Set<string> = new Set();
  /**
   * Servers this session already promised a first dial to, so a failure is not
   * retried on every turn (spec ecosystem/mcp.md 场景 7).
   */
  private autoDialAttempted: Set<string> = new Set();
  /**
   * Automatic dials promised but not yet settled — queued behind the batch gate
   * as well as in flight. Being promised (not started) is what keeps two paths
   * from dialing the same server twice.
   */
  private pendingDials: Set<string> = new Set();
  /**
   * Recovery dials (`recoverServers()`): promised so they cannot be dialed
   * twice, but deliberately not waited for by the turn — reviving a broken
   * server must not cost every turn another dial timeout.
   */
  private backgroundDials: Set<string> = new Set();
  /** Settles when that server's promised dial is over, however it ended. */
  private dialCompletions: Map<string, Promise<void>> = new Map();
  /**
   * The startup pass is still running — it may hold the config read and it may
   * not have promised its dials yet, so a turn must not read "nothing pending"
   * off the two sets below while it is true.
   */
  private autoDialPassActive: boolean = false;
  /** Set by `cleanup()`: a destroyed manager never spawns another process. */
  private destroyed: boolean = false;

  constructor(
    private container: Container,
    options: McpManagerOptions = {},
  ) {
    this.callbacks = options.callbacks || {};
    this.mcpServers = options.mcpServers;
  }

  /**
   * Merged env for this session: OS env overlaid with the per-session settings
   * snapshot. MCP env-var expansion (${VAR}) resolves against this so multiple
   * sessions in one `wave --stdio` process don't read each other's settings env.
   */
  private get envSnapshot(): Record<string, string> {
    return (
      this.container
        .get<ConfigurationService>("ConfigurationService")
        ?.getMergedEnv?.() ?? (process.env as Record<string, string>)
    );
  }

  /**
   * Initialize MCP manager with working directory and optionally start the
   * session's automatic dial.
   *
   * `autoConnect` starts the dial at creation time and returns without waiting
   * for any server to come up (`startAutoDials()`): the server list has to be
   * complete right after `Agent.create()` — the `/mcp` panel and the settings
   * page read it — while the processes are still starting. What a turn waits
   * for, and for how long, is `waitForTurnDials()`'s decision (5 s deadline,
   * `alwaysLoad: true` exempt), not this one's. See spec ecosystem/mcp.md
   * 「连接 MCP 服务器的时机与超时」. Config reading is separate (`loadConfig()`),
   * so the caller can make the server list visible without spawning anything.
   */
  async initialize(
    workdir: string,
    autoConnect: boolean = false,
  ): Promise<void> {
    this.configPath = join(workdir, ".mcp.json");
    this.userConfigPath = join(homedir(), ".wave", "mcp.json");
    this.workdir = workdir;

    // Register constructor-provided servers before loading .mcp.json
    if (this.mcpServers) {
      for (const [name, config] of Object.entries(this.mcpServers)) {
        this.addServer(name, config);
      }
    }

    if (autoConnect) {
      logger?.debug("Initializing MCP servers...");

      // Load workspace MCP configuration (always read, merge with any plugin servers already added)
      await this.loadConfig();

      // Fire-and-forget: starts one dial per configured server, waits for none.
      this.startAutoDials();

      logger?.debug("MCP servers initialization started in background");
      // Trigger state change callback after starting initialization
      this.callbacks.onMcpServersChange?.(this.getAllServers());
    }
  }

  /**
   * Start the session's automatic dial and return immediately
   * (spec ecosystem/mcp.md「连接 MCP 服务器的时机与超时」场景 1).
   *
   * One pass per session and one dial per server: servers were registered at
   * `Agent.create()`, and this spawns each of them at most once — a failure
   * stays failed until the user asks for an explicit connect (场景 7), a server
   * the user disconnected stays down (场景 9). Nothing is awaited: the turn path
   * (`waitForTurnDials()`) owns the question of how long to wait.
   *
   * Never throws — a config read or a dial failure is a status, not a startup
   * failure.
   */
  startAutoDials(): void {
    if (this.destroyed) return;
    void this.autoDialPass();
  }

  private async autoDialPass(): Promise<void> {
    this.autoDialPassActive = true;
    try {
      // A host path that skipped `loadConfig()` still gets its servers dialed.
      await this.ensureConfigLoaded();
      if (this.destroyed) return;
      await this.dialPendingTargets("initialize");
    } catch (error) {
      logger?.warn("MCP startup dial failed:", error);
    } finally {
      this.autoDialPassActive = false;
    }
  }

  /**
   * Wait for this session's MCP dials, for at most `deadlineMs`
   * (spec ecosystem/mcp.md「连接 MCP 服务器的时机与超时」场景 2-4).
   *
   * Returns `undefined` — synchronously, adding no yield point — when there is
   * nothing to wait for (nothing configured, everything connected, already
   * attempted or disconnected by the user): a session that does not use MCP
   * must be indistinguishable from one built before this mechanism existed.
   * "Nothing configured" covers the null-config case too: servers only ever
   * enter `this.servers` through a config read, so no config means no dial.
   *
   * Otherwise the promise resolves when the promised dials settle or when the
   * deadline arrives, whichever comes first. A dial still running at the
   * deadline keeps running in the background — it is neither cancelled nor
   * re-dialed — and its server simply is not part of this turn's tools. Servers
   * configured with `alwaysLoad: true` are the one exception: the turn waits
   * for them to connect or fail, deadline or not.
   *
   * Recovery dials (`recoverServers()`) are deliberately not waited for: they
   * exist so a broken server comes back on its own, not so every turn pays for
   * a dead one (spec ecosystem/mcp.md「使用前重拨」).
   *
   * Never throws.
   */
  waitForTurnDials(
    deadlineMs: number = MCP_CONNECT_DEADLINE_MS,
  ): Promise<void> | undefined {
    if (this.destroyed) return undefined;
    if (
      !this.autoDialPassActive &&
      this.foregroundDials().length === 0 &&
      this.pendingDialTargets().length === 0
    ) {
      return undefined;
    }
    return this.waitForDials(deadlineMs);
  }

  /** Promised dials the turn is allowed to wait for (recovery dials are not). */
  private foregroundDials(): string[] {
    return Array.from(this.pendingDials).filter(
      (name) => !this.backgroundDials.has(name),
    );
  }

  private async waitForDials(deadlineMs: number): Promise<void> {
    try {
      // The startup pass may not have promised its dials yet (it holds the
      // config read): pick up whatever it has not reached, so this turn waits
      // for the same set the session as a whole is dialing.
      await this.ensureConfigLoaded();
      if (this.destroyed) return;
      void this.dialPendingTargets("lazy");

      const claimed: Promise<void>[] = [];
      const alwaysLoad: Promise<void>[] = [];
      for (const name of this.foregroundDials()) {
        const done = this.dialCompletions.get(name);
        if (!done) continue;
        if (this.servers.get(name)?.config.alwaysLoad === true) {
          alwaysLoad.push(done);
        } else {
          claimed.push(done);
        }
      }
      if (claimed.length === 0 && alwaysLoad.length === 0) return;

      let timer: NodeJS.Timeout | undefined;
      const deadline = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, Math.max(0, deadlineMs));
        // Waiting for a server must not be a reason for the process to stay up.
        timer.unref?.();
      });
      try {
        await Promise.all([
          // Uncapped: `alwaysLoad` is the explicit "wait for this one" ask.
          Promise.all(alwaysLoad),
          Promise.race([Promise.all(claimed), deadline]),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch (error) {
      logger?.warn("MCP dial wait failed:", error);
    }
  }

  /**
   * Servers still waiting for their first dial in this session.
   */
  private pendingDialTargets(): string[] {
    const targets: string[] = [];
    for (const name of this.servers.keys()) {
      if (this.connections.has(name)) continue;
      if (this.pendingDials.has(name)) continue;
      if (this.disconnecting.has(name)) continue;
      if (this.userDisconnected.has(name)) continue;
      if (this.autoDialAttempted.has(name)) continue;
      targets.push(name);
    }
    return targets;
  }

  /**
   * Start the automatic dials and hand back a promise for all of them, or do
   * nothing at all.
   *
   * Returns `undefined` when no server needs dialing (nothing configured,
   * everything connected or already attempted) so a caller that cannot use a
   * deadline path gains no extra `await`. `waitForTurnDials()` is the turn's
   * entry point; this one awaits every dial, without a budget.
   */
  beginPendingDials(): Promise<void> | undefined {
    if (this.destroyed) return undefined;
    if (this.config && this.pendingDialTargets().length === 0) return undefined;
    return this.connectPendingServers();
  }

  /**
   * Dial every server that still needs it and await all of them
   * (spec ecosystem/mcp.md「连接 MCP 服务器的时机与超时」场景 6-9).
   *
   * Only servers that were never dialed in this session are picked up: a
   * server that already failed is left in `error` rather than costing every
   * later turn another dial timeout and another spawned tree, and a server the
   * user disconnected stays down. Already-connected servers are untouched, and
   * a dial already promised by the startup pass is joined instead of repeated.
   *
   * Never throws: a failure is a server status, not a turn failure.
   */
  async connectPendingServers(): Promise<void> {
    if (this.destroyed) return;
    // `.mcp.json` / `~/.wave/mcp.json` may not have been read yet (initialize()
    // with autoConnect=false still loads them, but a manager created by a test
    // double or a host path that skipped initialize must not dial blindly).
    try {
      await this.ensureConfigLoaded();
    } catch (error) {
      logger?.warn("MCP config load failed before dial:", error);
      return;
    }
    if (this.destroyed) return;

    await this.dialPendingTargets("lazy");
  }

  /**
   * Promise a dial for every server that still needs one and run them, at most
   * `MCP_CONNECT_BATCH_SIZE` at a time.
   */
  private dialPendingTargets(phase: DialPhase): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    const targets = this.pendingDialTargets();
    if (targets.length === 0) return Promise.resolve();
    return this.runDialBatch(
      targets.map((name) => this.scheduleDial(name, phase)),
    );
  }

  /**
   * Promise one server's dial: mark it before the batch gate admits it, so a
   * queued server already counts as "being dialed" — two paths can never dial
   * the same server twice, and a turn waiting for an `alwaysLoad` server waits
   * for its place in the queue too.
   */
  private scheduleDial(
    name: string,
    phase: DialPhase,
    options: { background?: boolean } = {},
  ): ScheduledDial {
    this.autoDialAttempted.add(name);
    this.pendingDials.add(name);
    if (options.background) this.backgroundDials.add(name);
    let settle!: () => void;
    const done = new Promise<void>((resolve) => {
      settle = resolve;
    });
    this.dialCompletions.set(name, done);

    return {
      done,
      run: async () => {
        try {
          const outcome = await this.connectServer(name);
          if (outcome.ok) {
            logger?.debug(`Connected to MCP server ${name}`);
          } else if (outcome.kind === "failed") {
            logger?.warn(
              `MCP server ${name} failed to connect (${outcome.reason}); it is retried on a later turn once its backoff window expires`,
            );
            this.reportConnectionFailure(name, phase, outcome);
          }
          // Skipped / abandoned dials were already explained by their own debug
          // line inside `connectServer`, and neither is a failure.
        } catch (error) {
          // `connectServer` does not throw; a throw here would be a bug in it,
          // and it still must not cost the session its turn.
          logger?.warn(`MCP dial failed for ${name}:`, error);
          this.reportConnectionFailure(name, phase, {
            reason: classifyMcpFailure(error),
            error,
          });
        } finally {
          this.pendingDials.delete(name);
          this.backgroundDials.delete(name);
          this.dialCompletions.delete(name);
          settle();
        }
      },
    };
  }

  /** Run promised dials with a bounded number in flight at once. */
  private async runDialBatch(dials: ScheduledDial[]): Promise<void> {
    const queue = [...dials];
    const workers = Array.from(
      { length: Math.min(MCP_CONNECT_BATCH_SIZE, queue.length) },
      async () => {
        for (let dial = queue.shift(); dial; dial = queue.shift()) {
          await dial.run();
        }
      },
    );
    await Promise.all(workers);
  }

  /**
   * Whose session could not reach an MCP server.
   *
   * Attribution comes from this manager's own container, so a nested agent's
   * container reports its own session rather than the outer one.
   */
  private connectionFailureTelemetry():
    | { sessionId: string; context: StandardAttributeContext }
    | undefined {
    const sessionId = this.container
      .get<{ getSessionId(): string }>("MessageManager")
      ?.getSessionId();
    if (!sessionId) return undefined;
    return {
      sessionId,
      context: {
        sessionId,
        workdir: this.container.get<string>("SessionWorkdir") ?? "",
        entrypoint: entrypointOf(this.container),
      },
    };
  }

  /**
   * Report a server that could not be reached. Deduped per server per session
   * inside `reportMcpConnectionFailure`: a server that is down stays down for
   * the whole session, and the dial is retried on every use.
   */
  private reportConnectionFailure(
    serverName: string,
    phase: "initialize" | "lazy" | "config",
    failure: { reason: McpFailureReason; error?: unknown },
  ): void {
    const telemetry = this.connectionFailureTelemetry();
    if (!telemetry) return;
    void reportMcpConnectionFailure({
      error: failure.error,
      reason: failure.reason,
      // The raw message stays in the local log; only this summary leaves the
      // process (paths and URL credentials stripped, then clipped).
      message:
        failure.error === undefined
          ? undefined
          : sanitizeMcpFailureMessage(failure.error, {
              workdir: this.workdir,
              homeDir: homedir(),
            }),
      sessionId: telemetry.sessionId,
      serverName,
      phase,
      context: telemetry.context,
    });
  }

  async ensureConfigLoaded(): Promise<McpConfig | null> {
    if (!this.config) {
      return this.loadConfig();
    }
    return this.config;
  }

  async loadConfig(): Promise<McpConfig | null> {
    if (!this.configPath) {
      logger?.warn("MCP config path not set. Call initialize() first.");
      return null;
    }

    try {
      // Load user-level (~/.wave/mcp.json) and project-level (<workdir>/.mcp.json)
      // configs, then merge with project taking precedence over user-level.
      const userConfig = await this.readConfigFile(this.userConfigPath);
      const projectConfig = await this.readConfigFile(this.configPath);

      // Neither file exists: preserve the original null contract (constructor-
      // provided servers may still be present in this.config).
      if (!userConfig && !projectConfig) {
        await this.hydrateToolsCache();
        return this.config;
      }

      const userResolved = userConfig
        ? resolveMcpConfig(userConfig, this.envSnapshot)
        : null;
      const projectResolved = projectConfig
        ? resolveMcpConfig(projectConfig, this.envSnapshot)
        : null;

      // Extract original (pre-resolution) URLs for safe display
      const originalUrls: Record<string, string | undefined> = {};
      for (const [name, serverConfig] of Object.entries({
        ...(userConfig?.mcpServers || {}),
        ...(projectConfig?.mcpServers || {}),
      })) {
        originalUrls[name] = serverConfig.url;
      }

      // Merge: existing config (e.g. plugin servers) -> user -> project -> constructor
      const merged: McpConfig = { mcpServers: {} };
      if (this.config) {
        Object.assign(merged.mcpServers, this.config.mcpServers);
      }
      if (userResolved) {
        Object.assign(merged.mcpServers, userResolved.mcpServers);
      }
      if (projectResolved) {
        Object.assign(merged.mcpServers, projectResolved.mcpServers);
      }
      if (this.mcpServers) {
        Object.assign(merged.mcpServers, this.mcpServers);
      }
      this.config = merged;

      // Initialize server statuses (preserve existing status for already known servers)
      if (this.config) {
        for (const [name, config] of Object.entries(this.config.mcpServers)) {
          const existingServer = this.servers.get(name);

          // Determine scope: plugin servers registered with pluginRoot keep
          // their plugin scope; user-level names come from ~/.wave/mcp.json.
          let scope: McpServerStatus["scope"] = existingServer?.scope;
          if (!scope) {
            if (config.pluginRoot) {
              scope = "plugin";
            } else if (userConfig?.mcpServers?.[name]) {
              scope = "user";
            } else {
              scope = "project";
            }
          }

          if (existingServer) {
            // Update config but preserve status and other runtime info
            this.servers.set(name, {
              ...existingServer,
              config, // Update config in case it changed
              originalUrl: originalUrls[name] ?? existingServer.originalUrl,
              scope,
            });
          } else {
            // New server, initialize with disconnected status
            this.servers.set(name, {
              name,
              config,
              originalUrl: originalUrls[name],
              scope,
              status: "disconnected",
            });
          }
        }
      }

      await this.hydrateToolsCache();
      return this.config;
    } catch (error) {
      // Only log error if it's not a "file not found" error
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        logger?.error("Failed to load MCP config:", error);
        // 配置整体加载失败（两个来源都成功读盘之后才可能走到这里）：
        // 不是某台服务器的问题，但同样让 MCP 能力整块消失。
        this.reportConnectionFailure("mcp-config", "config", {
          reason: "config",
          error,
        });
      }
      return null;
    }
  }

  /**
   * Attach the last-known tool snapshot to servers that are not connected
   * (spec ecosystem/mcp.md 场景 10-11).
   *
   * Runs on every config load, so a server whose command/args/env/url (or
   * workdir) changed loses its snapshot — the fingerprint no longer matches,
   * and the old tools are no longer trustworthy. A live connection owns the
   * truth: `tools` already holds the real list and `rememberTools()` keeps the
   * snapshot in step with it.
   */
  private async hydrateToolsCache(): Promise<void> {
    const cache = await readMcpToolsCache();
    for (const [name, server] of Array.from(this.servers.entries())) {
      if (this.connections.has(name)) continue;
      const entry =
        cache.servers[
          mcpToolsCacheKey(
            name,
            mcpConfigFingerprint(server.config, this.workdir),
          )
        ];
      const toolsFromCache = entry?.tools;
      const toolsCachedAt = entry?.cachedAt;
      if (
        server.toolsFromCache === toolsFromCache &&
        server.toolsCachedAt === toolsCachedAt
      ) {
        continue;
      }
      this.servers.set(name, { ...server, toolsFromCache, toolsCachedAt });
    }
  }

  /**
   * Persist a server's tool snapshot after a successful connection
   * (scenario 16: an empty list *overwrites* — a server that now exposes no
   * tools must not keep advertising the old ones).
   */
  private async rememberTools(name: string, tools: McpTool[]): Promise<void> {
    const server = this.servers.get(name);
    if (!server) return;
    const entry = await saveCachedTools({
      name,
      fingerprint: mcpConfigFingerprint(server.config, this.workdir),
      workdir: this.workdir,
      tools,
      configuredNames: this.servers.keys(),
    });
    const current = this.servers.get(name) ?? server;
    this.servers.set(name, {
      ...current,
      toolsFromCache: entry.tools,
      toolsCachedAt: entry.cachedAt,
    });
  }

  /**
   * Read a raw MCP config file, tolerating ENOENT and corrupt JSON.
   */
  private async readConfigFile(configPath: string): Promise<McpConfig | null> {
    if (!configPath) return null;
    try {
      const content = await fs.readFile(configPath, "utf-8");
      return JSON.parse(content) as McpConfig;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return null;
      logger?.error("Failed to load .mcp.json:", error);
      // Name the file that actually failed: the user-level config and the
      // project's `.mcp.json` are two different sources, and a report that
      // calls both `.mcp.json` cannot tell which one to fix.
      this.reportConnectionFailure(basename(configPath), "config", {
        // An unreadable or unparsable config file is a config problem, whether
        // the disk or the JSON was at fault: either way MCP is gone until the
        // file is fixed.
        reason: "config",
        error,
      });
      return null;
    }
  }

  /**
   * The user-level MCP config path (~/.wave/mcp.json).
   */
  getUserConfigPath(): string {
    return this.userConfigPath;
  }

  /**
   * The project-level MCP config path (<workdir>/.mcp.json).
   */
  getProjectConfigPath(): string {
    return this.configPath;
  }

  async saveConfig(config: McpConfig): Promise<boolean> {
    try {
      await fs.writeFile(this.configPath, JSON.stringify(config, null, 2));
      this.config = config;
      return true;
    } catch (error) {
      logger?.error("Failed to save .mcp.json:", error);
      return false;
    }
  }

  getConfig(): McpConfig | null {
    return this.config;
  }

  getAllServers(): McpServerStatus[] {
    return Array.from(this.servers.values());
  }

  getServer(name: string): McpServerStatus | undefined {
    return this.servers.get(name);
  }

  /**
   * The usage notes each usable server described about itself (`initialize`'s
   * `instructions`), for the announcement appended to the conversation.
   *
   * "Usable" is the same predicate `getAllConnectedTools` uses — connected, or
   * reconnecting with its last-known snapshot retained — so a server's prose is
   * visible exactly while its tools are. A server that dropped, failed to connect
   * or went to `error` keeps its snapshot but stops being reported here, which is
   * what keeps a dead server from still talking to the model.
   *
   * `isDenied` receives flattened tool names (`mcp__server__tool`, the shape
   * permission rules match on); a server whose tools are *all* excluded by rules is
   * dropped whole, so prose cannot reach the context after the user ruled the
   * server out. A server exposing no tools at all is still reported: nothing was
   * excluded, it is simply a server that brings context rather than tools.
   *
   * "Not usable" is not the same as "gone": a server that is still dialing is in
   * neither set, which `getPendingServerNames()` reports separately so the
   * announcement does not turn a slow dial into a departure.
   */
  getServerInstructions(
    isDenied?: (toolName: string) => boolean,
  ): Array<{ name: string; instructions: string }> {
    const result: Array<{ name: string; instructions: string }> = [];
    for (const server of this.servers.values()) {
      const usable =
        server.status === "connected" || server.status === "reconnecting";
      const instructions = server.instructions?.trim();
      if (!usable || !instructions) continue;
      const tools = server.tools ?? [];
      if (
        tools.length > 0 &&
        tools.every((tool) =>
          isDenied?.(mcpToolFlatName(server.name, tool.name)),
        )
      ) {
        continue;
      }
      result.push({ name: server.name, instructions });
    }
    return result;
  }

  /**
   * Servers that are neither available nor gone: still dialing (or waiting for
   * their recovery dial to run).
   *
   * The announcement path needs this third bucket. It computes "departed" as
   * `announced - available`, and a server that is mid-dial is in neither set —
   * so without the exemption, a server that is merely slow would be announced
   * as "已下线" and announced again when it connects. Claude Code excludes
   * `pending` from its `mcp_instructions_delta` for exactly that reason
   * (`0766:115797-115799`).
   */
  getPendingServerNames(): string[] {
    const pending: string[] = [];
    for (const [name, server] of this.servers) {
      if (this.connections.has(name)) continue;
      if (server.status === "connecting" || this.pendingDials.has(name)) {
        pending.push(name);
      }
    }
    return pending;
  }

  updateServerStatus(name: string, updates: Partial<McpServerStatus>): void {
    const server = this.servers.get(name);
    if (server) {
      this.servers.set(name, { ...server, ...updates });
      // Trigger state change callback
      this.callbacks.onMcpServersChange?.(this.getAllServers());
    }
  }

  addServer(name: string, config: McpServerConfig): boolean {
    if (this.servers.has(name)) {
      return false;
    }

    // Capture original URL before any resolution for safe display
    const originalUrl = config.url;

    // Expand env vars against the session snapshot (over OS env, e.g. ${TAVILY_API_KEY})
    const env = this.envSnapshot;
    const resolvedConfig: McpServerConfig = { ...config };
    if (resolvedConfig.command) {
      resolvedConfig.command = expandEnvVars(resolvedConfig.command, env);
    }
    if (resolvedConfig.args) {
      resolvedConfig.args = resolvedConfig.args.map((a) =>
        expandEnvVars(a, env),
      );
    }
    if (resolvedConfig.env) {
      const resolvedEnv: Record<string, string> = {};
      for (const [key, val] of Object.entries(resolvedConfig.env)) {
        resolvedEnv[key] = expandEnvVars(val, env);
      }
      resolvedConfig.env = resolvedEnv;
    }
    if (resolvedConfig.url) {
      resolvedConfig.url = expandEnvVars(resolvedConfig.url, env);
    }
    if (resolvedConfig.headers) {
      const resolvedHeaders: Record<string, string> = {};
      for (const [key, val] of Object.entries(resolvedConfig.headers)) {
        resolvedHeaders[key] = expandEnvVars(val, env);
      }
      resolvedConfig.headers = resolvedHeaders;
    }

    const newServer: McpServerStatus = {
      name,
      config: resolvedConfig,
      originalUrl,
      scope: resolvedConfig.pluginRoot ? "plugin" : undefined,
      status: "disconnected",
    };

    this.servers.set(name, newServer);

    // Update config
    if (this.config) {
      this.config.mcpServers[name] = resolvedConfig;
    } else {
      this.config = {
        mcpServers: { [name]: resolvedConfig },
      };
    }

    return true;
  }

  removeServer(name: string): boolean {
    // Disconnect if connected
    if (this.connections.has(name)) {
      void this.disconnectServer(name);
    }

    const removed = this.servers.delete(name);

    if (removed && this.config) {
      delete this.config.mcpServers[name];
    }

    return removed;
  }

  /**
   * Drop every MCP server contributed by a plugin (matched on pluginRoot),
   * disconnecting each one. Needed instead of re-adding under the same name
   * because addServer refuses a name that is already registered.
   * Called by the in-place plugin reload path before re-registering.
   * @returns the number of servers removed
   */
  removeServersForPlugin(pluginRoot: string): number {
    let removed = 0;
    for (const [name, server] of Array.from(this.servers.entries())) {
      if (server.config.pluginRoot !== pluginRoot) {
        continue;
      }
      this.removeServer(name);
      removed += 1;
    }
    if (removed > 0) {
      logger?.debug(
        `Removed ${removed} MCP servers for plugin root ${pluginRoot}`,
      );
    }
    return removed;
  }

  /**
   * Remove a server from a persisted config file (user or project scope),
   * then disconnect and drop it from the in-memory registry.
   * @param scope - "user" removes from ~/.wave/mcp.json; "project" removes from <workdir>/.mcp.json
   * @param name - The server name
   * @returns true if the server was found and removed
   */
  async removeServerFromConfig(
    scope: "user" | "project",
    name: string,
  ): Promise<boolean> {
    const configPath = scope === "user" ? this.userConfigPath : this.configPath;
    if (!configPath) return false;

    const rawConfig = await this.readConfigFile(configPath);
    if (
      !rawConfig ||
      !rawConfig.mcpServers ||
      !(name in rawConfig.mcpServers)
    ) {
      return false;
    }

    delete rawConfig.mcpServers[name];

    if (Object.keys(rawConfig.mcpServers).length === 0) {
      await fs.rm(configPath, { force: true });
    } else {
      await fs.writeFile(configPath, JSON.stringify(rawConfig, null, 2));
    }

    // Drop from memory (disconnects if connected)
    this.removeServer(name);
    return true;
  }

  // Real MCP connection implementation
  //
  // `manual` marks a user-initiated connect (settings page / `/mcp` / CLI), the
  // only way to override a previous explicit disconnect. Everything else —
  // automatic dial, auto-reconnect — must respect that decision.
  /**
   * Dial one server.
   *
   * Answers `McpDialOutcome` rather than a boolean: the four "we never tried"
   * paths and the "it connected but its owner was already destroyed" race have
   * to stay distinguishable from a real failure, so the caller can report a
   * failure only when there was one, and with its reason attached. A dial never
   * throws either way — a failure is a server status, not a turn failure.
   *
   * The boolean the SDK surface wants (`Agent.connectMcpServer`) is `.ok`.
   */
  async connectServer(name: string, manual = false): Promise<McpDialOutcome> {
    const server = this.servers.get(name);
    if (!server) {
      logger?.debug(
        `MCP server ${name} was not dialed: ${SKIP_REASON_TEXT.not_registered}`,
      );
      return { ok: false, kind: "skipped", skip: "not_registered" };
    }

    // Already connected
    if (this.connections.has(name)) return { ok: true };

    // An explicit disconnectServer teardown is in flight for this server —
    // don't race it (e.g. an auto-reconnect timer that just fired) by spawning
    // a fresh process the user asked to stop.
    if (this.disconnecting.has(name)) {
      logger?.debug(
        `MCP server ${name} was not dialed: ${SKIP_REASON_TEXT.disconnecting}`,
      );
      return { ok: false, kind: "skipped", skip: "disconnecting" };
    }

    // A destroyed manager must never spawn another process (spec
    // ecosystem/mcp.md 边界情况「拨号与销毁竞态」): the Agent's teardown already
    // ran, so nothing would ever reap what we spawn here.
    if (this.destroyed) {
      logger?.debug(
        `MCP server ${name} was not dialed: ${SKIP_REASON_TEXT.destroyed}`,
      );
      return { ok: false, kind: "skipped", skip: "destroyed" };
    }

    if (manual) {
      this.userDisconnected.delete(name);
    } else if (this.userDisconnected.has(name)) {
      // The user's explicit disconnect wins over an automatic dial. Not a
      // failure: they asked for this state.
      logger?.debug(
        `MCP server ${name} was not dialed: ${SKIP_REASON_TEXT.user_disconnected}`,
      );
      return { ok: false, kind: "skipped", skip: "user_disconnected" };
    }

    this.updateServerStatus(name, { status: "connecting" });

    // Declared outside `try` so a failure *after* the process was spawned (a
    // handshake or `listTools()` that throws) still tears the process down
    // instead of leaving an orphan tree nothing points at.
    let transport: Transport | undefined;
    let client: Client | undefined;
    // Where the dial currently is. The handshake and `listTools()` fail for
    // different reasons and the error does not say which one threw, so the
    // stage is tracked here and handed to the classifier.
    let stage: McpDialStage = "connect";

    try {
      let tools: McpTool[] = [];
      // Server-level usage notes from `initialize`; part of the connection's
      // handshake, so it is read once here rather than re-requested later.
      let instructions: string | undefined;

      const createClient = () =>
        new Client(
          {
            name: "wave-code",
            version: "1.0.0",
          },
          {
            capabilities: {},
          },
        );

      const serverType = server.config.type;

      if (serverType === "http" || (!serverType && server.config.url)) {
        if (!server.config.url) {
          throw new McpConfigError(
            `MCP server ${name} with type "http" requires a 'url'`,
          );
        }
        const url = new URL(server.config.url);
        const headers = server.config.headers;
        logger?.debug(
          `Connecting to MCP server ${name} using Streamable HTTP at ${url.href}`,
        );
        transport = new StreamableHTTPClientTransport(url, {
          requestInit: { headers },
        });
        client = createClient();
        await client.connect(transport);
        instructions = truncateMcpInstructions(client.getInstructions());
        stage = "list_tools";
        const toolsResponse = await client.listTools();
        tools =
          toolsResponse.tools?.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema,
            _meta: tool._meta,
          })) || [];
        logger?.info(`Connected to MCP server ${name} using Streamable HTTP`);
      } else if (serverType === "sse") {
        if (!server.config.url) {
          throw new McpConfigError(
            `MCP server ${name} with type "sse" requires a 'url'`,
          );
        }
        const url = new URL(server.config.url);
        const headers = server.config.headers;
        logger?.debug(
          `Connecting to MCP server ${name} using SSE at ${url.href}`,
        );
        transport = new SSEClientTransport(url, {
          requestInit: { headers },
        });
        client = createClient();
        await client.connect(transport);
        instructions = truncateMcpInstructions(client.getInstructions());
        stage = "list_tools";
        const toolsResponse = await client.listTools();
        tools =
          toolsResponse.tools?.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema,
            _meta: tool._meta,
          })) || [];
        logger?.info(`Connected to MCP server ${name} using SSE`);
      } else if (
        serverType === "stdio" ||
        (!serverType && server.config.command)
      ) {
        if (!server.config.command) {
          throw new McpConfigError(
            `MCP server ${name} with type "stdio" requires a 'command'`,
          );
        }

        // Base env = OS env overlaid with this session's settings snapshot, so
        // custom env vars from settings.json reach the MCP server subprocess
        // without polluting other sessions sharing one `wave --stdio` process.
        const env: Record<string, string> = {
          ...this.envSnapshot,
          ...(server.config.env || {}),
        };

        // For plugin servers, substitute ${WAVE_PLUGIN_ROOT} and ${CLAUDE_PLUGIN_ROOT}
        let command = server.config.command;
        let args = server.config.args || [];
        if (server.config.pluginRoot) {
          env.WAVE_PLUGIN_ROOT = server.config.pluginRoot;
          env.CLAUDE_PLUGIN_ROOT = server.config.pluginRoot;
          command = command.replace(
            /\$\{WAVE_PLUGIN_ROOT\}/g,
            server.config.pluginRoot,
          );
          command = command.replace(
            /\$\{CLAUDE_PLUGIN_ROOT\}/g,
            server.config.pluginRoot,
          );
          args = args.map((arg) => {
            let result = arg.replace(
              /\$\{WAVE_PLUGIN_ROOT\}/g,
              server.config.pluginRoot!,
            );
            result = result.replace(
              /\$\{CLAUDE_PLUGIN_ROOT\}/g,
              server.config.pluginRoot!,
            );
            return result;
          });
          // Also expand plugin root in user-provided env values
          for (const [key, value] of Object.entries(server.config.env || {})) {
            let expanded = value.replace(
              /\$\{WAVE_PLUGIN_ROOT\}/g,
              server.config.pluginRoot!,
            );
            expanded = expanded.replace(
              /\$\{CLAUDE_PLUGIN_ROOT\}/g,
              server.config.pluginRoot!,
            );
            env[key] = expanded;
          }
        }
        transport = new StdioClientTransport({
          command,
          args,
          env,
          cwd: this.workdir, // Use the agent's workdir as the process working directory
          stderr: "pipe", // Pipe stderr to capture it
        });

        // Buffer stderr silently (MCP servers use stderr for all logging;
        // stdout is reserved for JSON-RPC). Only dump it on connection
        // success (once) or failure — not line-by-line in real time.
        // Aligns with Claude Code's approach to avoid noise from [INFO],
        // [DEBUG], Warning: lines that are not actual errors.
        const stderr = (transport as StdioClientTransport).stderr;
        let stderrOutput = "";
        if (stderr) {
          stderr.on("data", (chunk: Buffer) => {
            if (stderrOutput.length < 64 * 1024 * 1024) {
              stderrOutput += chunk.toString();
            }
          });
        }

        client = createClient();
        try {
          await client.connect(transport);
        } catch (error) {
          if (stderrOutput.trim()) {
            logger?.error(
              `[MCP Server ${name}] Server stderr: ${stderrOutput.trim()}`,
            );
          }
          throw error;
        }

        // Dump accumulated stderr once after successful connection
        if (stderrOutput.trim()) {
          logger?.debug(
            `[MCP Server ${name}] Server stderr: ${stderrOutput.trim()}`,
          );
          stderrOutput = "";
        }

        instructions = truncateMcpInstructions(client.getInstructions());
        stage = "list_tools";
        const toolsResponse = await client.listTools();
        tools =
          toolsResponse.tools?.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema,
            _meta: tool._meta,
          })) || [];
      } else if (serverType) {
        // Unknown type value
        throw new McpConfigError(
          `MCP server ${name} has unknown type "${serverType}". Must be "stdio", "sse", or "http"`,
        );
      } else {
        throw new McpConfigError(
          `MCP server ${name} configuration must include either 'command' or 'url'`,
        );
      }

      // Both are assigned on every path that gets here (the branches above
      // either set them or throw); binding them to consts lets the closures
      // below — onerror / onclose — see non-optional values.
      const connectedClient: Client = client;
      const connectedTransport: Transport = transport;

      // A transport error is **not** a terminal state
      // (spec ecosystem/mcp.md 边界情况「下行通知流（SSE GET）断开不等于服务器不可用」).
      // What arrives here is a dead downstream stream — SSE GET body timeout
      // (`Body Timeout Error`), `terminated`, or the SDK giving up on its own
      // reconnection — while `tools/call` is a separate POST that still works.
      // So the server stays `connected` and its tools keep being declared; the
      // error is only counted, and `MCP_TRANSPORT_ERROR_LIMIT` of them in a row
      // recycle the connection (close → `onclose` → throttled redial).
      transport.onerror = (error: Error) => {
        const message = error?.message ?? String(error);
        const count = (this.transportErrors.get(name) ?? 0) + 1;
        this.transportErrors.set(name, count);
        if (isDownstreamStreamError(message)) {
          this.messageStreamLost.add(name);
          logger?.warn(
            `MCP Server ${name} lost its notification stream (${count}/${MCP_TRANSPORT_ERROR_LIMIT}); the server stays usable: ${message}`,
          );
        } else {
          logger?.warn(
            `MCP Server ${name} transport error (${count}/${MCP_TRANSPORT_ERROR_LIMIT}); the server stays usable: ${message}`,
          );
        }
        if (count < MCP_TRANSPORT_ERROR_LIMIT) return;
        // Third in a row: recycle. The teardown queues behind in-flight calls so
        // a `sendFile` that is already on the wire is never cut in half.
        this.recycleConnection(name, connectedTransport);
      };

      transport.onclose = () => {
        logger?.debug(`MCP Server ${name} transport closed`);
        // Only the current generation of this server's transport may mutate
        // state: a stale process 'close' arriving after an auto-reconnect must
        // not tear down (or schedule a reconnect for) the live connection.
        const current = this.connections.get(name);
        if (!current || current.transport !== transport) return;
        this.connections.delete(name);
        this.resetTransportHealth(name);
        this.markServerGone(name);
        // Auto-reconnect with exponential backoff. Skipped while an explicit
        // disconnectServer teardown is in flight — that close is expected, and
        // reconnecting would silently undo a user-initiated disconnect.
        if (!this.disconnecting.has(name) && !this.reconnectTimers.has(name)) {
          this.scheduleReconnect(name);
        }
      };

      // Store connection
      this.connections.set(name, {
        client: connectedClient,
        transport: connectedTransport,
        process: null,
      });

      // The dial outlived the Agent it was dialing for (spec
      // ecosystem/mcp.md「拨号与销毁竞态」): `cleanup()` can cancel timers but
      // cannot see a handshake in flight, so the ownership check has to happen
      // here — whatever this dial produced must be reaped immediately, or it
      // becomes a process tree nobody owns.
      if (this.destroyed) {
        logger?.debug(
          `MCP server ${name} connected after its owner was destroyed; closing it`,
        );
        this.connections.delete(name);
        await this.closeConnection(name, {
          client: connectedClient,
          transport: connectedTransport,
        });
        this.updateServerStatus(name, { status: "disconnected" });
        // The connection itself succeeded — only its owner was gone. Reporting
        // this as "failed to connect" would be the opposite of what happened
        // (and would pollute the failure rate with a shutdown race), so it
        // gets its own outcome: abandoned, not failed.
        return { ok: false, kind: "abandoned" };
      }

      // A fresh transport starts with a clean slate: no leftover error count, and
      // no leftover backoff — the server is back.
      this.resetTransportHealth(name);
      this.reconnectAttempts.delete(name);
      this.reconnectEligibleAt.delete(name);

      // Update status
      this.updateServerStatus(name, {
        status: "connected",
        tools,
        toolCount: tools.length,
        capabilities: ["tools"],
        instructions,
        lastConnected: Date.now(),
        error: undefined,
      });
      // Refresh the display snapshot the panel falls back to while this server
      // is not connected (spec ecosystem/mcp.md 场景 16).
      await this.rememberTools(name, tools);

      return { ok: true };
    } catch (error) {
      // The full message stays here, in the local log — telemetry gets the
      // sanitized summary built by `reportConnectionFailure`.
      logger?.error(`Failed to connect to MCP server ${name}:`, error);
      const reason = classifyMcpFailure(error, stage);
      // The process may already be spawned (a handshake or `listTools()` that
      // threw after `connect()`), and nothing else will ever reference it —
      // tear it down here rather than leaking a tree per failed dial.
      if (transport) {
        await this.closeConnection(name, { client, transport }).catch(() => {
          /* best-effort */
        });
      }
      // A failed dial is throttled, not final: the next turn's
      // `recoverServers()` retries it once the backoff window has expired.
      this.noteReconnectFailure(name);
      // updateServerStatus will trigger the callback
      this.updateServerStatus(name, {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      return { ok: false, kind: "failed", reason, error };
    }
  }

  /**
   * Close a connection and make sure its whole process tree is gone.
   *
   * The MCP SDK's stdio `close()` only ends stdin and signals the **direct**
   * child, so `uvx → uv → server → python×2` can lose its root and leave the
   * rest running (spec ecosystem/mcp.md 边界情况「断开后整树终止」). On Windows
   * the tree kill has to come first: once `uvx` is gone, its children are
   * re-parented and `taskkill /PID <pid> /T /F` has no tree left to walk.
   */
  private async closeConnection(
    name: string,
    connection: { client?: Client; transport: Transport },
  ): Promise<void> {
    const pid = transportPid(connection.transport);

    const close = async () => {
      try {
        await connection.client?.close();
      } catch (error) {
        logger?.debug(`Error closing MCP client ${name}:`, error);
      }
      try {
        await connection.transport.close();
      } catch (error) {
        logger?.debug(`Error closing MCP transport ${name}:`, error);
      }
    };

    // Concurrent with the close, not before it: the taskkill lands while the
    // direct child is still alive (the ordering Windows needs), and the SDK's
    // own post-exit wait overlaps it instead of adding to it.
    const kill = pid
      ? killProcessTree(pid, "SIGKILL").then((result) => {
          if (result === "failed") {
            logger?.warn(
              `MCP server ${name}: could not terminate process tree rooted at ${pid}`,
            );
          }
        })
      : Promise.resolve();

    await Promise.all([kill, close()]);
  }

  /** Report the server as gone, keeping the last-known snapshot out of the model's hands. */
  private markServerGone(name: string): void {
    this.updateServerStatus(name, {
      status: "disconnected",
      tools: [],
      toolCount: 0,
      instructions: undefined,
    });
  }

  /** Forget everything about the current transport generation's health. */
  private resetTransportHealth(name: string): void {
    this.transportErrors.delete(name);
    this.messageStreamLost.delete(name);
  }

  /** Count one tool call in flight, so a teardown can wait for it. */
  private beginCall(name: string): void {
    this.callsInProgress.set(name, (this.callsInProgress.get(name) ?? 0) + 1);
  }

  /** One tool call is over; wake whoever is waiting for the count to hit zero. */
  private endCall(name: string): void {
    const remaining = (this.callsInProgress.get(name) ?? 1) - 1;
    if (remaining > 0) {
      this.callsInProgress.set(name, remaining);
      return;
    }
    this.callsInProgress.delete(name);
    const waiters = this.callDrainWaiters.get(name);
    this.callDrainWaiters.delete(name);
    for (const wake of waiters ?? []) wake();
  }

  /**
   * Resolve when this server has no tool call in flight, or after
   * `MCP_CALLS_DRAIN_TIMEOUT_MS` — whichever comes first. Returns whether the
   * drain actually finished.
   */
  private waitForCallsToDrain(name: string): Promise<boolean> {
    if ((this.callsInProgress.get(name) ?? 0) === 0) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (drained: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(drained);
      };
      const waiters = this.callDrainWaiters.get(name) ?? [];
      waiters.push(() => settle(true));
      this.callDrainWaiters.set(name, waiters);
      const timer = setTimeout(() => settle(false), MCP_CALLS_DRAIN_TIMEOUT_MS);
      // Waiting for a drained call is not a reason for the process to stay up.
      timer.unref?.();
    });
  }

  /**
   * Queue one connection recycle after `MCP_TRANSPORT_ERROR_LIMIT` consecutive
   * transport errors: wait for in-flight calls, close the transport, and let the
   * normal close path redial it under the backoff.
   */
  private recycleConnection(name: string, transport: Transport): void {
    if (this.recycling.has(name)) return;
    this.recycling.add(name);
    void this.recycleConnectionWhenIdle(name, transport).finally(() => {
      this.recycling.delete(name);
    });
  }

  private async recycleConnectionWhenIdle(
    name: string,
    transport: Transport,
  ): Promise<void> {
    if ((this.callsInProgress.get(name) ?? 0) > 0) {
      logger?.info(
        `MCP server ${name}: waiting for in-flight tool calls before recycling the connection`,
      );
      const drained = await this.waitForCallsToDrain(name);
      if (!drained) {
        logger?.warn(
          `MCP server ${name}: in-flight tool calls did not finish within ${MCP_CALLS_DRAIN_TIMEOUT_MS}ms; recycling anyway`,
        );
      }
    }

    // Generation check *after* the wait: a dial that already replaced this
    // transport (or a user teardown that closed it) owns the state now.
    const connection = this.connections.get(name);
    if (!connection || connection.transport !== transport) return;

    logger?.warn(
      `MCP server ${name}: recycling the connection after ${MCP_TRANSPORT_ERROR_LIMIT} consecutive transport errors`,
    );
    // Drop it from the map first: the transport's own `onclose` then sees a
    // stale generation and stays quiet, so the state below is written exactly
    // once (a double update would announce the server gone twice).
    this.connections.delete(name);
    await this.closeConnection(name, connection).catch((error) => {
      logger?.debug(`Error closing MCP connection ${name}:`, error);
    });
    this.resetTransportHealth(name);
    this.markServerGone(name);
    if (
      !this.destroyed &&
      !this.disconnecting.has(name) &&
      !this.userDisconnected.has(name) &&
      !this.reconnectTimers.has(name)
    ) {
      this.scheduleReconnect(name);
    }
  }

  /**
   * Backoff before the next automatic dial, `failures` being the number of
   * consecutive failures already recorded: 10s, 20s, 40s, … capped at 300s, and
   * once the attempt budget is spent one 600s cooldown (Claude Code 2.1.331's
   * `1115:288-293`). Nothing here is a terminal state — the cooldown merely
   * ends, and the next turn after it redials.
   */
  private reconnectDelay(failures: number): number {
    if (failures >= MCP_RECONNECT_MAX_ATTEMPTS) {
      return MCP_RECONNECT_COOLDOWN_MS;
    }
    return Math.min(
      MCP_RECONNECT_BASE_DELAY_MS * Math.pow(2, Math.max(0, failures - 1)),
      MCP_RECONNECT_MAX_DELAY_MS,
    );
  }

  /**
   * Record one failed dial: bump the attempt count and open a new throttle
   * window. Failures are only throttled — they never make a server permanently
   * unusable, which is what `error` used to mean.
   */
  private noteReconnectFailure(name: string): void {
    const failures = (this.reconnectAttempts.get(name) ?? 0) + 1;
    this.reconnectAttempts.set(name, failures);
    this.reconnectEligibleAt.set(
      name,
      Date.now() + this.reconnectDelay(failures),
    );
  }

  /**
   * Redial the servers this turn may need that are currently down
   * (spec ecosystem/mcp.md「使用前重拨」, Claude Code 2.1.331's
   * `ensureConnectedClient`).
   *
   * Idempotent, never throws, and never blocks the turn: only servers whose
   * throttle window has expired are picked up (`reconnectDelay()`), the dial
   * runs in the background so it adds no wait to this turn, and a server the
   * user disconnected is never resurrected (场景 9).
   */
  recoverServers(): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    const targets = this.recoveryTargets();
    if (targets.length === 0) return Promise.resolve();
    return this.runDialBatch(
      targets.map((name) =>
        this.scheduleDial(name, "lazy", { background: true }),
      ),
    );
  }

  /**
   * Servers that are down, were already dialed once, and whose throttle window
   * has expired. A server still waiting for its *first* dial is not here: that
   * dial belongs to the startup pass (`pendingDialTargets()`).
   */
  private recoveryTargets(): string[] {
    const now = Date.now();
    const targets: string[] = [];
    for (const [name, server] of this.servers) {
      if (server.status !== "error" && server.status !== "disconnected") {
        continue;
      }
      if (this.connections.has(name)) continue;
      if (this.pendingDials.has(name)) continue;
      if (this.disconnecting.has(name)) continue;
      if (this.userDisconnected.has(name)) continue;
      if (this.reconnectTimers.has(name)) continue;
      if (!this.reconnectEligibleAt.has(name)) continue;
      if (now < (this.reconnectEligibleAt.get(name) ?? 0)) continue;
      targets.push(name);
    }
    return targets;
  }

  /**
   * Schedule a redial with the backoff from `reconnectDelay()`.
   *
   * A failed attempt does not reschedule itself here: recovery is driven by
   * `recoverServers()` before a turn, so a server nobody uses is not a process
   * tree spawned every few minutes (Claude Code has no reconnect timer at all).
   */
  private scheduleReconnect(name: string): void {
    if (this.destroyed) return;
    if (this.disconnecting.has(name) || this.userDisconnected.has(name)) return;
    if (this.reconnectTimers.has(name)) return;
    const attempts = (this.reconnectAttempts.get(name) ?? 0) + 1;
    const delay = this.reconnectDelay(attempts);
    this.reconnectAttempts.set(name, attempts);
    this.reconnectEligibleAt.set(name, Date.now() + delay);

    logger?.info(
      `Scheduling MCP server ${name} reconnect in ${delay}ms (attempt ${attempts})`,
    );

    const timer = setTimeout(() => {
      this.reconnectTimers.delete(name);
      // The Agent was torn down while this backoff was pending — reconnecting
      // would spawn a tree with no owner.
      if (this.destroyed) return;
      // The user may have disconnected while this timer was pending; that
      // decision always wins over an automatic redial.
      if (this.disconnecting.has(name) || this.userDisconnected.has(name)) {
        return;
      }
      logger?.debug(`Auto-reconnecting MCP server: ${name}`);
      this.connectServer(name)
        .then((outcome) => {
          if (outcome.ok) {
            logger?.info(`Auto-reconnected MCP server: ${name}`);
            this.reconnectAttempts.delete(name);
            this.reconnectEligibleAt.delete(name);
          } else {
            // The failure already advanced the throttle window; the next turn
            // (`recoverServers()`) picks it up.
            logger?.warn(`Auto-reconnect failed for MCP server: ${name}`);
          }
        })
        .catch((error) => {
          logger?.error(`Auto-reconnect error for MCP server ${name}:`, error);
        });
    }, delay);

    // A pending redial must not be a reason for the process to stay up.
    timer.unref?.();
    this.reconnectTimers.set(name, timer);
  }

  private cancelReconnect(name: string): void {
    const timer = this.reconnectTimers.get(name);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(name);
    }
    this.reconnectAttempts.delete(name);
    this.reconnectEligibleAt.delete(name);
    this.resetTransportHealth(name);
  }

  async disconnectServer(name: string): Promise<boolean> {
    // Cancel any pending reconnect attempts
    this.cancelReconnect(name);

    const server = this.servers.get(name);
    const connection = this.connections.get(name);

    // Nothing live to tear down. Still reconcile a stale "connected"-style
    // status (e.g. after an unobserved crash left no connection entry) so the
    // UI converges instead of staying wedged on a disconnect action.
    if (!connection) {
      if (server && server.status !== "disconnected") {
        this.updateServerStatus(name, {
          status: "disconnected",
          tools: [],
          toolCount: 0,
          instructions: undefined,
          error: undefined,
        });
      }
      return false;
    }

    // Idempotent: a teardown is already running for this server.
    if (this.disconnecting.has(name)) return false;

    // Mark before closing so transport.onclose knows this is an expected,
    // user-initiated teardown and must not schedule an auto-reconnect.
    this.disconnecting.add(name);
    // Remember the decision: a later turn's automatic dial must not resurrect it.
    this.userDisconnected.add(name);
    try {
      // Close the client/transport *and* the whole process tree it spawned.
      await this.closeConnection(name, connection);

      // Remove connection (transport.onclose may already have done so)
      if (this.connections.get(name) === connection) {
        this.connections.delete(name);
      }

      // updateServerStatus will trigger the callback
      this.updateServerStatus(name, {
        status: "disconnected",
        tools: [],
        toolCount: 0,
        instructions: undefined,
        error: undefined,
      });

      return true;
    } catch (error) {
      logger?.error(`Error disconnecting from MCP server ${name}:`, error);
      // Never leave the server reporting connected after a failed teardown:
      // drop the connection and push a terminal state so the caller/UI gets a
      // definitive outcome instead of an endless "disconnecting" spinner.
      if (this.connections.get(name) === connection) {
        this.connections.delete(name);
      }
      this.updateServerStatus(name, {
        status: "disconnected",
        tools: [],
        toolCount: 0,
        instructions: undefined,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      this.disconnecting.delete(name);
    }
  }

  // Get all tools from connected servers.
  // "reconnecting" servers retain their last-known tool snapshot so that
  // transient SSE disconnects don't churn the tool list (which would bust
  // the prompt cache). Tools are only dropped once the server truly fails
  // (status "error"/"disconnected").
  getAllConnectedTools(): McpTool[] {
    const allTools: McpTool[] = [];
    for (const server of this.servers.values()) {
      const usable =
        server.status === "connected" || server.status === "reconnecting";
      if (usable && server.tools) {
        allTools.push(...server.tools);
      }
    }
    return allTools;
  }

  // Execute MCP tool
  async executeMcpTool(
    toolName: string,
    args: Record<string, unknown>,
    context?: ToolContext,
  ): Promise<McpToolCallResult> {
    // PostToolUse 的 `duration_ms`（CC 的 `0172:9984`）从这里起算：进漏斗之后
    // 的一切都算，与内置工具那条路的口径一致。
    const startedAt = Date.now();
    // Check if it's a prefixed name: mcp__[serverName]__[toolName]
    if (!toolName.startsWith("mcp__")) {
      throw new Error(
        `Invalid MCP tool name: ${toolName}. Must start with 'mcp__'`,
      );
    }

    // PreToolUse hooks run before the permission check, exactly as they do for
    // a built-in: a hook that refuses the call means the user is never asked.
    // This is the one funnel every MCP call goes through — flat as well as
    // nested, from inside the REPL sandbox — so hooks cannot be skipped by
    // reaching a tool through the pool.
    if (context?.hookManager) {
      const blocked = await context.hookManager.executePreToolUseHooks(
        toolName,
        args,
        context,
      );
      if (blocked) {
        // The MCP contract reports failures by throwing; a block travels the
        // same route and is told apart by its class, so the funnels can show
        // the model the hook's wording rather than "tool failed".
        throw new HookBlockedToolError(blocked);
      }
    }

    // Permission check
    if (context?.permissionManager) {
      const permissionContext = context.permissionManager.createContext(
        toolName,
        context.permissionMode || "default",
        context.canUseToolCallback,
        args,
        context.toolCallId,
      );

      const decision =
        await context.permissionManager.checkPermission(permissionContext);
      if (decision.behavior === "deny") {
        throw new Error(decision.message || "Permission denied");
      }
    }

    const parts = toolName.split("__");
    if (parts.length < 3) {
      throw new Error(
        `Invalid MCP tool name format: ${toolName}. Expected 'mcp__[server]__[tool]'`,
      );
    }

    const targetServerName = parts[1];
    const actualToolName = parts.slice(2).join("__");

    const server = this.servers.get(targetServerName);
    if (server && server.status === "connected" && server.tools) {
      const tool = server.tools.find((t) => t.name === actualToolName);
      if (tool) {
        const connection = this.connections.get(targetServerName);
        if (connection) {
          try {
            const result = await this.executeToolOnConnection(
              connection,
              actualToolName,
              args,
              targetServerName,
              context?.abortSignal,
            );
            // `tool_response` 拿 `data`（CC 的 MCP Output：服务端 content 块数组，
            // 见 `McpToolCallResult.data`）；`mcp_server` 只在真 MCP 调用时给
            // （CC 的 `0172:9985`），值是 `{ name, source }`。
            await context?.hookManager?.executePostToolUseHooks(
              toolName,
              args,
              { success: true, content: result.content, data: result.data },
              context,
              {
                toolUseId: context?.toolCallId,
                durationMs: Date.now() - startedAt,
                mcpServer: {
                  name: targetServerName,
                  // CC 没有 scope 时填 `dynamic`（`O2r()`，`0278:54`）；我们
                  // 的 `scope` 只在配置文件里认出来的服务器上才有。
                  source: server.scope ?? "dynamic",
                },
              },
            );
            // A PR/MR created by an MCP tool scores here rather than in
            // `ToolManager`: this is the one funnel every MCP call goes through,
            // so a nested call from inside the REPL sandbox counts too.
            recordToolActivity(detectMcpActivity(toolName), {
              sessionId: context?.sessionId,
              // The session's starting directory, not the shell-following one a
              // tool context carries (see `SessionWorkdir` in containerSetup).
              workdir:
                this.container.get<string>("SessionWorkdir") ??
                context?.workdir,
              entrypoint: entrypointOf(this.container),
            });
            return result;
          } catch (error) {
            await context?.hookManager?.executePostToolUseHooks(
              toolName,
              args,
              {
                success: false,
                content: "",
                error: error instanceof Error ? error.message : String(error),
              },
              context,
              {
                toolUseId: context?.toolCallId,
                durationMs: Date.now() - startedAt,
                mcpServer: {
                  name: targetServerName,
                  source: server.scope ?? "dynamic",
                },
              },
            );
            throw error;
          }
        }
      }
    }

    throw new Error(`Tool ${toolName} not found on any connected MCP server`);
  }

  private async executeToolOnConnection(
    connection: McpConnection,
    toolName: string,
    args: Record<string, unknown>,
    serverName: string,
    signal?: AbortSignal,
  ): Promise<McpToolCallResult> {
    // Counted so a connection recycle (third consecutive transport error) queues
    // behind this call instead of cutting it in half — the same reason Claude
    // Code waits for `callsInProgress === 0` before closing (`2990:7118-7121`).
    this.beginCall(serverName);
    try {
      // The signal travels so a cancelled call really stops: a REPL watchdog
      // aborts it, and holding the request open would keep the connection busy
      // for as long as the server takes to answer (see beginCall above).
      const result = await connection.client.callTool(
        { name: toolName, arguments: args },
        undefined,
        signal ? { signal } : undefined,
      );

      // Separate text content and image data
      const textContent: string[] = [];
      const images: Array<{ data: string; mediaType?: string }> = [];

      if (Array.isArray(result.content)) {
        result.content.forEach(
          (c: {
            type: string;
            text?: string;
            data?: string;
            mimeType?: string;
            resource?: { uri: string };
            [key: string]: unknown;
          }) => {
            if (c.type === "text") {
              textContent.push(c.text || "");
            } else if (c.type === "image" && c.data) {
              images.push({
                data: c.data,
                mediaType: c.mimeType || "image/png", // MCP standard mimeType, PNG fallback
              });
            } else if (c.type === "resource") {
              textContent.push(`[Resource: ${c.resource?.uri || ""}]`);
            } else {
              textContent.push(JSON.stringify(c, null, 2));
            }
          },
        );
      } else if (result.content) {
        textContent.push(String(result.content));
      }

      const textContentStr =
        textContent.length > 0
          ? textContent.join("\n")
          : images.length > 0
            ? `Tool returned ${images.length} image(s).`
            : "No content";

      // The sandbox's value, decided from the text parts rather than from
      // `textContentStr`: that one carries display placeholders ("No content"),
      // and a script has to be able to tell "the tool said nothing" (`null`) from
      // "the tool said 'No content'". Same rule a signature's return type is
      // rendered from: structured, else text, else null. The text is handed over
      // raw here; the REPL layer parses it when it is JSON (`replRuntime.ts`
      // `parseMcpText`), so a flat call still sees exactly what arrived.
      const text = textContent.join("\n");
      const output = result.structuredContent ?? (text === "" ? null : text);

      return {
        success: true,
        content: textContentStr,
        output,
        // `data`：CC 的 MCP 工具 Output 就是服务端原样回来的 content 块数组
        // （`0172:13043` 的 `CallToolResult`：`content` 数组 + `structuredContent`
        // + `_meta`）。`_meta` / `structuredContent` / `resourceLinks` 在 CC 的
        // 转录里是 `data` 的**兄弟**字段 `mcpMeta`（`0633:176917-176920` 的
        // `{ content, ...mcpMeta }`），我们的 `ToolResult` 没有这一格，所以这里
        // 只带 content 块。
        // 没有块（或服务端没给）时给 `null`，与上面 `output` 的「说了空就是
        // null」同一口径。双写下这一格会随工具块落盘（`ToolBlock.data`，图片块的
        // base64 已由 `resultData/strip.ts` 剥掉），同时供 PostToolUse 的
        // `tool_response` 与 REPL 脚本读。
        data: result.content ?? null,
        images: images.length > 0 ? images : undefined,
        serverName,
      };
    } catch (error) {
      throw new Error(
        `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.endCall(serverName);
    }
  }

  /**
   * Tear every connection down and make this manager permanently inert.
   *
   * Idempotent by contract (spec ecosystem/mcp.md 边界情况「销毁必须先于引用丢弃、
   * 且回收不得被前置失败阻断」): the callers drop their own reference to the Agent
   * before/while the teardown runs, so a second call — or a call after a partial
   * failure — has to be harmless rather than throwing.
   */
  async cleanup(): Promise<void> {
    // Inert first: nothing below may spawn a process, and an in-flight dial (see
    // connectServer's post-connect check) will close what it produced.
    this.destroyed = true;
    // Cancel all pending reconnect timers
    for (const name of this.reconnectTimers.keys()) {
      this.cancelReconnect(name);
    }
    const names = Array.from(this.connections.keys());
    await Promise.all(
      names.map((name) =>
        this.disconnectServer(name).catch((error) => {
          logger?.warn(`MCP server ${name} teardown failed:`, error);
          return false;
        }),
      ),
    );
    this.pendingDials.clear();
    this.backgroundDials.clear();
    // Nothing may wait on a drain after teardown: wake every queued recycle and
    // let its own generation check decide there is nothing left to close.
    for (const waiters of this.callDrainWaiters.values()) {
      for (const wake of waiters) wake();
    }
    this.callDrainWaiters.clear();
    this.callsInProgress.clear();
  }

  // ========== Tools Registry Methods ==========

  /**
   * Get all currently available MCP tools as plugins
   */
  getMcpToolPlugins(): ToolPlugin[] {
    const mcpTools = new Map<string, ToolPlugin>();

    // Get all connected MCP tools
    const connectedTools = this.getAllConnectedTools();
    const servers = this.getAllServers();

    // Find server name for each tool and create plugins
    for (const tool of connectedTools) {
      // Find which server this tool belongs to
      const server = findToolServer(tool.name, servers);

      if (server) {
        const plugin = createMcpToolPlugin(
          tool,
          server.name,
          (
            name: string,
            args: Record<string, unknown>,
            context?: ToolContext,
          ) => this.executeMcpTool(name, args, context),
        );
        mcpTools.set(plugin.name, plugin);
      }
    }

    return Array.from(mcpTools.values());
  }

  /**
   * Get all currently available MCP tools as OpenAI function tools
   */
  getMcpToolsConfig(): ChatCompletionFunctionTool[] {
    return this.getMcpToolPlugins().map((tool) => tool.config);
  }

  /**
   * Declared output schema per flattened tool name, for the REPL catalog's return
   * types.
   *
   * A separate accessor because `getMcpToolsConfig()` cannot carry it: an OpenAI
   * function declaration has room for `parameters` and nothing else, so the schema
   * a server declared for its *output* has no field to travel in. Correlated with
   * the same `findToolServer` lookup `getMcpToolPlugins` uses and keyed with the
   * same `mcpToolFlatName`, so the two agree on which server owns a tool.
   *
   * Servers that declare no output schema are simply absent, which renders as
   * `Promise<unknown>`: honest about the call returning *something* of unspecified
   * shape.
   */
  getMcpToolOutputSchemas(): Map<string, Record<string, unknown>> {
    const schemas = new Map<string, Record<string, unknown>>();
    const servers = this.getAllServers();
    for (const tool of this.getAllConnectedTools()) {
      const server = findToolServer(tool.name, servers);
      if (server && tool.outputSchema) {
        schemas.set(mcpToolFlatName(server.name, tool.name), tool.outputSchema);
      }
    }
    return schemas;
  }

  /**
   * Execute an MCP tool by name (registry version)
   */
  async executeMcpToolByRegistry(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const plugins = this.getMcpToolPlugins();
    const tool = plugins.find((plugin) => plugin.name === name);

    if (!tool) {
      return {
        success: false,
        content: "",
        error: `MCP tool '${name}' not found or server disconnected`,
      };
    }
    return tool.execute(args, context);
  }

  /**
   * Check if a tool name belongs to an MCP tool
   */
  isMcpTool(name: string): boolean {
    if (!name.startsWith("mcp__")) return false;

    for (const server of this.servers.values()) {
      if (server.status === "connected" && server.tools) {
        for (const tool of server.tools) {
          if (`mcp__${server.name}__${tool.name}` === name) {
            return true;
          }
        }
      }
    }
    return false;
  }
}
