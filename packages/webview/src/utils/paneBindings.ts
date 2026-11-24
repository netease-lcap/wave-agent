import type { DesktopPane } from "../types";

/**
 * 宿主最近一次推来的分屏布局（`desktopPanes`）的同步镜像。
 *
 * 渲染端读的是**已提交**的 `panes`，而消息处理器需要在收到 `setInitialState`
 * 的那一个任务里就知道「这个 pane 现在绑的是哪条会话」：宿主的两次推送
 * （`pushPanes` 再 `pushPaneSessionState`）背靠背发出，可能落进同一个 React
 * 提交，那一刻 `panes` props 还是上一份布局。IPC 的推送顺序是协议事实（绑定
 * 永远先推），所以这里抹平的是「状态已提交」与「消息已到达」之间的时间差，不
 * 引入新的顺序约定。
 *
 * 由 DesktopApp 在收到 `desktopPanes` 时**同步**写入（与它自己的 panesRef /
 * setPanes 同一步），挂载时清空——一份布局属于一个窗口。
 */
let panes: DesktopPane[] = [];

export function setPaneBindings(next: DesktopPane[] | undefined): void {
  panes = next ?? [];
}

/**
 * pane 此刻应当显示的会话组键：宿主最后一次推来的绑定；没有绑定就是该 pane 的
 * 新会话桶 `new:<paneId>`（与 DesktopApp 渲染 pane 时选 groupKey 的口径一致）。
 */
export function paneSessionKey(paneId: string): string {
  return panes.find((p) => p.paneId === paneId)?.sessionId ?? `new:${paneId}`;
}
