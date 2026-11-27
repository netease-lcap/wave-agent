/**
 * ContextDialog — `/context` 浮层：当前上下文窗口的构成（spec
 * `commands/context-command.md`）。
 *
 * 形态对齐 Claude Code 图形界面的 `ChatContextRingPopoverBody`：**锚在输入框旁
 * 那个百分比用量环上的非模态浮层**（点环或运行 `/context` 都能打开，不遮对话、
 * 不挡输入框），内容是分段占用条 + 分类行（色块 + 名称 + tokens + 百分比）+ 可
 * 折叠明细。**分类判据一律用 `category.id` / `category.kind`，绝不用 `name`**
 * ——显示名会变，SDK 的类型注释里对这条写了出处。显示名也在这层映射成中文
 * （`CATEGORY_LABELS`）：SDK 送的 `name` 与 CLI 的报告共用，不能就地翻译。
 *
 * 定位复用 `useAnchoredMenuStyle`（下 → 翻上 → 收到可用高度内部滚动），与侧边栏
 * 会话菜单同一套；关闭走点外部 + Esc（点环本身不算外部，见 `anchorRef`）。
 *
 * 数据来自宿主的 `getContextBreakdown`（宿主转发自己 agent 的结果）。浮层不轮询：
 * 打开时取一次，本轮结束后（宿主回报空闲）再取一次，其余靠用户重开。
 */

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { RefObject } from "react";
import type { ContextBreakdown, ContextCategory } from "wave-agent-sdk/types";
import { useAnchoredMenuStyle } from "../utils/anchoredMenu";
import type { MenuAnchorRect } from "../utils/anchoredMenu";
import { viewportSize } from "../utils/viewport";
import { useClickOutside } from "../utils/useClickOutside";
import { useHostMessage } from "../utils/useHostMessage";
import { ConversationCloseIcon } from "./HeaderIcons";
import type { ContextDialogProps } from "../types";
import "../styles/ContextDialog.css";

/** 明细分组最多显示的行数；超过就前 5 行 + 一行 `Other`（对齐 CC 的 `C = 6`）。 */
const DETAIL_LIMIT = 6;

/**
 * 浮层宽度的**上限**。对话区（输入卡）比它窄时跟着收窄 —— 窄窗口、右侧面板
 * 展开都会让对话区变窄；不收的话 460 会被视口留白夹取推到侧边栏上，浮层就跨出
 * 对话区了。视口本身更窄时再由 CSS `max-width` 收到 `100vw - 16px`（手机远控页）。
 */
const POPOVER_WIDTH = 460;

/**
 * 环还没渲染时的兜底锚点（spec 场景 2：新会话首轮之前宿主还没推送用量，
 * `/context` 仍要打开）。贴视口左下角 —— 也就是输入区左边 —— 让浮层照旧在
 * 底部往上展开、靠左对齐，而不是落在坐标 (0,0) 的左上角。
 */
function fallbackAnchorRect(): MenuAnchorRect {
  const { width, height } = viewportSize();
  return {
    top: height - 72,
    bottom: height - 48,
    left: 16,
    right: width - 16,
  };
}

/**
 * 请求序号**跨面板实例**递增：面板关掉再打开会换一个新的组件实例，如果序号跟着
 * 实例从 1 重新数，上一实例的晚到回复就会与这一实例的第一笔请求撞号而被当成
 * 有效结果收下（把上一次的构成贴到刚打开的面板上）。
 */
let nextRequestId = 0;

/** 分类色块：按 `kind` 分档，`used` 再按 `id` 分色。 */
const CATEGORY_COLORS: Record<string, string> = {
  systemPrompt: "#8b7bd8",
  systemTools: "#5a9bd5",
  mcpTools: "#4bb3a5",
  memory: "#d8a657",
  skills: "#b5838d",
  agents: "#7a9e7e",
  messages: "#e07a5f",
  buffer: "#6b6b6b",
  free: "#2f2f2f",
};

/**
 * 分类显示名。SDK 下发的 `name` 是英文，且被 CLI 的 /context 报告共用
 * （`formatContextBreakdown` 的输出和它的测试钉着原文），所以中文化只在这一层
 * 按 `id` 映射 —— 与文件头「判据一律用 `id`，绝不用 `name`」同一条规矩。
 * 遇到未知 id 就退回 SDK 的名字，不会显示空白。
 */
