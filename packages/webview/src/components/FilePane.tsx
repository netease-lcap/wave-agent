import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import type { FileItem, FileViewState, VsCodeApi } from "../types";
import { toRelativePath } from "../utils/messageUtils";
import { FileSuggestionDropdown } from "./FileSuggestionDropdown";
import "../styles/FilePane.css";

const MIN_WIDTH = 320;

/** Debounce for the panel search requests, matching the message input's. */
const SEARCH_DEBOUNCE_MS = 200;

/** Extension → highlight.js language name (subset shipped by hljs/lib/common). */
const EXT_LANGUAGE: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",
  json: "json",
  jsonc: "json",
  html: "xml",
  htm: "xml",
  svg: "xml",
  xml: "xml",
  css: "css",
  scss: "scss",
  less: "less",
  yml: "yaml",
  yaml: "yaml",
  py: "python",
  java: "java",
  go: "go",
  rs: "rust",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  rb: "ruby",
  php: "php",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  toml: "ini",
  ini: "ini",
  diff: "diff",
  patch: "diff",
  makefile: "makefile",
  mk: "makefile",
  proto: "protobuf",
};

const isMarkdownPath = (path: string) =>
  /\.(md|markdown|mdown|mkd)$/i.test(path);

/** Trim the middle of an over-long path so the file name stays intact; the
    full path remains available on hover (title). Falls back to a plain split
    when the file name alone exceeds the limit. */
const middleEllipsis = (text: string, max = 48): string => {
  if (text.length <= max) return text;
  const fileName = text.slice(text.lastIndexOf("/") + 1);
  const headMax = max - fileName.length - 1; // -1 for the ellipsis
  if (headMax > 8) return `${text.slice(0, headMax)}…${fileName}`;
  const head = Math.ceil((max - 1) / 2);
  return `${text.slice(0, head)}…${text.slice(-(max - 1 - head))}`;
};

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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
  let current = "";
  for (const part of html.split(/(<span[^>]*>|<\/span>|\n)/)) {
    if (!part) continue;
    if (part === "\n") {
      lines.push(current + stack.map(() => "</span>").join(""));
      current = stack.join("");
      continue;
    }
    if (part === "</span>") {
      current += part;
      stack.pop();
      continue;
    }
    if (part.startsWith("<span")) {
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
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "code",
      "pre",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "ul",
      "ol",
      "li",
      "a",
      "blockquote",
      "hr",
      "img",
      "span",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "del",
      "input",
    ],
    ALLOWED_ATTR: [
      "href",
      "title",
      "align",
      "type",
      "checked",
      "disabled",
      "class",
      "src",
      "alt",
    ],
    ALLOW_DATA_ATTR: false,
  });
  return typeof clean === "string" ? clean : "";
};

/** Syntax-highlight fenced code blocks (the message list renders them plain). */
const fileMarkdownRenderer = new marked.Renderer();
fileMarkdownRenderer.code = (code: string, infostring: string | undefined) => {
  const lang = infostring?.trim().split(/\s+/)[0] ?? "";
  const language = lang && hljs.getLanguage(lang) ? lang : "";
  const highlighted = language
    ? hljs.highlight(code, { language, ignoreIllegals: true }).value
    : escapeHtml(code);
  return `<pre><code class="hljs${language ? ` language-${language}` : ""}">${highlighted}</code></pre>`;
};

/** Shared markdown renderer (marked → hljs → DOMPurify). Reused by PlanPane. */
export const renderFileMarkdown = (content: string): string => {
  const raw = marked.parse(content, {
    gfm: true,
    breaks: true,
    renderer: fileMarkdownRenderer,
  });
  return sanitizeFileMarkdown(typeof raw === "string" ? raw : content);
};

const HIGHLIGHT_LINE_HEIGHT = 20;

