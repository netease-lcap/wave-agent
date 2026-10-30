import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useImperativeHandle,
  forwardRef,
  useMemo,
  KeyboardEvent,
} from "react";
import { convertToMarkdown, serializeInputDraft } from "../utils/messageUtils";
import { renderDraftContent } from "../utils/inputDraft";
import { clearDraftImages, draftImageScopeKey } from "../utils/draftImageStore";
import {
  assembleIdeContextBlocks,
  buildIdeContextSuggestions,
  findIdeContextMentions,
  ideContextMarker,
  ideContextProviderInfo,
} from "../utils/ideContext";
import type {
  IdeContextProvider,
  IdeContextResult,
} from "wave-webview-fixtures";
import { validateImageFile } from "../utils/imageValidation";
import { useRovingMenu } from "../utils/useRovingMenu";
import { isRemotePageHost } from "../utils/platform";
import { useHostMessage } from "../utils/useHostMessage";
import { ContextTag } from "./ContextTag";
import { Tooltip } from "./Tooltip";
import ReactDOM from "react-dom/client";
import type {
  MessageInputProps,
  FileItem,
  SlashCommand,
  AttachedImage,
  PermissionMode,
} from "../types";
import { FileSuggestionDropdown } from "./FileSuggestionDropdown";
import { SlashCommandsPopup, orderSlashCommands } from "./SlashCommandsPopup";
import { HistorySearchPopup } from "./HistorySearchPopup";
import { ModelPicker } from "./ModelPicker";
import {
  PlusIcon,
  SlashBoxIcon,
  SendArrowIcon,
  PermCaretIcon,
  PermModeAskIcon,
  PermModeAcceptIcon,
  PermModeBypassIcon,
  PermModePlanIcon,
} from "./HeaderIcons";
import "../styles/MessageInput.css";

/** 发送时取 IDE 上下文的等待上限：超时按「不可用」写一行说明并照常发送。 */
const IDE_CONTEXT_TIMEOUT_MS = 3000;
import "../styles/HistorySearchPopup.css";

// Compress-context props. MessageInputProps lives in ../types (host
// wires these in ChatApp); extending it here keeps the change inside the
// two-file edit boundary. All added fields are optional, so existing callers
// keep type-checking unchanged.
interface MessageInputPropsWithCompress extends MessageInputProps {
  /** Host-reported context usage percentage (0-100). Undefined = unknown. */
  contextUsage?: number;
  /** Show the context-usage indicator (hidden on the welcome composer). */
  showContextUsage?: boolean;
}

interface AtMentionState {
  isActive: boolean;
  filterText: string;
  startPos: number;
  endPos: number;
}

interface SlashCommandState {
  isActive: boolean;
  filterText: string;
  startPos: number;
  endPos: number;
}

// Map a character offset within the flattened text of `container` back to a
// {textNode, offset} position in the DOM. The slash-command detection tracks
// positions in the flattened text (pre-caret Range.toString()), but insertion
// needs a concrete text node + offset to build a Range around.
function findTextOffset(
  container: Node,
  offset: number,
): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let textNode = walker.nextNode() as Text | null;
  while (textNode) {
    const len = textNode.textContent?.length ?? 0;
    if (acc + len >= offset) {
      return { node: textNode, offset: offset - acc };
    }
    acc += len;
    textNode = walker.nextNode() as Text | null;
  }
  return null;
}

// Map a {node, offset} position inside `container` back to a flat character
// offset in the container's text — the inverse of findTextOffset. Used to
// remember the caret across blur so async insertions (upload success,
// selection tag) can restore the position the browser lost on focus().
function textOffsetOf(container: Node, node: Node, offset: number): number {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let textNode = walker.nextNode() as Text | null;
  while (textNode) {
    if (textNode === node) return acc + offset;
    acc += textNode.textContent?.length ?? 0;
    textNode = walker.nextNode() as Text | null;
  }
  return acc;
}

// Permission mode options rendered in the custom dropdown. A custom dropdown is used
// instead of a native <select> so the option list can be forced to expand upward
// (bottom:100%): the native <select> popup expands downward by default and gets
// clipped at the bottom of the webview viewport in JCEF.
const PERMISSION_MODES: { value: PermissionMode; label: string }[] = [
  { value: "default", label: "修改前询问" },
  { value: "acceptEdits", label: "自动接受修改" },
  { value: "plan", label: "计划模式" },
  { value: "bypassPermissions", label: "跳过权限确认" },
];
const permissionModeLabel = (m?: PermissionMode): string =>
  PERMISSION_MODES.find((x) => x.value === m)?.label ?? "修改前询问";

const permissionModeIcon = (m?: PermissionMode): React.ReactNode => {
  switch (m) {
    case "acceptEdits":
      return <PermModeAcceptIcon className="permission-mode-icon" />;
    case "bypassPermissions":
      return <PermModeBypassIcon className="permission-mode-icon" />;
    case "plan":
      return <PermModePlanIcon className="permission-mode-icon" />;
    default:
      return <PermModeAskIcon className="permission-mode-icon" />;
  }
};

export interface MessageInputHandle {
  focus: () => void;
  triggerShortcut: (name: string) => void;
  appendText: (text: string) => void;
  loadQueuedEditContent: (text: string) => void;
  /** Replace the whole input with a plain-text draft (no queued-edit chip) and
   *  focus it. Used to prefill AI-dialog prompts from the settings page
   *  (新建/编辑 技能/子代理/钩子/MCP). */
  loadDraft: (text: string) => void;
  /** Upload a dropped file selection to the host, tagging this pane so the
   *  uploadSuccess reply routes back only to this input. */
  uploadFiles: (files: FileList | File[]) => void;
}

export const MessageInput = forwardRef<
  MessageInputHandle,
  MessageInputPropsWithCompress
