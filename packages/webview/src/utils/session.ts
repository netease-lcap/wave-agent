import type { SessionMetadata } from 'wave-agent-sdk';

export const formatSessionLabel = (session: SessionMetadata): string => {
  // Use firstMessage content if available, limited to 30 characters
  if (session.firstMessage && session.firstMessage.trim()) {
    const content = session.firstMessage.trim();
    return content.length > 30 ? content.substring(0, 30) + '...' : content;
  }

  // Fallback to date/time format
  const date = new Date(session.lastActiveAt).toLocaleDateString();
  const time = new Date(session.lastActiveAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
};
