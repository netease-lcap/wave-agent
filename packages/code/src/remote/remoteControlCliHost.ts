/**
 * RemoteControlCliHost — serves the **interactive CLI's own session** to a
 * phone.
 *
 * The daemon and each GUI host's `--stdio` child serve their sessions through
 * `AgentBridge`, which owns a registry of them. The front end the user is
 * typing in has no RPC server at all: one session, held in React state. Rather
 * than pretend otherwise, this host implements the same three-method
 * `RemoteControlHost` contract against that single session, so the relay, the
 * white list and the page need no special case.
 *
 * Two consequences of "one session, and it is the one on screen", both
 * deliberate (docs/specs/remote/remote-web.md, 前台 CLI 故事):
 *
 * - Both ways of asking for the session list (`listDaemonSessions`, which the
 *   page reads, and `listSessions`) answer with exactly this session. The
 *   phone's list is a navigation surface, and there is nothing else to navigate
 *   to — scanning disk for older conversations would offer rows that cannot be
 *   opened.
 * - The host dies with its process. Nothing here survives the TUI exiting, and
 *   that is the point: a session nobody holds cannot be served, only resumed
 *   (as a new session).
 */

import type {
  BackgroundTaskSummary,
  Message,
  PermissionDecision,
  PermissionMode,
  QueuedMessage,
  SessionMetadata,
  SlashCommand,
  Task,
  ToolPermissionContext,
} from "wave-agent-sdk";
import {
  listSessions,
  readRecentWorkdirs,
  rememberRecentWorkdir,
} from "wave-agent-sdk";
import {
  hostSlashCommandsFor,
  toSlashCommandInfo,
} from "../stdio/hostSlashCommands.js";
import { readImagePreview } from "./imagePreview.js";
import { messagesForUi } from "../stdio/uiPayload.js";
import {
  InvalidMessageWindowError,
  normalizeMessageWindow,
  type MessageWindow,
  type MessageWindowResult,
} from "./messageWindow.js";
import {
  REMOTE_HOST_UNSUPPORTED,
  type RemoteControlHost,
} from "./remoteControlService.js";

/**
 * What this host needs from the front end. Supplied by the chat hook, which
 * owns all of it; every getter must return the **current** value (the host is
 * long-lived and the session underneath it is not).
 */
export interface RemoteControlCliSession {
  /** Empty until the first turn mints one — there is nothing to serve yet. */
  sessionId(): string;
  /** Where the shell is now (drifts on `cd`) — used for live directory reads. */
  workdir(): string;
  /** Where the session was opened; the row the page groups by. */
  sessionCwd(): string;
  /** One page of the list, sliced in memory. */
  messagePage(window: MessageWindow): Promise<MessageWindowResult>;
  /** The whole list as the agent holds it (it starts at the last compaction). */
  currentThread(): Promise<Message[]>;
  /** Thread totals the session list needs (the window cannot answer them). */
  threadSummary(): {
    messageCount: number;
    firstUserText?: string;
    lastActiveAt?: string;
  };
  contextUsagePercent(): number;
  latestTotalTokens(): number;
  permissionMode(): PermissionMode;
  /** User-set title (the one `/rename` sets); undefined when it has none. */
  customTitle(): string | undefined;
  availableTools(): string[];
  isLoading(): boolean;
  hasRunningBackgroundWork(): boolean;
  hasPendingMessages(): boolean;
  /** The todo list (TaskCreate/TaskUpdate) — a *state*, the page re-reads it. */
  tasks(): Task[];
  isCompacting(): boolean;
  isCommandRunning(): boolean;
  queuedMessages(): QueuedMessage[];
  /**
   * Background tasks (shell / subagent / workflow) as the TUI holds them. Same
   * role as `tasks`: the page's `/tasks` dialog reads the current set on its
   * alignment paths, because the change notification only reports changes.
   */
  backgroundTasks(): BackgroundTaskSummary[];
  /** Approvals waiting on the user right now (terminal or phone). */
  pendingPermissions(): Array<{
    requestId: string;
    context: ToolPermissionContext;
  }>;
  sendMessage(text: string, force?: boolean): void | Promise<void>;
  abort(): void;
  setPermissionMode(mode: PermissionMode): void;
  /** Resolve a pending approval, whichever side asked for it. */
  respondPermission(requestId: string, decision: PermissionDecision): void;
  /** Set this session's custom title (the value `wave -r` lists). */
  renameSession(title: string): void | Promise<void>;
  /** Compact this conversation, optionally with custom instructions. */
  compact(customInstructions?: string): void | Promise<void>;
  /**
   * The slash commands this session offers (skills / custom commands). The
   * page renders these as a menu; the SDK's own list is exactly what a phone
   * can run, since host-local commands (`/plan`, `/config`, …) live outside it.
   */
  slashCommands(): SlashCommand[];
}

