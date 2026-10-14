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
 * deliberate (docs/specs/ui/remote-control.md, 前台 CLI 故事):
 *
 * - `listSessions` answers with exactly this session. The phone's list is a
 *   navigation surface, and there is nothing else to navigate to — scanning
 *   disk for older conversations would offer rows that cannot be opened.
 * - The host dies with its process. Nothing here survives the TUI exiting, and
 *   that is the point: a session nobody holds cannot be served, only resumed
 *   (as a new session).
 */

import type {
  Message,
  PermissionDecision,
  PermissionMode,
  SessionMetadata,
  SlashCommand,
  ToolPermissionContext,
} from "wave-agent-sdk";
import { listSessions } from "wave-agent-sdk";
import {
  InvalidMessageWindowError,
  sliceMessageWindow,
  type MessageWindow,
  type MessageWindowResult,
} from "./messageWindow.js";
import type { RemoteControlHost } from "./remoteControlService.js";

/**
 * What this host needs from the front end. Supplied by the chat hook, which
 * owns all of it; every getter must return the **current** value (the host is
 * long-lived and the session underneath it is not).
 */
export interface RemoteControlCliSession {
  /** Empty until the first turn mints one — there is nothing to serve yet. */
  sessionId(): string;
  workdir(): string;
  displayMessages(): Message[];
  contextUsagePercent(): number;
  latestTotalTokens(): number;
  permissionMode(): PermissionMode;
  availableTools(): string[];
  isLoading(): boolean;
  hasRunningBackgroundWork(): boolean;
  hasPendingMessages(): boolean;
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

function firstUserText(messages: Message[]): string | undefined {
  const user = messages.find((message) => message.role === "user");
  if (!user) return undefined;
  for (const block of user.blocks) {
    if (block.type === "text" && typeof block.content === "string") {
      const text = block.content.trim();
      if (text) return text;
    }
  }
  return undefined;
}

export class RemoteControlCliHost implements RemoteControlHost {
  constructor(private readonly session: RemoteControlCliSession) {}

  async handleRequest(method: string, params: unknown): Promise<unknown> {
    const p = (params ?? {}) as Record<string, unknown>;
    switch (method) {
      case "listSessions":
        return this.listSessions();
      case "getSessionInfo":
        return this.getSessionInfo();
      case "getMessages":
        return this.getMessages(p);
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
          // leaving the frame's shape to chance).
          commands: this.session.slashCommands().map((command) => ({
            id: command.id,
            name: command.name,
            description: command.description,
            ...(command.skillSource
              ? { skillSource: command.skillSource }
              : {}),
          })),
        };
      default:
        // The service's white list already rejected anything else; reaching
        // here means the two lists drifted apart, which must be loud.
        throw invalidParams(
          `Method not available for a CLI session: ${method}`,
        );
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
    const firstMessage = firstUserText(this.session.displayMessages());
    return {
      id: sessionId,
      sessionType: "main",
      workdir: this.session.workdir(),
      createdAt: now,
      lastActiveAt: now,
      latestTotalTokens: this.session.latestTotalTokens(),
      ...(firstMessage ? { firstMessage } : {}),
    };
  }

  private getSessionInfo(): {
    sessionId: string;
    workingDirectory: string;
    latestTotalTokens: number;
    permissionMode: PermissionMode;
    availableTools: string[];
  } {
    return {
      sessionId: this.session.sessionId(),
      workingDirectory: this.session.workdir(),
      latestTotalTokens: this.session.latestTotalTokens(),
      permissionMode: this.session.permissionMode(),
      availableTools: this.session.availableTools(),
    };
  }

  private getMessages(p: Record<string, unknown>): {
    messages: Message[];
    contextUsagePercent: number;
    hasMore?: boolean;
    reset?: boolean;
    total?: number;
  } {
    const all = this.session.displayMessages();
    const contextUsagePercent = this.session.contextUsagePercent();
    const window: MessageWindow = {};
    if (typeof p.before === "string") window.before = p.before;
    if (typeof p.since === "string") window.since = p.since;
    if (p.limit !== undefined) window.limit = Number(p.limit);

    let sliced: MessageWindowResult | undefined;
    try {
      sliced = sliceMessageWindow(all, window);
    } catch (err) {
      if (err instanceof InvalidMessageWindowError)
        throw invalidParams(err.message);
      throw err;
    }
    if (!sliced) return { messages: all, contextUsagePercent };
    return { ...sliced, contextUsagePercent };
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
