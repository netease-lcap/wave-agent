/**
 * RemoteControlService — serves a session to a paired phone.
 *
 * It sits beside the local transports: `DaemonServer` fans every notification
 * out to its unix-socket clients, and additionally to this service when remote
 * control is on. The bridge itself is untouched, so a machine with remote
 * control off behaves exactly as before.
 *
 * Three things happen on the remote path that do not happen locally:
 *
 * 1. **Coalescing.** Streamed deltas are merged over a short window
 *    (`NotificationCoalescer`); the local path keeps its per-chunk frames.
 * 2. **Structural pushes become signals.** `messagesChange` is content-free on
 *    every path — the bridge's re-attach push and the foreground CLI's notice
 *    both send `{}`. The phone answers it by pulling with
 *    `getMessages({ since })` — the same path a cold start takes — and this
 *    service still strips a payload from any build that attaches one, so the
 *    wire has exactly one shape.
 * 3. **A status signal.** The relay cannot see inside the frames (that is the
 *    whole design), so it cannot know that somebody is waiting on an approval —
 *    which is the one state where pushing to a phone matters. The machine
 *    therefore reports `running` / `idle` / `requires_action` per session.
 *    This carries no message content, by construction: session ids and one word
 *    each.
 * 4. **A frame budget.** The relay drops any single frame that does not fit its
 *    per-subscriber buffer (1 MiB by default) and asks the phone for a resync —
 *    silently, with no error for us to see. So nothing over budget is handed
 *    over: pages are trimmed to the newest messages that fit, and a
 *    notification too large to send becomes a content-free "re-read" signal.
 *    See `frameBudget.ts` for why the number is what it is.
 */

import type {
  RemoteControlSnapshot,
  RemoteControlStatus,
} from "wave-agent-sdk";
import {
  frameBytes,
  REMOTE_MAX_FRAME_BYTES,
  trailingCountThatFits,
} from "./frameBudget.js";
import {
  NotificationCoalescer,
  type RelayFrame,
} from "./notificationCoalescer.js";
import {
  RelayClient,
  type RelayEnvelope,
  type RelaySocketFactory,
} from "./relayClient.js";
import type { RemoteControlEndpoint } from "./remoteControlConfig.js";
import { resultForRemote } from "../stdio/uiPayload.js";

