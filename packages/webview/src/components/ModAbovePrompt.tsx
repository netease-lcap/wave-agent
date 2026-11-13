import React, { useLayoutEffect, useRef, useState } from "react";
import type { ModPanelTree } from "wave-agent-sdk/types";
import { ModPanelRenderer } from "./ModPanelRenderer";
import { CloseIcon, InfoIcon } from "./HeaderIcons";
import "../styles/ModAbovePrompt.css";

/**
 * 输入框周围那三样**不属于任何 pane** 的 mod 输出（spec
 * `ecosystem/plugin-mods.md`「状态带、状态行与提示」）。
 *
 * 三条纪律：
 *
 * - 带是**树**，走与面板同一条拉取链路（`AbovePrompt` 站点），所以这里复用
 *   `ModPanelRenderer`；状态行与提示是**纯文本**，只推不拉、不进对话上下文。
 * - 三者都不进消息列表、不落盘：它们描述的是「此刻的界面」，不是对话的一部分。
 * - 数据全部由宿主给（mod 跑在 CLI 进程里），这里不持有任何 mod 状态 —— 交互
 *   只回 `{ kind, key, value }`，由 ChatApp 转成 `modPanelEvent`。
 *
 * 形态口径对齐 CC 桌面端：带在卡上方、上限 `11lh + 40px`；状态行在卡下方一行、
 * 右对齐、单行省略、放不下的收成 `+N`；提示是右下角固定浮层。
 */

/** 一条带（一个 mod 一条）。 */
export interface ModBandFrame {
  modId: string;
  plugin: string;
  revision: number;
  tree: ModPanelTree | null;
  error?: string;
}

/** 输入框下方那行里的一段。 */
export interface ModStatusFrame {
  modId: string;
  plugin: string;
  text: string;
}

/** 右下角浮层里的一条。`id` 是本地排队用的序号。 */
export interface ModToastFrame {
  id: number;
  plugin: string;
  text: string;
}

/** 状态行之间的间距，与 `.mod-status` 的 `gap` 保持同一个数。 */
const STATUS_GAP = 8;
/** 给 `+N` 这一格预留的宽度（两三个字符 + 两侧间距），避免测量与渲染互相追。 */
const STATUS_REST_RESERVE = 40;
/** 提示正文的字符上限：CC 的 toast 在 240 字符后补省略号（`du`）。 */
const TOAST_TEXT_MAX = 240;

const clipToastText = (text: string): string =>
  text.length <= TOAST_TEXT_MAX
    ? text
    : `${text.slice(0, TOAST_TEXT_MAX - 1)}…`;

export interface ModBandListProps {
  bands: ModBandFrame[];
  onEvent: (
    modId: string,
    kind: "press" | "input",
    key: string,
    value?: string,
  ) => void;
  onOpenLink: (href: string) => void;
}

/** 输入框**上方**的带：一个 mod 一条，按 host 给的顺序纵向排列。 */
export function ModBandList({
  bands,
  onEvent,
  onOpenLink,
}: ModBandListProps): React.ReactElement | null {
  // 空树 / 没有内容的 mod 不占位置：不画空 div，也不留间距。
  const visible = bands.filter((band) => band.tree || band.error);
  if (visible.length === 0) return null;
  return (
    <div className="mod-band" data-testid="mod-band">
      {visible.map((band) => (
        <div
          className="mod-band-item"
          key={band.modId}
          data-mod-id={band.modId}
          data-plugin={band.plugin}
        >
          <ModPanelRenderer
            tree={band.tree}
            error={band.error}
            onEvent={(kind, key, value) =>
              onEvent(band.modId, kind, key, value)
            }
            onOpenLink={onOpenLink}
          />
        </div>
      ))}
    </div>
  );
}

