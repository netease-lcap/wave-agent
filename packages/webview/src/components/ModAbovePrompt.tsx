import React from "react";
import type { ModPanelTree } from "wave-agent-sdk/types";
import { ModPanelRenderer } from "./ModPanelRenderer";
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
 */

/** 一条带（一个 mod 一条）。 */
export interface ModBandFrame {
  modId: string;
  plugin: string;
  revision: number;
  tree: ModPanelTree | null;
  error?: string;
}

/** 输入框下方常驻的一行。 */
export interface ModStatusFrame {
  modId: string;
  plugin: string;
  text: string;
}

/** 输入框下方短暂出现的一条。`id` 是本地排队用的序号。 */
export interface ModToastFrame {
  id: number;
  plugin: string;
  text: string;
}

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

/** 输入框**下方**常驻的状态行，每个插件一条。 */
export function ModStatusLines({
  lines,
}: {
  lines: ModStatusFrame[];
}): React.ReactElement | null {
  if (lines.length === 0) return null;
  return (
    <div className="mod-status" data-testid="mod-status">
      {lines.map((line) => (
        <div
          className="mod-status-line"
          key={line.modId}
          data-mod-id={line.modId}
          data-plugin={line.plugin}
        >
          {/* 谁贴的要看得出：插件署名在前，文本原样在后（纯文本，不渲染
              markdown —— mod 写不了 HTML，这里也不给它这个口子）。 */}
          <span className="mod-status-plugin">{line.plugin}</span>
          <span className="mod-status-text">{line.text}</span>
        </div>
      ))}
    </div>
  );
}

/** 输入框**下方**的短暂提示；到点由 ChatApp 从队列里摘掉。 */
export function ModToastStack({
  toasts,
}: {
  toasts: ModToastFrame[];
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
          <span className="mod-toast-plugin">{toast.plugin}</span>
          <span className="mod-toast-text">{toast.text}</span>
        </div>
      ))}
    </div>
  );
}