/**
 * Methods the remote channel accepts.
 *
 * The local desktop / IDE transports have always been able to call anything —
 * they are the user's own machine talking to itself. A phone page is a web page
 * holding a token, so the remote channel is default-deny and this is the whole
 * of what it may ask for (the chat subset the phone actually renders, taken
 * from the method list in the feature request). Widening it is a deliberate
 * act, not an accident of the bridge's surface.
 *
 * `listDaemonSessions` is the session list's data source rather than
 * `listSessions`: the page can only open sessions that are live in this process
 * (`getMessages` requires the envelope's sessionId to be in the registry), while
 * `listSessions` reads the transcripts on disk and would offer it conversations
 * it cannot read. See 规格 remote-control「边界情况」。
 *
 * `renameSession` / `compact` / `getSlashCommands` (2026-10-14): conversation
 * upkeep the phone can do without an editor, a file system or a plugin manager —
 * all three are session-scoped and already implemented by both hosts
 * (`AgentBridge` for daemon sessions, `RemoteControlCliHost` for a foreground
 * CLI session). The page's slash-command menu reads `getSlashCommands`; the same
 * method is what makes 重命名 / 压缩 usable there instead of a request that comes
 * back unreachable.
 *
 * **Second batch (2026-10-17)** — rewind / clear / model / background tasks and
 * workflows / queue surgery / file search / prompt history. The first batch's
 * rule was "anything the page cannot *carry* stays out", and it lumped these in
 * with settings and file paths under a single reason ("the host holds the data").
 * Checked one by one, that reason only holds for the **interface** surfaces —
 * a settings page, a plugin market, an editor, the on-disk session list. Every
 * method below is already implemented on `AgentBridge`, so what was missing was
 * one line here, one case in the shim, and one remote gate in the UI; keeping
 * them out left the phone able to *read* but not to *act*. Two of them are worth
 * spelling out because the page must warn before running them:
 *
 * - `rewindToMessage` is **the same operation the desktop runs**, not a
 *   conversation-only truncation: `truncateHistory` → `reversionManager.revertTo`
 *   restores this machine's workspace files from each message's `file_history`
 *   snapshot. A mis-tap on a phone is therefore a file operation, which is why
 *   the page confirms once before sending it.
 * - `setModel` is **not** session-scoped: it writes the `model` key of the
 *   user-level `~/.wave/settings.json` (falling back to this session only when
 *   the write fails), so switching on the phone switches it for every session on
 *   this machine. The page says so in its confirmation.
 *
 * Still out, and deliberately: settings / plugin market / login (`getUserSettings`,
 * `updateUserSettings`, plugins, `login`, `logout`, …), anything that opens an
 * editor (`openFile` is not even a bridge method), the on-disk session list
 * (`listAllSessions` / `restoreSession`), the process-lifecycle calls
 * (`shutdown` / `bang`), and the **read-only panes the page has no
 * surface for** — `getWorkspaceDiff` / `getWorktreeChanges` / `getPlanFile`
 * (no diff / worktree / plan pane on the page; the plan body travels inside
 * the `ExitPlanMode` approval card).
 *
 * **Session deletion (2026-10-17, fourth batch)** — the batch where the page
 * gained the entry `removeWorktree` was being kept out for. Two of the three
 * things involved are whitelisted, one is not, and the split is the whole design:
 *
 * - `destroy` (now with an optional `removeWorktree` param) is the write. It is
 *   **session-keyed**: the daemon resolves the worktree from that session's own
 *   creation directory, so the phone names a session, never a path.
 * - `getSessionWorktreeChanges` is the read the delete confirmation needs — the
 *   same counts the desktop dialog shows, resolved the same way.
 * - `removeWorktree` / `getWorktreeChanges` stay **out**: they take `path` /
 *   `branch` / `repoRoot` (or `path`) from the caller, i.e. they would let the
 *   page name any directory on this machine to delete or to inspect. Being able
 *   to delete a session it was handed is not the same capability.
 */
