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

// Escape closes the panel (spec scenario 6). A separate keydown listener is used
// instead of a focused tabIndex container so closing works even while focus is
// inside the message input (the input's own Esc handler is scoped to slash/mention
// popups and would otherwise swallow it).
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
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="btw-panel" data-testid="btw-panel">
      <div className="btw-panel-header">
        {question && (
          <>
            <span className="btw-panel-prefix">/btw </span>
            <span className="btw-panel-question" data-testid="btw-panel-question">{question}</span>
          </>
        )}
        <button
          className="btw-panel-close"
          onClick={onClose}
          aria-label="关闭"
          data-testid="btw-panel-close"
        >
          <i className="codicon codicon-close"></i>
        </button>
      </div>
      {isLoading ? (
        <div className="btw-panel-loading" data-testid="btw-panel-loading">
          <span className="btw-loading-indicator">✻</span>
          <span className="btw-loading-text">Answering...</span>
        </div>
      ) : answer ? (
        <div
          className="btw-panel-answer"
          data-testid="btw-panel-answer"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(answer) }}
        />
      ) : null}
    </div>
  );
};

export default BtwPanel;