export interface FilePaneProps {
  /** Panel content; null renders the "open a file" placeholder. */
  fileView: FileViewState | null;
  width: number;
  onWidthChange: (width: number) => void;
  maxWidth: number;
  /** Local sessions only: open the file in the OS default app. */
  onOpenExternal?: (path: string) => void;
  /** Owning pane's effective cwd, for the relative-path title display. */
  workdir?: string;
  /** Host bridge for the top search bar. Absent → the search bar is hidden. */
  vscode?: VsCodeApi;
  /** Open a file in the panel (same flow as clicking a message file path). */
  onOpenFileInPanel?: (path: string) => void;
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
  onOpenExternal,
  workdir,
  vscode,
  onOpenFileInPanel,
}) => {
  const asideRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchPopoverRef = useRef<HTMLDivElement>(null);
  const searchInputRowRef = useRef<HTMLDivElement>(null);

  // Search popover: the toolbar's search icon toggles a floating panel (input +
  // suggestions). Host broadcasts fileSuggestionsResponse to every pane;
  // requestId dedupes it.
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");
  const [searchSuggestions, setSearchSuggestions] = useState<FileItem[]>([]);
  const [searchSelectedIndex, setSearchSelectedIndex] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchActive, setSearchActive] = useState(false);
  const searchRequestIdRef = useRef("");
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** The panel can only display files, not directories. */
  const fileSuggestions = useMemo(
    () => searchSuggestions.filter((s) => !s.isDirectory),
    [searchSuggestions],
  );

  const requestSearch = useCallback(
    (filterText: string) => {
      if (!vscode) return;
      const requestId = Date.now().toString();
      searchRequestIdRef.current = requestId;
      setSearchLoading(true);
      vscode.postMessage({
        command: "requestFileSuggestions",
        filterText,
        requestId,
      });
    },
    [vscode],
  );

  const resetSearch = useCallback(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = null;
    setSearchFilter("");
    setSearchSuggestions([]);
    setSearchSelectedIndex(0);
    setSearchLoading(false);
    setSearchActive(false);
  }, []);

  /** Close the whole popover and clear the search state. */
  const closeSearch = useCallback(() => {
    resetSearch();
    setSearchOpen(false);
  }, [resetSearch]);

  // Open: reset + autofocus. The actual empty-filter request fires from the
  // input's onFocus (handled below) so the dropdown populates immediately —
  // empty filter returns the workspace's top files, acting as a file picker.
  const openSearch = useCallback(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = null;
    setSearchFilter("");
    setSearchSuggestions([]);
    setSearchSelectedIndex(0);
    setSearchLoading(false);
    setSearchActive(true);
    setSearchOpen(true);
  }, []);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  // Dismiss when clicking outside the popover (and not on the trigger button).
  useEffect(() => {
    if (!searchOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (searchPopoverRef.current?.contains(target)) return;
      const trigger = document.querySelector(
        "[data-testid='file-pane-search-trigger']",
      );
      if (trigger?.contains(target)) return;
      closeSearch();
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [searchOpen, closeSearch]);

  const handleSearchFocus = useCallback(() => {
    setSearchActive(true);
    requestSearch("");
  }, [requestSearch]);

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchFilter(value);
      setSearchSelectedIndex(0);
      // Selecting a file resets the search (searchActive=false) while focus
      // stays in the input, so typing again must re-activate the dropdown —
      // onFocus won't fire again until the input loses and regains focus.
      setSearchActive(true);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = setTimeout(() => {
        searchDebounceRef.current = null;
        requestSearch(value);
      }, SEARCH_DEBOUNCE_MS);
    },
    [requestSearch],
  );

  const handleSearchSelect = useCallback(
    (file: FileItem) => {
      closeSearch();
      onOpenFileInPanel?.(file.path);
    },
    [closeSearch, onOpenFileInPanel],
  );

  const handleSearchKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (fileSuggestions.length === 0) {
        if (event.key === "Escape") closeSearch();
        return;
      }
      const maxIndex = fileSuggestions.length - 1;
      switch (event.key) {
        case "ArrowUp":
          event.preventDefault();
          setSearchSelectedIndex((prev) => Math.max(0, prev - 1));
          break;
        case "ArrowDown":
          event.preventDefault();
          setSearchSelectedIndex((prev) => Math.min(maxIndex, prev + 1));
          break;
        case "Enter":
          event.preventDefault();
          if (fileSuggestions[searchSelectedIndex]) {
            handleSearchSelect(fileSuggestions[searchSelectedIndex]);
          }
          break;
        case "Escape":
          event.preventDefault();
          closeSearch();
          break;
      }
    },
    [fileSuggestions, searchSelectedIndex, handleSearchSelect, closeSearch],
  );

  // Listen for the host's file suggestions reply (same channel as @ mention).
  useEffect(() => {
    if (!vscode) return;
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (data.command === "fileSuggestionsResponse") {
        if (data.requestId !== searchRequestIdRef.current) return;
        setSearchSuggestions(data.suggestions || []);
        setSearchSelectedIndex(0);
        setSearchLoading(false);
      } else if (data.command === "fileSuggestionsError") {
        if (data.requestId !== searchRequestIdRef.current) return;
        setSearchSuggestions([]);
        setSearchLoading(false);
        console.error("文件搜索失败:", data.error);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [vscode]);

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    // Keep the handle lit + cursor locked for the whole drag — :hover and the
    // 6px-only col-resize cursor both flicker as the pointer outruns the handle.
    handle.style.background = "var(--vscode-focusBorder, #007fd4)";
    document.body.classList.add("is-panel-resizing");
    const rect = asideRef.current?.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      const next = (rect?.right ?? 0) - ev.clientX;
      onWidthChange(Math.min(Math.max(next, MIN_WIDTH), maxWidth));
    };
    const onUp = () => {
      handle.style.background = "";
      document.body.classList.remove("is-panel-resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Per-line fragments: syntax-highlighted (balanced spans) or plain text.
  const contentLines = useMemo(() => {
    const content = fileView?.content;
    if (!content) return null;
    const raw = content.replace(/\n$/, "");
    const ext = (fileView.path.split(".").pop() ?? "").toLowerCase();
    const language =
      EXT_LANGUAGE[ext] && hljs.getLanguage(EXT_LANGUAGE[ext])
        ? EXT_LANGUAGE[ext]
        : "";
    if (language) {
      try {
        return splitHighlightedHtml(
          hljs.highlight(raw, { language, ignoreIllegals: true }).value,
        );
      } catch {
        /* fall back to plain text below */
      }
    }
    return escapeHtml(raw).split("\n");
  }, [fileView?.content, fileView?.path]);

  // Jump to the requested line range on open / file switch.
  useEffect(() => {
    const start = fileView?.startLine;
    const el = scrollRef.current;
    if (!start || !el || !contentLines) return;
    el.scrollTop = Math.max(
      0,
      (start - 1) * HIGHLIGHT_LINE_HEIGHT - HIGHLIGHT_LINE_HEIGHT * 1.5,
    );
  }, [fileView?.path, fileView?.startLine, contentLines]);

  const relativePath = useMemo(
    () => (fileView ? toRelativePath(fileView.path, workdir) : ""),
    [fileView, workdir],
  );
  const isLocal = fileView?.host === "local";
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
        <div className="preview-pane-toolbar" ref={toolbarRef}>
          {fileView ? (
            <>
              <span className="file-pane-host">
                {isLocal ? "本地" : fileView.host}
              </span>
              <span className="file-pane-path" title={fileView.path}>
                {middleEllipsis(relativePath || fileView.path)}
              </span>
            </>
          ) : (
            <span className="desktop-panel-toolbar-title">文件</span>
          )}
          {fileView && isLocal && onOpenExternal && (
            <button
              className="preview-pane-button"
              title="在默认应用中打开"
              data-testid="file-open-external"
              onClick={() => onOpenExternal(fileView.path)}
            >
              <i className="codicon codicon-link-external" />
            </button>
          )}
          {vscode && (
            <button
              type="button"
              className={`preview-pane-button file-pane-search-trigger${searchOpen ? " active" : ""}`}
              data-testid="file-pane-search-trigger"
              title={searchOpen ? "收起文件搜索" : "搜索文件"}
              aria-label="搜索文件"
              aria-expanded={searchOpen}
              onClick={searchOpen ? closeSearch : openSearch}
            >
              <i className="codicon codicon-search" />
            </button>
          )}
        </div>
        {vscode && searchOpen && (
          <div
            className="file-pane-search-popover"
            ref={searchPopoverRef}
            data-testid="file-pane-search-popover"
            style={{
              top: (toolbarRef.current?.offsetHeight ?? 28) + 6,
            }}
          >
            <div className="file-pane-search-input-row" ref={searchInputRowRef}>
              <i className="codicon codicon-search file-pane-search-icon" />
              <input
                ref={searchInputRef}
                className="file-pane-search-input"
                data-testid="file-pane-search-input"
                placeholder="搜索文件…"
                value={searchFilter}
                onChange={(e) => handleSearchChange(e.target.value)}
                onFocus={handleSearchFocus}
                onKeyDown={handleSearchKeyDown}
              />
            </div>
            <FileSuggestionDropdown
              suggestions={fileSuggestions}
              isVisible={
                searchActive &&
                (searchFilter !== "" ||
                  searchLoading ||
                  fileSuggestions.length > 0)
              }
              selectedIndex={searchSelectedIndex}
              onSelect={handleSearchSelect}
              onClose={resetSearch}
              disableClickOutside
              position={{
                top: (searchInputRowRef.current?.offsetHeight ?? 28) + 6,
                left: 0,
              }}
              filterText={searchFilter}
              isLoading={searchLoading}
              direction="down"
            />
          </div>
        )}
        <div className="preview-pane-body file-pane-body" ref={scrollRef}>
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
          {fileView &&
            !fileView.error &&
            !fileView.content &&
            !fileView.imageBase64 && (
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
              dangerouslySetInnerHTML={{
                __html: renderFileMarkdown(fileView.content),
              }}
            />
          )}
          {fileView?.content &&
            !fileView.error &&
            !markdown &&
            contentLines && (
              <div className="file-pane-code">
                {fileView.truncated && fileView.totalLines !== undefined && (
                  <div className="file-pane-truncated-hint">
                    文件共 {fileView.totalLines} 行，仅显示前{" "}
                    {contentLines.length} 行
                  </div>
                )}
                {contentLines.map((line, i) => {
                  const lineNo = i + 1;
                  const active =
                    fileView.startLine !== undefined &&
                    lineNo >= fileView.startLine &&
                    (fileView.endLine === undefined ||
                      lineNo <= fileView.endLine);
                  return (
                    <div
                      key={i}
                      className={`file-pane-line${active ? " file-pane-line--active" : ""}`}
                    >
                      <span className="file-pane-line-no">{lineNo}</span>
                      <span
                        className="file-pane-line-code"
                        dangerouslySetInnerHTML={{ __html: line || "&nbsp;" }}
                      />
                    </div>
                  );
                })}
                {fileView.truncated && fileView.totalLines === undefined && (
                  <div className="file-pane-truncated-hint">
                    文件较大，内容已截断
                  </div>
                )}
              </div>
            )}
        </div>
      </div>
    </aside>
  );
};

export default FilePane;
