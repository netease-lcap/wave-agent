import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import type { FileViewState } from '../types';
import { toRelativePath } from '../utils/messageUtils';
import '../styles/FilePane.css';

const MIN_WIDTH = 320;

/** Extension → highlight.js language name (subset shipped by hljs/lib/common). */
const EXT_LANGUAGE: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  jsonc: 'json',
  html: 'xml',
  htm: 'xml',
  svg: 'xml',
  xml: 'xml',
  css: 'css',
  scss: 'scss',
  less: 'less',
  yml: 'yaml',
  yaml: 'yaml',
  py: 'python',
  java: 'java',
  go: 'go',
  rs: 'rust',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  sql: 'sql',
  rb: 'ruby',
  php: 'php',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  toml: 'ini',
  ini: 'ini',
  diff: 'diff',
  patch: 'diff',
  makefile: 'makefile',
  mk: 'makefile',
  proto: 'protobuf',
};

const isMarkdownPath = (path: string) => /\.(md|markdown|mdown|mkd)$/i.test(path);

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Split hljs-highlighted HTML into per-line fragments while keeping every
 * line's <span> stack balanced: a token spanning several lines (block comment,
 * template string) would otherwise leak an unclosed span into the next line.
 * Each line closes the open spans at its end and reopens them at its start, so
 * the fragments stay individually valid markup for per-line rendering.
 */
const splitHighlightedHtml = (html: string): string[] => {
  const lines: string[] = [];
  const stack: string[] = [];
  let current = '';
  for (const part of html.split(/(<span[^>]*>|<\/span>|\n)/)) {
    if (!part) continue;
    if (part === '\n') {
      lines.push(current + stack.map(() => '</span>').join(''));
      current = stack.join('');
      continue;
    }
    if (part === '</span>') {
      current += part;
      stack.pop();
      continue;
    }
    if (part.startsWith('<span')) {
      current += part;
      stack.push(part);
      continue;
    }
    current += part;
  }
  if (current || lines.length === 0) lines.push(current);
  return lines;
};

/** Sanitizer whitelist mirrors Message.tsx, plus <span> for hljs highlight classes. */
const sanitizeFileMarkdown = (html: string): string => {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'b', 'em', 'i', 'code', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'ul', 'ol', 'li', 'a', 'blockquote', 'hr', 'img', 'span',
      'table', 'thead', 'tbody', 'tr', 'th', 'td', 'del', 'input',
    ],
    ALLOWED_ATTR: ['href', 'title', 'align', 'type', 'checked', 'disabled', 'class', 'src', 'alt'],
    ALLOW_DATA_ATTR: false,
  });
  return typeof clean === 'string' ? clean : '';
};

/** Syntax-highlight fenced code blocks (the message list renders them plain). */
const fileMarkdownRenderer = new marked.Renderer();
fileMarkdownRenderer.code = (code: string, infostring: string | undefined) => {
  const lang = infostring?.trim().split(/\s+/)[0] ?? '';
  const language = lang && hljs.getLanguage(lang) ? lang : '';
  const highlighted = language
    ? hljs.highlight(code, { language, ignoreIllegals: true }).value
    : escapeHtml(code);
  return `<pre><code class="hljs${language ? ` language-${language}` : ''}">${highlighted}</code></pre>`;
};

const renderFileMarkdown = (content: string): string => {
  const raw = marked.parse(content, { gfm: true, breaks: true, renderer: fileMarkdownRenderer });
  return sanitizeFileMarkdown(typeof raw === 'string' ? raw : content);
};

const HIGHLIGHT_LINE_HEIGHT = 20;

export interface FilePaneProps {
  /** Panel content; null renders the "open a file" placeholder. */
  fileView: FileViewState | null;
  width: number;
  onWidthChange: (width: number) => void;
  maxWidth: number;
  onClose: () => void;
  /** Second-row layout: the width drag anchors the left edge. */
  widthFromLeft?: boolean;
  /** Local sessions only: open the file in the OS default app. */
  onOpenExternal?: (path: string) => void;
  /** Owning pane's effective cwd, for the relative-path title display. */
  workdir?: string;
}

/**
 * Desktop file panel: a read-only viewer for file paths clicked in messages.
 * Local files are read by the host straight from disk; remote files arrive via
 * ssh as base64/text. Renders markdown, syntax-highlights code, keeps long
 * lines scrolling horizontally with a fixed line-number gutter, and jumps to
 * the requested start line when the opener carries one.
 */
