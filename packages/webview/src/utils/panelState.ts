import type { PanelTab } from "../types";
import {
  emptySessionUiState,
  type DiffSelection,
  type RemoteForwardRef,
  type SessionUiState,
} from "./sessionUiStore";

/**
 * 面板组的纯归约：把「切到某条会话时右侧面板应该长什么样」从 React 提交时序里
 * 摘出来，变成一份可以直接断言的输入 → 输出。
 *
 * ## 为什么需要它
 *
 * 宿主切换 pane 上的会话时会连推两条消息：布局（`desktopPanes`，带上这个 pane
 * 的新会话）与会话快照（`setInitialState`，带着要恢复的 ExitPlanMode plan）。两条
 * 消息可能落进同一个 React 提交。此前「从缓存播种整个面板组」写在 swap effect
 * 里、「把 plan 打开成标签」写在另一个 effect 里，正确性押在「后者声明在前者之后，
 * 于是它跑在播种之后」这条 React 保证同一次提交内 effect 按声明顺序执行的隐式
 * 契约上——改一次声明顺序就会静默丢掉刚打开的 plan 标签。
 *
 * 现在由快照的消息处理器认领这次切换：它在同一次提交里（a）按本函数的输出播种
 * 面板组、（b）把 plan 路由到其中、（c）把 groupKeyRef 指到新键，使 groupKey
 * 变化触发的 swap effect 早退（它只剩「没有快照的绑定变化」这一种情形）。于是
 * 结果与 effect 声明顺序无关。
 *
 * ## 三条 plan 规则（与旧 plan 路由 effect 逐条对应）
 *
 * 1. 目标会话的缓存里已有 plan 标签 —— 只换内容，标签与它的激活位置由播种一起
 *    恢复（{@link PlanRoute} 的 `keep`）。
 * 2. 缓存里没有、但当前屏幕上（committed）有 —— 会话切换会把上一组的 plan 标签
 *    换掉，而 `ensureTabRef` 读的是这份过期的 committed 列表、只会去「激活」一个
 *    即将被丢弃的标签；所以这里直接新分配一个 id 追加（`flip`）。
 * 3. 两边都没有 —— 交给带守卫的打开路径（`ensureTabRef`：标签上限 + 面板空间
 *    守卫，它会按行宽重算未手动拖过的面板宽度），本函数只报告 `guarded`。
 */

/**
 * 一条会话的面板组该恢复成什么样。字段与 ChatApp 里那批面板 state 一一对应。
 */
export interface DerivedPanelGroup {
  /** Open panel tabs in tab order (multi-instance kinds may repeat). */
  tabs: PanelTab[];
  /** Active tab id; null when no tab is open. */
  activeTabId: string | null;
  /** Whether the panel slot is expanded for this session. */
  panelExpanded: boolean;
  /** Plan panel markdown; the replayed plan wins over the cached one. */
  planContent: string | null;
  panelWidth: number;
  panelWidthManual: boolean;
  diffTreeVisible: boolean;
  fileTreeVisible: boolean;
  fileTreeWidth: number;
  diffSelection: DiffSelection;
  forward: RemoteForwardRef | null;
  forwardError: string | null;
}

/**
 * 回放的 plan 落到哪里：
 * - `none`：这次快照没带 plan，面板保持播种结果；
 * - `keep`：目标组缓存里已有 plan 标签，只换内容；
 * - `flip`：本函数已把新 plan 标签放进 {@link DerivedPanelState.group}；
 * - `guarded`：调用方走 `ensureTabRef("plan")`（标签上限 + 空间守卫）。
 */
export type PlanRoute = "none" | "keep" | "flip" | "guarded";

export interface DerivedPanelState {
  /** 要应用到 ChatApp 的那一整组面板状态。 */
  group: DerivedPanelGroup;
  planRoute: PlanRoute;
  /**
   * 这颗 plan 标签计数器在本次归约后的值（`flip` 会消耗一个序号）。调用方写回
   * 自己的 ref —— 序号是显式的输入/输出，不再藏在 effect 里改 ref。
   */
  planSeq: number;
}

/**
 * 按缓存播种一份面板组。没有缓存 = 这条会话第一次进入（或从未打开过面板）：
 * 空标签、默认宽度、面板收起（空态需要用户显式展开）。
 */
function seedGroup(cached: SessionUiState | undefined): DerivedPanelGroup {
  const empty = emptySessionUiState();
  const tabs = cached?.checked ?? empty.checked;
  // 记住的激活标签必须还在这次恢复出来的标签里；缓存里指着已关闭标签的陈旧条目
  // 回落到第一个标签。
  const restoredActive = cached?.activePanel ?? null;
  const activeTabId =
    restoredActive !== null && tabs.some((t) => t.id === restoredActive)
      ? restoredActive
      : (tabs[0]?.id ?? null);
  return {
    tabs,
    activeTabId,
    // 展开/收起逐会话记忆（spec desktop-right-panel.md「展开/折叠」场景 10）；
    // 有缓存但没记过的老条目按「有标签就展开」兜底。
    panelExpanded: cached?.panelExpanded ?? tabs.length > 0,
    planContent: cached?.planContent ?? null,
    panelWidth: cached?.panelWidth ?? empty.panelWidth,
    panelWidthManual: cached?.panelWidthManual ?? empty.panelWidthManual,
    diffTreeVisible: cached?.diffTreeVisible ?? empty.diffTreeVisible,
    fileTreeVisible: cached?.fileTreeVisible ?? empty.fileTreeVisible,
    fileTreeWidth: cached?.fileTreeWidth ?? empty.fileTreeWidth,
    diffSelection: cached?.diffSelection ?? empty.diffSelection,
    forward: cached?.forward ?? null,
    forwardError: cached?.forwardError ?? null,
  };
}

/**
 * 归约一次会话激活后的面板组。
 *
 * @param cached 目标会话组在 sessionUi 里的快照（未缓存 = 第一次进入）
 * @param replayPlan 快照里带回来的 ExitPlanMode plan（null = 这次没有）
 * @param committedTabs 当前屏幕上这一组的标签（用于识别「会话切换丢掉了上一组的
 *   plan 标签」这条 flip 规则）
 * @param planSeq plan 标签计数器的当前值
 */
export function derivePanelState(
  cached: SessionUiState | undefined,
  replayPlan: string | null,
  committedTabs: PanelTab[],
  planSeq: number,
): DerivedPanelState {
  const group = seedGroup(cached);
  if (replayPlan === null) return { group, planRoute: "none", planSeq };
  // plan 面板的内容永远跟着最新那次回放走（批准/拒绝后 plan 仍留在面板里）。
  const withPlan: DerivedPanelGroup = { ...group, planContent: replayPlan };
  if (group.tabs.some((t) => t.kind === "plan")) {
    return { group: withPlan, planRoute: "keep", planSeq };
  }
  if (committedTabs.some((t) => t.kind === "plan")) {
    const nextSeq = planSeq + 1;
    const id = `plan-${nextSeq}`;
    return {
      group: {
        ...withPlan,
        tabs: [...group.tabs, { kind: "plan", id }],
        activeTabId: id,
        // 打开的标签压过原先查看的那个：面板一并展开。
        panelExpanded: true,
      },
      planRoute: "flip",
      planSeq: nextSeq,
    };
  }
  return { group: withPlan, planRoute: "guarded", planSeq };
}
