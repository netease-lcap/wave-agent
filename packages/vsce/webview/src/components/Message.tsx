import React from 'react';
import { ContextTag } from './ContextTag';
import { parseMentions } from '../utils/messageUtils';
import { marked } from 'marked';
import { BangBlock } from './BangBlock';
import { Tooltip } from './Tooltip';

// ... (existing imports)
import DOMPurify from 'dompurify';
import { 
  BASH_TOOL_NAME, 
  LSP_TOOL_NAME, 
  WRITE_TOOL_NAME, 
  EDIT_TOOL_NAME, 
  ASK_USER_QUESTION_TOOL_NAME, 
  EXIT_PLAN_MODE_TOOL_NAME 
} from 'wave-agent-sdk/dist/constants/tools.js';
import type { MessageProps, ToolBlock, ImageBlock, TaskNotificationBlock, ReasoningBlock, MessageBlock } from '../types';
import { DiffViewer } from './DiffViewer';
import { MermaidRenderer } from './MermaidRenderer';
import '../styles/Message.css';

// Configure marked for VS Code webview context
marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    listitem(text: string, task: boolean, checked: boolean) {
      if (task) {
        return `<li class="task-list-item${checked ? ' checked' : ''}">${text}</li>`;
      }
      return `<li>${text}</li>`;
    }
  }
});

// Interface for parsed markdown content that may contain mermaid diagrams
interface ParsedMarkdownContent {
  elements: Array<{
    type: 'html' | 'mermaid';
    content: string;
    id?: string;
  }>;
}

// Parse markdown content and extract mermaid blocks
const parseMarkdownWithMermaid = (content: string): ParsedMarkdownContent => {
  if (!content || content.trim() === '') {
    return { elements: [] };
  }

  const elements: Array<{ type: 'html' | 'mermaid'; content: string; id?: string; }> = [];
  
  // Split content by mermaid blocks
  const parts = content.split(/(```mermaid\n[\s\S]*?\n```)/g);
  
  let mermaidIndex = 0;
  
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    
    if (part.match(/^```mermaid\n[\s\S]*?\n```$/)) {
      // This is a mermaid block
      const mermaidContent = part.replace(/^```mermaid\n/, '').replace(/\n```$/, '').trim();
      elements.push({
        type: 'mermaid',
        content: mermaidContent,
        id: `mermaid-${mermaidIndex++}`
      });
    } else if (part.trim()) {
      // This is regular markdown content
      const html = marked.parse(part);
      const sanitizedHtml = DOMPurify.sanitize(html, {
        ALLOWED_TAGS: [
          'p', 'br', 'strong', 'b', 'em', 'i', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 
          'ul', 'ol', 'li', 'a', 'blockquote',
          'table', 'thead', 'tbody', 'tr', 'th', 'td', 'del', 'input'
        ],
        ALLOWED_ATTR: ['href', 'title', 'align', 'type', 'checked', 'disabled', 'class'],
        ALLOW_DATA_ATTR: false,
        FORBID_ATTR: [],
        FORBID_TAGS: []
      });
      
      if (typeof sanitizedHtml === 'string' && sanitizedHtml.trim()) {
        elements.push({
          type: 'html',
          content: sanitizedHtml
        });
      }
    }
  }

  return { elements };
};


