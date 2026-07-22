import type { Message, SessionMetadata } from 'wave-agent-sdk';

const DEFAULT_SESSION_TITLE = '新会话';

const truncate = (content: string): string => {
  const trimmed = content.trim();
  return trimmed.length > 30 ? trimmed.substring(0, 30) + '...' : trimmed;
};

/** Extract the first real user message text, used as a session title fallback. */
const firstUserMessageText = (messages?: Message[]): string | undefined => {
  if (!messages) return undefined;
  for (const message of messages) {
    if (message.role !== 'user' || message.isMeta) continue;
    const text = message.blocks
      ?.filter((b) => b.type === 'text' || b.type === 'compact')
      .map((b) => b.content || '')
      .join('')
      .trim();
    if (text) return text;
  }
  return undefined;
};

export const formatSessionLabel = (session: SessionMetadata): string => {
  // Use firstMessage content if available, limited to 30 characters
  if (session.firstMessage && session.firstMessage.trim()) {
    return truncate(session.firstMessage);
  }

  // No first message yet (e.g. a freshly created session): show a friendly
  // default rather than a bare timestamp.
  return DEFAULT_SESSION_TITLE;
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
  if (currentSession.firstMessage && currentSession.firstMessage.trim()) {
    return truncate(currentSession.firstMessage);
  }
  const derived = firstUserMessageText(messages);
  if (derived) return truncate(derived);
  return DEFAULT_SESSION_TITLE;
};
