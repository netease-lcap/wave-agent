/**
 * ContextDialog — `/context` 浮层：当前上下文窗口的构成（spec
 * `commands/context-command.md`）。
 *
 * 形态对齐 Claude Code 图形界面的 `ChatContextRingPopoverBody`：**锚在输入框旁
 * 那个百分比用量环上的非模态浮层**（点环或运行 `/context` 都能打开，不遮对话、
 * 不挡输入框），内容是分段占用条 + 分类行（色块 + 名称 + tokens + 百分比）+ 可
 * 折叠明细。**分类判据一律用 `category.id` / `category.kind`，绝不用 `name`**
 * ——显示名会变，SDK 的类型注释里对这条写了出处。
 *
 * 定位复用 `useAnchoredMenuStyle`（下 → 翻上 → 收到可用高度内部滚动），与侧边栏
 * 会话菜单同一套；关闭走点外部 + Esc（点环本身不算外部，见 `anchorRef`）。
 *
 * 数据来自宿主的 `getContextBreakdown`（宿主转发自己 agent 的结果）。浮层不轮询：
 * 打开时取一次，本轮结束后（宿主回报空闲）再取一次，其余靠用户重开。
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
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

/** 浮层宽度；比它窄的视口由 CSS `max-width` 收到 `100vw - 16px`（手机远控页）。 */
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

function formatTokens(tokens: number): string {
  return tokens.toLocaleString("en-US");
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
      name: `Other (${rest.length} items)`,
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
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const request = useCallback(() => {
    // 刷新时保留上一份数字，避免面板闪成空白（只有首帧没有数据才显示加载态）。
    setError(null);
    const requestId = String(++nextRequestId);
    requestIdRef.current = requestId;
    vscode?.postMessage({ command: "getContextBreakdown", requestId });
  }, [vscode]);

  useEffect(() => {
    setLoading(true);
    request();
  }, [request]);

  useHostMessage((message) => {
    if (message.command !== "contextBreakdownResponse") return;
    // 晚到的旧回复即弃：面板可反复开关，每次打开都重新取数。
    if (message.requestId !== requestIdRef.current) return;
    setLoading(false);
    if (message.error || !message.breakdown) {
      setError(message.error || "Failed to read context usage.");
      return;
    }
    setBreakdown(message.breakdown);
    setLoadedAt(new Date());
  });

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

  // 定位：锚点矩形缺失（环没渲染 / 首帧还没量到布局）时用右下角兜底。
  // 左对齐输入框左缘（`align: "left"`），与 `.rewind-popup` / `.btw-panel` /
  // `.model-picker-menu` 这几个输入框上方的浮层同一族 —— 右对齐会悬在中间。
  const popoverStyle = useAnchoredMenuStyle(
    dialogRef,
    anchorRect ?? fallbackAnchorRect(),
    POPOVER_WIDTH,
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
    if (loading && !breakdown) {
      return (
        <div className="context-placeholder">Loading context breakdown…</div>
      );
    }
    if (error) {
      return (
        <div className="context-placeholder context-error" role="alert">
          {error}
          <button type="button" className="context-retry" onClick={request}>
            重试
          </button>
        </div>
      );
    }
    if (!breakdown) {
      return (
        <div className="context-placeholder">Loading context breakdown…</div>
      );
    }

    // 「Send a message to see context usage.」：会话还没有任何对话消息时，
    // 分段条只会画成整条 free，不如直接说清楚。
    const hasConversation = breakdown.categories.some(
      (category) => category.id === "messages",
    );
    if (!hasConversation && !breakdown.measured) {
      return (
        <div className="context-placeholder">
          Send a message to see context usage.
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

        <div className="context-meter" role="img" aria-label="Context usage">
          {breakdown.categories.map((category) => (
            <div
              key={category.id}
              className={`context-meter-segment context-segment-${category.kind}`}
              style={{
                flexGrow: Math.max(category.tokens, 0),
                backgroundColor: CATEGORY_COLORS[category.id] ?? "#555",
              }}
              title={`${category.name}: ${formatTokens(category.tokens)} tokens`}
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
              <span className="context-legend-name">{category.name}</span>
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
            Auto-compact at {formatTokens(breakdown.autoCompactThreshold)}{" "}
            tokens
          </div>
        )}

        <div className="context-groups">
          {renderGroup("mcp", "MCP tools", breakdown.mcpTools)}
          {renderGroup("system", "System tools", breakdown.systemTools)}
          {renderGroup(
            "memory",
            "Memory files",
            breakdown.memoryFiles.map((file) => ({
              name: `${file.type} · ${file.path}`,
              tokens: file.tokens,
            })),
          )}
          {renderGroup("skills", "Skills", breakdown.skills)}
          {renderGroup("agents", "Custom agents", breakdown.agents)}
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
          Last updated {loadedAt ? formatClock(loadedAt) : "—"}.
          {busy
            ? " Refreshes when this turn ends."
            : " Send a message to refresh."}
        </div>
      </>
    );
  };

  return (
    <div
      ref={dialogRef}
      className="context-popover"
      role="dialog"
      aria-label="Context window"
      data-testid="context-dialog"
      style={popoverStyle}
    >
      <div className="context-popover-header">
        <span className="context-popover-title">Context window</span>
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