export const REMOTE_ALLOWED_METHODS: ReadonlySet<string> = new Set([
  "listSessions",
  "listDaemonSessions",
  "getSessionInfo",
  "getMessages",
  "listPendingPermissions",
  "permissionResponse",
  "sendMessage",
  "abortMessage",
  "setPermissionMode",
  "renameSession",
  "compact",
  "getSlashCommands",
  // 发起新会话（spec ui/remote-control.md「Web 端也能发起新会话」）：白名单
  // 从「只碰已存在的会话」显式扩到「可在选定目录建会话」。initialize 在下方
  // 收敛入参——放行的是「建一条会话」这个能力，不是它的整张参数表。
  "initialize",
  "listDirectories",
  "listGitBranches",
  "createWorktree",
  // ── 第二批解禁（spec「页面能执行的那批宿主命令」）──
  // 回滚：与桌面同语义（截断对话 + 按 file_history 快照还原本机工作区文件），
  // 页面执行前有一次确认。
  "rewindToMessage",
  "listRewindCheckpoints",
  // 清空：换绑新 sessionId（与 IDE 端「新建对话」同一条底层），页面确认一次。
  "clearMessages",
  // 模型：getConfiguredModels 只读；setModel 写用户级 ~/.wave/settings.json。
  "getConfiguredModels",
  "setModel",
  // 排队消息三动作里的两条（「立即发送」= sendMessage{force} + 删这条）。
  "updateQueuedMessage",
  "deleteQueuedMessageById",
  // 后台任务与工作流：读输出 / 停止 / 把本轮转到后台（不毁文件，回执即可）。
  // `backgroundCurrentTask` 曾经因为「页面上唯一的入口是 Ctrl/Cmd+B，手机键盘
  // 没有这个键」而不在此列：放行一个页面根本调不到的方法，只是把暴露面放大，
  // 与本清单「跟页面能力一致」的判据相反。2026-10-30 助手消息上出现了后台按钮
  // （spec: task-background-execution.md「前台工具后台化」场景 3–6），页面上有了
  // 调用方，这条判据随之满足。
  "getBackgroundTaskOutput",
  "stopBackgroundTask",
  "getWorkflowRuns",
  "stopWorkflowRun",
  "backgroundCurrentTask",
  // `@` 文件建议与历史提示词：都只读，锚在信封 sessionId 的 workdir 上。
  "searchFiles",
  "getPromptHistory",
  "searchPromptHistory",
  // `/btw` 旁路提问（spec「Web 页也能用 /btw 旁路提问」）：单轮 fork、不执行工具、
  // 不进对话历史 —— 它作用于当前会话、既不需要编辑器也不需要文件系统，与第二批
  // 那条「页面能不能承载」同一条判据。**只放行请求**：流式增量是宿主推的
  // `btwContent` 通知，走既有的通知扇出，白名单管不到也不需要管。
  "askBtw",
  // ── 第四批：会话删除（spec「手机端的会话列表与删除」）──
  // 写：`destroy` 带上可选 `removeWorktree`（默认 false）。工作树由 daemon 从该
  // 会话的 createdWorkdir 定位、并在 agent.destroy() 之后删除，页面给不出路径。
  // 读：确认卡片要的改动计数走会话作用域的那一条（路径同样由 daemon 推导）。
  // 裸 `removeWorktree` / `getWorktreeChanges` **仍然不放行**：它们收调用方给的
  // path，等于把「这台机器上的任意目录」开给远端——「能删一条被列出来的会话」与
  // 「能指名任意路径」不是同一个能力。
  "destroy",
  "getSessionWorktreeChanges",
  // ── 第五批：最近打开的工作目录（spec core/recent-workdirs.md）──
  // 读：`getRecentWorkdirs` 回这台机器自己的 MRU 列表（`~/.wave/recent-workdirs.json`）。
  // 写：`rememberRecentWorkdir` 只在新建会话成功后由页面调用一次，参数是那次
  // 创建用的目录——它不会删改已有条目，也换不来「在任意目录跑 agent」之外
  // 的任何东西（那个能力本来就在 `initialize` 里）。
  "getRecentWorkdirs",
  "rememberRecentWorkdir",
  // ── 第六批：点消息里的图片路径看原图（spec「点消息里的图片路径看原图」）──
  // 读：`getImagePreview` 把**一个路径**变成一张压缩到单帧预算内的图。
  // 这是第一个收调用方 path 的读方法，所以边界是显式的三道而不是目录前缀：
  // ① 页面只对图片扩展名给点击入口，路径来自对话内容（没有手输入口）；
  // ② 宿主解码后按**真实容器**判型（`imagePreview.ts` 的 ALLOWED_SOURCE_FORMATS），
  //    扩展名只是路由提示，指向文本文件的软链在这一道被挡下；
  // ③ 只读、不写不删，回包体积被压缩档位限住。
  // **不按目录限制**是刻意的：真机截图落在 `/tmp`，限目录等于打掉主场景
  // （见规格边界情况那条「边界画在内容类型上，不画在目录上」）。
  "getImagePreview",
]);

/**
 * The JSON-RPC code for "the channel would carry this, but **this host** has not
 * implemented it".
 *
 * Three failures have to stay distinguishable on the page: `-32601` means the
 * whitelist above refuses the method (the page should ask for a newer build),
 * `-32602` means the parameters are wrong, and this one means the method is
 * allowed but the host behind the channel does not serve it — a foreground CLI
 * session serves its own conversation, not a whole registry. Collapsing them
 * into `-32601` told the user to upgrade a machine that was already current,
 * and returning nothing at all left the page stuck on the action.
 *
 * The page's shim mirrors this number (`packages/webview/remote/shim.js`); it is
 * browser JS shipped verbatim and cannot import from this package, so the
 * literal is duplicated there with a pointer back here.
 */
export const REMOTE_HOST_UNSUPPORTED = -32011;

/**
 * The only `initialize` shape the remote channel may request: create a session
 * in a chosen directory, with an optional permission mode. Everything else in
 * its parameter surface (model / apiKey / tools / plugins / mcpServers /
 * restoreSessionId …) is dropped, not validated — a whitelisted method must
 * not smuggle in knobs the whitelist never approved.
 *
 * `entrypoint` is stamped here rather than picked: it describes the CHANNEL, not
 * the caller's request, and must not be spoofable (the page cannot claim to be
 * the desktop app). A session created this way runs in whichever process serves
 * the relay — a daemon or the interactive CLI — so without this the phone's
 * usage would be indistinguishable from that process's own sessions.
 */