const CATEGORY_LABELS: Record<string, string> = {
  systemPrompt: "系统提示词",
  systemTools: "系统工具",
  mcpTools: "MCP 工具",
  memory: "记忆文件",
  skills: "技能",
  agents: "自定义代理",
  messages: "对话消息",
  buffer: "自动压缩预留",
  free: "剩余空间",
};

/** 记忆来源（SDK 给的是 `project` / `user` / `local` / `rules`）。 */
const MEMORY_TYPE_LABELS: Record<string, string> = {
  project: "项目",
  user: "用户",
  local: "个人",
  rules: "规则",
};

function categoryLabel(category: ContextCategory): string {
  return CATEGORY_LABELS[category.id] ?? category.name;
}

function formatTokens(tokens: number): string {
  return tokens.toLocaleString("en-US");
}

/** 某个 tokens 值占窗口的比例，如 `83.5%`（阈值那一行用）。 */
function windowShareLabel(tokens: number, window: number): string {
  return `${Number(((tokens / window) * 100).toFixed(1))}%`;
}

function percentLabel(category: ContextCategory, window: number): string {
  // free / buffer 不占对话可用量，百分比列给 `—`（spec 场景 2）。
  if (category.kind !== "used") return "—";
  if (window <= 0) return "—";
  const percent = (category.tokens / window) * 100;
  if (percent > 0 && percent < 0.1) return "<0.1%";
  return `${percent.toFixed(1)}%`;
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 一个明细分组的行：超过 `DETAIL_LIMIT` 时截断并把余量并成 `Other`。 */
function detailRows(
  items: Array<{ name: string; tokens: number }>,
): Array<{ name: string; tokens: number }> {
  if (items.length <= DETAIL_LIMIT) return items;
  const head = items.slice(0, DETAIL_LIMIT - 1);
  const rest = items.slice(DETAIL_LIMIT - 1);
  return [
    ...head,
    {
      name: `其他（${rest.length} 项）`,
      tokens: rest.reduce((sum, item) => sum + item.tokens, 0),
    },
  ];
}

const ContextDialog: React.FC<
  ContextDialogProps & {
    vscode: { postMessage: (msg: unknown) => void };
    /** 锚点矩形：用量环（或底栏）在视口里的位置，由 ChatApp 从 MessageInput 取。 */
    anchorRect?: MenuAnchorRect | null;
    /** 锚点元素本身：mousedown 落在它上面不算「点外部」——否则点环会先被关掉、
     *  再被 click 打开，闪一下还要重取一次数。 */
    anchorRef?: RefObject<HTMLElement | null>;
  }
> = ({ onClose, busy, vscode, anchorRect, anchorRef }) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef("");
  const [breakdown, setBreakdown] = useState<ContextBreakdown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const request = useCallback(() => {
    // 刷新时保留上一份数字，避免面板闪成空白（只有首帧没有数据才显示加载态）。
    // 这里不清 error：error 只在回包里写、在成功回包里清（错误提示留到新结果到达
    // 那一刻才消失）。点「重试」是用户按下的那一刻就要回到取数态，那个清在
    // `retry`（事件处理器）里做。
    const requestId = String(++nextRequestId);
    requestIdRef.current = requestId;
    vscode?.postMessage({ command: "getContextBreakdown", requestId });
  }, [vscode]);

  useEffect(() => {
    request();
  }, [request]);

  useHostMessage((message) => {
    if (message.command !== "contextBreakdownResponse") return;
    // 晚到的旧回复即弃：面板可反复开关，每次打开都重新取数。
    if (message.requestId !== requestIdRef.current) return;
    if (message.error || !message.breakdown) {
      setError(message.error || "Failed to read context usage.");
      return;
    }
    setError(null);
    setBreakdown(message.breakdown);
    setLoadedAt(new Date());
  });

  // 「重试」是事件处理器（不在 effect 里）：按下那一刻清掉错误提示，与改动前
  // 一致地回到取数态，不必等新回包。
  const retry = useCallback(() => {
    setError(null);
    request();
  }, [request]);

  // 本轮结束后取一次新数字：面板打开时若正在跑，报告必然落后于这一轮。
  const wasBusyRef = useRef(busy);
  useEffect(() => {
    if (wasBusyRef.current && !busy) {
      request();
    }
    wasBusyRef.current = busy;
  }, [busy, request]);

  useClickOutside({
    // 点环本身豁免：环是 toggle 触发按钮，否则「再点一次环」会变成
    // 先关（mousedown）后开（click），闪一下并重取一次数。
    refs: anchorRef ? [dialogRef, anchorRef] : [dialogRef],
    onClickOutside: onClose,
  });

  useEffect(() => {
    // Esc 只关面板（capture + stopPropagation，别让 MessageInput 当成中断）。
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handleEscapeKey, true);
    return () => document.removeEventListener("keydown", handleEscapeKey, true);
  }, [onClose]);

  const toggleGroup = (id: string) =>
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }));

  /**
   * 对话区宽度：输入卡（composer）的横向跨度。锚点矩形本来就是从它身上取的
   * （`getContextAnchorRect`：left/right = composer 的左右缘），所以打开那一帧
   * 先用它，随后由 `ResizeObserver` 盯住输入卡 —— 右侧面板开合、窗口缩放不会
   * 重新打开浮层，宽度得自己跟着变。
   */
  const [dialogAreaWidth, setDialogAreaWidth] = useState<number | null>(() => {
    const span = anchorRect ? anchorRect.right - anchorRect.left : 0;
    return span > 0 ? span : null;
  });
  useLayoutEffect(() => {
    const composer = anchorRef?.current?.closest(".input-wrapper");
    const sync = () => {
      const width = composer?.getBoundingClientRect().width ?? 0;
      // 量到 0（隐藏 / 无布局环境）就保留上一个值，别把浮层缩成一条线。
      if (width > 0) setDialogAreaWidth(width);
    };
    // layout effect 在绘制前跑完，避免「先按 460 画一帧再收窄」的闪动。
    sync();
    if (!composer || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(sync);
    observer.observe(composer);
    return () => observer.disconnect();
  }, [anchorRef]);

  // 460 是上限；对话区更窄时取对话区宽度，左缘仍对齐它的左缘。
  const popoverWidth = Math.max(
    1,
    Math.min(POPOVER_WIDTH, dialogAreaWidth ?? POPOVER_WIDTH),
  );

  // 定位：锚点矩形缺失（环没渲染 / 首帧还没量到布局）时用右下角兜底。
  // 左对齐输入框左缘（`align: "left"`），与 `.rewind-popup` / `.btw-panel` /
  // `.model-picker-menu` 这几个输入框上方的浮层同一族 —— 右对齐会悬在中间。
  const { style: popoverStyle, attachRef: popoverAttachRef } =
    useAnchoredMenuStyle(
      dialogRef,
      anchorRect ?? fallbackAnchorRect(),
      popoverWidth,
      "left",
    );

  const renderGroup = (
    id: string,
    label: string,
    items: Array<{ name: string; tokens: number }>,
  ) => {
    if (items.length === 0) return null;
    const total = items.reduce((sum, item) => sum + item.tokens, 0);
    const open = !!openGroups[id];
    return (
      <div className="context-detail-group" data-testid={`context-group-${id}`}>
        <button
          type="button"
          className="context-detail-header"
          onClick={() => toggleGroup(id)}
          aria-expanded={open}
        >
          <span className="context-detail-caret">{open ? "▾" : "▸"}</span>
          <span className="context-detail-name">{label}</span>
          <span className="context-detail-meta">
            {items.length} · {formatTokens(total)} tokens
          </span>
        </button>
        {open && (
          <div className="context-detail-rows">
            {detailRows(items).map((item) => (
              <div className="context-detail-row" key={item.name}>
                <span className="context-detail-row-name">{item.name}</span>
                <span className="context-detail-row-tokens">
                  {formatTokens(item.tokens)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderBody = () => {
    if (error) {
      return (
        <div className="context-placeholder context-error" role="alert">
          {error}
          <button type="button" className="context-retry" onClick={retry}>
            重试
          </button>
        </div>
      );
    }
    if (!breakdown) {
      return <div className="context-placeholder">正在读取上下文构成…</div>;
    }

    // 「发一条消息后即可看到上下文占用」：会话还没有任何对话消息时，
    // 分段条只会画成整条 free，不如直接说清楚。
    const hasConversation = breakdown.categories.some(
      (category) => category.id === "messages",
    );
    if (!hasConversation && !breakdown.measured) {
      return (
        <div className="context-placeholder">
          发一条消息后即可看到上下文占用。
        </div>
      );
    }

    const window = breakdown.contextWindow;
    return (
      <>
        <div className="context-summary">
          <span className="context-model">{breakdown.model}</span>
          <span className="context-totals">
            {formatTokens(breakdown.usedTokens)} / {formatTokens(window)} tokens
            {window > 0 ? ` (${breakdown.usedPercent}%)` : ""}
          </span>
        </div>

        <div className="context-meter" role="img" aria-label="上下文占用">
          {breakdown.categories.map((category) => (
            <div
              key={category.id}
              className={`context-meter-segment context-segment-${category.kind}`}
              style={{
                flexGrow: Math.max(category.tokens, 0),
                backgroundColor: CATEGORY_COLORS[category.id] ?? "#555",
              }}
              title={`${categoryLabel(category)}: ${formatTokens(category.tokens)} tokens`}
            />
          ))}
        </div>

        <div className="context-legend">
          {breakdown.categories.map((category) => (
            <div
              className="context-legend-row"
              key={category.id}
              data-testid={`context-category-${category.id}`}
            >
              <span
                className="context-legend-swatch"
                style={{
                  backgroundColor: CATEGORY_COLORS[category.id] ?? "#555",
                }}
              />
              <span className="context-legend-name">
                {categoryLabel(category)}
              </span>
              <span className="context-legend-tokens">
                {formatTokens(category.tokens)}
              </span>
              <span className="context-legend-percent">
                {percentLabel(category, window)}
              </span>
            </div>
          ))}
        </div>

        {breakdown.autoCompactThreshold > 0 && (
          <div className="context-threshold">
            自动压缩于 {formatTokens(breakdown.autoCompactThreshold)} tokens
            {breakdown.contextWindow > 0
              ? `（占窗口 ${windowShareLabel(
                  breakdown.autoCompactThreshold,
                  breakdown.contextWindow,
                )}）`
              : ""}
          </div>
        )}

        <div className="context-groups">
          {renderGroup("mcp", "MCP 工具", breakdown.mcpTools)}
          {renderGroup("system", "系统工具", breakdown.systemTools)}
          {renderGroup(
            "memory",
            "记忆文件",
            breakdown.memoryFiles.map((file) => ({
              name: `${MEMORY_TYPE_LABELS[file.type] ?? file.type} · ${file.path}`,
              tokens: file.tokens,
            })),
          )}
          {renderGroup("skills", "技能", breakdown.skills)}
          {renderGroup("agents", "自定义代理", breakdown.agents)}
        </div>

        {breakdown.errors.length > 0 && (
          <div className="context-errors">
            {breakdown.errors.map((message) => (
              <div key={message} className="context-error-line">
                {message}
              </div>
            ))}
          </div>
        )}

        <div className="context-footer">
          最后更新 {loadedAt ? formatClock(loadedAt) : "—"}。
          {busy ? "本轮结束后自动刷新。" : "发一条消息即可刷新。"}
        </div>
      </>
    );
  };

  return (
    <div
      ref={popoverAttachRef}
      className="context-popover"
      role="dialog"
      aria-label="上下文窗口"
      data-testid="context-dialog"
      style={popoverStyle}
    >
      <div className="context-popover-header">
        <span className="context-popover-title">上下文窗口</span>
        <button
          type="button"
          className="context-popover-close"
          onClick={onClose}
          aria-label="关闭"
        >
          {/* 与弹窗右上角 / pane 头部 / toast 同一官方矢量（0916 关闭族）。
              原先这里是文本「×」字符：字形 8.19×16、盒 16.19×18、无圆角无 hover 面，
              与族内 20×20 + r8 + fill-hover 的按钮不是一套。 */}
          <ConversationCloseIcon className="context-popover-close-icon" />
        </button>
      </div>

      <div className="context-body">{renderBody()}</div>
    </div>
  );
};

export default ContextDialog;
