import React from "react";
import type { ModPanelTree } from "wave-agent-sdk/types";
import { ModPanelRenderer } from "./ModPanelRenderer";
import { CloseTabIcon } from "./CloseTabIcon";
import { measureElementCells } from "../utils/modViewport";
import "../styles/ModIdePanes.css";

/**
 * IDE 聊天面板里的 mod 面板（spec `ecosystem/plugin-mods.md`「在 IDE 插件里画」）。
 *
 * 与桌面端右侧面板槽的区别只有**摆在哪**：宽面板（`(min-width: 800px)`）dock 在
 * 对话右侧、多开时出 tab 栏；窄面板落到输入框上方、12 行后整体滚。元素树、交互回
 * 传、错误条都与桌面端同一份 `ModPanelRenderer` —— 两端画的是同一棵树。
 *
 * 这里不持有 mod 的任何状态：树由 ChatApp 按 `modPanelRender` 的回包填进来，交互
 * 原样回给它转成 `modPanelEvent`。
 */
export interface ModIdePaneFrame {
  /** tab id（`mod:<modId>:<paneId>`），与桌面端同一个拼法。 */
  id: string;
  modId: string;
  paneId: string;
  /** mod 在 `$.ui.open({ title })` 里要的名字。 */
  title: string;
  /** `undefined` = 第一帧还在路上；`null` = mod 这次没画东西。 */
  tree?: ModPanelTree | null;
  error?: string;
}

export interface ModIdePanesProps {
  panes: ModIdePaneFrame[];
  activePaneId: string | null;
  placement: "dock" | "inline";
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onEvent: (
    pane: ModIdePaneFrame,
    kind: "press" | "input" | "select",
    key: string,
    value?: string,
  ) => void;
  onOpenLink: (href: string) => void;
  /**
   * 这块面板自己有多大（字符宽高，spec「`ui.render` 的 `e.props`」的
   * `bodyColumns`）。宽度由 CSS 定（dock 是 `clamp(240px, 32%, 360px)`、inline
   * 是 100%），但只有挂上 DOM 之后才量得到，所以第一帧的请求里没有 `bodyColumns`
   * —— 量到之后 ChatApp 会再拉一帧。
   */
  onMeasure?: (cells: { columns: number; rows: number }) => void;
}

export function ModIdePanes({
  panes,
  activePaneId,
  placement,
  onActivate,
  onClose,
  onEvent,
  onOpenLink,
  onMeasure,
}: ModIdePanesProps): React.ReactElement | null {
  const observerRef = React.useRef<ResizeObserver | null>(null);
  // 回调 ref：元素一挂上量一次，之后靠 ResizeObserver（拖宽窗口、切 dock/inline、
  // 内容变高都会触发）。只看 `columns` 的变化由调用方决定 —— 行数会随内容变，
  // 跟着它重拉会转圈。
  const measureRef = React.useCallback(
    (section: HTMLElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!section || !onMeasure) return;
      const report = (): void => {
        const pane = section.querySelector<HTMLElement>(".mod-ide-pane");
        const cells = measureElementCells(pane ?? section);
        if (cells) onMeasure(cells);
      };
      report();
      if (typeof ResizeObserver === "undefined") return;
      const observer = new ResizeObserver(report);
      observer.observe(section);
      observerRef.current = observer;
    },
    [onMeasure],
  );

  if (panes.length === 0) return null;
  // 激活的 tab 可能刚被 mod 关掉：退回第一个，不留空白面板。
  const active = panes.find((pane) => pane.id === activePaneId) ?? panes[0];

  return (
    <section
      ref={measureRef}
      className="mod-ide-panes"
      data-testid="mod-ide-panes"
      data-placement={placement}
    >
      <div className="mod-ide-panes-header">
        {panes.length > 1 ? (
          <div className="mod-ide-panes-tabs" role="tablist">
            {panes.map((pane) => (
              <button
                key={pane.id}
                type="button"
                role="tab"
                aria-selected={pane.id === active.id}
                className="mod-ide-pane-tab"
                data-active={pane.id === active.id ? "true" : "false"}
                title={pane.title}
                onClick={() => onActivate(pane.id)}
              >
                {pane.title}
              </button>
            ))}
          </div>
        ) : (
          <div className="mod-ide-pane-title" title={active.title}>
            {active.title}
          </div>
        )}
        {/* 关掉这一块面板 = 用户自己收起来（与桌面端关 tab 同一条：
            宿主丢弃这块 pane，mod 不会被通知）。 */}
        <button
          type="button"
          className="mod-ide-pane-close"
          aria-label="关闭面板"
          onClick={() => onClose(active.id)}
        >
          <CloseTabIcon className="mod-ide-pane-close-icon" />
        </button>
      </div>
      <div className="mod-ide-panes-body">
        {panes.map((pane) => (
          <div
            key={pane.id}
            className="mod-ide-pane mod-surface"
            data-mod-id={pane.modId}
            // 非激活的 pane 保持挂载（`display: none`）：切回来时输入框里的草稿、
            // 滚动位置都还在，与桌面端面板槽同一条做法。
            style={{ display: pane.id === active.id ? undefined : "none" }}
          >
            {pane.tree === undefined && !pane.error ? (
              <div className="mod-panel-empty">正在渲染…</div>
            ) : (
              <ModPanelRenderer
                tree={pane.tree ?? null}
                error={pane.error}
                onEvent={(kind, key, value) => onEvent(pane, kind, key, value)}
                onOpenLink={onOpenLink}
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