function pickInitializeParams(params: unknown): Record<string, unknown> {
  const p = (params ?? {}) as Record<string, unknown>;
  const picked: Record<string, unknown> = { entrypoint: "remote" };
  if (typeof p.workdir === "string" && p.workdir) picked.workdir = p.workdir;
  if (typeof p.permissionMode === "string" && p.permissionMode) {
    picked.permissionMode = p.permissionMode;
  }
  return picked;
}

/**
 * How long to wait before recomputing the session status signal. Any
 * notification may be the one that flipped a session between states, so the
 * signal is recomputed on a debounce rather than by enumerating every possible
 * trigger — a missed trigger would leave a phone believing nobody is waiting
 * on an approval, which is the one thing this feature exists to fix.
 */
export const REMOTE_STATUS_DEBOUNCE_MS = 250;

/**
 * What the bridge routes `remoteControl*` requests to. The bridge owns nothing
 * here — same shape as `onShutdownRequest`, where the daemon owns the process
 * lifecycle and the bridge only forwards the call.
 *
 * The snapshot shapes it returns live in the SDK (`wave-agent-sdk`): the hosts
 * and the webview render them and cannot import this package.
 */
export interface RemoteControlController {
  getSnapshot(): RemoteControlSnapshot;
  /** `name` is an optional label for this machine, shown on the phone. */
  connect(name?: string): void;
  disconnect(): void;
}

/**
 * The host a service serves. Two shapes satisfy it:
 *
 * - `AgentBridge` — a process that stands up a JSON-RPC server (`--daemon`,
 *   `--stdio`) and keeps its sessions in a registry;
 * - the interactive CLI front end (`RemoteControlCliHost`) — one session held in
 *   React state, with no RPC server (and so no `AgentBridge`) anywhere.
 *
 * These three methods are the whole of what a service asks of its host: fan
 * inbound frames back in, and read the per-session status the relay cannot
 * derive for itself. Keeping the type this narrow is what lets the CLI serve the
 * session the user is sitting in front of, instead of only the sessions that
 * happen to live behind an RPC server.
 */
export interface RemoteControlHost {
  handleRequest(
    method: string,
    params: unknown,
    sessionId?: string,
  ): Promise<unknown>;
  handleNotification(method: string, params: unknown): void;
  listSessionStatuses(): Array<{
    sessionId: string;
    status: "running" | "idle" | "requires_action";
  }>;
}

export interface RemoteControlServiceOptions {
  /**
   * Resolved when connecting, not when the service is built: a resident daemon
   * outlives the SSO token it booted with, and remote control is usually turned
   * on long after the process started. On a machine that has never registered
   * this is also where the one registration call happens, which is why it is
   * async.
   */
  resolveEndpoint: (options?: {
    name?: string;
    refreshIdentity?: boolean;
  }) => Promise<{
    endpoint?: RemoteControlEndpoint;
    pageUrl?: string;
    error?: string;
  }>;
  createSocket?: RelaySocketFactory;
  onStatusChange?: (status: RemoteControlStatus) => void;
}

export class RemoteControlService implements RemoteControlController {
  private client: RelayClient | undefined;
  private readonly coalescer: NotificationCoalescer;
  private status: RemoteControlStatus = { state: "off" };
  private statusTimer: ReturnType<typeof setTimeout> | undefined;
  private lastStatusPayload = "";
  private pageUrl: string | undefined;
  private url: string | undefined;
  private name: string | undefined;
  /** Last state announced per session over the control channel. */
  private readonly lastHostStates = new Map<string, string>();
  /** A one-off note from the relay worth showing beside the state. */
  private notice: string | undefined;
  /**
   * Bumped by every `start`/`stop`: registering a machine is an HTTP round trip,
   * and a `stop` that lands in the middle of one must not end with a live
   * connection the user has already turned off.
   */
  private generation = 0;
  /**
   * The stale-identity self-heal already ran in this process.
   *
   * Re-registering mints a **new** token, and any other entry on this machine is
   * still holding the old one — so an unbounded heal turns two processes into a
   * loop of re-signing each other's credential away (the same shape as the `4001`
   * takeover ping-pong). One attempt per process is what keeps it convergent:
   * whoever healed last serves, the other stops. A second, different reason is
   * an expiry 90 days out, which is not worth spending the budget on.
   */
  private identityRefreshUsed = false;

