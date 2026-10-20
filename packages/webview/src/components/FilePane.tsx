import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { createPortal } from "react-dom";
import hljs from "../utils/highlight";
import type { FileItem, FileViewState, VsCodeApi } from "../types";
import { formatCodeComment } from "../utils/codeComment";
import { toRelativePath } from "../utils/messageUtils";
import { useClickOutside } from "../utils/useClickOutside";
import { useHostMessage } from "../utils/useHostMessage";
import { FileSuggestionDropdown } from "./FileSuggestionDropdown";
import { OpenBrowserIcon, SearchIcon } from "./HeaderIcons";
import { LineCommentBox } from "./LineCommentBox";
import { PanelKindIcon } from "./PanelKindIcon";
import { PanePlaceholder, PaneShell } from "./PaneShell";
import { Tooltip } from "./Tooltip";
import "../styles/FilePane.css";

/** Debounce for the panel search requests, matching the message input's. */
const SEARCH_DEBOUNCE_MS = 200;

/** Extension → highlight.js language name (registered in utils/highlight.ts). */
export const EXT_LANGUAGE: Record<string, string> = {
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

/**
 * Class marked on every commentable block of a rendered markdown file. Only the
 * file panel asks for it (via `annotateBlocks`); PlanPane and the message list
 * keep the plain render, so nothing else gains hover targets.
 */
export const MD_COMMENT_BLOCK_CLASS = "md-comment-block";

/**
 * Block-level nodes a markdown comment can anchor to (spec
 * `desktop-panels.md`「文件面板评论」场景 8): the outermost of these wins, so a
 * paragraph inside a list item resolves to the list item and a heading inside a
 * quote resolves to the quote. Containers (`ul` / `table` / `tbody` / `tr`) are
 * deliberately left out — nobody points at "the list", they point at an item.
 */
const MD_COMMENT_BLOCK_SELECTOR = "p,h1,h2,h3,h4,h5,h6,blockquote,li,pre,td,th";

/**
 * Tag commentable blocks in the *sanitized* html. Sanitization has to come
 * first: this is a pure DOM pass on already-clean markup (and DOMPurify would
 * strip a `data-` anchor anyway, since data attributes are not allow-listed
 * here). The class itself is allow-listed, so nothing new becomes injectable.
 */
const annotateMarkdownBlocks = (html: string): string => {
  if (typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.body.querySelectorAll(MD_COMMENT_BLOCK_SELECTOR).forEach((el) => {
    el.classList.add(MD_COMMENT_BLOCK_CLASS);
  });
  return doc.body.innerHTML;
};

/**
 * Tags whose text has to be kept apart when a block's text becomes a quote —
 * without this, two paragraphs inside one list item read as one run-on word.
 * Inline elements (code, strong, a) are left alone so their text stays glued
 * to the sentence around it.
 */
const BLOCK_LEVEL_TAGS = new Set([
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "UL",
  "OL",
  "PRE",
  "BLOCKQUOTE",
  "TD",
  "TH",
  "TR",
  "TABLE",
  "THEAD",
  "TBODY",
]);

/** The text a markdown block contributes to the appended comment quote. */
const blockQuoteText = (el: HTMLElement): string => {
  const parts: string[] = [];
  el.childNodes.forEach((node) => {
    const text = node.textContent ?? "";
    if (
      node.nodeType === 1 &&
      BLOCK_LEVEL_TAGS.has((node as HTMLElement).tagName)
    ) {
      parts.push(` ${text} `);
    } else {
      parts.push(text);
    }
  });
  return parts.join("").replace(/\s+/g, " ").trim();
};

/** Shared markdown renderer (marked → hljs → DOMPurify). Reused by PlanPane. */
export const renderFileMarkdown = (
  content: string,
  options?: { annotateBlocks?: boolean },
): string => {
  const raw = marked.parse(content, {
    gfm: true,
    breaks: true,
    renderer: fileMarkdownRenderer,
  });
  const clean = sanitizeFileMarkdown(typeof raw === "string" ? raw : content);
  return options?.annotateBlocks ? annotateMarkdownBlocks(clean) : clean;
};

const HIGHLIGHT_LINE_HEIGHT = 20;

export interface FilePaneProps {
  /** Panel content; null renders the "open a file" placeholder. */
  fileView: FileViewState | null;
  width: number;
  /** Local sessions only: open the file in the OS default app. */
  onOpenExternal?: (path: string) => void;
  /** Owning pane's effective cwd, for the relative-path title display. */
  workdir?: string;
  /** Host bridge for the top search bar. Absent → the search bar is hidden. */
  vscode?: VsCodeApi;
  /** Open a file in the panel (same flow as clicking a message file path). */
  onOpenFileInPanel?: (path: string) => void;
  /**
   * Receives a formatted line comment; appended to the chat input. Absent →
   * the code view renders no comment buttons at all.
   */
  onAddComment?: (text: string) => void;
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
  onOpenExternal,
  workdir,
  vscode,
  onOpenFileInPanel,
  onAddComment,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchPopoverRef = useRef<HTMLDivElement>(null);
  const searchTriggerRef = useRef<HTMLButtonElement>(null);

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
  // Listener registered one tick later inside useClickOutside.
  useClickOutside({
    refs: [searchPopoverRef, searchTriggerRef],
    enabled: searchOpen,
    onClickOutside: closeSearch,
  });

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
  // Routing is by requestId (request correlation), not message.paneId.
  useHostMessage((data) => {
    if (!vscode) return;
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
  });

  // Clear a pending search debounce on unmount (was the listener effect's
  // cleanup before the message listener moved into useHostMessage).
  useEffect(
    () => () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    },
    [],
  );

  // Per-line fragments: syntax-highlighted (balanced spans) or plain text.
  // `text` is kept alongside `html` because a line comment quotes the source,
  // not the highlighted markup.
  const contentLines = useMemo(() => {
    const content = fileView?.content;
    if (!content) return null;
    const raw = content.replace(/\n$/, "");
    const rawLines = raw.split("\n");
    const ext = (fileView.path.split(".").pop() ?? "").toLowerCase();
    const language =
      EXT_LANGUAGE[ext] && hljs.getLanguage(EXT_LANGUAGE[ext])
        ? EXT_LANGUAGE[ext]
        : "";
    let highlighted: string[] | null = null;
    if (language) {
      try {
        highlighted = splitHighlightedHtml(
          hljs.highlight(raw, { language, ignoreIllegals: true }).value,
        );
      } catch {
        /* fall back to plain text below */
      }
    }
    return rawLines.map((text, i) => ({
      text,
      // `&nbsp;` keeps an empty line from collapsing to zero height.
      html: highlighted?.[i] || escapeHtml(text) || "&nbsp;",
    }));
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

  // Inline line comments — the same interaction as the diff pane: hovering a
  // line reveals a "+" button, clicking opens a box under that line, and the
  // submitted comment is appended to the chat input (never sent directly, and
  // never kept in the panel). Only the code view can host them by line: an
  // image has no lines at all, and a markdown file has no line numbers once
  // rendered (it gets block comments instead, below).
  const [commentLine, setCommentLine] = useState<number | null>(null);
  const [commentDraft, setCommentDraft] = useState("");

  // Markdown block comments (spec「文件面板评论」场景 8): same interaction and
  // same append format as line comments, anchored to a rendered block. Nothing
  // is persisted — the anchor only has to be valid at submit time, which is why
  // this needs no source offsets and no re-anchoring. The box itself is a portal
  // into a holder element spliced in after the block, so it pushes the document
  // down instead of covering the block that follows.
  const mdWrapRef = useRef<HTMLDivElement | null>(null);
  const mdHolderRef = useRef<HTMLDivElement | null>(null);
  const [mdHover, setMdHover] = useState<{
    el: HTMLElement;
    top: number;
  } | null>(null);
  const [mdComment, setMdComment] = useState<{
    quote: string;
    holder: HTMLDivElement;
  } | null>(null);

  const mdHtml = useMemo(
    () =>
      fileView?.content && markdown
        ? renderFileMarkdown(fileView.content, {
            annotateBlocks: Boolean(onAddComment),
          })
        : "",
    [fileView?.content, markdown, onAddComment],
  );

  const closeComment = useCallback(() => {
    setCommentLine(null);
    setCommentDraft("");
  }, []);

  const closeMdComment = useCallback(() => {
    // Detach the holder before React unmounts the portal into it: the element
    // survives (only its tree position goes away), so the unmount is harmless.
    mdHolderRef.current?.remove();
    mdHolderRef.current = null;
    setMdComment(null);
    setCommentDraft("");
  }, []);

  // Unmount safety net — a pane torn down with the box open must not leave the
  // holder (with its draft) sitting in the document.
  useEffect(
    () => () => {
      mdHolderRef.current?.remove();
      mdHolderRef.current = null;
    },
    [],
  );

  // A different file — or a fresh read of the same one — invalidates both the
  // open box and its draft: the line it pointed at may no longer be there
  // (spec「文件面板行评论」场景 5). Same for the markdown block anchor.
  useEffect(() => {
    closeComment();
    closeMdComment();
    setMdHover(null);
  }, [fileView?.path, fileView?.content, closeComment, closeMdComment]);

  /**
   * Track which block the pointer is over. The outermost commentable block
   * wins — a paragraph inside a list item resolves to the list item, a heading
   * inside a quote to the quote — and the button is positioned against the
   * wrapper, so it stays glued to the block while the panel scrolls.
   */
  const handleMarkdownHover = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!onAddComment || mdComment) return;
      const wrap = mdWrapRef.current;
      const target = event.target as HTMLElement;
      let block = target.closest?.(
        `.${MD_COMMENT_BLOCK_CLASS}`,
      ) as HTMLElement | null;
      if (!wrap || !block) {
        setMdHover((prev) => (prev ? null : prev));
        return;
      }
      for (
        let parent = block.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        const outer = parent.closest(`.${MD_COMMENT_BLOCK_CLASS}`);
        if (!outer) break;
        block = outer as HTMLElement;
      }
      const top =
        block.getBoundingClientRect().top - wrap.getBoundingClientRect().top;
      setMdHover((prev) => (prev?.el === block ? prev : { el: block, top }));
    },
    [onAddComment, mdComment],
  );

  const openMdComment = useCallback(() => {
    if (!mdHover) return;
    const quote = blockQuoteText(mdHover.el);
    // One holder at a time: a previous box (if any) is closed first.
    mdHolderRef.current?.remove();
    const holder = document.createElement("div");
    holder.className = "md-block-comment-holder";
    mdHover.el.insertAdjacentElement("afterend", holder);
    mdHolderRef.current = holder;
    setMdComment({ quote, holder });
    setCommentDraft("");
    setMdHover(null);
  }, [mdHover]);

  const submitMdComment = useCallback(() => {
    const comment = commentDraft.trim();
    if (!mdComment || !comment || !onAddComment || !fileView) return;
    onAddComment(
      formatCodeComment({
        path: relativePath || fileView.path,
        text: mdComment.quote,
        comment,
      }),
    );
    closeMdComment();
  }, [
    commentDraft,
    mdComment,
    onAddComment,
    fileView,
    relativePath,
    closeMdComment,
  ]);

  const submitComment = useCallback(() => {
    const comment = commentDraft.trim();
    if (commentLine === null || !comment || !onAddComment || !fileView) return;
    onAddComment(
      formatCodeComment({
        path: relativePath || fileView.path,
        line: commentLine,
        text: contentLines?.[commentLine - 1]?.text,
        comment,
      }),
    );
    closeComment();
  }, [
    commentDraft,
    commentLine,
    onAddComment,
    fileView,
    relativePath,
    contentLines,
    closeComment,
  ]);

  const commentTag = relativePath || fileView?.path || "";

  return (
    <PaneShell
      kind="file-pane"
      dataTestId="file-pane"
      width={width}
      toolbarRef={toolbarRef}
      toolbar={
        <>
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
          {/* 1009 评论（三处工具条气泡同族收齐的其中一处）：文件面板工具条的
              两颗图标按钮从原生 `title` 换成桌面端自绘气泡（`Tooltip`，
              `position="bottom"`，与预览面板工具条同档）。原 `title` 文案原样
              搬进气泡；`title` 移除以免 OS 原生气泡叠成两层。
              - 「在默认应用中打开」：原 `title`/气泡文案一致，`aria-label` 同文案。
              - 搜索触发器：气泡文案跟随状态（原 `title` 就是动态的），
                而 `aria-label` 保持稳定的「搜索文件」（改的是开关，名字不该跟着翻）。 */}
          {fileView && isLocal && onOpenExternal && (
            <Tooltip text="在默认应用中打开" position="bottom">
              <button
                className="preview-pane-button"
                aria-label="在默认应用中打开"
                data-testid="file-open-external"
                onClick={() => onOpenExternal(fileView.path)}
              >
                <OpenBrowserIcon className="preview-pane-icon" />
              </button>
            </Tooltip>
          )}
          {vscode && (
            <Tooltip
              text={searchOpen ? "收起文件搜索" : "搜索文件"}
              position="bottom"
            >
              <button
                type="button"
                ref={searchTriggerRef}
                className={`preview-pane-button file-pane-search-trigger${searchOpen ? " active" : ""}`}
                data-testid="file-pane-search-trigger"
                aria-label="搜索文件"
                aria-expanded={searchOpen}
                onClick={searchOpen ? closeSearch : openSearch}
              >
                <SearchIcon className="preview-pane-icon" />
              </button>
            </Tooltip>
          )}
        </>
      }
      betweenToolbarAndBody={
        vscode &&
        searchOpen && (
          <div
            className="file-pane-search-popover"
            ref={searchPopoverRef}
            data-testid="file-pane-search-popover"
            style={{
              top: (toolbarRef.current?.offsetHeight ?? 28) + 6,
            }}
          >
            <div className="file-pane-search-input-row">
              <SearchIcon className="file-pane-search-icon" />
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
              filterText={searchFilter}
              isLoading={searchLoading}
              direction="down"
            />
          </div>
        )
      }
      bodyClassName="preview-pane-body file-pane-body"
      bodyRef={scrollRef}
    >
      {!fileView && (
        <PanePlaceholder className="file-pane-placeholder-empty">
          {/* Figma 文件面板空态：图标在上 24px、文案在下（评论 2026-09）。 */}
          <PanelKindIcon
            kind="file"
            size={24}
            className="file-pane-placeholder-icon"
          />
          <span>点击消息中的文件路径，在此查看文件内容</span>
        </PanePlaceholder>
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
          <PanePlaceholder>
            <i className="codicon codicon-loading codicon-modifier-spin" />
            <span>正在读取文件…</span>
          </PanePlaceholder>
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
          className="file-pane-markdown-wrap"
          ref={mdWrapRef}
          onMouseOver={handleMarkdownHover}
          onMouseLeave={() => setMdHover(null)}
        >
          <div
            className="message-content markdown-content file-pane-markdown"
            dangerouslySetInnerHTML={{ __html: mdHtml }}
          />
          {/* Revealed on hover of a block rather than by CSS: the button only
              exists while a block is actually under the pointer, which is also
              what keeps it off images (an image has no block to anchor to). */}
          {mdHover && onAddComment && !mdComment && (
            <button
              className="line-comment-btn md-block-comment-btn"
              style={{ top: mdHover.top }}
              title="评论这段"
              aria-label="评论这段"
              data-testid="md-block-comment-add"
              onClick={openMdComment}
            >
              <i className="codicon codicon-add" />
            </button>
          )}
          {mdComment &&
            createPortal(
              <LineCommentBox
                draft={commentDraft}
                onDraftChange={setCommentDraft}
                onSubmit={submitMdComment}
                onCancel={closeMdComment}
                tag={commentTag}
                placeholder="评论这段…"
              />,
              mdComment.holder,
            )}
        </div>
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
              <React.Fragment key={i}>
                <div
                  className={`file-pane-line${active ? " file-pane-line--active" : ""}`}
                >
                  <span className="file-pane-line-no">
                    {onAddComment && (
                      <button
                        className="line-comment-btn"
                        title="评论这行"
                        aria-label={`评论 ${commentTag} 第 ${lineNo} 行`}
                        data-testid={`line-comment-add-${lineNo}`}
                        onClick={() => {
                          setCommentLine(lineNo);
                          setCommentDraft("");
                        }}
                      >
                        <i className="codicon codicon-add" />
                      </button>
                    )}
                    {lineNo}
                  </span>
                  <span
                    className="file-pane-line-code"
                    dangerouslySetInnerHTML={{ __html: line.html }}
                  />
                </div>
                {commentLine === lineNo && (
                  <LineCommentBox
                    draft={commentDraft}
                    onDraftChange={setCommentDraft}
                    onSubmit={submitComment}
                    onCancel={closeComment}
                    tag={commentTag}
                  />
                )}
              </React.Fragment>
            );
          })}
          {fileView.truncated && fileView.totalLines === undefined && (
            <div className="file-pane-truncated-hint">文件较大，内容已截断</div>
          )}
        </div>
      )}
    </PaneShell>
  );
};

export default FilePane;
