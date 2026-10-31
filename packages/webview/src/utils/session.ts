import type { Message, SessionMetadata } from "wave-agent-sdk/types";

const DEFAULT_SESSION_TITLE = "新对话";

const truncate = (content: string): string => {
  const trimmed = content.trim();
  return trimmed.length > 30 ? trimmed.substring(0, 30) + "..." : trimmed;
};

/** Extract the first real user message text, used as a session title fallback. */
export const firstUserMessageText = (
  messages?: Message[],
): string | undefined => {
  if (!messages) return undefined;
  for (const message of messages) {
    if (message.role !== "user" || message.isMeta) continue;
    const text = message.blocks
      ?.filter((b) => b.type === "text" || b.type === "compact")
      .map((b) => b.content || "")
      .join("")
      .trim();
    if (text) return text;
  }
  return undefined;
};

export const formatSessionLabel = (session: SessionMetadata): string => {
  // A user-set title wins over the first-message label (spec:
  // session-management.md「会话自定义标题（重命名）」).
  if (session.customTitle && session.customTitle.trim()) {
    return session.customTitle.trim();
  }

  // Use firstMessage content if available, limited to 30 characters
  if (session.firstMessage && session.firstMessage.trim()) {
    return truncate(session.firstMessage);
  }

  // No first message yet (e.g. a freshly created session): show a friendly
  // default rather than a bare timestamp.
  return DEFAULT_SESSION_TITLE;
};

/**
 * Pin the session title from the first user message while it is still in the
 * message list. Compaction later truncates the list to [compact, ...tail
 * rounds] (assistant-only), so deriving after the fact comes up empty and the
 * header would fall back to the default title. An already-set firstMessage
 * always wins.
 */
export const pinSessionTitle = (
  currentSession: SessionMetadata | undefined,
  messages?: Message[],
): SessionMetadata | undefined => {
  if (!currentSession || currentSession.firstMessage) return currentSession;
  const derived = firstUserMessageText(messages);
  return derived
    ? { ...currentSession, firstMessage: derived }
    : currentSession;
};

/**
 * Resolve the header title for the active session. The backend pushes a
 * currentSession without a firstMessage on creation, so once the user sends a
 * message we derive the title from the message list instead of leaving it stuck
 * on the default. Only applies when a session is actually active.
 */
export const getSessionTitle = (
  currentSession: SessionMetadata | undefined,
  messages?: Message[],
): string => {
  if (!currentSession) return DEFAULT_SESSION_TITLE;
  if (currentSession.customTitle && currentSession.customTitle.trim()) {
    return currentSession.customTitle.trim();
  }
  if (currentSession.firstMessage && currentSession.firstMessage.trim()) {
    return truncate(currentSession.firstMessage);
  }
  const derived = firstUserMessageText(messages);
  if (derived) return truncate(derived);
  return DEFAULT_SESSION_TITLE;
};

/**
 * 「最近活跃时间」的相对写法，手机上的会话列表用（`remote/remote-web.md`）：
 * 那一行要和标题、路径挤在同一屏，绝对时间（`toLocaleString`）既长又读不出
 * 「刚才还是昨天」。桌面 / IDE 端仍用绝对时间，不受这里影响。
 */
export const formatLastActive = (at?: string | Date): string => {
  if (!at) return "";
  const ms = at instanceof Date ? at.getTime() : new Date(at).getTime();
  if (Number.isNaN(ms)) return "";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return new Date(ms).toLocaleDateString();
};