  constructor(
    private readonly bridge: RemoteControlHost,
    private readonly options: RemoteControlServiceOptions,
  ) {
    this.coalescer = new NotificationCoalescer((frames) => this.write(frames));
  }

  start(): void {
    const generation = ++this.generation;
    this.setStatus({ state: "connecting" });
    void this.setup(generation);
  }

  /**
   * Resolve the identity (registering this machine on first use), then dial.
   * Every await is followed by a generation check, so a `stop` that arrives
   * while the relay is being asked for a host id wins.
   *
   * `refreshIdentity` forces that registration to happen again, which is only
   * ever set by the self-heal below.
   */
  private async setup(
    generation: number,
    options: { refreshIdentity?: boolean } = {},
  ): Promise<void> {
    const resolved = await this.options.resolveEndpoint({
      ...(this.name !== undefined ? { name: this.name } : {}),
      ...(options.refreshIdentity ? { refreshIdentity: true } : {}),
    });
    if (generation !== this.generation) return;

    if (!resolved.endpoint) {
      const reason = resolved.error ?? "Remote control is unavailable.";
      this.setStatus({
        state: "error",
        // Two layers, because the user has to act on both halves: the identity
        // this machine stored is gone, *and* replacing it did not work. Saying
        // only the latter would read like a flaky network.
        message: options.refreshIdentity
          ? `the relay no longer knows this machine, and registering it again failed: ${reason}`
          : reason,
      });
      return;
    }
    const { url, hostToken, version } = resolved.endpoint;
    this.url = url;
    if (resolved.pageUrl) this.pageUrl = resolved.pageUrl;
    // A reconnect has to re-announce every session: the relay keeps the last
    // state it was told, and that state may be minutes old.
    this.lastHostStates.clear();
    this.notice = undefined;

    this.client = new RelayClient({
      url,
      // The machine is not a phone with a login token: it is the thing being
      // controlled, identified by the long-lived token the relay minted when it
      // registered this machine. With `sso` the relay would take this side for a
      // subscriber — the handshake would succeed and the phone would then be
      // told nobody is home (4001).
      credential: { type: "host", token: hostToken },
      version,
      createSocket: this.options.createSocket,
      onAuthenticated: () => {
        this.setStatus({ state: "online" });
        // Tell the phone which CLI build is behind this session: the page is
        // always the newest one, so a mismatch is resolved by asking the user
        // to upgrade the machine, never by keeping old pages around. The label
        // rides along so a user with two computers can tell them apart. Sent
        // after `auth_ok` because frames sent before the handshake are not
        // forwarded anywhere.
        this.client?.send({
          method: "hostHello",
          params: {
            version,
            ...(this.name ? { name: this.name } : {}),
          },
        });
        this.lastHostStates.clear();
        this.emitStatus(true);
      },
      onAuthError: (info) => {
        // The close that follows carries the mechanics (4003 = do not retry);
        // the frame is the only place the *reason* lives.
        this.setStatus({
          state: "error",
          message: `the relay refused this machine: ${info.error}`,
        });
      },
      onPeerDisconnected: () => {
        // A host should never be told this; a subscriber is. Recorded rather
        // than acted on: the 4001 that follows is what drives the retry.
        this.notice = "the relay reports the other end of this channel is gone";
      },
      onResyncRequired: () => {
        // Our frames to a slow peer were dropped, so its view is no longer
        // complete — and it cannot tell which frames it lost. Re-announcing
        // every state (not just the changed ones) is what lets it rebuild.
        this.notice =
          "a subscriber fell behind: the relay dropped frames and asked for a resync";
        this.lastHostStates.clear();
        this.emitStatus(true);
      },
      onFrame: (frame) => this.handleFrame(frame),
      onStaleIdentity: (info) => {
        if (generation !== this.generation) return;
        this.refreshIdentity(info.error);
      },
      onFatal: (message) => {
        if (generation !== this.generation) return;
        this.setStatus({ state: "error", message });
      },
    });
    this.client.start();
  }