export const FilePane: React.FC<FilePaneProps> = ({
  fileView,
  width,
  onWidthChange,
  maxWidth,
  onClose,
  widthFromLeft,
  onOpenExternal,
  workdir,
}) => {
  const asideRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copyTimerRef.current), []);

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    // Keep the handle lit + cursor locked for the whole drag — :hover and the
    // 6px-only col-resize cursor both flicker as the pointer outruns the handle.
    handle.style.background = 'var(--vscode-focusBorder, #007fd4)';
    document.body.classList.add('is-panel-resizing');
    const rect = asideRef.current?.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      const next = widthFromLeft ? ev.clientX - (rect?.left ?? 0) : (rect?.right ?? 0) - ev.clientX;
      onWidthChange(Math.min(Math.max(next, MIN_WIDTH), maxWidth));
    };
    const onUp = () => {
      handle.style.background = '';
      document.body.classList.remove('is-panel-resizing');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const copyPath = useCallback(() => {
    if (!fileView) return;
    const path = fileView.path;
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = path;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {
        /* clipboard unavailable — nothing else to try */
      }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(path).catch(fallback);
    } else {
      fallback();
    }
    setCopied(true);
    window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopied(false), 1500);
  }, [fileView]);

  // Per-line fragments: syntax-highlighted (balanced spans) or plain text.
  const contentLines = useMemo(() => {
    const content = fileView?.content;
    if (!content) return null;
    const raw = content.replace(/\n$/, '');
    const ext = (fileView.path.split('.').pop() ?? '').toLowerCase();
    const language = EXT_LANGUAGE[ext] && hljs.getLanguage(EXT_LANGUAGE[ext]) ? EXT_LANGUAGE[ext] : '';
    if (language) {
      try {
        return splitHighlightedHtml(hljs.highlight(raw, { language, ignoreIllegals: true }).value);
      } catch {
        /* fall back to plain text below */
      }
    }
    return escapeHtml(raw).split('\n');
  }, [fileView?.content, fileView?.path]);

  // Jump to the requested line range on open / file switch.
  useEffect(() => {
    const start = fileView?.startLine;
    const el = scrollRef.current;
    if (!start || !el || !contentLines) return;
    el.scrollTop = Math.max(0, (start - 1) * HIGHLIGHT_LINE_HEIGHT - HIGHLIGHT_LINE_HEIGHT * 1.5);
  }, [fileView?.path, fileView?.startLine, contentLines]);

  const relativePath = useMemo(
    () => (fileView ? toRelativePath(fileView.path, workdir) : ''),
    [fileView, workdir],
  );
  const isLocal = fileView?.host === 'local';
  const markdown = fileView?.content ? isMarkdownPath(fileView.path) : false;

  return (
    <aside
      ref={asideRef}
      className="preview-pane file-pane"
      style={{ width }}
      data-testid="file-pane"
    >
      <div className="preview-pane-drag-handle" onMouseDown={onDragStart} />
      <div className="preview-pane-inner">
        <div className="preview-pane-toolbar">
          <span className="preview-pane-url">文件</span>
          {fileView && isLocal && onOpenExternal && (
            <button
              className="preview-pane-button"
              title="在默认应用中打开"
              data-testid="file-open-external"
              onClick={() => onOpenExternal(fileView.path)}
            >
              <i className="codicon codicon-open-external" />
            </button>
          )}
          {fileView && (
            <button
              className="preview-pane-button"
              title="复制路径"
              data-testid="file-copy-path"
              onClick={copyPath}
            >
              <i className={`codicon codicon-${copied ? 'check' : 'copy'}`} />
            </button>
          )}
          <button
            className="preview-pane-button"
            title="关闭"
            data-testid="file-close"
            onClick={onClose}
          >
            <i className="codicon codicon-close" />
          </button>
        </div>
        <div className="preview-pane-body file-pane-body" ref={scrollRef}>
          {fileView && (
            <div className="file-pane-location">
              <span className={`file-pane-host${isLocal ? ' file-pane-host--local' : ''}`}>
                {isLocal ? '本地' : fileView.host}
              </span>
              <span className="file-pane-path" title={fileView.path}>
                {relativePath || fileView.path}
              </span>
            </div>
          )}
          {!fileView && (
            <div className="desktop-panel-placeholder">
              <i className="codicon codicon-file file-pane-placeholder-icon" />
              <span>点击消息中的文件路径，在此查看文件内容</span>
            </div>
          )}
          {fileView?.error && (
            <div className="file-pane-status">
              <i className="codicon codicon-error file-pane-status-icon" />
              <span>{fileView.error}</span>
            </div>
          )}
          {fileView && !fileView.error && !fileView.content && !fileView.imageBase64 && (
            <div className="desktop-panel-placeholder">
              <i className="codicon codicon-loading codicon-modifier-spin" />
              <span>正在读取文件…</span>
            </div>
          )}
          {fileView?.imageBase64 && !fileView.error && (
            <img
              className="file-pane-image"
              src={fileView.imageBase64}
              alt={relativePath || fileView.path}
            />
          )}
          {fileView?.content && !fileView.error && markdown && (
            <div
              className="message-content markdown-content file-pane-markdown"
              dangerouslySetInnerHTML={{ __html: renderFileMarkdown(fileView.content) }}
            />
          )}
          {fileView?.content && !fileView.error && !markdown && contentLines && (
            <div className="file-pane-code">
              {fileView.truncated && fileView.totalLines !== undefined && (
                <div className="file-pane-truncated-hint">
                  文件共 {fileView.totalLines} 行，仅显示前 {contentLines.length} 行
                </div>
              )}
              {contentLines.map((line, i) => {
                const lineNo = i + 1;
                const active =
                  fileView.startLine !== undefined &&
                  lineNo >= fileView.startLine &&
                  (fileView.endLine === undefined || lineNo <= fileView.endLine);
                return (
                  <div
                    key={i}
                    className={`file-pane-line${active ? ' file-pane-line--active' : ''}`}
                  >
                    <span className="file-pane-line-no">{lineNo}</span>
                    <span
                      className="file-pane-line-code"
                      dangerouslySetInnerHTML={{ __html: line || '&nbsp;' }}
                    />
                  </div>
                );
              })}
              {fileView.truncated && fileView.totalLines === undefined && (
                <div className="file-pane-truncated-hint">文件较大，内容已截断</div>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};

export default FilePane;
