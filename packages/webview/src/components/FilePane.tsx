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
import type {
  FileItem,
  FileViewState,
  OpenFileTab,
  ToastKind,
  VsCodeApi,
} from "../types";
import { copyTextToClipboard } from "../utils/clipboard";
import { commentLocationLabel, formatCodeComment } from "../utils/codeComment";
import type { ConversationFileEntry } from "../utils/conversationFiles";
import { toRelativePath } from "../utils/messageUtils";
import { isMarkdownPath } from "../utils/filePathLinks";
import { useCodeCommentEntry } from "../utils/useCodeCommentEntry";
import { useHostMessage } from "../utils/useHostMessage";
import { ancestorsWithin, isUnder } from "../utils/fileTreePaths";
import { isDesktopHost } from "../utils/platform";
import { CodeCommentEntry } from "./CodeCommentEntry";
import { CommentChipIcon } from "./CommentChipIcon";
import { ConversationFileList } from "./ConversationFileList";
import { FileEditor } from "./fileEditor/FileEditor";
import {
  CommentIcon,
  CopyPathIcon,
  RevealInTreeIcon,
  TreeToggleIcon,
} from "./FilePaneToolbarIcons";
import { FileTabStrip } from "./FileTabStrip";
import { FileTree, type DirEntryState } from "./FileTree";
import {
  OpenBrowserIcon,
  QueueEditIcon,
  SearchIcon,
  SettingsBackIcon,
} from "./HeaderIcons";
import { LineCommentBox } from "./LineCommentBox";
import { PanelKindIcon } from "./PanelKindIcon";
import { PanePlaceholder, PaneShell } from "./PaneShell";
import { Tooltip } from "./Tooltip";
import {
  clampTreeWidth,
  draggedTooNarrow,
  shouldShowTree,
  treeDeferredForSpace,
  treeFits,
} from "../utils/fileTreeLayout";
import "../styles/FilePane.css";

/**
 * Debounce for the panel search requests. Shorter than the message input's:
 * the host answers from a prebuilt index (tens of milliseconds), so at 200 ms
 * the input felt laggy while the wait, not the search, was the latency.
 */
const SEARCH_DEBOUNCE_MS = 50;

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
 * Wrap one character range of an already-rendered line in a `<mark>`.
 *
 * The line's HTML is highlight.js output, so the range may span several text
 * nodes; offsets are plain-text offsets, which equal the running lengths of
 * those nodes. Splitting text nodes keeps the surrounding `<span>`s intact —
 * re-splitting an HTML string instead would drop tokens whose `<span>` straddles
 * the match boundary.
 */
const wrapTextRange = (
  container: HTMLElement,
  start: number,
  length: number,
  className: string,
): void => {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node as Text);
  }
  const end = start + length;
  let offset = 0;
  for (const textNode of nodes) {
    const nodeStart = offset;
    const nodeEnd = offset + textNode.data.length;
    offset = nodeEnd;
    if (nodeEnd <= start || nodeStart >= end) continue;
    const from = Math.max(start, nodeStart) - nodeStart;
    const to = Math.min(end, nodeEnd) - nodeStart;
    if (to < textNode.data.length) textNode.splitText(to);
    const target = from > 0 ? textNode.splitText(from) : textNode;
    const mark = document.createElement("mark");
    mark.className = className;
    target.parentNode?.replaceChild(mark, target);
    mark.appendChild(target);
  }
};

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
 * `desktop-file-panel.md`「文件面板评论」场景 8): the outermost of these wins, so a
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

/**
 * Whether a pointer that resolved to *no* block still belongs to the anchored
 * one. The comment button sits in the padding left of every block
 * (`.file-pane-markdown`'s 16px), so the pointer has to cross a strip with no
 * block under it — and then land on the button itself — before it can be
 * clicked. Reading that strip as "no hover" unmounted the button mid-move,
 * which made it physically unclickable. The check is the block's own row, so the
 * anchor still drops as soon as the pointer leaves the block vertically.
 */
const gutterKeepsMarkdownAnchor = (
  block: HTMLElement,
  pointer: { clientX: number; clientY: number },
): boolean => {
  const rect = block.getBoundingClientRect();
  return (
    pointer.clientY >= rect.top &&
    pointer.clientY <= rect.bottom &&
    pointer.clientX <= rect.left
  );
};

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

/**
 * 一份**没有 markdown 结构**的文件（代码、日志、配置）→ 高亮后的内层 HTML。
 *
 * 文件面板自己逐行 split（查找跳行要高亮后的行边界），预览弹层只要一段能滚的
 * HTML，所以这里只做「按扩展名选语言 → hljs → 消毒」三步，共用同一份
 * `EXT_LANGUAGE` 与消毒白名单——两边的高亮配色因此永远一致。
 *
 * 认不出扩展名或高亮抛错时退回转义后的纯文本：高亮是锦上添花，读不到内容才是
 * 事故。
 */