/** The JSON-RPC code for a rejected parameter (matches the daemon's answer). */
const INVALID_PARAMS = -32602;

function invalidParams(message: string): Error {
  const err = new Error(message) as Error & { code?: number };
  err.code = INVALID_PARAMS;
  return err;
}

/**
 * "The channel carries this method, this host does not." The white list is
 * channel-wide (a daemon, a GUI's `--stdio` child and this foreground session all
 * read the same set), while the three hosts implement different amounts of it:
 * `AgentBridge` serves a registry of conversations, this host serves the one on
 * screen and is wired to a subset. Answering `-32601` here would tell the page the
 * method is unavailable over remote control at all — i.e. "upgrade the machine" —
 * when the truth is "this machine can, this session cannot".
 */
function hostUnsupported(method: string): Error {
  const err = new Error(
    `Not implemented by a foreground CLI session: ${method}`,
  ) as Error & { code?: number };
  err.code = REMOTE_HOST_UNSUPPORTED;
  return err;
}

export class RemoteControlCliHost implements RemoteControlHost {
  constructor(private readonly session: RemoteControlCliSession) {}

  async handleRequest(method: string, params: unknown): Promise<unknown> {
    const p = (params ?? {}) as Record<string, unknown>;
    switch (method) {
      case "listSessions":
        return this.listSessions();
      case "listDaemonSessions":
        return this.listDaemonSessions();
      case "getSessionInfo":
        return this.getSessionInfo();
      case "getMessages":
        return this.getMessages(p);
      // 最近打开的工作目录是本机的事实，与「这条前台会话」无关：同一个文件
      // AgentBridge 也在读（spec core/recent-workdirs.md）。不实现的话，页面
      // 会落到「这台电脑上的会话不支持这个操作」——白名单放行 ≠ 宿主实现。
      case "getRecentWorkdirs":
        return { dirs: readRecentWorkdirs() };
      // 远控页按需取图（spec「点消息里的图片路径看原图」）。与 daemon 那条
      // 共用 `imagePreview.ts`：判型按解码后的真实容器、压到单帧预算内。
      // 不实现的话页面会落到 hostUnsupported，而「白名单放行 ≠ 宿主实现」
      // 这份规格已经踩过一次（见场景 7）。
      case "getImagePreview":
        return readImagePreview(typeof p.path === "string" ? p.path : "");
      case "rememberRecentWorkdir":
        rememberRecentWorkdir(typeof p.workdir === "string" ? p.workdir : "");
        return null;
      case "listPendingPermissions":
        return this.listPendingPermissions();
      case "sendMessage":
        await this.session.sendMessage(
          typeof p.text === "string" ? p.text : "",
          p.force === true,
        );
        return null;
      case "abortMessage":
        this.session.abort();
        return null;
      case "setPermissionMode":
        this.session.setPermissionMode(p.mode as PermissionMode);
        return null;
      case "renameSession": {
        // The daemon's AgentBridge takes the target session from params (a host
        // serves many). This host serves exactly one, so the title is the only
        // input that means anything here — an empty one is a caller bug.
        const title = typeof p.title === "string" ? p.title.trim() : "";
        if (!title) throw invalidParams("renameSession requires a title");
        await this.session.renameSession(title);
        return null;
      }
      case "compact":
        await this.session.compact(
          typeof p.customInstructions === "string"
            ? p.customInstructions
            : undefined,
        );
        return null;
      case "getSlashCommands":
        return {
          // Narrowed to what the page renders, like the desktop host does: the
          // SDK's SlashCommand carries a `handler` function, which has no
          // business travelling over a relay (and would be dropped silently,
          // leaving the frame's shape to chance). The host-local half comes
          // from the one table, filtered for this entry (spec
          // ui/slash-commands.md「弹窗里的宿主命令只有一份表」) — the same bytes
          // the daemon returns, so the phone sees one list either way.
          commands: [
            ...this.session.slashCommands().map(toSlashCommandInfo),
            ...hostSlashCommandsFor("remote-page"),
          ],
        };
      default:
        // The white list already rejected everything outside it, so anything
        // arriving here is a method the *channel* carries and this host does not
        // (rewind, `clearMessages`, background tasks, `searchFiles`, … — see
        // `REMOTE_HOST_UNSUPPORTED`). Said as exactly that, not as a bad
        // parameter and not as silence: the page turns it into one visible line.
        throw hostUnsupported(method);
    }
  }

