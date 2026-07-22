import type { SessionMetadata } from 'wave-agent-sdk';

export const formatSessionLabel = (session: SessionMetadata): string => {
  // Use firstMessage content if available, limited to 30 characters
  if (session.firstMessage && session.firstMessage.trim()) {
    const content = session.firstMessage.trim();
    return content.length > 30 ? content.substring(0, 30) + '...' : content;
  }

  // No first message yet (e.g. a freshly created session): show a friendly
  // default rather than a bare timestamp.
  return '新会话';
};