>((props, ref) => {
  const {
    onSendMessage,
    isStreaming,
    onAbortMessage,
    onSubmitQueuedEdit,
    editingQueuedId,
    onCancelQueuedEdit,
    shouldClearInput,
    onInputCleared,
    vscode,
    inputContent,
    sessionId,
    permissionMode,
    initialAttachedImages,
    workdirSelector,
    rewindPopup,
    models,
    currentModel,
    onSelectModel,
    btwPopup,
    disabled,
    placeholder,
    paneId,
    contextUsage,
    showContextUsage,
  } = props;
  const [message, setMessage] = useState("");

  // 草稿图片按会话存（新对话按 pane），与宿主给 `inputDrafts` 分键的口径一致。
  const draftScopeKey = useMemo(
    () => draftImageScopeKey(sessionId, paneId),
    [sessionId, paneId],
  );

  // Context-usage indicator: the ring fill and the trailing number both
  // reflect the current usage (rounded up per spec); hovering pops a
  // design-system tooltip naming the number as the context usage (the same
  // text is the aria-label). Pure display — not a button, no click action.
  // Both readings below are only consumed where the indicator is rendered,
  // i.e. when the host has reported a non-zero usage (see the JSX gate).
  const contextUsagePct =
    contextUsage !== undefined
      ? Math.min(100, Math.max(0, Math.ceil(contextUsage)))
      : undefined;
  const contextUsageLabel =
    contextUsagePct !== undefined && contextUsagePct > 0
      ? `上下文已使用 ${contextUsagePct}%`
      : "";
  const ringCircumference = 2 * Math.PI * 8;

  // ── 底栏「空间不足 → 图标档」（1023 评论：参考 codex，模型和权限都只显示图标）──
  // 纯 CSS 判断不了「放不放得下」：文字档的自然宽度随模型名 / 权限文案 / 上下文档位
  // 变化（同宽卡片下换一个长模型名就可能放不下），固定断点会在界面上「跳档」。
  // 所以按实际内容量一次，两条判据取或：①「文字档下有没有被压扁」——模型选择器是底栏
  // 里唯一可收缩的一档，一挤就先被压到比自己的文字还窄（此时文字会压到相邻控件上）；
  // ②「整行内容量是否超出可用宽度」——临时挂 `.is-measuring`（子项不许收缩）读自然宽度。
  // `.is-compact` 直接写在 DOM 类上（不经过 React 渲染，避免状态与量宽互相打架），
  // state 只用来决定要不要给图标档挂气泡。量宽在 rAF 里做、同一帧读+写，
  // 浏览器不会把中间的「文字档」画出来。
  //
  // 桌面端、插件端（VS Code / JetBrains）与远控页共用同一套判据、同一套收法：桌面端的
  // 「预览全屏」浮卡只有 420px、插件端的侧边栏默认 350–400px、手机上的远控页把按钮放大到
  // 40×40 后一行也放不下两个文字档（PM 3503127847500032 / 远控页「修改前询问」折行），
  // 三端都会挤到这条线上。图标档的**尺寸**按宿主密度分档（桌面 32×32 / 插件 22×22 /
  // 远控页触控档 40×40），见 ModelPicker.css、MessageInput.css 与 remote-page.css。
  const buttonsRowRef = useRef<HTMLDivElement>(null);
  const [compactRow, setCompactRow] = useState(false);
  useEffect(() => {
    const row = buttonsRowRef.current;
    if (!row) return;
    let raf = 0;
    const decide = () => {
      row.classList.remove("is-compact");
      // ① 文字档下这个控件已经被压得比自己的内容还窄 = 已经挤到相邻控件上了
      const pinched = [
        [".model-picker-container", ".model-picker-trigger"],
        [".permission-mode-container", ".permission-mode-select"],
      ].some(([cont, inner]) => {
        const c = row.querySelector<HTMLElement>(cont);
        const t = row.querySelector<HTMLElement>(inner);
        if (!c || !t) return false;
        return (
          t.getBoundingClientRect().width >
          c.getBoundingClientRect().width + 0.5
        );
      });
      // ② 整行在文字档下的自然宽度 vs 可用宽度（1px 容差：亚像素取整，别为 0.4px 反复跳档）
      row.classList.add("is-measuring");
      const needed = row.scrollWidth;
      row.classList.remove("is-measuring");
      const next = pinched || needed > row.clientWidth + 1;
      row.classList.toggle("is-compact", next);
      setCompactRow((prev) => (prev === next ? prev : next));
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(decide);
    };
    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(row);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // 这几项决定底栏里出现哪些控件 / 文案有多宽；换会话、切权限、用量变化都要重量
  }, [
    models,
    currentModel,
    permissionMode,
    contextUsagePct,
    showContextUsage,
    workdirSelector,
    isStreaming,
    compactRow,
  ]);

  // Permission mode custom dropdown (roving-tabindex listbox shared with
  // the "+" menu via useRovingMenu; Escape returns to the trigger, Tab
  // leaves without changing the mode).
  const permMenuRef = useRef<HTMLDivElement>(null);
  const permMenuButtonRef = useRef<HTMLButtonElement>(null);

  const selectedPermissionIndex = Math.max(
    0,
    PERMISSION_MODES.findIndex(
      (m) => m.value === (permissionMode || "default"),
    ),
  );

  const permMenu = useRovingMenu(permMenuRef, {
    itemSelector: ".permission-mode-item",
    itemCount: PERMISSION_MODES.length,
    triggerRef: permMenuButtonRef,
    closeOnActivate: true,
    onActivate: (i) => {
      vscode.postMessage({
        command: "setPermissionMode",
        mode: PERMISSION_MODES[i].value,
      });
    },
  });

  // Open the permission-mode dropdown. Shared by the in-DOM Cmd/Ctrl+Shift+M
  // handler (VS Code / desktop when the key reaches the DOM) and the
  // JetBrains bridge, which forwards the key after swallowing the IDE's
  // "Move Caret to Matching Brace" action (same pattern as history-search,
  // issue #1429). Focus moves to the currently selected option so Enter/Space
  // confirm and Escape closes without routing focus back through the
  // textarea first.
  const openPermissionModeMenu = useCallback(() => {
    permMenu.openMenu(selectedPermissionIndex);
  }, [permMenu, selectedPermissionIndex]);

  const { open: permMenuOpen } = permMenu;

  const [atMention, setAtMention] = useState<AtMentionState>({
    isActive: false,
    filterText: "",
    startPos: 0,
    endPos: 0,
  });
  const [slashCommand, setSlashCommand] = useState<SlashCommandState>({
    isActive: false,
    filterText: "",
    startPos: 0,
    endPos: 0,
  });
  const [suggestions, setSuggestions] = useState<FileItem[]>([]);
  const [slashCommands, setSlashCommands] = useState<SlashCommand[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);

  // 发送时取 IDE 上下文内容的在途请求：reply 按 requestId 关联，超时兜底。
  const ideContextRequestRef = useRef<{
    requestId: string;
    resolve: (results: IdeContextResult[]) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  // IDE 上下文固定条目（@终端 / @问题）排在文件建议之前：条目由 webview 本地
  // 生成、按已输入的过滤文本筛选（宿主的真实读取发生在发送时，见 handleSend）。
  // 宿主没有 IDE 数据源（桌面端 / 远控页）时 buildIdeContextSuggestions 返回空。
  const ideSuggestions = useMemo(
    () =>
      atMention.isActive
        ? buildIdeContextSuggestions(atMention.filterText)
        : [],
    [atMention.isActive, atMention.filterText],
  );
  // 子代理条目由宿主随文件建议一起下发（`agentName` 判据，见
  // types/index.ts 的 FileItem）：排在文件之前——它们是稳定的小集合，被上百条
  // 文件结果压到下面就等于没有（spec multi-agent/subagent.md 验收场景 1）。
  // 过滤在 webview 做（与上面 IDE 固定条目同一套判据、同一处），宿主只负责
  // 「有哪些子代理」，不必各自再写一份名字/描述的匹配。
  const agentSuggestions = useMemo(() => {
    const filter = atMention.filterText.toLowerCase();
    return suggestions
      .filter((suggestion) => suggestion.agentName)
      .filter(
        (suggestion) =>
          !filter ||
          (suggestion.agentName ?? "").toLowerCase().includes(filter) ||
          (suggestion.agentDescription ?? "").toLowerCase().includes(filter),
      );
  }, [suggestions, atMention.filterText]);
  const fileSuggestions = useMemo(
    () => suggestions.filter((suggestion) => !suggestion.agentName),
    [suggestions],
  );
  const allSuggestions = useMemo(
    () => [...ideSuggestions, ...agentSuggestions, ...fileSuggestions],
    [ideSuggestions, agentSuggestions, fileSuggestions],
  );
  const [dropdownPosition, setDropdownPosition] = useState({
    top: 0,
    left: 0,
  });
  const [slashPopupPosition, setSlashPopupPosition] = useState({
    top: 0,
    left: 0,
  });
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [isHistorySearchVisible, setIsHistorySearchVisible] = useState(false);
  const [historyPopupPosition, setHistoryPopupPosition] = useState({
    top: 0,
    left: 0,
  });
  const [isComposing, setIsComposing] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>(
    initialAttachedImages || [],
  );

  const textareaRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef<string>("");
  const inputContentTimerRef = useRef<NodeJS.Timeout | null>(null);
  // 还在 150ms 防抖窗口里、尚未上报宿主的那份草稿。卸载时必须补发：打开设置页 /
  // 会话看板会把整个 pane 卸载，重挂载的输入框由宿主快照（setInitialState 的
  // inputContent）回填——不补发，最后一段输入就永远到不了宿主，返回对话窗口时
  // 输入框是空的（spec desktop-sessions.md「会话管理」场景 23）。
  const pendingDraftRef = useRef<{
    sessionId?: string;
    content: string;
  } | null>(null);
  const selectionChangeTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSelectionChangePosRef = useRef<number>(0);

  // Expose focus method to parent component
  useImperativeHandle(ref, () => ({
    focus: () => {
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
    },
    triggerShortcut: (name: string) => {
      if (name === "history-search") {
        openHistorySearch();
      } else if (name === "open-permission-mode") {
        openPermissionModeMenu();
      }
    },
    // Appends text at the end of the input, keeping any existing content
    // (including @file chips and images) intact. Used by the desktop preview
    // element picker to batch element comments before sending.
    appendText: (text: string) => {
      const div = textareaRef.current;
      if (!div || !text) return;
      if ((div.textContent ?? "").trim() === "") {
        div.replaceChildren();
      } else {
        div.appendChild(document.createElement("br"));
        div.appendChild(document.createElement("br"));
      }
      text.split("\n").forEach((line, i) => {
        if (i > 0) div.appendChild(document.createElement("br"));
        div.appendChild(document.createTextNode(line));
      });
      // jsdom lacks a real innerText, so fall back to textContent for the
      // state mirror (only its trim() emptiness check is consumed).
      const mirror = div.innerText ?? div.textContent ?? "";
      setMessage(mirror);
      inputContentRef.current = mirror;
      vscode.postMessage({
        command: "updateInputContent",
        sessionId,
        content: serializeInputDraft(div, draftScopeKey),
      });
      div.focus();
      // Caret to the end so the user can keep typing seamlessly.
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(div);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    },
    // Replaces the input content entirely with a plain-text draft (no chip).
    // Unlike appendText, any existing content is discarded — the settings page
    // uses this to hand the AI a prefilled prompt for creating/editing a
    // skill/subagent/hook/MCP entry.
    loadDraft: (text: string) => {
      const div = textareaRef.current;
      if (!div) return;
      div.replaceChildren();
      text.split("\n").forEach((line, i) => {
        if (i > 0) div.appendChild(document.createElement("br"));
        div.appendChild(document.createTextNode(line));
      });
      const mirror = div.innerText ?? div.textContent ?? "";
      setMessage(mirror);
      inputContentRef.current = mirror;
      vscode.postMessage({
        command: "updateInputContent",
        sessionId,
        content: mirror,
      });
      div.focus();
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(div);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    },
    // Loads a queued message's content into the input for editing (chip + body).
    // Called via ref from ChatApp so it only affects this pane's input, not every
    // pane in a split-view layout (window.postMessage would be received by all panes).
    loadQueuedEditContent,
    // Upload a dropped file selection (desktop drag-and-drop).
    uploadFiles: (files: FileList | File[]) => {
      readAndUploadFiles(files);
    },
  }));

  // Auto-focus input on component mount
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, []);

  // Initialize message from inputContent prop
  // Use a ref to avoid re-running effect on every local message change
  const inputContentRef = useRef(inputContent);
  const prevSessionRef = useRef(sessionId);
  // Mirror the latest local message so the session-switch flush can read it
  // without depending on `message` in the effect deps: a message dep would
  // re-run this effect after every keystroke/appendText and wipe the input
  // with the (stale) inputContent prop the host last pushed.
  const messageRef = useRef(message);
  messageRef.current = message;
  // 回填草稿里的图片要挂上「点开预览」，那个回调定义在下面（粘贴路径）：
  // 用 ref 转一手，免得把它的声明拖到本 effect 前面来。
  const handleImagePreviewRef = useRef<(url: string, name: string) => void>(
    () => {},
  );
  // 首次挂载时 prop 就已经带着草稿——欢迎页要等 `state.initialized` 才挂载输入框，
  // 而 initialized 与 inputContent 是同一条 setInitialState 给的，所以「宿主回放
  // 草稿」和「输入框挂载」发生在同一帧：此时 inputContentRef 的初值就等于 prop，
  // 下面的值相等守卫会跳过首次播种，草稿留在宿主里、界面上却是空的（spec
  // desktop-sessions.md「会话管理」场景 23）。
  const initialSeedPendingRef = useRef(!!inputContent);
  useEffect(() => {
    const prevSession = prevSessionRef.current;
    const sessionChanged = prevSession !== sessionId;
    prevSessionRef.current = sessionId;
    if (sessionChanged) {
      // A session switch is in flight. Cancel the pending debounce so the old
      // text can't land on the incoming session's draft, then flush the
      // outgoing session's draft — tagged with its sessionId so the host saves
      // it to the right conversation even if the pane has already switched.
      if (inputContentTimerRef.current) {
        clearTimeout(inputContentTimerRef.current);
        inputContentTimerRef.current = null;
      }
      // 这一份已在下面按「旧 sessionId + 实时文本」补发，待发记录随之作废，
      // 免得卸载时的补发把它重复报到新会话名下。
      pendingDraftRef.current = null;
      const div = textareaRef.current;
      const text = div
        ? serializeInputDraft(div, draftImageScopeKey(prevSession, paneId))
        : messageRef.current;
      if (text) {
        vscode.postMessage({
          command: "updateInputContent",
          sessionId: prevSession,
          content: text,
        });
      }
    }
    // Reset unconditionally on a session switch — the old and new drafts can
    // be equal, which the value-equality guard below can't distinguish.
    // 首次挂载带着草稿那一次也照写（见 initialSeedPendingRef）。
    const seedOnMount = initialSeedPendingRef.current;
    initialSeedPendingRef.current = false;
    if (
      sessionChanged ||
      seedOnMount ||
      (inputContent !== undefined && inputContent !== inputContentRef.current)
    ) {
      inputContentRef.current = inputContent ?? "";
      setMessage(inputContent ?? "");
      if (textareaRef.current) {
        // 草稿里带引用标记（`[@file:…]` / `[Selection: …]` / `[@ide:…]` / 图片）
        // 时必须还原成标签——直接写 innerText 会把它们变成纯文本，引用随消息
        // 发出去时就失效了（缺陷 3503216687855872）。
        renderDraftContent(textareaRef.current, inputContent ?? "", {
          scopeKey: draftScopeKey,
          onImageClick: (url, name) => handleImagePreviewRef.current(url, name),
        });
      }
    }
  }, [inputContent, sessionId, paneId, vscode, draftScopeKey]);

  // Initialize attached images from initialAttachedImages prop
  useEffect(() => {
    if (initialAttachedImages !== undefined) {
      setAttachedImages(initialAttachedImages);
    }
  }, [initialAttachedImages]);

  // Close dropdown helper
  const closeDropdown = useCallback(() => {
    setAtMention({ isActive: false, filterText: "", startPos: 0, endPos: 0 });
    setSuggestions([]);
    setSelectedIndex(0);
    setIsLoadingSuggestions(false);
  }, []);

  // Close 指令 popup helper
  const closeSlashCommandPopup = useCallback(() => {
    setSlashCommand({
      isActive: false,
      filterText: "",
      startPos: 0,
      endPos: 0,
    });
    setSlashCommands([]);
    setSelectedSlashIndex(0);
  }, []);

  const closeHistorySearch = useCallback(() => {
    setIsHistorySearchVisible(false);
    if (textareaRef.current) {
      // Use setTimeout to ensure focus is returned after any other click events are processed
      const textarea = textareaRef.current;
      setTimeout(() => {
        textarea.focus();
      }, 0);
    }
  }, []);

  const handleHistorySelect = useCallback(
    (prompt: string) => {
      if (!textareaRef.current) return;

      // Set the prompt as the new message
      textareaRef.current.innerText = prompt;
      setMessage(prompt);

      // Update extension state
      vscode.postMessage({
        command: "updateInputContent",
        content: prompt,
      });

      // Focus and move cursor to end
      textareaRef.current.focus();
      const range = document.createRange();
      const selection = window.getSelection();
      range.selectNodeContents(textareaRef.current);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);

      closeHistorySearch();
    },
    [vscode, closeHistorySearch],
  );

  // Load content for editing a queued message.
  // Per design (Figma 2196:1055): the input starts with a read-only inline chip
  // "编辑队列消息" (contentEditable=false, blue-teal text) followed by a space and
  // the editable message body. Deleting the chip exits edit mode; convertToMarkdown
  // skips the chip so the sent markdown is just the body.
  const loadQueuedEditContent = useCallback(
    (text: string) => {
      if (!textareaRef.current) return;

      // Reset the editor content, then build chip + space + body.
      textareaRef.current.innerHTML = "";

      const chip = document.createElement("span");
      chip.className = "queued-edit-chip";
      chip.contentEditable = "false";
      chip.setAttribute("data-queued-edit-chip", "true");
      chip.innerText = "编辑队列消息";
      textareaRef.current.appendChild(chip);

      // Space between chip and body.
      textareaRef.current.appendChild(document.createTextNode(" "));

      // Editable body.
      const bodyNode = document.createTextNode(text);
      textareaRef.current.appendChild(bodyNode);

      setMessage(textareaRef.current.innerText);

      vscode.postMessage({
        command: "updateInputContent",
        content: serializeInputDraft(textareaRef.current, draftScopeKey),
      });

      // Focus and move cursor to end of the body.
      textareaRef.current.focus();
      const range = document.createRange();
      const selection = window.getSelection();
      range.selectNodeContents(textareaRef.current);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    },
    [vscode, draftScopeKey],
  );

  // Detect 指令 in text
  const detectSlashCommand = useCallback(
    (text: string, cursorPos: number): SlashCommandState => {
      // Find the last / symbol before cursor position
      let slashPos = -1;
      for (let i = cursorPos - 1; i >= 0; i--) {
        if (text[i] === "/") {
          slashPos = i;
          break;
        }
        // Stop if we hit whitespace or newline
        if (text[i] === " " || text[i] === "\n") {
          break;
        }
      }

      if (slashPos === -1) {
        return { isActive: false, filterText: "", startPos: 0, endPos: 0 };
      }

      // Check if / is at start of line or preceded by whitespace
      const isValidPosition = slashPos === 0 || /\s/.test(text[slashPos - 1]);
      if (!isValidPosition) {
        return { isActive: false, filterText: "", startPos: 0, endPos: 0 };
      }

      // Extract filter text after /
      const afterSlash = text.slice(slashPos + 1, cursorPos);

      // Check if filter text contains invalid characters
      if (/\s/.test(afterSlash)) {
        return { isActive: false, filterText: "", startPos: 0, endPos: 0 };
      }

      return {
        isActive: true,
        filterText: afterSlash,
        startPos: slashPos,
        endPos: cursorPos,
      };
    },
    [],
  );

  // Detect @ mention in text
  const detectAtMention = useCallback(
    (text: string, cursorPos: number): AtMentionState => {
      // Find the last @ symbol before cursor position
      let atPos = -1;
      for (let i = cursorPos - 1; i >= 0; i--) {
        if (text[i] === "@") {
          atPos = i;
          break;
        }
        // Stop if we hit whitespace or newline
        if (text[i] === " " || text[i] === "\n") {
          break;
        }
      }

      if (atPos === -1) {
        return { isActive: false, filterText: "", startPos: 0, endPos: 0 };
      }

      // Check if @ is at start of line or preceded by whitespace
      const charBefore = text[atPos - 1];
      const isValidPosition = atPos === 0 || /\s/.test(charBefore);
      if (!isValidPosition) {
        return { isActive: false, filterText: "", startPos: 0, endPos: 0 };
      }

      // Extract filter text after @
      const afterAt = text.slice(atPos + 1, cursorPos);

      // Check if filter text contains invalid characters
      if (/\s/.test(afterAt)) {
        return { isActive: false, filterText: "", startPos: 0, endPos: 0 };
      }

      return {
        isActive: true,
        filterText: afterAt,
        startPos: atPos,
        endPos: cursorPos,
      };
    },
    [],
  );

  // Calculate dropdown position based on cursor
  const calculateDropdownPosition = useCallback(() => {
    if (!textareaRef.current) return { top: 0, left: 0 };

    const textarea = textareaRef.current;

    // Position at textarea top - CSS transform will move it up by dropdown height
    // This ensures the dropdown appears above the input with proper spacing
    return {
      top: textarea.offsetTop,
      left: textarea.offsetLeft,
    };
  }, []);

  // Handle input clearing when requested by parent
  useEffect(() => {
    if (shouldClearInput) {
      setMessage("");
      // Clear persisted input content
      vscode.postMessage({
        command: "updateInputContent",
        sessionId,
        content: "",
      });
      setAttachedImages([]);
      closeDropdown();
      onInputCleared?.();
    }
  }, [shouldClearInput, onInputCleared, vscode, closeDropdown, sessionId]);

  // Request file suggestions from extension
  const requestFileSuggestions = useCallback(
    (filterText: string) => {
      const requestId = Date.now().toString();
      requestIdRef.current = requestId;
      setIsLoadingSuggestions(true);

      vscode.postMessage({
        command: "requestFileSuggestions",
        filterText: filterText,
        requestId: requestId,
      });
    },
    [vscode],
  );

  // Request 指令 from extension
  const requestSlashCommands = useCallback(
    (filterText: string) => {
      vscode.postMessage({
        command: "requestSlashCommands",
        filterText: filterText,
      });
    },
    [vscode],
  );

  // Remembers the caret position when the input loses focus. The browser
  // resets the caret to the start when focus() is called from an async
  // insertion (e.g. upload success), so those paths restore the pre-blur
  // position instead of inserting at the wrong spot.
  const lastCaretOffsetRef = useRef<number | null>(null);

  const handleInputBlur = useCallback(() => {
    const selection = window.getSelection();
    if (
      selection &&
      selection.rangeCount > 0 &&
      textareaRef.current?.contains(selection.getRangeAt(0).startContainer)
    ) {
      const range = selection.getRangeAt(0);
      if (range.startContainer.nodeType === Node.TEXT_NODE) {
        lastCaretOffsetRef.current = textOffsetOf(
          textareaRef.current,
          range.startContainer,
          range.startOffset,
        );
      }
    }
  }, []);

  // The insertion point for async tag insertions: the pre-blur caret
  // snapshot first, then the live selection when the input never lost focus,
  // else null (caller falls back to the end of the input).
  const resolveInsertionPoint = useCallback((): {
    node: Node;
    offset: number;
  } | null => {
    const input = textareaRef.current;
    if (!input) return null;

    if (lastCaretOffsetRef.current !== null) {
      // The snapshot can go stale — the input is emptied on send (and on
      // manual delete) without resetting it, so the offset can exceed the
      // current text length and resolve to nothing. Only trust it when it
      // still maps to a position; otherwise fall through.
      const fromSnapshot = findTextOffset(input, lastCaretOffsetRef.current);
      if (fromSnapshot) return fromSnapshot;
    }

    const selection = window.getSelection();
    if (
      selection &&
      selection.rangeCount > 0 &&
      input.contains(selection.getRangeAt(0).startContainer)
    ) {
      const range = selection.getRangeAt(0);
      return { node: range.startContainer, offset: range.startOffset };
    }
    return null;
  }, []);

  // Handle inserting uploaded file paths into the input
  const insertUploadedFilePaths = useCallback(
    (uploadedFiles: string[]) => {
      if (!textareaRef.current || uploadedFiles.length === 0) return;

      // Focus the input first; the browser resets the caret to the start, so
      // the insertion point must come from the pre-blur snapshot (or the
      // live selection when the input never lost focus).
      textareaRef.current.focus();

      // Insert at the saved/pre-blur caret position; fall back to the end of
      // the input when no reliable position exists.
      let range: Range;
      const insertPoint = resolveInsertionPoint();
      if (insertPoint) {
        range = document.createRange();
        range.setStart(insertPoint.node, insertPoint.offset);
        range.collapse(true);
      } else {
        // 无可靠插入点（光标快照过期 / 实时选区不在输入框内）：插到末尾而不是丢弃，
        // 失败不再静默 —— 界面上没反应时至少能从 console 定位。
        console.warn(
          "[MessageInput] 上传文件路径无法解析插入位置，已回退到输入框末尾",
        );
        range = document.createRange();
        range.selectNodeContents(textareaRef.current);
        range.collapse(false);
      }

      uploadedFiles.forEach((filePath) => {
        const fileName = filePath.split(/[/\\]/).pop() || filePath;

        const tagSpan = document.createElement("span");
        tagSpan.className = "context-tag-container";
        tagSpan.contentEditable = "false";
        tagSpan.setAttribute("data-path", filePath);
        tagSpan.setAttribute("data-name", fileName);
        tagSpan.innerText = `[@file:${filePath}]`;

        const root = ReactDOM.createRoot(tagSpan);
        root.render(<ContextTag name={fileName} path={filePath} />);

        range.insertNode(tagSpan);
        range.setStartAfter(tagSpan);

        // Add space after each tag
        const space = document.createTextNode(" ");
        range.insertNode(space);
        range.setStartAfter(space);
      });

      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      // Trigger input event to update message state
      const inputEvent = new Event("input", { bubbles: true });
      textareaRef.current?.dispatchEvent(inputEvent);

      closeDropdown();
    },
    [closeDropdown, resolveInsertionPoint],
  );

  // Handle inserting selection tags into the input
  const insertSelectionTag = useCallback(
    (selection: {
      fileName: string;
      filePath: string;
      startLine: number;
      endLine: number;
      isEmpty?: boolean;
    }) => {
      if (!textareaRef.current || !selection || selection.isEmpty) return;

      // Focus the input first; the browser resets the caret to the start, so
      // the insertion point must come from the pre-blur snapshot (or the
      // live selection when the input never lost focus).
      textareaRef.current.focus();

      const insertPoint = resolveInsertionPoint();
      // Insert at the saved/pre-blur caret position; fall back to the end of
      // the input when no reliable position exists (same contract as
      // insertUploadedFilePaths) so a stale caret snapshot can never make the
      // tag disappear silently.
      let range: Range;
      if (insertPoint) {
        range = document.createRange();
        range.setStart(insertPoint.node, insertPoint.offset);
        range.setEnd(insertPoint.node, insertPoint.offset);
      } else {
        // 无可靠插入点（光标快照过期 / 实时选区不在输入框内）：插到末尾而不是丢弃，
        // 失败不再静默 —— 界面上没反应时至少能从 console 定位。
        console.warn(
          "[MessageInput] 选区标签无法解析插入位置，已回退到输入框末尾",
        );
        range = document.createRange();
        range.selectNodeContents(textareaRef.current);
        range.collapse(false);
      }

      const fileName =
        selection.fileName.split(/[/\\]/).pop() || selection.fileName;
      const displayName = `${fileName}#${selection.startLine}-${selection.endLine}`;

      const tagSpan = document.createElement("span");
      tagSpan.className = "context-tag-container";
      tagSpan.contentEditable = "false";
      tagSpan.setAttribute("data-path", selection.filePath);
      tagSpan.setAttribute("data-name", fileName);
      tagSpan.setAttribute("data-start-line", String(selection.startLine));
      tagSpan.setAttribute("data-end-line", String(selection.endLine));
      tagSpan.setAttribute("data-is-selection", "true");
      tagSpan.innerText = `[Selection: ${selection.filePath}|${fileName}#${selection.startLine}-${selection.endLine}]`;

      const root = ReactDOM.createRoot(tagSpan);
      root.render(
        <ContextTag
          name={displayName}
          path={selection.filePath}
          onClick={() => {
            vscode.postMessage({
              command: "openFile",
              path: selection.filePath,
              startLine: selection.startLine,
              endLine: selection.endLine,
            });
          }}
        />,
      );

      range.deleteContents();
      range.insertNode(tagSpan);
      range.setStartAfter(tagSpan);

      // Add space after the tag
      const space = document.createTextNode(" ");
      range.insertNode(space);
      range.setStartAfter(space);

      range.collapse(true);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);

      // Trigger input event to update message state
      const inputEvent = new Event("input", { bubbles: true });
      textareaRef.current?.dispatchEvent(inputEvent);
    },
    [vscode, resolveInsertionPoint],
  );

  // Listen for file suggestions response from extension
  useHostMessage((data) => {
    if (data.command === "ideContextResponse") {
      // 发送前那一笔 IDE 上下文读取的回执：requestId 对上才消费（晚到的旧回复
      // 即弃），清掉超时定时器并放行发送。
      const pending = ideContextRequestRef.current;
      if (pending && data.requestId === pending.requestId) {
        clearTimeout(pending.timer);
        ideContextRequestRef.current = null;
        pending.resolve(Array.isArray(data.results) ? data.results : []);
      }
      return;
    }
    if (data.command === "fileSuggestionsResponse") {
      // Only process if this is the latest request
      if (data.requestId === requestIdRef.current) {
        setSuggestions(data.suggestions || []);
        setSelectedIndex(0);
        setIsLoadingSuggestions(false);
      }
    } else if (data.command === "fileSuggestionsError") {
      if (data.requestId === requestIdRef.current) {
        setSuggestions([]);
        setIsLoadingSuggestions(false);
        console.error("File suggestions error:", data.error);
      }
    } else if (data.command === "slashCommandsResponse") {
      setSlashCommands(data.commands || []);
      setSelectedSlashIndex(0);
    } else if (data.command === "slashCommandsError") {
      setSlashCommands([]);
      console.error("指令错误:", data.error);
    } else if (data.command === "uploadSuccess") {
      // Insert uploaded file paths into the input after the @ symbol.
      // In split view the host echoes the originating paneId; a reply for
      // another pane must not insert into this input. Inline (not the hook's
      // paneId option): the other commands here are untagged and pane
      // instances must still receive them.
      if (paneId !== undefined && data.paneId !== paneId) return;
      if (data.uploadedFiles && data.uploadedFiles.length > 0) {
        insertUploadedFilePaths(data.uploadedFiles);
      }
    } else if (data.command === "uploadError") {
      console.error("文件上传失败:", data.error);
      // Could show an error notification here if needed
    } else if (data.command === "addSelectionToInput") {
      insertSelectionTag(data.selection);
    }
  });

  // Handle image preview
  const handleImagePreview = useCallback((url: string, name: string) => {
    // Create a temporary modal for image preview
    const modal = document.createElement("div");
    modal.className = "image-preview-modal";
    modal.onclick = () => document.body.removeChild(modal);

    const img = document.createElement("img");
    img.src = url;
    img.alt = name;
    img.onclick = (e) => e.stopPropagation();

    const closeBtn = document.createElement("div");
    closeBtn.className = "image-preview-close";
    closeBtn.innerHTML =
      '<svg width="24" height="24" viewBox="0 0 17 17" fill="none"><path d="M8.51 2.5 L9.19 3.17 V7.84 H13.84 L14.51 8.51 H13.84 V9.19 H9.19 V13.83 L8.51 14.5 V13.83 H7.84 V9.19 H3.17 L2.5 8.51 H3.17 V7.84 H7.84 V3.17 Z" fill="currentColor" transform="rotate(45 8.5 8.5)"/></svg>';

    modal.appendChild(img);
    modal.appendChild(closeBtn);
    document.body.appendChild(modal);
  }, []);
  useEffect(() => {
    handleImagePreviewRef.current = handleImagePreview;
  }, [handleImagePreview]);

  // Read files as base64 and post them to the host for upload. The paneId is
  // tagged on the request so the host can echo it back on uploadSuccess and
  // only the originating pane's input inserts the path chips (split view).
  const readAndUploadFiles = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      if (fileArray.length === 0) return;
      const readers = fileArray.map((file) => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            resolve({
              name: file.name,
              size: file.size,
              type: file.type,
              data: reader.result,
            });
          };
          reader.onerror = reject;
          reader.readAsArrayBuffer(file);
        });
      });

      Promise.all(readers)
        .then((fileDataArray) => {
          vscode.postMessage({
            command: "uploadFilesToArtifacts",
            files: fileDataArray,
            ...(paneId !== undefined ? { paneId } : {}),
          });
        })
        .catch((error) => {
          console.error("Error reading files:", error);
          vscode.postMessage({
            command: "showError",
            message: "读取文件失败: " + error.message,
          });
        });
    },
    [vscode, paneId],
  );

  // Handle file upload
  const handleFileUpload = useCallback(() => {
    // Create a hidden file input element
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.multiple = true; // Support multiple file selection
    fileInput.style.display = "none";

    fileInput.onchange = (event) => {
      const files = (event.target as HTMLInputElement).files;
      if (files && files.length > 0) {
        readAndUploadFiles(files);
      }

      // Cleanup
      document.body.removeChild(fileInput);
    };

    // Trigger file selection dialog
    document.body.appendChild(fileInput);
    fileInput.click();

    // Close the dropdown after triggering upload
    closeDropdown();
  }, [readAndUploadFiles, closeDropdown]);

  // Handle "/" toolbar button: focus the input and insert a "/" at the cursor/end so the
  // existing handleInput -> detectSlashCommand -> requestSlashCommands flow opens the popup.
  const handleSlashButtonClick = useCallback(() => {
    if (!textareaRef.current) return;

    textareaRef.current.focus();

    const selection = window.getSelection();
    if (!selection) return;

    let range: Range;
    if (
      selection.rangeCount > 0 &&
      textareaRef.current.contains(selection.getRangeAt(0).startContainer)
    ) {
      range = selection.getRangeAt(0);
    } else {
      range = document.createRange();
      range.selectNodeContents(textareaRef.current);
      range.collapse(false);
    }

    const slashNode = document.createTextNode("/");
    range.insertNode(slashNode);
    range.setStartAfter(slashNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    // Trigger input event so the slash-command detection runs and the popup appears.
    const inputEvent = new Event("input", { bubbles: true });
    textareaRef.current.dispatchEvent(inputEvent);
  }, []);

  // Handle file selection
  const handleFileSelect = useCallback(
    (file: FileItem) => {
      if (!textareaRef.current) return;
      if (!atMention.isActive) {
        closeDropdown();
        return;
      }

      // Create the tag element
      const tagSpan = document.createElement("span");
      tagSpan.className = "context-tag-container"; // Wrapper for React component
      tagSpan.contentEditable = "false";

      // 子代理条目：标签只留点名标记，判定与注入都在 SDK（spec
      // multi-agent/subagent.md「显式子代理调用」）。
      const agentName = file.agentName;
      if (agentName) {
        tagSpan.setAttribute("data-agent-name", agentName);
        tagSpan.setAttribute("data-path", `agent:${agentName}`);
        tagSpan.setAttribute("data-name", agentName);
        tagSpan.setAttribute("data-is-image", "false");
        tagSpan.innerText = `[@agent:${agentName}]`;
        ReactDOM.createRoot(tagSpan).render(
          <ContextTag name={agentName} path={`agent:${agentName}`} />,
        );
      } else {
        // IDE 上下文条目（@终端 / @问题）：不是文件引用，标签只留一个标记，内容
        // 在发送那一刻才向宿主取（spec ui/ide-context-mentions.md）。
        const ideProvider = file.ideContext;
        const ideInfo = ideProvider
          ? ideContextProviderInfo(ideProvider)
          : undefined;
        if (ideProvider && ideInfo) {
          tagSpan.setAttribute("data-ide-context", ideProvider);
          tagSpan.setAttribute("data-path", `ide:${ideProvider}`);
          tagSpan.setAttribute("data-name", ideInfo.label);
          tagSpan.setAttribute("data-is-image", "false");
          tagSpan.innerText = ideContextMarker(ideProvider);
          ReactDOM.createRoot(tagSpan).render(
            <ContextTag name={ideInfo.label} path={`ide:${ideProvider}`} />,
          );
        } else {
          tagSpan.setAttribute("data-path", file.relativePath);
          tagSpan.setAttribute("data-name", file.name);
          tagSpan.innerText = `[@file:${file.relativePath}]`;

          // 普通文件引用：图片文件也一样，不可点击、没有预览入口
          // （spec ui/file-selector.md 场景 1）。
          ReactDOM.createRoot(tagSpan).render(
            <ContextTag name={file.name} path={file.relativePath} />,
          );
        }
      }

      // Locate the '@' + filter text to replace. Prefer the live DOM selection
      // when it still points into the input's text node (keyboard Enter): the
      // atMention snapshot may be stale if the 200ms detection debounce has not
      // fired yet, so it would only cover the '@'. Fall back to atMention when
      // the selection sits on the popup item (mouse click), where the old
      // text-node check silently no-op'd (same failure mode as the slash popup).
      textareaRef.current.focus();

      let start: { node: Text; offset: number } | null = null;
      let end: { node: Text; offset: number } | null = null;

      const selection = window.getSelection();
      if (
        selection &&
        selection.rangeCount > 0 &&
        textareaRef.current.contains(selection.getRangeAt(0).startContainer)
      ) {
        const selRange = selection.getRangeAt(0);
        if (selRange.startContainer.nodeType === Node.TEXT_NODE) {
          const text = selRange.startContainer.textContent || "";
          const lastAtIndex = text.lastIndexOf("@", selRange.startOffset - 1);
          // A zero-length range (caret at the very start, e.g. after focus()
          // reset it) would delete nothing and insert the tag *before* the
          // '@' — reject it and fall back to the atMention snapshot instead.
          if (lastAtIndex !== -1 && selRange.startOffset > lastAtIndex) {
            start = {
              node: selRange.startContainer as Text,
              offset: lastAtIndex,
            };
            end = {
              node: selRange.startContainer as Text,
              offset: selRange.startOffset,
            };
          }
        }
      }

      if (!start || !end) {
        if (!atMention.isActive) {
          closeDropdown();
          return;
        }
        start = findTextOffset(textareaRef.current, atMention.startPos);
        end = findTextOffset(textareaRef.current, atMention.endPos);
      }

      if (start && end) {
        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        range.deleteContents();

        // Insert the tag
        range.insertNode(tagSpan);

        // Insert a space after the tag
        const space = document.createTextNode(" ");
        range.setStartAfter(tagSpan);
        range.insertNode(space);

        // Move cursor after the space
        range.setStartAfter(space);
        range.setEndAfter(space);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);

        // Trigger input event to update message state
        const inputEvent = new Event("input", { bubbles: true });
        textareaRef.current?.dispatchEvent(inputEvent);
      }

      closeDropdown();
    },
    [closeDropdown, atMention],
  );

  // Handle 指令 selection
  const handleSlashCommandSelect = useCallback(
    (command: SlashCommand) => {
      if (!textareaRef.current) return;

      // 宿主本地 UI 指令（打开弹窗/设置页/面板）选中即执行，行为与光标位置无关，
      // 所以先处理它们：即使浏览器把选区塌在 contenteditable div 上（nodeType 1），
      // 鼠标点击也能生效。判据取自宿主下发的 `runOnSelect`，这里不再维护命令名
      // 名单——三个宿主各有自己的本地指令表，webview 抄一份必然漂移，漏同步的命令
      // 会掉进下面的「插入文本」分支。
      if (command.runOnSelect) {
        // 本地指令不能把 '/' 前的草稿整条清掉（历史 bug：无条件 innerHTML=""
        // 静默丢弃草稿）。与下方技能指令分支一致：仅删除 [startPos, endPos)
        // 的指令 token，保留其余文本，并把剩余文本上报宿主会话记忆。
        textareaRef.current.focus();

        const start = findTextOffset(
          textareaRef.current,
          slashCommand.startPos,
        );
        const end = findTextOffset(textareaRef.current, slashCommand.endPos);
        if (start && end) {
          const range = document.createRange();
          range.setStart(start.node, start.offset);
          range.setEnd(end.node, end.offset);
          range.deleteContents();

          const remaining = serializeInputDraft(
            textareaRef.current,
            draftScopeKey,
          );
          setMessage(remaining);
          // 立即持久化剩余草稿：随后打开的对话框/设置页可能卸载本输入框，
          // 会取消 handleInput 里 150ms 防抖的保存。
          vscode.postMessage({
            command: "updateInputContent",
            sessionId,
            content: remaining,
          });
        }

        closeSlashCommandPopup();
        onSendMessage(`/${command.name}`);
        return;
      }

      // Skill commands replace the '/' plus any filter text with the command name.
      // Locate the [startPos, endPos) span recorded by detectSlashCommand by walking
      // the text nodes, instead of relying on window.getSelection()'s startContainer
      // being a text node — which is not guaranteed when the user picks the command
      // with the mouse (the selection may collapse onto the contenteditable div
      // itself, nodeType 1, making the old text-node check silently no-op and the
      // first click fail to insert anything).
      textareaRef.current.focus();

      const start = findTextOffset(textareaRef.current, slashCommand.startPos);
      const end = findTextOffset(textareaRef.current, slashCommand.endPos);
      if (start && end) {
        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        range.deleteContents();

        const commandText = `/${command.name} `;
        const newNode = document.createTextNode(commandText);
        range.insertNode(newNode);

        // Move cursor after the inserted text
        range.setStartAfter(newNode);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);

        // Trigger input event to update message state
        const inputEvent = new Event("input", { bubbles: true });
        textareaRef.current.dispatchEvent(inputEvent);
      }

      closeSlashCommandPopup();
    },
    [
      closeSlashCommandPopup,
      onSendMessage,
      vscode,
      slashCommand,
      sessionId,
      draftScopeKey,
    ],
  );

  /**
   * 向宿主取 IDE 上下文内容（@终端 / @问题）。一次性查询：requestId 原样带回，
   * 不匹配的回复即弃；超时按「不可用」返回，消息照常发出——读不到 IDE 不该让
   * 用户点发送后卡住（spec 边界情况「读数据有延迟」）。
   */
  const requestIdeContextContent = useCallback(
    (providers: IdeContextProvider[]): Promise<IdeContextResult[]> =>
      new Promise((resolve) => {
        const requestId = `ide-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        const timer = setTimeout(() => {
          ideContextRequestRef.current = null;
          resolve(
            providers.map((provider) => ({
              provider,
              ok: false,
              reason: "读取超时（IDE 未响应）",
            })),
          );
        }, IDE_CONTEXT_TIMEOUT_MS);
        ideContextRequestRef.current = { requestId, resolve, timer };
        vscode.postMessage({
          command: "requestIdeContext",
          requestId,
          providers,
        });
      }),
    [vscode],
  );

  const handleSend = useCallback(() => {
    if (disabled) return;
    if (!textareaRef.current) return;

    const { markdown: rawMarkdown, images: extractedImages } =
      convertToMarkdown(textareaRef.current);
    const markdown = rawMarkdown.replace(/\u00A0/g, " ");
    const allImages = [...attachedImages, ...extractedImages];

    if (markdown.trim() || allImages.length > 0) {
      // Convert attached images to base64 format for SDK
      const images = allImages.map((img) => ({
        data: img.data, // This is already base64 data URL
        mediaType: img.mimeType,
      }));

      const dispatch = (text: string) => {
        if (editingQueuedId) {
          // Editing a queued message: update the queue entry instead of sending to AI
          onSubmitQueuedEdit?.(
            editingQueuedId,
            text,
            images.length > 0 ? images : undefined,
          );
        } else {
          onSendMessage(text, images.length > 0 ? images : undefined);
        }
      };

      const clearInput = () => {
        if (!textareaRef.current) return;
        textareaRef.current.innerHTML = "";
        setMessage("");
        // Clear persisted input content
        vscode.postMessage({
          command: "updateInputContent",
          content: "",
        });
        // 图片已经随消息发出去了，本地存储里那份草稿图片不再需要。
        void clearDraftImages(draftScopeKey);
        setAttachedImages([]);
        closeDropdown();
      };

      const ideMentions = findIdeContextMentions(markdown);
      if (ideMentions.length === 0) {
        dispatch(markdown);
        clearInput();
        return;
      }

      // IDE 上下文（@终端 / @问题）：内容在**发送这一刻**取一次，取到后拼进正
      // 文再发（spec ui/ide-context-mentions.md）。输入框先清空——等待宿主这
      // 一小段时间里用户接着打字，不会被随后那次清空抹掉；正文快照已经取好。
      clearInput();
      void requestIdeContextContent(ideMentions).then((results) => {
        dispatch(assembleIdeContextBlocks(markdown, results));
      });
    }
  }, [
    disabled,
    attachedImages,
    onSendMessage,
    closeDropdown,
    vscode,
    editingQueuedId,
    onSubmitQueuedEdit,
    requestIdeContextContent,
    draftScopeKey,
  ]);

  // Open the history-search popup. Shared by the in-DOM Ctrl/Cmd+R handler and the
  // JetBrains bridge (which forwards the key after swallowing the IDE action — see
  // issue #1429). Kept as a plain function so the host can invoke it without a KeyEvent.
  const openHistorySearch = useCallback(() => {
    setHistoryPopupPosition(calculateDropdownPosition());
    setIsHistorySearchVisible(true);
  }, [calculateDropdownPosition]);

  // 「上传文件」要宿主的 artifacts 上传能力，远程控制 Web 页没有它
  // （spec ui/remote-control.md 场景 24）—— 页面上这一项不渲染，菜单里只剩
  // 历史提示词。
  const plusMenuItems = [
    ...(isRemotePageHost()
      ? []
      : [
          {
            label: "上传文件",
            run: () => handleFileUpload(),
          },
        ]),
    {
      label: "历史提示词",
      run: () => openHistorySearch(),
    },
  ];

  // "+" (add) custom dropdown, same roving keyboard model as the
  // permission-mode listbox via useRovingMenu. Declared after its
  // collaborators so onActivate can close over them.
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const plusMenuButtonRef = useRef<HTMLButtonElement>(null);

  const plusMenu = useRovingMenu(plusMenuRef, {
    itemSelector: ".plus-menu-item",
    itemCount: plusMenuItems.length,
    triggerRef: plusMenuButtonRef,
    closeOnActivate: true,
    onActivate: (i) => plusMenuItems[i].run(),
  });

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      // Handle Cmd/Ctrl+Shift+M to open the permission mode menu (aligned
      // with Claude Code Desktop). preventDefault+stopPropagation also keeps
      // the chord away from host defaults that share it: VS Code's "Focus
      // Problems" and JetBrains' "Move Caret to Matching Brace". Matched on
      // `code` because Shift uppercases `key`.
      if (
        event.code === "KeyM" &&
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        !isComposing
      ) {
        event.preventDefault();
        event.stopPropagation();
        openPermissionModeMenu();
        return;
      }

      // Handle Ctrl+R for history search
      if (
        event.key === "r" &&
        (event.ctrlKey || event.metaKey) &&
        !isComposing
      ) {
        event.preventDefault();
        event.stopPropagation();
        openHistorySearch();
        return;
      }

      // Handle Ctrl+B to background the current foreground task (same as CLI).
      // Only intercepted while a turn is running — when idle the key falls
      // through so the host keeps its own Ctrl+B binding (e.g. VS Code's
      // Toggle Sidebar). Never on the remote-control Web page: backgrounding is
      // a host-side move with no reply there (spec ui/remote-control.md 场景 24),
      // and a phone browser has no binding to protect anyway.
      if (
        event.key === "b" &&
        (event.ctrlKey || event.metaKey) &&
        !isComposing &&
        !isRemotePageHost()
      ) {
        if (isStreaming) {
          event.preventDefault();
          event.stopPropagation();
          vscode.postMessage({ command: "backgroundCurrentTask" });
          return;
        }
      }

      // Handle 指令 navigation. Navigate over the display-ordered list so the
      // highlighted item, up/down movement, and Enter selection all match the
      // grouped order shown in the popup.
      if (slashCommand.isActive && slashCommands.length > 0) {
        const orderedCommands = orderSlashCommands(slashCommands);
        switch (event.key) {
          case "ArrowUp":
            event.preventDefault();
            setSelectedSlashIndex((prev: number) => Math.max(0, prev - 1));
            return;
          case "ArrowDown":
            event.preventDefault();
            setSelectedSlashIndex((prev: number) =>
              Math.min(orderedCommands.length - 1, prev + 1),
            );
            return;
          case "Tab":
          case "Enter":
            event.preventDefault();
            if (orderedCommands[selectedSlashIndex]) {
              handleSlashCommandSelect(orderedCommands[selectedSlashIndex]);
            }
            return;
          case "Escape":
            event.preventDefault();
            closeSlashCommandPopup();
            return;
        }
      }

      // Handle dropdown navigation
      if (atMention.isActive && allSuggestions.length > 0) {
        const maxIndex = allSuggestions.length - 1;

        switch (event.key) {
          case "ArrowUp":
            event.preventDefault();
            setSelectedIndex((prev: number) => Math.max(0, prev - 1));
            return;
          case "ArrowDown":
            event.preventDefault();
            setSelectedIndex((prev: number) => Math.min(maxIndex, prev + 1));
            return;
          case "Enter":
            event.preventDefault();
            if (allSuggestions[selectedIndex]) {
              handleFileSelect(allSuggestions[selectedIndex]);
            }
            return;
          case "Escape":
            event.preventDefault();
            if (isStreaming) {
              onAbortMessage();
            }
            closeDropdown();
            return;
        }
      }

      // Handle Esc key for interruption when focused and streaming
      if (event.key === "Escape" && isStreaming) {
        event.preventDefault();
        onAbortMessage();
        return;
      }

      // Normal behavior for Enter key
      if (event.key === "Enter" && !event.shiftKey && !isComposing) {
        event.preventDefault();
        handleSend();
      }
    },
    [
      slashCommand.isActive,
      slashCommands,
      selectedSlashIndex,
      handleSlashCommandSelect,
      closeSlashCommandPopup,
      atMention.isActive,
      allSuggestions,
      selectedIndex,
      handleFileSelect,
      closeDropdown,
      handleSend,
      isComposing,
      vscode,
      openHistorySearch,
      openPermissionModeMenu,
      isStreaming,
      onAbortMessage,
    ],
  );

  // Handle cursor position changes - debounced to wait for user to stop moving cursor
  const handleSelectionChange = useCallback(() => {
    if (!textareaRef.current) return;

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(textareaRef.current);
    preCaretRange.setEnd(range.endContainer, range.endOffset);

    const cursorPos = preCaretRange.toString().length;

    // Skip if cursor position hasn't changed (avoid redundant work)
    if (cursorPos === lastSelectionChangePosRef.current) {
      return;
    }
    lastSelectionChangePosRef.current = cursorPos;

    // Debounce: reset timer on each cursor change, only execute when user stops
    if (selectionChangeTimerRef.current) {
      clearTimeout(selectionChangeTimerRef.current);
    }

    selectionChangeTimerRef.current = setTimeout(() => {
      if (!textareaRef.current) return;

      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;

      const rng = sel.getRangeAt(0);
      const pre = rng.cloneRange();
      pre.selectNodeContents(textareaRef.current!);
      pre.setEnd(rng.endContainer, rng.endOffset);

      const textBeforeCursor = pre.toString();

      // `@` 文件提及：远控页现在也有宿主能力了（第二批解禁）——shim 把
      // `requestFileSuggestions` 转成 `searchFiles`，工作目录由宿主按会话取。
      // 这条门禁此前存在，是因为发出去没人应答、下拉永远停在「正在搜索文件…」；
      // 有了回执，那条理由随之消失（spec ui/remote-control.md「页面能执行的那批
      // 宿主命令」场景 7）。
      const mentionState: AtMentionState = detectAtMention(
        textBeforeCursor,
        textBeforeCursor.length,
      );
      const slashCommandState = detectSlashCommand(
        textBeforeCursor,
        textBeforeCursor.length,
      );

      if (!mentionState.isActive) {
        closeDropdown();
        setSuggestions([]);
        setIsLoadingSuggestions(false);
      } else {
        setAtMention(mentionState);
        setDropdownPosition(calculateDropdownPosition());
        requestFileSuggestions(mentionState.filterText);
      }

      if (!slashCommandState.isActive) {
        closeSlashCommandPopup();
      } else {
        setSlashCommand(slashCommandState);
        setSlashPopupPosition(calculateDropdownPosition());
        requestSlashCommands(slashCommandState.filterText);
      }
      selectionChangeTimerRef.current = null;
    }, 200);
  }, [
    detectAtMention,
    detectSlashCommand,
    closeDropdown,
    closeSlashCommandPopup,
    calculateDropdownPosition,
    requestFileSuggestions,
    requestSlashCommands,
  ]);

  const handleInput = useCallback(
    (event: React.FormEvent<HTMLDivElement>) => {
      const target = event.currentTarget;
      const newValue = target.innerText;

      // 输入删空后 contenteditable 常残留 <br>/空 div，`:empty` 不再匹配，
      // 占位文案随之消失（用户反馈：输入内容再删除后占位文案不应消失）。
      // 仅剩空标记时清空子节点让占位符恢复；img/附件等实质内容不受影响。
      if (
        newValue.trim() === "" &&
        Array.from(target.children).every(
          (el) =>
            el.tagName === "BR" ||
            (el.tagName === "DIV" && (el.textContent ?? "").trim() === ""),
        )
      ) {
        target.replaceChildren();
      }

      setMessage(newValue);

      // If we're editing a queued message and the read-only chip has been deleted
      // (e.g. via backspace), exit edit mode. The remaining body text is kept.
      if (editingQueuedId && !target.querySelector(".queued-edit-chip")) {
        onCancelQueuedEdit?.();
      }

      // Debounce sending updated content to extension for persistence. The
      // sessionId is captured at keystroke time so a save landing after the pane
      // switched sessions still routes to the conversation it was typed in.
      const draftSession = sessionId;
      if (inputContentTimerRef.current) {
        clearTimeout(inputContentTimerRef.current);
      }
      // 上报的草稿走与发送正文同一套序列化，保留引用标签（`[@file:…]` 等）；
      // 用 innerText 会只剩标签的可见文字，回填后引用就失效了。
      const draft = serializeInputDraft(target, draftScopeKey);
      // 记下这份待发草稿，卸载时补发（见 pendingDraftRef 声明处）。定时器本身仍读
      // 实时 DOM：选中历史搜索、追加评论、预填提示词这些「立即上报」的路径会直接
      // 改写同一个节点，读实时值才不会用更旧的快照把它们盖回去。
      pendingDraftRef.current = { sessionId: draftSession, content: draft };
      inputContentTimerRef.current = setTimeout(() => {
        pendingDraftRef.current = null;
        vscode.postMessage({
          command: "updateInputContent",
          sessionId: draftSession,
          content: serializeInputDraft(target, draftScopeKey),
        });
        inputContentTimerRef.current = null;
      }, 150);

      // Debounced selection change detection (for @mention and /command)
      handleSelectionChange();
    },
    [
      handleSelectionChange,
      vscode,
      editingQueuedId,
      onCancelQueuedEdit,
      sessionId,
      draftScopeKey,
    ],
  );

  // Handle IME composition events
  const handleCompositionStart = useCallback(() => {
    setIsComposing(true);
  }, []);

  const handleCompositionEnd = useCallback(() => {
    setIsComposing(false);
  }, []);

  // Image handling functions
  const createDataUrlFromBlob = useCallback((blob: Blob): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve(reader.result as string);
      };
      reader.readAsDataURL(blob);
    });
  }, []);

  const handleImagePaste = useCallback(
    async (files: FileList) => {
      const imageFiles = Array.from(files).filter((file) =>
        file.type.startsWith("image/"),
      );

      // Images the model gateway would reject (empty payload, garbage bytes or
      // a format outside png/jpeg/gif/webp) are dropped here instead of being
      // sent and bounced back as `HTTP 400 ... unsupported image`; images whose
      // width or height exceeds the 2000px outbound budget come back
      // downsampled (spec: docs/specs/ui/image-pasting.md「发送前校验图片有效性」
      // 「粘贴时在本地把图片降到 2000 像素预算」).
      const rejectedMessages = new Set<string>();

      for (const file of imageFiles) {
        try {
          const validation = await validateImageFile(file);
          if (!validation.ok) {
            rejectedMessages.add(validation.message);
            continue;
          }

          // `validation.file` is the original pasted file unless it was
          // oversized, in which case it is the re-encoded copy.
          const dataUrl = await createDataUrlFromBlob(validation.file);

          // Insert inline tag for the image
          if (!textareaRef.current) continue;

          // Count existing images in the input to determine the next index
          const existingImageTags = textareaRef.current.querySelectorAll(
            '.context-tag-container[data-is-image="true"]',
          );
          const nextIndex = existingImageTags.length + 1;
          const displayName = `图片 ${nextIndex}`;

          const selection = window.getSelection();
          if (!selection || selection.rangeCount === 0) continue;

          const range = selection.getRangeAt(0);

          const tagSpan = document.createElement("span");
          tagSpan.className = "context-tag-container";
          tagSpan.contentEditable = "false";
          tagSpan.setAttribute("data-path", `pasted-image-${Date.now()}.png`);

          tagSpan.setAttribute("data-name", displayName);
          tagSpan.setAttribute("data-is-image", "true");
          tagSpan.setAttribute("data-image-url", dataUrl);
          tagSpan.innerText = `[image]`;

          const root = ReactDOM.createRoot(tagSpan);
          root.render(
            <ContextTag
              name={displayName}
              path={`pasted-image-${Date.now()}.png`}
              isImage={true}
              onClick={() => handleImagePreview(dataUrl, displayName)}
            />,
          );

          range.deleteContents();
          range.insertNode(tagSpan);

          // Insert a space after the tag
          const space = document.createTextNode(" ");
          range.setStartAfter(tagSpan);
          range.insertNode(space);
          range.setStartAfter(space);
          range.setEndAfter(space);
          selection.removeAllRanges();
          selection.addRange(range);

          // Trigger input event to update message state
          const inputEvent = new Event("input", { bubbles: true });
          textareaRef.current.dispatchEvent(inputEvent);
        } catch (error) {
          console.error("Failed to process image:", error);
        }
      }

      if (rejectedMessages.size > 0) {
        // Reuses the existing host-side error channel (VS Code/JetBrains
        // notification, desktop system message) — no new UI surface.
        vscode.postMessage({
          command: "showError",
          message: `已跳过无效图片：${[...rejectedMessages].join("；")}`,
        });
      }
    },
    [createDataUrlFromBlob, textareaRef, handleImagePreview, vscode],
  );

  // Paste event handler
  const handlePaste = useCallback(
    (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;

      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }

      if (files.length > 0) {
        event.preventDefault();
        const fileList = new DataTransfer();
        files.forEach((file) => fileList.items.add(file));
        handleImagePaste(fileList.files);
      } else {
        // Handle text paste to avoid rich text styles
        const text = event.clipboardData?.getData("text/plain");
        if (text) {
          event.preventDefault();

          // Fallback to manual insertion as execCommand('insertText') is unreliable in some environments
          const selection = window.getSelection();
          if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.deleteContents();

            const textNode = document.createTextNode(text);
            range.insertNode(textNode);

            // Move cursor to the end of inserted text
            range.setStartAfter(textNode);
            range.setEndAfter(textNode);
            selection.removeAllRanges();
            selection.addRange(range);

            // Trigger input event manually to update React state
            const inputEvent = new Event("input", { bubbles: true });
            textareaRef.current?.dispatchEvent(inputEvent);
          }
        }
      }
    },
    [handleImagePaste],
  );

  // Add event listeners for paste only
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const pasteHandler = (e: ClipboardEvent) => handlePaste(e);

    textarea.addEventListener("paste", pasteHandler);

    return () => {
      textarea.removeEventListener("paste", pasteHandler);
    };
  }, [handlePaste]);

  // Cleanup timers on unmount. A pending draft is **flushed, not dropped**：打开
  // 设置页 / 点开会话看板 / 收起分屏都会卸载本 pane，重挂载的输入框只能靠宿主
  // 快照（setInitialState 的 inputContent）回填，落在防抖窗口里的最后一段输入
  // 不在这里补发就丢了（spec desktop-sessions.md「会话管理」场景 23）。
  useEffect(() => {
    return () => {
      const pending = pendingDraftRef.current;
      pendingDraftRef.current = null;
      if (pending) {
        vscode.postMessage({
          command: "updateInputContent",
          sessionId: pending.sessionId,
          content: pending.content,
        });
      }
      if (inputContentTimerRef.current) {
        clearTimeout(inputContentTimerRef.current);
      }
      if (selectionChangeTimerRef.current) {
        clearTimeout(selectionChangeTimerRef.current);
      }
    };
  }, [vscode]);

  // 权限模式按钮：图标档（`.is-compact`）里只剩左边的模式图标，文案靠
  // `.permission-mode-label` 藏掉（裸文本节点 CSS 藏不掉，所以文案单独成 span）。
  const permTriggerButton = (
    <button
      type="button"
      ref={permMenuButtonRef}
      className={`permission-mode-select mode-${permissionMode || "default"}`}
      aria-label="权限模式"
      aria-haspopup="listbox"
      aria-expanded={permMenuOpen}
      disabled={disabled}
      onClick={() => {
        if (permMenu.open) {
          permMenu.closeMenu();
        } else {
          openPermissionModeMenu();
        }
      }}
    >
      {permissionModeIcon(permissionMode)}
      <span className="permission-mode-label">
        {permissionModeLabel(permissionMode)}
      </span>
      <PermCaretIcon className="permission-mode-caret" />
    </button>
  );

  return (
    <div className="input-container" data-testid="input-container">
      <div className="input-wrapper">
        {/* Single bordered box wrapping the text area and toolbar (设计稿 2237-5088).
            Focus turns the whole box's border red via :focus-within. */}
        <div className="input-content">
          {/* ContentEditable - full width */}
          <div
            ref={textareaRef}
            id="messageInput"
            className="message-input content-editable-input"
            contentEditable={!disabled}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onSelect={handleSelectionChange}
            onClick={handleSelectionChange}
            onBlur={handleInputBlur}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            data-testid="message-input"
            data-placeholder={
              placeholder ?? "/快捷指令，@添加上下文，粘贴图片，Enter发送..."
            }
          />

          {/* Buttons row */}
          <div className="input-buttons-row" ref={buttonsRowRef}>
            {/* Context actions ("+" add menu + "/" slash command), 4px gap per design */}
            <div className="context-actions">
              {/* "+" add menu (custom dropdown, expands upward) */}
              <div className="plus-menu-container" ref={plusMenuRef}>
                {/* 悬停提示（设计师 1026 评论：`button.toolbar-icon-button`
                    「缺少hover提示的地方都补上」）：底栏这两颗纯图标按钮原先
                    只有 aria-label，看不到可见提示。用既有 Tooltip（气泡向上，
                    桌面端 4px 间距），包裹层是 inline-flex 且 flex-shrink 0，
                    按钮盒与 4px 组内间距逐值不变。 */}
                <Tooltip text="添加" position="top">
                  <button
                    type="button"
                    ref={plusMenuButtonRef}
                    className="toolbar-icon-button"
                    aria-label="添加"
                    aria-haspopup="menu"
                    aria-expanded={plusMenu.open}
                    disabled={disabled}
                    onClick={() => {
                      if (plusMenu.open) {
                        plusMenu.closeMenu();
                      } else {
                        // Focus moves to the first item so Enter/Space
                        // activate and Escape returns to this button.
                        plusMenu.openMenu();
                      }
                    }}
                  >
                    <PlusIcon className="toolbar-icon" />
                  </button>
                </Tooltip>
                {plusMenu.open && (
                  <ul className="plus-menu" role="menu">
                    {plusMenuItems.map((item, i) => (
                      <li
                        key={item.label}
                        role="menuitem"
                        className="plus-menu-item"
                        {...plusMenu.getItemProps(i)}
                      >
                        {item.label}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* "/" slash command button */}
              <Tooltip text="快捷指令" position="top">
                <button
                  type="button"
                  className="toolbar-icon-button"
                  aria-label="快捷指令"
                  disabled={disabled}
                  onClick={handleSlashButtonClick}
                >
                  <SlashBoxIcon className="toolbar-icon" />
                </button>
              </Tooltip>
            </div>

            {/* 模型选择器：底栏左侧，紧跟 + / / 之后（spec ui/model-selection.md
                「输入卡片底栏切换模型」）。候选清单由宿主下发，空清单时不渲染。 */}
            {models && models.length > 0 && onSelectModel && (
              <ModelPicker
                models={models}
                currentModel={currentModel}
                disabled={disabled}
                compact={compactRow}
                onSelect={onSelectModel}
              />
            )}

            {/* Left side - Permission Mode Select (custom dropdown, expands upward) */}
            <div className="button-spacer" />

            {/* Context-usage indicator. Hidden on the welcome composer in
                  either flavor: desktop signals that via workdirSelector being
                  present, IDE hosts via ChatApp withholding showContextUsage
                  when no visible messages yet (spec 场景 3).

                  No usage to show ⇒ render nothing at all (no ring, no number,
                  no placeholder in the toolbar): 0% is meaningless to display
                  and undefined means the host has not pushed usage yet
                  (designer 0916, 先「为 0 时整个都不显示」再「未知时也整块
                  隐藏」——后者偏离 spec 场景 4 的「空圆环」，规格待回写).
                  Hence the ring always carries a known, non-zero percentage.

                  ⚠️ MERGE-TIME REVIEW（合并前请开发确认，2026-09-16 设计师裁决）:
                  the 「宿主尚未推送用量 → 显示空圆环」requirement in
                  docs/specs/desktop/desktop-settings.md 场景 4
                  (line ~77) is intentionally NOT implemented — the indicator is
                  now unmounted in that state, same as 0%. Either update/remove
                  that 场景 or ask us to restore the empty ring. Note 场景 4's
                  other half still holds: no empty tooltip bubble (the Tooltip
                  is no longer rendered at all when usage is unknown).

                  Hovering pops the context-usage tooltip naming the number
                  (spec 场景 1). The indicator is display-only — compression
                  stays on /compact and auto compaction. */}
            {!workdirSelector && showContextUsage && !!contextUsagePct && (
              <Tooltip text={contextUsageLabel} position="top">
                <span
                  className="compress-context-button"
                  aria-label={contextUsageLabel}
                >
                  <svg
                    className="compress-context-ring"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    {/* Track = full ring（设计师 0916：「100% 时应该是进度沾满，
                        而不是半圈轨道」——原先是左半环 path，进度一旦超过 50%
                        就长到没有轨道的位置（64% 时弧长 32.17 > 轨道 25.14））。 */}
                    <circle
                      className="compress-context-ring-track"
                      cx="12"
                      cy="12"
                      r="8"
                    />
                    <circle
                      className="compress-context-ring-fill"
                      cx="12"
                      cy="12"
                      r="8"
                      strokeDasharray={`${
                        (ringCircumference * contextUsagePct) / 100
                      } ${ringCircumference}`}
                      // Mirror the circle so its stroke sweeps
                      // counter-clockwise from 3 o'clock like the designer's.
                      transform="scale(-1, 1) translate(-24, 0)"
                    />
                  </svg>
                  <span className="compress-context-pct">
                    {contextUsagePct}%
                  </span>
                </span>
              </Tooltip>
            )}

            <div className="permission-mode-container" ref={permMenuRef}>
              {/* 图标档只剩盾牌，含义不直观 → 挂可见气泡；文字档不包（保持零位移） */}
              {compactRow ? (
                <Tooltip
                  text={`权限：${permissionModeLabel(permissionMode)}`}
                  position="top"
                >
                  {permTriggerButton}
                </Tooltip>
              ) : (
                permTriggerButton
              )}
              {permMenuOpen && (
                <ul className="permission-mode-menu" role="listbox">
                  {PERMISSION_MODES.map((m, i) => (
                    <li
                      key={m.value}
                      role="option"
                      data-value={m.value}
                      aria-selected={m.value === (permissionMode || "default")}
                      className={`permission-mode-item mode-${m.value}${m.value === (permissionMode || "default") ? " selected" : ""}`}
                      {...permMenu.getItemProps(i)}
                    >
                      {permissionModeIcon(m.value)}
                      {m.label}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {isStreaming ? (
              <Tooltip text="停止" position="top">
                <button
                  className="abort-button ai-abort-btn"
                  id="abortButton"
                  onClick={onAbortMessage}
                  data-testid="abort-btn"
                  aria-label="停止"
                >
                  <span className="abort-glyph" />
                </button>
              </Tooltip>
            ) : (
              <Tooltip text="发送" position="top">
                <button
                  id="sendButton"
                  className="send-button ai-send-btn"
                  onClick={handleSend}
                  disabled={
                    disabled || (!message.trim() && attachedImages.length === 0)
                  }
                  data-testid="send-btn"
                  aria-label="发送"
                >
                  <SendArrowIcon className="ai-send-icon" />
                </button>
              </Tooltip>
            )}
          </div>
        </div>

        {/* Desktop host, new-session state: context bar BELOW the toolbar
              (prototype welcome composer). Figma 13439-9245: an independent
              strip OUTSIDE the card (overlaps card bottom by 18px, no radius,
              own shadow), not a card footer. Its dropdown still expands
              upward. */}
        {workdirSelector && (
          <div className="input-workdir-row" data-testid="input-workdir-row">
            {workdirSelector}
          </div>
        )}

        {/* File Suggestion Dropdown */}
        <FileSuggestionDropdown
          suggestions={allSuggestions}
          isVisible={
            !!(
              atMention.isActive &&
              (allSuggestions.length > 0 || isLoadingSuggestions)
            )
          }
          selectedIndex={selectedIndex}
          onSelect={handleFileSelect}
          onClose={closeDropdown}
          position={dropdownPosition}
          filterText={atMention.filterText}
          isLoading={isLoadingSuggestions}
        />

        {/* 指令弹窗 */}
        <SlashCommandsPopup
          commands={slashCommands}
          isVisible={slashCommand.isActive && slashCommands.length > 0}
          selectedIndex={selectedSlashIndex}
          onSelect={handleSlashCommandSelect}
          onClose={closeSlashCommandPopup}
          position={slashPopupPosition}
        />

        {/* 历史记录搜索弹窗 */}
        <HistorySearchPopup
          isVisible={isHistorySearchVisible}
          onSelect={handleHistorySelect}
          onClose={closeHistorySearch}
          position={historyPopupPosition}
          vscode={vscode}
        />

        {/* /rewind 检查点弹窗，与历史记录弹窗共用 .input-wrapper 定位上下文 */}
        {rewindPopup}

        {/* /btw 旁路提问面板，锚定 .input-wrapper 顶部 */}
        {btwPopup}
      </div>
    </div>
  );
});
MessageInput.displayName = "MessageInput";