export const renderCodeHighlight = (
  content: string,
  filePath: string,
): string => {
  const ext = (filePath.split(".").pop() ?? "").toLowerCase();
  const mapped = EXT_LANGUAGE[ext];
  if (!mapped || !hljs.getLanguage(mapped)) return escapeHtml(content);
  try {
    return sanitizeFileMarkdown(
      hljs.highlight(content, { language: mapped, ignoreIllegals: true }).value,
    );
  } catch {
    return escapeHtml(content);
  }
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

/** Per-file find-bar state (spec「文件面板内查找与跳行」). */
interface FindState {
  open: boolean;
  query: string;
  /** 1-based index of the current match among all matches. */
  current: number;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

const EMPTY_FIND: FindState = {
  open: false,
  query: "",
  current: 1,
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

export interface FilePaneProps {
  /** The panel's own open-file tabs, in strip order. Empty → list/placeholder. */
  files: OpenFileTab[];
  /** Which of them is showing; undefined with files present = 「未选择文件」. */
  activeFileId?: string;
  width: number;
  /** Local sessions only: open the file in the OS default app. */
  onOpenExternal?: (path: string) => void;
  /** Owning pane's effective cwd, for the relative-path title display. */
  workdir?: string;
  /** Host bridge (desktop only); absent → the panel is not a desktop surface. */
  vscode?: VsCodeApi;
  /** Owning pane, used to filter pane-scoped host replies (directory levels). */
  paneId?: string;
  /** Open a file in the panel (same flow as clicking a message file path). */
  onOpenFileInPanel?: (path: string) => void;
  /**
   * The files this conversation read or wrote, newest first. Shown as the
   * panel's list view while no file is open; empty → the empty placeholder.
   */
  conversationFiles?: ConversationFileEntry[];
  /** Leave the open file and go back to the conversation file list. */
  onBackToList?: () => void;
  /** The tab is currently showing the list even though it has a file loaded. */
  listMode?: boolean;
  /**
   * Receives a formatted line comment; appended to the chat input. Absent →
   * the code view renders no comment buttons at all.
   */
  onAddComment?: (text: string) => void;

  // ---- 面板内文件标签（spec「文件面板已打开文件的标签」）----------------------
  onActivateFile?: (fileId: string) => void;
  onCloseFile?: (fileId: string) => void;
  onCloseOtherFiles?: (fileId: string) => void;
  onCloseFilesRight?: (fileId: string) => void;
  onCloseAllFiles?: () => void;
  onReorderFile?: (fileId: string, delta: number) => void;

  // ---- 目录树（spec「文件面板工作区目录树」）--------------------------------
  /** Workspace root = the session's working tree (moves on EnterWorktree, not on
   *  a bash `cd`); absent → no tree column. */
  treeRoot?: string;
  treeVisible?: boolean;
  onTreeVisibleChange?: (visible: boolean) => void;
  treeWidth?: number;
  onTreeWidthChange?: (width: number) => void;

  // ---- 面板内编辑（spec desktop-file-panel.md「文件面板内编辑与保存」）--------
  // 全部由桌面端 ChatApp 接线；缺省即面板只读（插件端根本没有这个面板）。
  /** 进入编辑态：宿主在 `fileView.editable` 里说这个文件可以改。 */
  onStartEdit?: () => void;
  /** 起草稿；编辑器是受控之外的（CodeMirror 自己持有文本），这里只镜像到宿主态。 */
  onDraftChange?: (value: string) => void;
  /** 保存草稿。`content` 是编辑器此刻的全文，避免差一次状态提交。 */
  onSaveDraft?: (content: string) => void;
  /** 退出编辑态（有未保存修改时，宿主负责先弹确认）。 */
  onCancelEdit?: () => void;
  /** 磁盘已被改动后用户选择「重新加载」：丢弃草稿并重读。 */
  onReloadDraft?: () => void;

  // ---- 轻提示（spec desktop-file-panel.md 场景 8「复制路径」）----------------
  /** 走窗口级的全局 toast（桌面端顶部居中提示）。缺省时面板只做复制、不弹提示。 */
  onToast?: (message: string, kind?: ToastKind) => void;
}

/**
 * markdown 块的「评论这段」按钮（1029 评论第十六批）。
 *
 * 她指着 `i.codicon.codicon-add`（`button > i`）说「这个按钮改成一样的」——
 * 即和选区那颗评论气泡同一套：设计源的两态矢量（评论normal / 评论hover）+
 * 桌面端自绘 Tooltip。插件端继续用 codicon-add + 原生 title。
 * 尺寸沿用按钮原盒 16×16（图标等比缩到 16），不改这个浮在块左缘的小按钮的
 * 几何；取色与气泡一致，悬停面走 `currentColor`（`--cc-text-link` 两档）。
 */
const MdBlockCommentButton: React.FC<{
  top: number;
  desktop: boolean;
  buttonRef: React.RefObject<HTMLButtonElement>;
  onClick: () => void;
}> = ({ top, desktop, buttonRef, onClick }) => {
  const button = (
    <button
      ref={buttonRef}
      className="line-comment-btn md-block-comment-btn"
      style={{ top }}
      // 桌面端交给 Tooltip，留住 title 会双弹（原生 + 自绘）。
      title={desktop ? undefined : "评论这段"}
      aria-label="评论这段"
      data-testid="md-block-comment-add"
      onClick={onClick}
    >
      {desktop ? (
        <>
          <CommentChipIcon className="md-block-comment-icon is-normal" />
          <CommentChipIcon hover className="md-block-comment-icon is-hover" />
        </>
      ) : (
        <i className="codicon codicon-add" />
      )}
    </button>
  );
  return desktop ? (
    <Tooltip
      text="评论这段"
      position="top"
      className="md-block-comment-tooltip"
      anchorRef={buttonRef}
    >
      {button}
    </Tooltip>
  ) : (
    button
  );
};

/**
 * Desktop file panel: the session's directory tree on the left, the open file's
 * own tab strip on top of the content column, and a read-only viewer that jumps
 * to a requested line.
 *
 * All of the panel's file state lives in `files` + `activeFileId` (the first
 * level file tab owns it); this component only holds view-local state — the
 * tree's expansions and listings, the filter box, and the find bar.
 */
export const FilePane: React.FC<FilePaneProps> = ({
  files,
  activeFileId,
  width,
  onOpenExternal,
  workdir,
  vscode,
  paneId,
  onOpenFileInPanel,
  conversationFiles,
  onBackToList,
  listMode,
  onAddComment,
  onActivateFile,
  onCloseFile,
  onCloseOtherFiles,
  onCloseFilesRight,
  onCloseAllFiles,
  onReorderFile,
  treeRoot,
  treeVisible = true,
  onTreeVisibleChange,
  treeWidth = 200,
  onTreeWidthChange,
  onStartEdit,
  onDraftChange,
  onSaveDraft,
  onCancelEdit,
  onReloadDraft,
  onToast,
}) => {
  // PaneShell's body (the whole layout) and the content column's own scroll
  // container — the tree column scrolls independently, so jumps and find marks
  // work against the content one.
  // body 用回调 ref：面板挂载时会先渲染占位、再渲染骨架，`useRef` + `[]` 的
  // effect 会永远拿到 null，量宽度（场景 2/3）就一次都跑不起来。
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);

  const activeFile = useMemo(
    () => files.find((f) => f.id === activeFileId),
    [files, activeFileId],
  );
  const fileView: FileViewState | null = activeFile?.fileView ?? null;

  // 复制路径（spec desktop-file-panel.md 场景 8）：原来只吞掉 clipboard 的
  // Promise、成功失败都不说话（设计师 1028 评论：「点击复制路径后现在是否有
  // 全局提示？没有的话需要加一下成功失败提示」）。现在两种结果都回一条窗口级
  // toast，失败时退回 execCommand，两路都失败才报错。
  const handleCopyPath = useCallback(async () => {
    const path = activeFile?.path;
    if (!path) return;
    const ok = await copyTextToClipboard(path);
    onToast?.(
      ok ? "路径已复制" : "复制失败，请手动复制",
      ok ? "success" : "error",
    );
  }, [activeFile?.path, onToast]);

  // ---- 目录树（左栏）--------------------------------------------------------
  // 展开集合与已取到的层级都留在组件里：树的每一次展开才发一次列目录请求，
  // 面板打开时只读根目录一层。会话切换会重建本组件，树按需重新取。
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [dirs, setDirs] = useState<Record<string, DirEntryState>>({});
  const pendingDirsRef = useRef<Set<string>>(new Set());
  const [revealTick, setRevealTick] = useState(0);
  const [treeDragWidth, setTreeDragWidth] = useState<number | null>(null);
  // 面板正文区的宽度：树宽上限、以及「还有没有并排余地」都看它（场景 2/3）。
  // 0 = 还没量到（首帧、jsdom 这类没有布局的环境），规则里当成「宽度未知」。
  const [bodyWidth, setBodyWidth] = useState(0);

  useEffect(() => {
    if (!bodyEl) return;
    const measure = () => setBodyWidth(bodyEl.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(bodyEl);
    return () => observer.disconnect();
  }, [bodyEl]);

  const requestDir = useCallback(
    (path: string) => {
      if (!vscode || !path) return;
      if (pendingDirsRef.current.has(path)) return;
      pendingDirsRef.current.add(path);
      setDirs((prev) =>
        prev[path]?.entries || prev[path]?.error
          ? prev
          : { ...prev, [path]: { loading: true } },
      );
      vscode.postMessage({ command: "desktopListDirectory", path });
      // A dropped request must not wedge the row in 「正在加载…」 forever: the
      // reply clears it, and this timer is the only other way out.
      setTimeout(() => pendingDirsRef.current.delete(path), 5000);
    },
    [vscode],
  );

  const toggleDir = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  useHostMessage(
    (data) => {
      if (data.command !== "desktopDirEntries") return;
      const path = data.path as string;
      pendingDirsRef.current.delete(path);
      setDirs((prev) => ({
        ...prev,
        [path]: data.error
          ? { error: data.error }
          : { entries: data.entries ?? [], total: data.total ?? 0 },
      }));
    },
    { paneId },
  );

  /** Root level: list it once the tree is on screen (no click to expand it). */
  useEffect(() => {
    if (!treeRoot || !treeVisible) return;
    requestDir(treeRoot);
  }, [treeRoot, treeVisible, requestDir]);

  // 「在文件树中显示」: expand every ancestor inside the root, then scroll.
  const revealActiveInTree = useCallback(() => {
    const path = fileView?.path;
    if (!path || !treeRoot) return;
    if (!isUnder(path, treeRoot)) return;
    const ancestors = ancestorsWithin(path, treeRoot);
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const dir of ancestors) next.add(dir);
      return next;
    });
    for (const dir of ancestors) requestDir(dir);
    setRevealTick((tick) => tick + 1);
  }, [fileView?.path, treeRoot, requestDir]);

  // Opening a file keeps the tree honest without a click: its ancestors are
  // expanded (and listed) so the row shows up selected (scenario 6's first half).
  useEffect(() => {
    const path = fileView?.path;
    if (!path || !treeRoot || !treeVisible) return;
    if (!isUnder(path, treeRoot)) return;
    const ancestors = ancestorsWithin(path, treeRoot);
    setExpanded((prev) => {
      const missing = ancestors.filter((d) => !prev.has(d));
      if (missing.length === 0) return prev;
      const next = new Set(prev);
      for (const dir of ancestors) next.add(dir);
      return next;
    });
    for (const dir of ancestors) requestDir(dir);
  }, [fileView?.path, treeRoot, treeVisible, requestDir]);

  // Splitter drag: local mirror while dragging, persisted on release. Dragging
  // below the collapse threshold is a collapse gesture, not a 140px column
  // (Claude's divider behaves the same way) — release then hides the tree.
  //
  // The live width lives in a ref, not in the state updater: the host callbacks
  // must not be invoked from inside `setState(fn)` (React runs that during the
  // render phase ⇒ "Cannot update a component while rendering a different
  // component" in the console).
  const treeWidthRef = useRef(treeWidth);
  treeWidthRef.current = treeWidth;
  const bodyWidthRef = useRef(bodyWidth);
  bodyWidthRef.current = bodyWidth;
  // 桌面端的树挂在正文（文件预览）**右侧**（host-desktop.css：
  // `[data-host="desktop"] .file-pane-layout { flex-direction: row-reverse }`，
  // 设计师 1028 评论「整个树 包括搜索放在预览区域右侧」），所以横向拖拽的
  // 方向要反过来：往左拖才是变宽、往右拖是变窄。命中区宽度与夹取逻辑不变。
  const treeOnRight = isDesktopHost();
  const treeDragWidthRef = useRef<number | null>(null);
  const handleTreeResizeStart = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = treeWidthRef.current;
      const onMove = (move: MouseEvent) => {
        const delta = treeOnRight
          ? startX - move.clientX
          : move.clientX - startX;
        const raw = startWidth + delta;
        const next = draggedTooNarrow(raw)
          ? 0
          : clampTreeWidth(raw, bodyWidthRef.current);
        treeDragWidthRef.current = next;
        setTreeDragWidth(next);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        const released = treeDragWidthRef.current;
        treeDragWidthRef.current = null;
        setTreeDragWidth(null);
        if (released === 0) onTreeVisibleChange?.(false);
        else if (released !== null) onTreeWidthChange?.(released);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [onTreeVisibleChange, onTreeWidthChange, treeOnRight],
  );

  // 树收起后那条恢复带：VS Code 档在面板左缘（往右拖），桌面端树在右侧，
  // 带子落在面板右缘（往左拖）。
  const handleTreeEdgeResizeStart = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      let opened = false;
      let width: number | null = null;
      const onMove = (move: MouseEvent) => {
        const raw = treeOnRight ? startX - move.clientX : move.clientX - startX;
        if (!opened) {
          if (draggedTooNarrow(raw)) return;
          opened = true;
          onTreeVisibleChange?.(true);
        }
        width = clampTreeWidth(raw, bodyWidthRef.current);
        treeDragWidthRef.current = width;
        setTreeDragWidth(width);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        treeDragWidthRef.current = null;
        setTreeDragWidth(null);
        if (width !== null) onTreeWidthChange?.(width);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [onTreeVisibleChange, onTreeWidthChange, treeOnRight],
  );

  // ---- 过滤框：复用 @ 文件搜索的数据流（spec「文件面板按名字查找」）--------
  const [searchFilter, setSearchFilter] = useState("");
  const [searchSuggestions, setSearchSuggestions] = useState<FileItem[]>([]);
  const [searchSelectedIndex, setSearchSelectedIndex] = useState(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | undefined>(undefined);
  const searchRequestIdRef = useRef("");
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestSearch = useCallback(
    (filterText: string) => {
      if (!vscode) return;
      const requestId = Date.now().toString();
      searchRequestIdRef.current = requestId;
      setSearchLoading(true);
      setSearchError(undefined);
      vscode.postMessage({
        command: "requestFileSuggestions",
        filterText,
        requestId,
      });
    },
    [vscode],
  );

  const handleFilterChange = useCallback(
    (value: string) => {
      setSearchFilter(value);
      setSearchSelectedIndex(0);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      if (!value) {
        // 清空即回到目录树（场景 3），不重新查一次空关键字。
        setSearchSuggestions([]);
        setSearchLoading(false);
        return;
      }
      searchDebounceRef.current = setTimeout(() => {
        searchDebounceRef.current = null;
        requestSearch(value);
      }, SEARCH_DEBOUNCE_MS);
    },
    [requestSearch],
  );

  const handlePickFilterResult = useCallback(
    (file: FileItem) => {
      setSearchFilter("");
      setSearchSuggestions([]);
      onOpenFileInPanel?.(file.path);
    },
    [onOpenFileInPanel],
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
      setSearchError("搜索文件失败");
    }
  });

  useEffect(
    () => () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    },
    [],
  );

  // ---- 查找与跳行（spec「文件面板内查找与跳行」）---------------------------
  const [find, setFind] = useState<FindState>(EMPTY_FIND);
  const [gotoValue, setGotoValue] = useState("");
  const [gotoError, setGotoError] = useState<string | undefined>(undefined);

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

  const relativePath = useMemo(
    () => (fileView ? toRelativePath(fileView.path, workdir) : ""),
    [fileView, workdir],
  );
  const isLocal = fileView?.host === "local";
  const markdown = fileView?.content ? isMarkdownPath(fileView.path) : false;

  // Jump to the requested line range on open / file switch.
  useEffect(() => {
    const start = fileView?.startLine;
    const el = contentScrollRef.current;
    if (!start || !el || !contentLines) return;
    el.scrollTop = Math.max(
      0,
      (start - 1) * HIGHLIGHT_LINE_HEIGHT - HIGHLIGHT_LINE_HEIGHT * 1.5,
    );
  }, [fileView?.path, fileView?.startLine, contentLines]);

  // ---- 查找：配对与命中（spec「文件面板内查找与跳行」）----------------------
  // 命中按「行 + 行内起始位置」记录，作用在纯文本上（`contentLines[].text`），
  // 高亮在渲染后再把 `<mark>` 包进对应的文本节点——这样语法高亮的 <span> 保持
  // 原样，不必在 HTML 字符串里二次切分（切错一个 span 就会吞掉半屏高亮）。
  const searchMatcher = useMemo(() => {
    const query = find.query;
    if (!query) return null;
    const flags = find.caseSensitive ? "g" : "gi";
    const source = find.regex
      ? query
      : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = find.wholeWord ? `\\b(?:${source})\\b` : source;
    try {
      return {
        regex: new RegExp(pattern, flags),
        error: undefined as string | undefined,
      };
    } catch {
      // 非法正则给出可读提示且不匹配任何内容（场景 3）。
      return { regex: null, error: "正则表达式无效" };
    }
  }, [find.query, find.caseSensitive, find.regex, find.wholeWord]);

  const matches = useMemo(() => {
    const regex = searchMatcher?.regex;
    if (!regex || !contentLines) return [];
    const out: Array<{ line: number; index: number; length: number }> = [];
    for (let i = 0; i < contentLines.length; i++) {
      const text = contentLines[i].text;
      regex.lastIndex = 0;
      let hit = regex.exec(text);
      let guard = 0;
      while (hit && guard++ < 500) {
        if (hit[0].length === 0) {
          regex.lastIndex++;
        } else {
          out.push({ line: i + 1, index: hit.index, length: hit[0].length });
        }
        hit = regex.exec(text);
      }
    }
    return out;
  }, [searchMatcher, contentLines]);

  const matchCount = matches.length;
  const hitsByLine = useMemo(() => {
    const map = new Map<number, typeof matches>();
    for (const hit of matches) {
      const list = map.get(hit.line);
      if (list) list.push(hit);
      else map.set(hit.line, [hit]);
    }
    return map;
  }, [matches]);
  const currentIndex = find.current;
  const currentMatch = useMemo(() => {
    if (matchCount === 0) return null;
    const index = Math.min(Math.max(currentIndex, 1), matchCount) - 1;
    return matches[index] ?? null;
  }, [matches, matchCount, currentIndex]);

  const scrollToLine = useCallback((line: number) => {
    const el = contentScrollRef.current;
    if (!el) return;
    el.scrollTop = Math.max(
      0,
      (line - 1) * HIGHLIGHT_LINE_HEIGHT - HIGHLIGHT_LINE_HEIGHT * 2,
    );
  }, []);

  const stepMatch = useCallback(
    (delta: number) => {
      if (matchCount === 0) return;
      setFind((prev) => {
        // 到末尾循环（场景 2）。
        const next = ((prev.current - 1 + delta + matchCount) % matchCount) + 1;
        return { ...prev, current: next };
      });
    },
    [matchCount],
  );

  useEffect(() => {
    if (currentMatch) scrollToLine(currentMatch.line);
  }, [currentMatch, scrollToLine]);

  /**
   * Paint the marks after every render that could have produced new line nodes.
   * React owns the text; this pass only wraps ranges inside text nodes, and
   * re-running it from scratch keeps it idempotent.
   */
  useEffect(() => {
    const root = contentScrollRef.current;
    if (!root) return;
    root
      .querySelectorAll<HTMLElement>("mark.file-pane-find-hit")
      .forEach((mark) => {
        const parent = mark.parentNode;
        if (!parent) return;
        parent.replaceChild(
          document.createTextNode(mark.textContent ?? ""),
          mark,
        );
        parent.normalize();
      });
    if (!find.query || matches.length === 0) return;
    const currentLine = currentMatch?.line;
    root.querySelectorAll<HTMLElement>(".file-pane-line-code").forEach((el) => {
      const lineNo = Number(el.dataset.lineNo ?? "0");
      const hits = hitsByLine.get(lineNo);
      if (!hits) return;
      for (const hit of [...hits].reverse()) {
        wrapTextRange(
          el,
          hit.index,
          hit.length,
          lineNo === currentLine && hit === currentMatch
            ? "file-pane-find-hit file-pane-find-hit--current"
            : "file-pane-find-hit",
        );
      }
    });
  });

  /** `Ctrl/Cmd+F` opens the find bar; `Esc` closes it (scenarios 1/5). */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "f")
        return;
      // 面板没在显示文本时沿用视图既有行为（markdown / 图片，场景 6）。
      if (!contentLines || markdown || fileView?.imageBase64) return;
      event.preventDefault();
      setFind((prev) => ({ ...prev, open: true }));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [contentLines, markdown, fileView?.imageBase64]);

  // 查找条一打开就把焦点放进输入框（场景 1）。入口有两个——工具条按钮与
  // `Ctrl/Cmd+F`——焦点只在这一处给，两条入口才不会一个有一处没有。
  useEffect(() => {
    if (!find.open) return;
    findInputRef.current?.focus();
    findInputRef.current?.select();
  }, [find.open]);

  // 换文件 / 换标签时重新计数，高亮不残留（场景 9）。
  useEffect(() => {
    setFind((prev) => (prev.open ? { ...prev, current: 1 } : prev));
    setGotoValue("");
    setGotoError(undefined);
  }, [fileView?.path]);

  const handleGoto = useCallback(() => {
    const total = contentLines?.length ?? 0;
    const target = Number(gotoValue.trim());
    if (!Number.isFinite(target) || target < 1 || target > total) {
      setGotoError(`有效范围 1-${total}`);
      return;
    }
    setGotoError(undefined);
    scrollToLine(target);
    setFind((prev) => ({ ...prev, open: true }));
  }, [contentLines, gotoValue, scrollToLine]);

  // 列表态只在这一种情况出现：还没打开过任何文件（列表既是进门页也是空对话
  // 的落地页），或者用户按了「返回文件列表」。有标签但没激活走「未选择文件」
  // 空态，而不是列表——两者是不同的处境（场景 14）。
  const hasConversationFiles = (conversationFiles?.length ?? 0) > 0;
  const showList =
    listMode === true || (files.length === 0 && hasConversationFiles);
  const showFile = !!activeFile && !showList;

  // ---- 面板内编辑（spec「文件面板内编辑与保存」）------------------------------
  // 编辑入口只认宿主给的 `fileView.editable`：里面已经包含了「本地会话 + 路径在
  // 工作目录内 + 读到的是完整文本」，可写性由宿主一处判定，webview 不重新推导一
  // 份规则（否则远端会话、截断文件迟早各漏一处）。`draft !== undefined` 就是
  // 「处于编辑态」：草稿放在 tab 态里而不是组件内部，切一级 tab 再切回来仍在。
  const editing = fileView?.draft !== undefined;
  const canEdit =
    !!onStartEdit &&
    !!fileView &&
    fileView.editable === true &&
    !fileView.error &&
    !fileView.truncated &&
    !fileView.imageBase64 &&
    !!fileView.content;

  // 编辑器不受控（文本由 CodeMirror 持有），保存读的是这里的镜像而不是 React
  // state：onChange 与点击保存/按 Cmd+S 是两次事件，走 state 会有一段「慢一次提
  // 交」的窗口，快手指令下会把旧内容写回磁盘。
  const draftRef = useRef("");
  useEffect(() => {
    draftRef.current = fileView?.draft ?? "";
  }, [fileView?.draft]);

  const handleEditorChange = useCallback(
    (value: string) => {
      draftRef.current = value;
      onDraftChange?.(value);
    },
    [onDraftChange],
  );

  // 工具条的「保存」与编辑器内的 Cmd/Ctrl+S 是同一条路径。
  const handleEditorSave = useCallback(() => {
    onSaveDraft?.(draftRef.current);
  }, [onSaveDraft]);

  // Inline line comments — the same entries as the diff pane: right-clicking a
  // line (or selecting several, then clicking the button that follows the
  // selection) opens a box under that line or range, and the submitted comment
  // is appended to the chat input (never sent directly, never kept in the
  // panel). Nothing is parked in the gutter, which is what lets the line numbers
  // sit flush against the panel's left edge. Only the code view can host them by
  // line: an image has no lines at all, and a markdown file has no line numbers
  // once rendered (it gets block comments instead, below).
  const [commentRange, setCommentRange] = useState<{
    from: number;
    to: number;
  } | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const {
    containerRef: commentContainerRef,
    containerProps: commentContainerProps,
    menu: commentMenu,
    chip: commentChip,
    anchor: commentAnchor,
    menuRef: commentMenuRef,
    closeMenu: closeCommentMenu,
    clearChip: clearCommentChip,
  } = useCodeCommentEntry({
    enabled:
      Boolean(onAddComment) && !markdown && !editing && !!fileView?.content,
  });

  // Markdown block comments (spec「文件面板评论」场景 8): same interaction and
  // same append format as line comments, anchored to a rendered block. Nothing
  // is persisted — the anchor only has to be valid at submit time, which is why
  // this needs no source offsets and no re-anchoring. The box itself is a portal
  // into a holder element spliced in after the block, so it pushes the document
  // down instead of covering the block that follows.
  const mdWrapRef = useRef<HTMLDivElement | null>(null);
  const mdHolderRef = useRef<HTMLDivElement | null>(null);
  // 「评论这段」按钮的锚点：桌面端 Tooltip 拿它量位置（包裹层是 display:contents）。
  const mdBlockCommentBtnRef = useRef<HTMLButtonElement>(null);
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
    setCommentRange(null);
    setCommentDraft("");
  }, []);

  const openComment = useCallback(
    (target: { from: number; to: number }) => {
      setCommentRange(target);
      setCommentDraft("");
      closeCommentMenu();
      clearCommentChip();
    },
    [closeCommentMenu, clearCommentChip],
  );

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
        setMdHover((prev) =>
          prev &&
          // 指针压在「评论这段」按钮自己身上时也要留住锚点：按钮放大到 40px 后
          // 有一半盖在正文上（越过块的左缘），只按 gutter 判会把按钮连同提示一起
          // 收掉 —— 表现为悬停时按钮闪一下就没了。
          (target.closest?.(".md-block-comment-btn") ||
            gutterKeepsMarkdownAnchor(prev.el, event))
            ? prev
            : null,
        );
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
    if (!commentRange || !comment || !onAddComment || !fileView) return;
    const { from, to } = commentRange;
    onAddComment(
      formatCodeComment({
        path: relativePath || fileView.path,
        from,
        to,
        // A range contributes its own lines, joined so the quote stays one
        // readable fragment (formatCodeComment clips it to 30 characters).
        text: contentLines
          ?.slice(from - 1, to)
          .map((line) => line.text)
          .join(" ")
          .trim(),
        comment,
      }),
    );
    closeComment();
  }, [
    commentDraft,
    commentRange,
    onAddComment,
    fileView,
    relativePath,
    contentLines,
    closeComment,
  ]);

  const commentTag = relativePath || fileView?.path || "";
  // One naming rule for the chip's label, the toolbar tooltip and the box's
  // placeholder: 「评论第 12 行」 / 「评论第 12–15 行」.
  const commentLabel = (target: { from: number; to: number }) =>
    `评论${commentLocationLabel(target.from, target.to)}`;

  // Layout inputs: the tree column takes its width out of the body, the content
  // column gets the rest. `treeDragWidth` is the live drag value (0 = the user is
  // dragging it shut).
  const treeColumnWidth = clampTreeWidth(treeDragWidth ?? treeWidth, bodyWidth);
  // 树默认可见：宿主要么显式关掉，要么给一个根就够（老宿主不下发也不至于没树）。
  // 宽度不够并排时它自己让位，但**不改写**用户的手动开关（场景 3）。
  const treeLayout = {
    hasTree: !!treeRoot && !!vscode,
    wantsTree: treeVisible !== false,
    available: bodyWidth,
    hasOpenFile: !!activeFile,
  };
  const showTree =
    shouldShowTree(treeLayout) && treeDragWidth !== 0 && !!vscode;
  const treeDeferred = treeDeferredForSpace(treeLayout);
  // 收起后的拖拽带只在「用户关掉了树、而且面板放得下」时给：因为太窄而让位时
  // 拖出来也没地方摆，给条带等于骗人（场景 3）。
  const showTreeEdge =
    !showTree &&
    treeLayout.hasTree &&
    treeLayout.wantsTree === false &&
    treeFits(bodyWidth) &&
    !!onTreeVisibleChange;

  // Two empty states (spec tab story scenario 14): nothing open at all, versus
  // tabs open but none active (「返回文件列表」, or a list view over open files).
  const nothingOpen = files.length === 0;
  const noActiveFile = files.length > 0 && !activeFile;

  return (
    <PaneShell
      kind="file-pane"
      dataTestId="file-pane"
      width={width}
      toolbarRef={toolbarRef}
      toolbar={
        <>
          {showFile && hasConversationFiles && onBackToList && (
            <Tooltip text="返回文件列表" position="bottom">
              <button
                className="preview-pane-button"
                aria-label="返回文件列表"
                data-testid="file-pane-back-to-list"
                onClick={onBackToList}
              >
                <SettingsBackIcon className="preview-pane-icon" />
              </button>
            </Tooltip>
          )}
          {showFile && activeFile ? (
            <>
              <span className="file-pane-host">
                {isLocal ? "本地" : activeFile.fileView?.host}
              </span>
              <span className="file-pane-path" title={activeFile.path}>
                {middleEllipsis(relativePath || activeFile.path)}
              </span>
            </>
          ) : (
            <span className="desktop-panel-toolbar-title">文件</span>
          )}
          {/* 树隐藏时给一条回来的路（场景 1 的显隐切换）；没有工具条按钮的话，
              隐藏后只能改配置文件才能恢复。面板太窄、树被迫让位时按钮画成不可用
              并写明原因——点了没反应比没有按钮更让人困惑（场景 3）。 */}
          {!!treeRoot && !!onTreeVisibleChange && (
            <Tooltip
              text={
                treeDeferred
                  ? "面板过窄，加宽后显示文件树"
                  : treeVisible
                    ? "隐藏文件树"
                    : "显示文件树"
              }
              position="bottom"
            >
              <button
                type="button"
                className={`preview-pane-button${treeVisible ? " active" : ""}${
                  treeDeferred ? " file-pane-toolbar-deferred" : ""
                }`}
                aria-label={
                  treeDeferred
                    ? "面板过窄，加宽后显示文件树"
                    : treeVisible
                      ? "隐藏文件树"
                      : "显示文件树"
                }
                aria-pressed={treeVisible}
                aria-disabled={treeDeferred || undefined}
                data-testid="file-pane-tree-toggle"
                onClick={() => {
                  if (treeDeferred) return;
                  onTreeVisibleChange(!treeVisible);
                }}
              >
                {isDesktopHost() ? (
                  // 1029 第十三轮：桌面端用官方矢量（显示/隐藏文件树，源图标
                  // 「显示隐藏文件树.svg」）；插件端保留 codicon。
                  <TreeToggleIcon className="preview-pane-icon" />
                ) : (
                  <i
                    className="codicon codicon-files preview-pane-icon"
                    aria-hidden="true"
                  />
                )}
              </button>
            </Tooltip>
          )}
          {showFile && activeFile && treeRoot && !treeDeferred && (
            <Tooltip text="在文件树中显示" position="bottom">
              <button
                type="button"
                className="preview-pane-button"
                aria-label="在文件树中显示"
                data-testid="file-pane-reveal-in-tree"
                onClick={() => {
                  if (!treeVisible) onTreeVisibleChange?.(true);
                  revealActiveInTree();
                }}
              >
                {isDesktopHost() ? (
                  // 1029 第十三轮：桌面端用官方矢量（在文件树中显示）；
                  // 插件端保留 codicon。
                  <RevealInTreeIcon className="preview-pane-icon" />
                ) : (
                  <i
                    className="codicon codicon-list-selection preview-pane-icon"
                    aria-hidden="true"
                  />
                )}
              </button>
            </Tooltip>
          )}
          {/* 查找（spec「文件面板内查找与跳行」场景 1）：只对文本视图出现，
              markdown 渲染与图片沿用各自既有行为（场景 6）。 */}
          {showFile && contentLines && !markdown && (
            <Tooltip text="查找" position="bottom">
              <button
                type="button"
                className={`preview-pane-button${find.open ? " active" : ""}`}
                aria-label="查找"
                aria-expanded={find.open}
                data-testid="file-pane-find-trigger"
                onClick={() =>
                  setFind((prev) => ({ ...prev, open: !prev.open }))
                }
              >
                <SearchIcon className="preview-pane-icon" />
              </button>
            </Tooltip>
          )}
          {/* 评论入口的兜底（spec「文件面板评论」场景 3）：入口改成右键/选中之后
              一眼看不见，工具条上留一颗按钮——打在当前选区或最近点过的那一行上，
              两者都没有时呈不可用并写明原因。 */}
          {showFile &&
            contentLines &&
            !markdown &&
            !editing &&
            onAddComment && (
              <Tooltip
                text={
                  commentAnchor
                    ? commentLabel(commentAnchor)
                    : "点击代码行后可在此评论"
                }
                position="bottom"
              >
                <button
                  type="button"
                  className="preview-pane-button"
                  aria-label="评论"
                  data-testid="file-pane-comment"
                  disabled={!commentAnchor}
                  onClick={() => {
                    if (commentAnchor) openComment(commentAnchor);
                  }}
                >
                  {isDesktopHost() ? (
                    // 1029 第十三轮：桌面端用官方矢量（评论）；插件端保留 codicon。
                    <CommentIcon className="preview-pane-icon" />
                  ) : (
                    <i
                      className="codicon codicon-comment preview-pane-icon"
                      aria-hidden="true"
                    />
                  )}
                </button>
              </Tooltip>
            )}
          {/* 复制路径：原来的复制按钮在工具条合并那次被删掉，规格场景仍有这条
              （spec desktop-file-panel.md 场景 8）。 */}
          {showFile && activeFile && (
            <Tooltip text="复制路径" position="bottom">
              <button
                type="button"
                className="preview-pane-button"
                aria-label="复制路径"
                data-testid="file-copy-path"
                onClick={() => {
                  void handleCopyPath();
                }}
              >
                {isDesktopHost() ? (
                  // 1029 第十三轮：桌面端用官方矢量（复制路径）；插件端保留
                  // codicon。
                  <CopyPathIcon className="preview-pane-icon" />
                ) : (
                  <i
                    className="codicon codicon-copy preview-pane-icon"
                    aria-hidden="true"
                  />
                )}
              </button>
            </Tooltip>
          )}
          {showFile && fileView && isLocal && onOpenExternal && (
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
          {/* 编辑入口是**显式动作**：只有宿主说可写时才出现，且点击正文不会进入
              编辑（场景 3）——避免浏览时误触把面板变成草稿态。进入后工具条右端换
              成「取消 / 保存」，编辑态不再显示编辑按钮。 */}
          {showFile && canEdit && !editing && (
            <Tooltip text="编辑" position="bottom">
              <button
                type="button"
                className="preview-pane-button"
                aria-label="编辑"
                data-testid="file-pane-edit"
                onClick={onStartEdit}
              >
                <QueueEditIcon className="preview-pane-icon" />
              </button>
            </Tooltip>
          )}
          {showFile && editing && (
            <>
              <button
                type="button"
                className="file-pane-edit-action"
                data-testid="file-pane-edit-cancel"
                onClick={onCancelEdit}
              >
                取消
              </button>
              <button
                type="button"
                className="file-pane-edit-action file-pane-edit-action--primary"
                data-testid="file-pane-edit-save"
                disabled={fileView?.saving}
                onClick={handleEditorSave}
              >
                {fileView?.saving ? "保存中…" : "保存"}
              </button>
            </>
          )}
        </>
      }
      bodyClassName={`preview-pane-body file-pane-body${editing ? " file-pane-body--editing" : ""}`}
      bodyRef={setBodyEl}
    >
      <div className="file-pane-layout">
        {showTree && treeRoot && (
          <>
            <div
              className="file-pane-tree-col"
              data-testid="file-pane-tree-col"
              style={{ width: treeColumnWidth }}
            >
              <FileTree
                root={treeRoot}
                expanded={expanded}
                onToggleDir={toggleDir}
                dirs={dirs}
                onNeedDir={requestDir}
                activePath={fileView?.path}
                onOpenFile={(path) => onOpenFileInPanel?.(path)}
                revealTick={revealTick}
                filter={searchFilter}
                onFilterChange={handleFilterChange}
                filterResults={searchSuggestions}
                filterLoading={searchLoading}
                filterError={searchError}
                selectedIndex={searchSelectedIndex}
                onSelectedIndexChange={setSearchSelectedIndex}
                onPickResult={handlePickFilterResult}
              />
            </div>
            <div
              className="file-pane-tree-splitter"
              data-testid="file-pane-tree-splitter"
              role="separator"
              aria-orientation="vertical"
              aria-label="调整文件树宽度"
              onMouseDown={handleTreeResizeStart}
            />
          </>
        )}
        {showTreeEdge && (
          <div
            className="file-pane-tree-edge"
            data-testid="file-pane-tree-edge"
            role="separator"
            aria-orientation="vertical"
            aria-label="拖出文件树"
            onMouseDown={handleTreeEdgeResizeStart}
          />
        )}
        <div className="file-pane-content-col">
          {files.length > 0 && (
            <FileTabStrip
              files={files}
              activeFileId={activeFileId}
              workdir={workdir}
              onActivate={(fileId) => onActivateFile?.(fileId)}
              onClose={(fileId) => onCloseFile?.(fileId)}
              onCloseOthers={(fileId) => onCloseOtherFiles?.(fileId)}
              onCloseRight={(fileId) => onCloseFilesRight?.(fileId)}
              onCloseAll={() => onCloseAllFiles?.()}
              onReorder={(fileId, delta) => onReorderFile?.(fileId, delta)}
            />
          )}
          {find.open && contentLines && !editing && (
            <div className="file-pane-find" data-testid="file-pane-find">
              <div className="file-pane-find-row">
                <input
                  ref={findInputRef}
                  className="file-pane-find-input"
                  data-testid="file-pane-find-input"
                  placeholder="查找…"
                  value={find.query}
                  onChange={(e) => {
                    const query = e.target.value;
                    setFind((prev) => ({ ...prev, query, current: 1 }));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      stepMatch(e.shiftKey ? -1 : 1);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setFind((prev) => ({ ...prev, open: false, query: "" }));
                    }
                  }}
                />
                <span
                  className="file-pane-find-count"
                  data-testid="file-pane-find-count"
                >
                  {searchMatcher?.error
                    ? searchMatcher.error
                    : matchCount === 0
                      ? find.query
                        ? "无匹配结果"
                        : "0/0"
                      : `${currentMatch ? Math.min(Math.max(find.current, 1), matchCount) : 0}/${matchCount}`}
                </span>
                <button
                  type="button"
                  className="file-pane-find-btn"
                  data-testid="file-pane-find-prev"
                  aria-label="上一个匹配"
                  onClick={() => stepMatch(-1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="file-pane-find-btn"
                  data-testid="file-pane-find-next"
                  aria-label="下一个匹配"
                  onClick={() => stepMatch(1)}
                >
                  ↓
                </button>
                {(
                  [
                    ["caseSensitive", "case", "Aa", "区分大小写"],
                    ["wholeWord", "word", "ab", "整词匹配"],
                    ["regex", "regex", ".*", "正则表达式"],
                  ] as const
                ).map(([key, testId, label, title]) => (
                  <button
                    key={key}
                    type="button"
                    title={title}
                    className={`file-pane-find-btn${find[key] ? " active" : ""}`}
                    data-testid={`file-pane-find-${testId}`}
                    aria-pressed={find[key]}
                    aria-label={title}
                    onClick={() =>
                      setFind((prev) => ({
                        ...prev,
                        [key]: !prev[key],
                        current: 1,
                      }))
                    }
                  >
                    {label}
                  </button>
                ))}
                <span className="file-pane-goto-sep" aria-hidden="true" />
                <input
                  className="file-pane-goto-input"
                  data-testid="file-pane-goto-input"
                  placeholder="跳行"
                  value={gotoValue}
                  onChange={(e) => {
                    setGotoValue(e.target.value);
                    setGotoError(undefined);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleGoto();
                    }
                  }}
                  aria-label="跳转到行"
                />
                {gotoError && (
                  <span
                    className="file-pane-find-count file-pane-find-count--error"
                    data-testid="file-pane-goto-error"
                  >
                    {gotoError}
                  </span>
                )}
                <button
                  type="button"
                  className="file-pane-find-btn"
                  data-testid="file-pane-find-close"
                  aria-label="关闭查找"
                  onClick={() =>
                    setFind((prev) => ({ ...prev, open: false, query: "" }))
                  }
                >
                  ✕
                </button>
              </div>
              {fileView?.truncated && (
                <div className="file-pane-find-note">
                  只在已加载的内容内查找（文件已截断）
                </div>
              )}
            </div>
          )}
          <div className="file-pane-scroll" ref={contentScrollRef}>
            {showList && (
              <ConversationFileList
                files={conversationFiles ?? []}
                onOpenFile={(path) => onOpenFileInPanel?.(path)}
              />
            )}
            {!showList && nothingOpen && (
              <PanePlaceholder className="file-pane-placeholder-empty">
                {/* 空态一：一个文件都没打开（场景 14）。 */}
                <PanelKindIcon
                  kind="file"
                  size={24}
                  className="file-pane-placeholder-icon"
                />
                {/* 评论 1030：原来这里还有一行「打开的文件会显示在这里」，与下面
                    这句引导重复，设计师要求拿掉（只留引导句）。`data-testid` 迁到
                    引导句上 —— 场景 14「一个文件都没打开」的断言靠它定位，语义不变。
                    注：本组件两个宿主共用，插件端的同一空态也会少这一行。 */}
                <span
                  className="file-pane-placeholder-hint"
                  data-testid="file-pane-empty-none"
                >
                  点击目录树中的文件，或点击消息里的文件路径
                </span>
              </PanePlaceholder>
            )}
            {!showList && noActiveFile && (
              <PanePlaceholder className="file-pane-placeholder-empty">
                {/* 空态二：有标签但都没有激活（场景 14）。 */}
                <PanelKindIcon
                  kind="file"
                  size={24}
                  className="file-pane-placeholder-icon"
                />
                <span data-testid="file-pane-empty-no-active">未选择文件</span>
                <span className="file-pane-placeholder-hint">
                  点击上方的文件标签，或点击消息里的文件路径
                </span>
              </PanePlaceholder>
            )}
            {/* 「已删除」的标签：内容区给出提示与关标签动作（场景 13）。 */}
            {!showList && activeFile?.deleted && (
              <div
                className="file-pane-status file-pane-status--deleted"
                data-testid="file-pane-deleted"
              >
                <i className="codicon codicon-warning file-pane-status-icon" />
                <span>文件已不存在</span>
                <button
                  type="button"
                  className="file-pane-banner-action"
                  data-testid="file-pane-deleted-close"
                  onClick={() => onCloseFile?.(activeFile.id)}
                >
                  关闭标签
                </button>
              </div>
            )}
            {/* 文件正文整组在列表态下不渲染：状态、图片、Markdown、代码行各自都靠
                `fileView` 判空，列表态却是「有 fileView 但在看列表」（见 showList
                注释）。 */}
            {!showList && !activeFile?.deleted && (
              <>
                {fileView?.error && (
                  // 1030 第三轮：同族口径（见 host-desktop.css 的 1030 块）。
                  <div className="file-pane-status file-pane-status--error">
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
                {/* 编辑态：正文换成 CodeMirror（markdown 也是源文本编辑，保存后回
                    到渲染态）。正文整块替换掉，行评论 / 块评论入口随之消失（场景
                    12）——评论锚定的是只读正文的行区间，草稿里的行号随时在变。 */}
                {fileView && editing && !fileView.error && (
                  <div className="file-pane-editor-wrap">
                    {fileView.diskChanged && (
                      <div
                        className="file-pane-banner"
                        data-testid="file-pane-disk-changed"
                      >
                        <i className="codicon codicon-warning file-pane-banner-icon" />
                        <span className="file-pane-banner-text">
                          文件已在磁盘上更新，保存将覆盖磁盘上的改动
                        </span>
                        {/* 「覆盖」按回包里的磁盘哈希再写一次（与工具条保存同一条
                            路径）；「重新加载」丢弃草稿重读。 */}
                        <button
                          type="button"
                          className="file-pane-banner-action"
                          data-testid="file-pane-overwrite"
                          onClick={handleEditorSave}
                        >
                          覆盖
                        </button>
                        <button
                          type="button"
                          className="file-pane-banner-action"
                          data-testid="file-pane-reload"
                          onClick={onReloadDraft}
                        >
                          重新加载
                        </button>
                      </div>
                    )}
                    {fileView.saveError && (
                      <div
                        className="file-pane-banner file-pane-banner--error"
                        data-testid="file-pane-save-error"
                      >
                        <i className="codicon codicon-error file-pane-banner-icon" />
                        <span className="file-pane-banner-text">
                          {fileView.saveError}
                        </span>
                      </div>
                    )}
                    <FileEditor
                      path={fileView.path}
                      initialValue={fileView.draft ?? ""}
                      onChange={handleEditorChange}
                      onSave={handleEditorSave}
                    />
                  </div>
                )}
                {fileView?.content &&
                  !fileView.error &&
                  markdown &&
                  !editing && (
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
                      {/* Revealed on hover of a block rather than by CSS: the button
                    only exists while a block is actually under the pointer, which
                    is also what keeps it off images (an image has no block to
                    anchor to). */}
                      {mdHover && onAddComment && !mdComment && (
                        <MdBlockCommentButton
                          top={mdHover.top}
                          desktop={isDesktopHost()}
                          buttonRef={mdBlockCommentBtnRef}
                          onClick={openMdComment}
                        />
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
                {fileView?.content &&
                  !fileView.error &&
                  !markdown &&
                  !editing &&
                  contentLines && (
                    <div
                      className="file-pane-code"
                      ref={commentContainerRef}
                      {...commentContainerProps}
                      style={
                        {
                          // Line-number column width in digits: every row shares
                          // one value so the code column stays a straight edge,
                          // and it follows *this* file's last line number rather
                          // than a fixed reservation (a 7-line file gets a 7px
                          // number instead of a three-digit gutter).
                          "--file-pane-line-no-digits": String(
                            contentLines.length,
                          ).length,
                        } as React.CSSProperties
                      }
                    >
                      {fileView.truncated &&
                        fileView.totalLines !== undefined && (
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
                          <React.Fragment key={i}>
                            <div
                              className={`file-pane-line${active ? " file-pane-line--active" : ""}`}
                              data-comment-unit={
                                onAddComment ? lineNo : undefined
                              }
                              data-testid={`file-pane-line-${lineNo}`}
                            >
                              <span className="file-pane-line-no">
                                {lineNo}
                              </span>
                              <span
                                className="file-pane-line-code"
                                data-line-no={lineNo}
                                dangerouslySetInnerHTML={{ __html: line.html }}
                              />
                            </div>
                            {commentRange?.to === lineNo && (
                              <LineCommentBox
                                draft={commentDraft}
                                onDraftChange={setCommentDraft}
                                onSubmit={submitComment}
                                onCancel={closeComment}
                                tag={commentTag}
                                placeholder={`${commentLabel(commentRange)}…`}
                              />
                            )}
                          </React.Fragment>
                        );
                      })}
                      {fileView.truncated &&
                        fileView.totalLines === undefined && (
                          <div className="file-pane-truncated-hint">
                            文件较大，内容已截断
                          </div>
                        )}
                      <CodeCommentEntry
                        chip={commentChip}
                        menu={commentMenu}
                        menuRef={commentMenuRef}
                        labelOf={commentLabel}
                        onOpen={openComment}
                        onCloseMenu={closeCommentMenu}
                      />
                    </div>
                  )}
              </>
            )}
          </div>
        </div>
      </div>
    </PaneShell>
  );
};

export default FilePane;