/** 输入框**下方**那一行常驻状态，每个插件一段 `plugin: text`。 */
export function ModStatusLines({
  lines,
}: {
  lines: ModStatusFrame[];
}): React.ReactElement | null {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLSpanElement | null>(null);
  // null = 还没量出宽度（首帧 / jsdom 没有布局）→ 全部显示。宁可不收，也不能在
  // 没有依据的情况下把行藏掉。
  const [shown, setShown] = useState<number | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;
    const compute = () => {
      const available = container.clientWidth;
      const widths = Array.from(measure.children).map(
        (child) => (child as HTMLElement).offsetWidth,
      );
      if (available <= 0 || widths.length === 0 || widths.some((w) => w <= 0)) {
        setShown(null);
        return;
      }
      let used = 0;
      let fit = 0;
      for (let i = 0; i < widths.length; i += 1) {
        const withGap = used === 0 ? widths[i] : used + STATUS_GAP + widths[i];
        // 后面还有放不下的段：得给 `+N` 留一格。
        const hasMore = i < widths.length - 1;
        const limit =
          available - (hasMore ? STATUS_GAP + STATUS_REST_RESERVE : 0);
        if (withGap > limit) break;
        used = withGap;
        fit = i + 1;
      }
      setShown(Math.min(widths.length, Math.max(1, fit)));
    };
    compute();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(compute);
    observer.observe(container);
    return () => observer.disconnect();
  }, [lines]);

  if (lines.length === 0) return null;

  const visibleCount =
    shown === null ? lines.length : Math.min(shown, lines.length);
  const hidden = lines.length - visibleCount;

  return (
    <div
      className="mod-status"
      data-testid="mod-status"
      // 有段被收起来才给每段 32ch 的天花板（CC 的 `isCapped` 口径）。
      {...(hidden > 0 ? { "data-capped": "" } : {})}
      ref={containerRef}
    >
      {lines.slice(0, visibleCount).map((line) => (
        <div
          className="mod-status-line"
          key={line.modId}
          data-mod-id={line.modId}
          data-plugin={line.plugin}
        >
          {/* 谁贴的要看得出：`plugin: text`（CC 的 `Hl` 就是这个拼法）。
              纯文本，不渲染 markdown —— mod 写不了 HTML，这里也不给它这个口子。 */}
          <span className="mod-status-plugin">{line.plugin}:</span>
          <span className="mod-status-text">{line.text}</span>
        </div>
      ))}
      {hidden > 0 && (
        <span
          className="mod-status-rest"
          data-testid="mod-status-rest"
          title={lines
            .slice(visibleCount)
            .map((line) => `${line.plugin}: ${line.text}`)
            .join("\n")}
        >
          +{hidden}
        </span>
      )}
      {/* 量自然宽度：保留全部行，绝对定位不参与布局。 */}
      <span className="mod-status-measure" ref={measureRef} aria-hidden="true">
        {lines.map((line) => (
          <span className="mod-status-line" key={line.modId}>
            <span className="mod-status-plugin">{line.plugin}:</span>
            <span className="mod-status-text">{line.text}</span>
          </span>
        ))}
      </span>
    </div>
  );
}

/** 右下角浮层里的短暂提示；到点由 ChatApp 从队列里摘掉，也可以手动关。 */
export function ModToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ModToastFrame[];
  onDismiss?: (id: number) => void;
}): React.ReactElement | null {
  if (toasts.length === 0) return null;
  return (
    <div
      className="mod-toasts"
      data-testid="mod-toast"
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div className="mod-toast" key={toast.id} data-plugin={toast.plugin}>
          <InfoIcon className="mod-toast-icon" />
          <div className="mod-toast-body">
            <div className="mod-toast-title">{toast.plugin}</div>
            <div className="mod-toast-text">{clipToastText(toast.text)}</div>
          </div>
          {onDismiss && (
            <button
              type="button"
              className="mod-toast-close"
              aria-label="关闭提示"
              onClick={() => onDismiss(toast.id)}
            >
              <CloseIcon className="mod-toast-close-icon" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