  /**
   * The relay refused the credential with a stale-identity reason — the stored
   * row is gone (revoked, expired, or a file whose id and token never belonged
   * together). Recover by registering again: the id is derived from the machine,
   * so the relay reuses the same row and the page URL survives, and the fresh
   * token then dials out. Without this the only way back was for the user to
   * delete `~/.wave/remote-control.json` by hand, which nobody knows exists
   * (2026-10-16: a revoked row left a Mac unable to reconnect at all).
   *
   * Attempted **once per process** — see `identityRefreshUsed`.
   */
  private refreshIdentity(error: string): void {
    if (this.identityRefreshUsed) {
      this.setStatus({
        state: "error",
        message: `the relay rejected this machine even after registering it again (4003): ${error}`,
      });
      return;
    }
    this.identityRefreshUsed = true;
    const generation = ++this.generation;
    this.setStatus({
      state: "connecting",
      message: "the relay no longer knows this machine: registering it again",
    });
    void this.setup(generation, { refreshIdentity: true });
  }

  stop(): void {
    // Ordered before the teardown so a registration still in flight cannot
    // finish and dial out afterwards.
    this.generation += 1;
    if (this.statusTimer !== undefined) {
      clearTimeout(this.statusTimer);
      this.statusTimer = undefined;
    }
    this.coalescer.discard();
    const client = this.client;
    this.client = undefined;
    client?.stop();
    this.pageUrl = undefined;
    this.lastHostStates.clear();
    this.notice = undefined;
    this.lastStatusPayload = "";
    this.setStatus({ state: "off" });
  }

  getStatus(): RemoteControlStatus {
    return this.status;
  }

  getSnapshot(): RemoteControlSnapshot {
    // `message` is the error reason when there is one, and otherwise the last
    // thing the relay told us (a peer went away, a resync was requested).
    const message = this.status.message ?? this.notice;
    return {
      state: this.status.state,
      ...(this.url ? { url: this.url } : {}),
      ...(message ? { message } : {}),
      ...(this.pageUrl ? { pageUrl: this.pageUrl } : {}),
    };
  }

  /** The controller surface the bridge routes to. */
  connect(name?: string): void {
    if (name !== undefined) this.name = name;
    this.start();
  }

  disconnect(): void {
    this.stop();
  }

  // ── Outbound: the daemon's notification fan-out ───────────────

  /**
   * Same signature as `JsonRpcConnection.sendNotification`, so the daemon can
   * treat local clients and the relay identically.
   */
  sendNotification(method: string, params: unknown, sessionId?: string): void {
    // Nothing to serve while the link is down. Dropping here (rather than
    // buffering) is deliberate: a phone that was disconnected re-reads the tail
    // through `getMessages({ since })` anyway, so a backlog would only be a
    // burst of frames it is about to discard.
    if (!this.client) return;

    if (method === "messagesChange") {
      // Signal only — and it stays that way for the phone no matter what the
      // producing side did. Every producer in this build sends `{}` already (the
      // bridge's re-attach push and the foreground CLI's structural notice), but
      // an older machine may still attach the full list: dropping `params` here
      // is what keeps the phone on one protocol instead of two
      // (spec「messagesChange 只有一种形态」). Sending immediately rather than
      // through the coalescer is the other half of this branch: a structural
      // notice must not wait for the next delta window.
      this.send({ method: "messagesChange", sessionId });
      this.scheduleStatus();
      return;
    }
    this.coalescer.push(method, params, sessionId);
    this.scheduleStatus();
  }

  // ── Inbound: what the phone asks for ──────────────────────────