export const Message: React.FC<MessageProps> = React.memo((props) => {
  const { message, isStreaming = false, isQueued = false, onRewindToMessage } = props;
  const getMessageClassName = () => {
    const classes = ['message'];
    
    const hasBangBlock = message.blocks?.some(b => b.type === 'bang');

    if (message.role === 'user') {
      if (!hasBangBlock) {
        classes.push('user');
      }
      if (isQueued) {
        classes.push('queued');
      }
    } else if (message.role === 'assistant') {
      classes.push('assistant');
      if (isStreaming) {
        classes.push('streaming');
      }
    }
    
    return classes.join(' ');
  };

  const handleImagePreview = (url: string, name: string) => {
    const modal = document.createElement('div');
    modal.className = 'image-preview-modal';
    modal.onclick = () => document.body.removeChild(modal);
    
    const img = document.createElement('img');
    img.src = url;
    img.alt = name;
    img.onclick = (e) => e.stopPropagation();
    
    const closeBtn = document.createElement('div');
    closeBtn.className = 'image-preview-close';
    closeBtn.innerHTML = '<i class="codicon codicon-close"></i>';
    
    modal.appendChild(img);
    modal.appendChild(closeBtn);
    document.body.appendChild(modal);
  };

  const getAttachedImages = () => {
    const images: Array<{ data: string, filename?: string }> = [];
    message.blocks?.forEach(block => {
      if (block.type === 'image' && block.imageUrls) {
        block.imageUrls.forEach((url) => {
          images.push({ data: url, filename: `图片 ${images.length + 1}` });
        });
      } else if (block.type === 'tool' && block.images) {
        block.images.forEach((img) => {
          images.push({ data: img.data, filename: `图片 ${images.length + 1}` });
        });
      }
    });
    return images;
  };

  const renderMarkdownContent = (content: string, index: number) => {
    const parsed = parseMarkdownWithMermaid(content);
    return (
      <div key={index} className="message-content-container">
        {parsed.elements.map((element, elIndex) => (
          element.type === 'mermaid' ? (
            <MermaidRenderer 
              key={element.id || `mermaid-${index}-${elIndex}`}
              content={element.content}
              vscode={props.vscode}
            />
          ) : (
            <div 
              key={`html-${index}-${elIndex}`}
              className="message-content markdown-content"
              dangerouslySetInnerHTML={{ 
                __html: element.content 
              }}
            />
          )
        ))}
      </div>
    );
  };

  const renderBashIO = (toolBlock: ToolBlock) => {
    const stage = toolBlock.stage;
    
    // Parse the command from parameters
    let command = '';
    let hasValidCommand = false;
    try {
      if (toolBlock.parameters) {
        const params = JSON.parse(toolBlock.parameters);
        command = params.command || '';
        hasValidCommand = !!command;
      }
    } catch {
      // If parsing fails, use compactParams or fallback
      command = toolBlock.compactParams || '';
      hasValidCommand = !!toolBlock.compactParams;
    }

    // Only render bash-specific content if we have a valid command and appropriate stage
    if ((stage === 'running' || stage === 'end') && hasValidCommand) {
      const result = (toolBlock.result || toolBlock.shortResult || '').trim();
      
      if (result) {
        // Show both input and output if result is present (even if running)
        return (
          <div className="bash-command-unified">
            <div className="bash-command-input">
              <span className="bash-prompt">$</span>
              <span className="bash-command">{command}</span>
            </div>
            <div className="bash-command-output">
              {result}
            </div>
          </div>
        );
      } else {
        // Show only input if no result yet
        return (
          <div className="bash-command-input">
            <span className="bash-prompt">$</span>
            <span className="bash-command">{command}</span>
          </div>
        );
      }
    }

    // For all other cases, return null (no additional content)
    return null;
  };

  const renderToolBlock = (toolBlock: ToolBlock, index: number) => {
    // Default tool rendering for all tools (including Bash)
    const compactInfo = toolBlock.stage === 'streaming'
      ? (toolBlock.parameters ? String(toolBlock.parameters).slice(-30) : '')
      : (toolBlock.compactParams || '');
    const toolStatusColor = toolBlock.stage === 'running' || toolBlock.stage === 'streaming'
      ? 'var(--vscode-editorWarning-foreground, #cca700)'
      : toolBlock.success === true
        ? 'var(--vscode-testing-iconPassed, #73c991)'
        : (toolBlock.error || toolBlock.success === false)
          ? 'var(--vscode-testing-iconFailed, #f14c4c)'
          : 'var(--vscode-descriptionForeground, #888)';
    const toolHeader = (
      <div key={index} className="tool-block">
        <span className="tool-status-dot" style={{ color: toolStatusColor }}>●</span> {toolBlock.name || 'Tool'}{compactInfo ? <span className="compact-params"> {compactInfo}</span> : ''}
      </div>
    );

    // Render tool error if it exists (with same style as error blocks)
    const errorContent = (toolBlock as unknown as Record<string, unknown>).error ? (
      <div className="tool-error">
        <pre>{String((toolBlock as unknown as Record<string, unknown>).error)}</pre>
      </div>
    ) : null;

    // For Bash tools, add the bash-specific content below the header
    if (toolBlock.name === BASH_TOOL_NAME) {
      const bashContent = renderBashIO(toolBlock);
      if (bashContent || errorContent) {
        return (
          <div key={index} className="tool-container">
            {toolHeader}
            {bashContent}
            {errorContent}
          </div>
        );
      }
    }
    
    // For LSP tools, show output with max height and no scrolling
    if (toolBlock.name === LSP_TOOL_NAME) {
      return (
        <div key={index} className="tool-container">
          {toolHeader}
          {!errorContent && (
            <div className="lsp-output">
              {(toolBlock.shortResult || toolBlock.result || '').trim()}
            </div>
          )}
          {errorContent}
        </div>
      );
    }
    
    // For file editing tools, show diff below the header only when stage is 'end'
    if (toolBlock.name && [WRITE_TOOL_NAME, EDIT_TOOL_NAME].includes(toolBlock.name)) {
      return (
        <div key={index} className="tool-container">
          {toolHeader}
          {!errorContent && <DiffViewer toolBlock={toolBlock} />}
          {errorContent}
        </div>
      );
    }

    // For AskUserQuestion tools, show the user's answers
    if (toolBlock.name === ASK_USER_QUESTION_TOOL_NAME) {
      let answers: Record<string, unknown> = {};
      let isParsed = false;
      try {
        const result = toolBlock.shortResult || toolBlock.result;
        if (typeof result === 'string') {
          const trimmed = result.trim();
          if (trimmed.startsWith('{')) {
            try {
              let parsed = JSON.parse(trimmed);
              // Handle nested "answers" key if it's the only key
              if (parsed && typeof parsed === 'object' && Object.keys(parsed).length === 1 && parsed.answers && typeof parsed.answers === 'object') {
                parsed = parsed.answers;
              }
              answers = parsed;
              isParsed = true;
            } catch {
              // Try to find the first { and last }
              const start = trimmed.indexOf('{');
              const end = trimmed.lastIndexOf('}');
              if (start !== -1 && end !== -1 && end > start) {
                let parsed = JSON.parse(trimmed.substring(start, end + 1));
                if (parsed && typeof parsed === 'object' && Object.keys(parsed).length === 1 && parsed.answers && typeof parsed.answers === 'object') {
                  parsed = parsed.answers;
                }
                answers = parsed;
                isParsed = true;
              }
            }
          }
        } else if (typeof result === 'object' && result !== null) {
          let parsed: Record<string, unknown> = result as Record<string, unknown>;
          if (Object.keys(parsed).length === 1 && parsed.answers && typeof parsed.answers === 'object') {
            parsed = parsed.answers as Record<string, unknown>;
          }
          answers = parsed;
          isParsed = true;
        }
      } catch {
        // Fallback to raw result
      }

      const result = toolBlock.shortResult || toolBlock.result;
      return (
        <div key={index} className="tool-container">
          {toolHeader}
          {!errorContent && result && (
            <div className="tool-result-block">
              {isParsed ? (
                Object.entries(answers).map(([question, answer], aIndex) => (
                  <div key={aIndex} className="ask-user-result-item">
                    <div className="ask-user-result-text">
                      <span className="ask-user-result-q" style={{ whiteSpace: 'pre-wrap' }}>{question}</span>
                      <span className="ask-user-result-a" style={{ whiteSpace: 'pre-wrap' }}>
                        {Array.isArray(answer) 
                          ? answer.join(', ') 
                          : (typeof answer === 'object' && answer !== null 
                              ? JSON.stringify(answer) 
                              : String(answer))}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="result-raw">{String(result)}</div>
              )}
            </div>
          )}
          {errorContent}
        </div>
      );
    }

    // For ExitPlanMode tools, show the decision
    if (toolBlock.name === EXIT_PLAN_MODE_TOOL_NAME) {
      const result = toolBlock.shortResult || toolBlock.result;
      const resultText = typeof result === 'string' 
        ? result 
        : (result ? JSON.stringify(result) : '');

      return (
        <div key={index} className="tool-container">
          {toolHeader}
          {!errorContent && resultText && (
            <div className="tool-result-block">
              <div className="result-item">
                <div className="result-answer">{resultText}</div>
              </div>
            </div>
          )}
          {errorContent}
        </div>
      );
    }

    // For other tools, show result or shortResult if present
    if ((toolBlock.result || toolBlock.shortResult) && !errorContent) {
      return (
        <div key={index} className="tool-container">
          {toolHeader}
          <div className="tool-result-block">
            <div className="result-raw">{(toolBlock.shortResult || toolBlock.result || '').trim()}</div>
          </div>
        </div>
      );
    }

    // For other tools, show error if present
    if (errorContent) {
      return (
        <div key={index} className="tool-container">
          {toolHeader}
          {errorContent}
        </div>
      );
    }
    
    // For other tools without special content, just return the header
    return toolHeader;
  };

  const renderImageBlock = (imageBlock: ImageBlock, index: number) => {
    if (!imageBlock.imageUrls || imageBlock.imageUrls.length === 0 || message.role === 'user') {
      return null;
    }

    const getImageTypeFromUrl = (url: string): string => {
      // Try to determine type from URL extension or default to IMG
      const extension = url.split('.').pop()?.toLowerCase();
      switch (extension) {
        case 'png': return 'PNG';
        case 'jpg':
        case 'jpeg': return 'JPG';
        case 'gif': return 'GIF';
        case 'webp': return 'WEBP';
        case 'svg': return 'SVG';
        default: return 'IMG';
      }
    };

    return (
      <div key={`image-${index}`} className="image-block">
        {imageBlock.imageUrls.map((imageUrl, imgIndex) => (
          <div key={`img-${index}-${imgIndex}`} className="image-item-message">
            <div className="image-icon">
              <span className="image-type">{getImageTypeFromUrl(imageUrl)}</span>
            </div>
            <div className="image-info">
              <span className="image-name">
                {`Image ${imgIndex + 1}`}
              </span>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderReasoningBlock = (reasoningBlock: ReasoningBlock, index: number) => {
    return (
      <div key={`reasoning-${index}`} className="reasoning-block">
        <div className="reasoning-header">
          <i className="codicon codicon-lightbulb"></i>
          <span>思考过程</span>
        </div>
        <div className="reasoning-content">
          {renderMarkdownContent(reasoningBlock.content || '', index)}
        </div>
      </div>
    );
  };

  const renderTaskNotification = (block: TaskNotificationBlock, index: number) => {
    const statusIcon = block.status === 'completed' ? 'check' : block.status === 'failed' ? 'error' : 'circle-slash';
    const statusLabel = block.status === 'completed' ? '已完成' : block.status === 'failed' ? '失败' : '已终止';
    const statusColor = block.status === 'completed' ? '#3fb950' : block.status === 'failed' ? '#f85149' : '#8b949e';
    return (
      <div key={`task-notification-${index}`} className="task-notification-block" style={{ padding: '8px 12px', margin: '4px 0', borderRadius: '6px', border: `1px solid ${statusColor}40`, background: `${statusColor}0d` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <i className={`codicon codicon-${statusIcon}`} style={{ color: statusColor }}></i>
          <span style={{ fontWeight: 500, fontSize: '12px', color: statusColor }}>{statusLabel}</span>
        </div>
        {block.summary && (
          <div style={{ marginTop: '4px', fontSize: '13px' }}>{block.summary}</div>
        )}
        {block.outputFile && (
          <div style={{ marginTop: '4px', fontSize: '12px', color: '#8b949e' }}>输出: {block.outputFile}</div>
        )}
      </div>
    );
  };

  const renderBlock = (block: MessageBlock, index: number) => {
    switch (block.type) {
      case 'text':
      case 'compact': {
        const content = block.content || '';
        if (!content.trim()) return null;
        
        if (message.role === 'user') {
          const attachedImages = getAttachedImages();
          const parts = parseMentions(content, attachedImages);
          
          return (
            <div key={index} className="user-text-block">
              <div className="message-content user-content">
                {parts.map((part, pIndex) => {
                  if (part.type === 'mention') {
                    const onClick = part.isImage ? () => {
                      if (part.imageData) {
                        handleImagePreview(part.imageData, part.path || 'image');
                      } else {
                        props.vscode.postMessage({
                          command: 'openFile',
                          path: part.path
                        });
                      }
                    } : undefined;

                    return (
                      <ContextTag 
                        key={pIndex}
                        name={part.path?.replace(/[/\\]$/, '').split(/[/\\]/).pop() || ''}
                        path={part.path || ''}
                        isImage={part.isImage}
                        onClick={onClick}
                      />
                    );
                  } else if (part.type === 'selection') {
                    const displayName = `${part.fileName}#${part.startLine}-${part.endLine}`;
                    const filePath = part.path || part.fileName || '';
                    return (
                      <ContextTag 
                        key={pIndex}
                        name={displayName}
                        path={filePath}
                        onClick={() => {
                          props.vscode.postMessage({
                            command: 'openFile',
                            path: filePath,
                            startLine: part.startLine ? parseInt(part.startLine) : undefined,
                            endLine: part.endLine ? parseInt(part.endLine) : undefined
                          });
                        }}
                      />
                    );
                  } else {
                    return <span key={pIndex}>{part.content}</span>;
                  }
                })}
              </div>
            </div>
          );
        }

        return renderMarkdownContent(content, index);
      }
      case 'error':
        return (
          <div key={index} className="message-content error">
            <pre>{block.content || ''}</pre>
          </div>
        );
      case 'tool':
        return renderToolBlock(block as ToolBlock, index);
      case 'bang':
        return <BangBlock key={index} block={block} />;
      case 'image':
        return renderImageBlock(block as ImageBlock, index);
      case 'reasoning':
        return renderReasoningBlock(block, index);
      case 'task_notification':
        return renderTaskNotification(block as TaskNotificationBlock, index);
      default:
        return null;
    }
  };

  return (
    <div className={getMessageClassName()}>
      {message.blocks?.map((block, index) => renderBlock(block, index))}
      {message.role === 'user' && !isQueued && message.id && !message.blocks?.some(b => b.type === 'bang') && (
        <div className="message-actions">
          <Tooltip text="回滚到此消息" position="left">
            <button 
              className="message-action-btn" 
              onClick={() => onRewindToMessage?.(message.id!)}
            >
              <i className="codicon codicon-history"></i>
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}, (prev, next) => {
  // Custom comparison for React.memo
  return prev.message === next.message &&
    prev.isStreaming === next.isStreaming &&
    prev.isQueued === next.isQueued;
});