  handleNotification(method: string, params: unknown): void {
    if (method !== "permissionResponse") return;
    const p = (params ?? {}) as {
      requestId?: unknown;
      decision?: unknown;
    };
    if (typeof p.requestId !== "string" || !p.decision) return;
    this.session.respondPermission(
      p.requestId,
      p.decision as PermissionDecision,
    );
  }

  /**
   * One row, one word. The relay turns a transition *into* `requires_action`
   * into a Web Push, so this is what makes a phone ring when the terminal is
   * waiting on an approval.
   */
  listSessionStatuses(): Array<{
    sessionId: string;
    status: "running" | "idle" | "requires_action";
  }> {
    const sessionId = this.session.sessionId();
    if (!sessionId) return [];
    if (this.session.pendingPermissions().length > 0) {
      return [{ sessionId, status: "requires_action" }];
    }
    const busy =
      this.session.isLoading() || this.session.hasRunningBackgroundWork();
    return [{ sessionId, status: busy ? "running" : "idle" }];
  }

  private async listSessions(): Promise<{ sessions: SessionMetadata[] }> {
    const sessionId = this.session.sessionId();
    if (!sessionId) return { sessions: [] };
    // Prefer the real record from disk — it carries the title, timestamps and
    // token count the page renders. A session that has not been flushed yet
    // has no record, and an empty list would read on the phone as "this
    // machine has nothing to control", so synthesize the row instead.
    try {
      const persisted = await listSessions(this.session.workdir());
      const mine = persisted.find((entry) => entry.id === sessionId);
      if (mine) return { sessions: [mine] };
    } catch {
      // Unreadable project directory: the synthesized row is still the truth.
    }
    return { sessions: [this.synthesizedMetadata(sessionId)] };
  }

  private synthesizedMetadata(sessionId: string): SessionMetadata {
    const now = new Date();
    const firstMessage = this.session.threadSummary().firstUserText;
    const customTitle = this.session.customTitle();
    return {
      id: sessionId,
      sessionType: "main",
      workdir: this.session.workdir(),
      createdAt: now,
      lastActiveAt: now,
      latestTotalTokens: this.session.latestTotalTokens(),
      ...(customTitle ? { customTitle } : {}),
      ...(firstMessage ? { firstMessage } : {}),
    };
  }