  private handleFrame(frame: RelayEnvelope): void {
    if (frame.id === undefined) {
      // Notification (no reply expected) — `permissionResponse` is the one the
      // protocol defines.
      try {
        this.bridge.handleNotification(frame.method, frame.params);
      } catch {
        // Notifications have no reply channel; a bad one is not fatal.
      }
      this.scheduleStatus();
      return;
    }

    // Captured once: the narrowing above does not survive into the callbacks
    // below, and a reply without an id is not a reply.
    const replyId = frame.id;

    if (!REMOTE_ALLOWED_METHODS.has(frame.method)) {
      this.send({
        id: replyId,
        method: "error",
        params: {
          code: -32601,
          message: `Method not available over remote control: ${frame.method}`,
        },
      });
      return;
    }

    // `initialize` is whitelisted for exactly one shape: create a session in a
    // chosen directory (and optionally set its permission mode). Its full
    // parameter surface — apiKey / baseURL / model / tools / plugins /
    // mcpServers … — would let the page reshape the machine-side agent, so
    // everything outside the two allowed keys is dropped here rather than
    // trusted to the caller (spec 「Web 端也能发起新会话」场景 5). Re-attach
    // (`restoreSessionId`) is NOT part of the whitelisted shape: the page
    // switches sessions via `getMessages`, not by re-binding the host agent.
    const requestParams =
      frame.method === "initialize"
        ? pickInitializeParams(frame.params)
        : frame.params;

    void this.bridge
      .handleRequest(frame.method, requestParams, frame.sessionId)
      .then((result) => {
        this.sendResult(replyId, frame.method, result);
        this.scheduleStatus();
      })
      .catch((err: unknown) => {
        const { code, message } = describeRpcError(err);
        this.send({
          id: replyId,
          method: "error",
          params: { code, message },
        });
      });
  }

  /**
   * Answer a request, hammering the answer into the frame budget.
   *
   * A read answer is the one frame whose size follows the session (a page of
   * the message list), so it is the one frame that gets trimmed instead of
   * dropped. A `getMessages` answer can be cut and the phone asked for the
   * tail, so an over-budget one is cut to the **newest** messages that fit — the
   * phone keeps a usable list instead of nothing. Every other over-budget
   * answer is an explicit error: truncating a `getSessionInfo` or a
   * `listSessions` would hand the phone a well-formed lie about which sessions
   * exist, and there is no "newer part" of such an answer to prefer.
   */
  private sendResult(
    replyId: number | string,
    method: string,
    result: unknown,
  ): void {
    // The page's copy: user image bytes never go over the relay
    // (spec ui/remote-control.md「远端通道只开一个白名单」场景 10).
    const forRemote = resultForRemote(result);
    const envelope: RelayEnvelope = {
      id: replyId,
      method: "result",
      params: { result: forRemote },
    };
    const bytes = frameBytes(envelope);
    if (bytes <= REMOTE_MAX_FRAME_BYTES) {
      this.send(envelope);
      return;
    }

    const page = asMessagePage(forRemote);
    if (page) {
      const kept = trailingCountThatFits(
        page.messages.length,
        (count) =>
          frameBytes(pageFrame(replyId, page, count)) <= REMOTE_MAX_FRAME_BYTES,
      );
      // Not even one message fits: there is nothing to send that the phone
      // could render, and an empty list would only make it re-ask forever.
      if (kept > 0) {
        this.send(pageFrame(replyId, page, kept));
        return;
      }
    }

    this.send({
      id: replyId,
      method: "error",
      params: {
        code: -32603,
        message:
          `${method}: the answer is larger than the remote channel's frame budget` +
          ` (${String(bytes)} bytes over the ${String(REMOTE_MAX_FRAME_BYTES)}-byte limit)` +
          ` — ask for a smaller page`,
      },
    });
  }

  // ── Plumbing ──────────────────────────────────────────────────

  /** Frames are simply dropped when the link is down; the phone re-syncs. */
  private send(frame: RelayEnvelope): void {
    this.client?.send(frame);
  }

  /**
   * Hand the coalesced notifications over, one frame each — unless a frame is
   * over budget, which for a notification means "the phone must re-read".
   *
   * The relay would drop such a frame anyway and ask for a resync, so saying it
   * ourselves is the same outcome without the round trip — and it is the only
   * way the phone hears about it *before* the drop. Which matters, because the
   * notification most likely to be oversized is a **permission request** (its
   * payload carries the command and the diff): dropping it silently would leave
   * an approval that nobody can answer. So the stand-in is the `full` variant of
   * the list-changed signal, and the page answers it by re-pulling the snapshot
   * — messages *and* pending approvals — rather than only the messages it is
   * missing.
   */
  private write(frames: RelayFrame[]): void {
    for (const frame of frames) {
      const envelope: RelayEnvelope = {
        method: frame.method,
        params: frame.params,
        sessionId: frame.sessionId,
      };
      if (frameBytes(envelope) > REMOTE_MAX_FRAME_BYTES) {
        this.send({
          method: "messagesChanged",
          params: { full: true },
          sessionId: frame.sessionId,
        });
        continue;
      }
      this.send(envelope);
    }
  }

