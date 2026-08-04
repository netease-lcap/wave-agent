import React, { useEffect } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import '../styles/BtwPanel.css';

interface BtwPanelProps {
  question: string;
  answer: string;
  isLoading: boolean;
  onClose: () => void;
}

// Escape closes only the panel (spec scenario 9). A capture-phase listener with
// stopPropagation runs before React's synthetic onKeyDown (attached at the root
// container), so the keypress never reaches MessageInput's onAbortMessage and
// the in-flight agent loop keeps running.
const renderMarkdown = (content: string): string => {
  const html = marked.parse(content, { gfm: true, breaks: true });
  const sanitized = DOMPurify.sanitize(html as string, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'b', 'em', 'i', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'a', 'blockquote', 'hr', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'del'
    ],
    ALLOWED_ATTR: ['href', 'title', 'align', 'src', 'alt'],
    ALLOW_DATA_ATTR: false
  });
  return typeof sanitized === 'string' ? sanitized : '';
};

export const BtwPanel: React.FC<BtwPanelProps> = ({ question, answer, isLoading, onClose }) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  return (
    <div className="btw-panel" data-testid="btw-panel">
      <div className="btw-panel-header">
        {/* The prefix is always rendered so the header keeps a title and the
            close button stays on the right even for a bare `/btw` (spec
            scenario 3). */}
        <span className="btw-panel-prefix">/btw </span>
        <span className="btw-panel-question" data-testid="btw-panel-question">{question}</span>
        <button
          className="btw-panel-close"
          onClick={onClose}
          aria-label="关闭"
          data-testid="btw-panel-close"
        >
          <i className="codicon codicon-close"></i>
        </button>
      </div>
      {isLoading && (
        <div className="btw-panel-loading" data-testid="btw-panel-loading">
          <span className="btw-loading-indicator">▋</span>
          <span className="btw-loading-text">正在回答…</span>
        </div>
      )}
      {answer &&
        (isLoading ? (
          // Streaming chunks render as plain text (no markdown flicker while
          // the answer is incomplete); the finished answer is rendered below.
          <div className="btw-panel-streaming" data-testid="btw-panel-streaming">{answer}</div>
        ) : (
          <div
            className="btw-panel-answer"
            data-testid="btw-panel-answer"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(answer) }}
          />
        ))}
    </div>
  );
};

export default BtwPanel;