  /**
   * The session list the page actually reads. A daemon has a real registry of
   * them (`AgentBridge.listDaemonSessions`); this host holds exactly one, so its
   * registry is that one — same shape, one row, and no disk read (the page can
   * only open sessions that are live in the serving process, and this is the
   * only one that is; see 规格 remote-control「边界情况」).
   *
   * Not `listSessions`: that reads the transcripts and would answer with rows
   * the page cannot open — including this machine's older, unloaded ones.
   */
  private listDaemonSessions(): {
    sessions: Array<{
      sessionId: string;
      sessionCwd: string;
      isLoading: boolean;
      hasRunningBackgroundWork: boolean;
      hasPendingMessages: boolean;
      messageCount: number;
      /** User-set title; wins over `firstMessage` in the UI. */
      customTitle?: string;
      /** First real user message — the label when no custom title is set. */
      firstMessage?: string;
      /** Last display message's timestamp: the session list's ordering key. */
      lastActiveAt?: string;
    }>;
  } {
    const sessionId = this.session.sessionId();
    if (!sessionId) return { sessions: [] };
    const customTitle = this.session.customTitle();
    const summary = this.session.threadSummary();
    const firstMessage = summary.firstUserText;
    const lastActiveAt = summary.lastActiveAt;
    return {
      sessions: [
        {
          sessionId,
          sessionCwd: this.session.sessionCwd(),
          isLoading: this.session.isLoading(),
          hasRunningBackgroundWork: this.session.hasRunningBackgroundWork(),
          hasPendingMessages: this.session.hasPendingMessages(),
          messageCount: summary.messageCount,
          ...(customTitle ? { customTitle } : {}),
          ...(firstMessage ? { firstMessage } : {}),
          ...(lastActiveAt ? { lastActiveAt } : {}),
        },
      ],
    };
  }

  private getSessionInfo(): {
    sessionId: string;
    sessionCwd: string;
    latestTotalTokens: number;
    permissionMode: PermissionMode;
    availableTools: string[];
    tasks: Task[];
    isCompacting: boolean;
    isCommandRunning: boolean;
    queuedMessages: QueuedMessage[];
    backgroundTasks: BackgroundTaskSummary[];
  } {
    return {
      sessionId: this.session.sessionId(),
      sessionCwd: this.session.sessionCwd(),
      latestTotalTokens: this.session.latestTotalTokens(),
      permissionMode: this.session.permissionMode(),
      availableTools: this.session.availableTools(),
      // The session-state family the page re-reads (spec remote-control
      // 「Web 页作为第五种宿主」场景 26): current values, not transitions.
      tasks: this.session.tasks(),
      isCompacting: this.session.isCompacting(),
      isCommandRunning: this.session.isCommandRunning(),
      queuedMessages: this.session.queuedMessages(),
      backgroundTasks: this.session.backgroundTasks(),
    };
  }

  private async getMessages(p: Record<string, unknown>): Promise<{
    messages: Message[];
    contextUsagePercent: number;
    reset?: boolean;
  }> {
    const contextUsagePercent = this.session.contextUsagePercent();
    const window: MessageWindow = {};
    if (typeof p.since === "string") window.since = p.since;
    if (p.limit !== undefined) window.limit = Number(p.limit);

    let normalized: MessageWindow | undefined;
    try {
      normalized = normalizeMessageWindow(window);
    } catch (err) {
      if (err instanceof InvalidMessageWindowError)
        throw invalidParams(err.message);
      throw err;
    }
    // No parameters = the whole list the agent holds (spec
    // ui/message-rendering-system.md「首屏就是整份列表」). A `limit` is a tail
    // slice of the same list, for the phone's frame budget.
    //
    // Both answers are trimmed: the phone renders no tool pictures, and its
    // frame budget cannot carry one
    // (specs/ui/stdio-transport.md「工具图片的字节不下发 UI」).
    if (!normalized) {
      return {
        messages: messagesForUi(await this.session.currentThread()),
        contextUsagePercent,
      };
    }
    const page = await this.session.messagePage(normalized);
    return {
      ...page,
      messages: messagesForUi(page.messages),
      contextUsagePercent,
    };
  }

  private listPendingPermissions(): {
    requests: Array<{
      requestId: string;
      sessionId?: string;
      context: ToolPermissionContext;
    }>;
  } {
    const sessionId = this.session.sessionId();
    return {
      requests: this.session.pendingPermissions().map((pending) => ({
        requestId: pending.requestId,
        ...(sessionId ? { sessionId } : {}),
        context: pending.context,
      })),
    };
  }
}