  private scheduleStatus(): void {
    if (this.statusTimer !== undefined) return;
    this.statusTimer = setTimeout(() => {
      this.statusTimer = undefined;
      this.emitStatus(false);
    }, REMOTE_STATUS_DEBOUNCE_MS);
    this.statusTimer.unref?.();
  }

  /**
   * Recompute and push the per-session status signal. Sent only when it
   * actually changed: at 250 ms debounce this would otherwise be a steady
   * trickle of identical frames for the life of a session.
   *
   * Two carriers, because they serve two readers: the JSON-RPC notification is
   * what the phone page renders, and the `host_state` control frame is the only
   * thing the **relay** reads — it has to, because "somebody is waiting on an
   * approval" is the one state worth a Web Push, and deriving that from a
   * business envelope would mean parsing the payloads it promises not to parse.
   */
  private emitStatus(force: boolean): void {
    let sessions: Array<{ sessionId: string; status: string }>;
    try {
      sessions = this.bridge.listSessionStatuses();
    } catch {
      return;
    }
    const payload = JSON.stringify(sessions);
    if (!force && payload === this.lastStatusPayload) return;
    this.lastStatusPayload = payload;
    this.send({ method: "sessionStatus", params: { sessions } });
    this.reportHostStates(sessions);
  }

  /**
   * Announce every state the relay has not been told yet, one frame per session
   * (`{type:'host_state', sessionId, state}`). Only changes, because the relay
   * turns a transition *into* `requires_action` into a push — re-announcing an
   * unchanged state would be a push per frame.
   *
   * Sessions that went away are simply forgotten: a state the relay holds for a
   * session nobody can ask about does nothing, while a stale `requires_action`
   * would keep a phone ringing about a session that no longer exists.
   */
  private reportHostStates(
    sessions: Array<{ sessionId: string; status: string }>,
  ): void {
    const seen = new Set<string>();
    for (const session of sessions) {
      seen.add(session.sessionId);
      if (this.lastHostStates.get(session.sessionId) === session.status)
        continue;
      this.lastHostStates.set(session.sessionId, session.status);
      this.client?.sendControl({
        type: "host_state",
        sessionId: session.sessionId,
        state: session.status,
      });
    }
    for (const sessionId of [...this.lastHostStates.keys()]) {
      if (!seen.has(sessionId)) this.lastHostStates.delete(sessionId);
    }
  }

  private setStatus(status: RemoteControlStatus): void {
    this.status = status;
    this.options.onStatusChange?.(status);
  }
}

function describeRpcError(err: unknown): { code: number; message: string } {
  const code =
    err && typeof err === "object" && "code" in err
      ? Number((err as { code: unknown }).code)
      : -32603;
  const message = err instanceof Error ? err.message : String(err);
  return { code: Number.isFinite(code) ? code : -32603, message };
}

/** A `getMessages` answer: the one read shape that can be cut. */
interface MessagePage {
  messages: unknown[];
  /** Whatever else the host put in the answer (`reset` / `contextUsagePercent`). */
  rest: Record<string, unknown>;
}

/**
 * Recognise a cuttable answer by its shape rather than by the method that
 * produced it: `getMessages` is the only method that returns `messages` today,
 * and matching on the shape means a future read is covered without a second
 * list of method names to keep in sync.
 */
function asMessagePage(result: unknown): MessagePage | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  const { messages, ...rest } = result as { messages?: unknown };
  return Array.isArray(messages)
    ? { messages, rest: rest as Record<string, unknown> }
    : undefined;
}

/** The answer, cut to its newest `count` messages. */
function pageFrame(
  replyId: number | string,
  page: MessagePage,
  count: number,
): RelayEnvelope {
  return {
    id: replyId,
    method: "result",
    params: {
      result: {
        ...page.rest,
        messages: page.messages.slice(-count),
      },
    },
  };
}
