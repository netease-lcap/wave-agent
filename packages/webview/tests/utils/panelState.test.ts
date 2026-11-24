import { describe, it, expect } from "vitest";
import { derivePanelState, type PlanRoute } from "../../src/utils/panelState";
import {
  emptySessionUiState,
  FILE_TREE_DEFAULT_WIDTH,
  PANEL_DEFAULT_WIDTH,
  type SessionUiState,
} from "../../src/utils/sessionUiStore";
import type { PanelTab } from "../../src/types";

/**
 * 面板组的纯归约（`derivePanelState`）。
 *
 * 这份归约取代了「swap effect 播种、plan 路由 effect 随后补一条」那对靠**声明
 * 顺序**仲裁的 effect：会话激活时两条消息可能落进同一个 React 提交，播种会不会
 * 抹掉刚打开的 plan 标签全看谁先跑。现在由快照的消息处理器一次算完，于是规则可
 * 以按输入组合直接断言，不用去摆布 React 的提交时序。
 *
 * 目标组由调用方选定后作为 `cached` 传进来，所以这里的两维就是全部输入：
 * - 目标组有没有缓存（= 换会话 vs 留在当前组 / 有 groupKey vs 没有）；
 * - 缓存与「当前屏幕上这一组」的 committed 标签里各有没有 plan 标签；
 * 再乘上「这次快照有没有回放 plan」。
 */

const previewTab: PanelTab = { id: "preview-1", kind: "preview" };
const planTab: PanelTab = { id: "plan-1", kind: "plan" };
const diffTab: PanelTab = { id: "diff-1", kind: "diff" };

/** 一条会话在 sessionUi 里的缓存（只写本用例关心的字段，其余取空组默认）。 */
function cachedGroup(patch: Partial<SessionUiState>): SessionUiState {
  return { ...emptySessionUiState(), ...patch };
}

const kinds = (tabs: PanelTab[]) => tabs.map((t) => t.kind);

interface Row {
  name: string;
  cached: SessionUiState | undefined;
  committed: PanelTab[];
  plan: string | null;
  seq: number;
  route: PlanRoute;
  tabs: PanelTab[];
  active: string | null;
  expanded: boolean;
  planContent: string | null;
  nextSeq: number;
}

/**
 * 三条 plan 规则 × 「有没有缓存」的矩阵（规则逐条来自旧的 plan 路由 effect）：
 * - `keep`：目标组缓存里已有 plan 标签 —— 只换内容，标签与激活位置由播种一起恢复；
 * - `flip`：缓存里没有、屏幕上却有 —— 换会话会把上一组的 plan 标签换掉，而
 *   `ensureTabRef` 读的是过期的 committed 列表、只会去激活一个即将被丢弃的标签，
 *   所以新分配一个 id 追加；
 * - `guarded`：两边都没有 —— 交给带守卫的打开路径（标签上限 + 空间守卫）。
 */
const rows: Row[] = [
  {
    name: "未缓存的会话、快照没带 plan：空组、面板收起",
    cached: undefined,
    committed: [],
    plan: null,
    seq: 0,
    route: "none",
    tabs: [],
    active: null,
    expanded: false,
    planContent: null,
    nextSeq: 0,
  },
  {
    name: "未缓存的会话、快照带 plan：交给守卫路径",
    cached: undefined,
    committed: [],
    plan: "# 计划",
    seq: 6,
    route: "guarded",
    tabs: [],
    active: null,
    expanded: false,
    planContent: "# 计划",
    nextSeq: 6,
  },
  {
    name: "有缓存、快照没带 plan：原样播种",
    cached: cachedGroup({
      checked: [previewTab],
      activePanel: previewTab.id,
      panelExpanded: true,
    }),
    committed: [],
    plan: null,
    seq: 3,
    route: "none",
    tabs: [previewTab],
    active: previewTab.id,
    expanded: true,
    planContent: null,
    nextSeq: 3,
  },
  {
    name: "有缓存但没有 plan 标签、快照带 plan：交给守卫路径",
    cached: cachedGroup({
      checked: [previewTab],
      activePanel: previewTab.id,
      panelExpanded: true,
    }),
    committed: [],
    plan: "# 计划",
    seq: 3,
    route: "guarded",
    tabs: [previewTab],
    active: previewTab.id,
    expanded: true,
    planContent: "# 计划",
    nextSeq: 3,
  },
  {
    name: "缓存里已有 plan 标签：只换内容、不新分配",
    cached: cachedGroup({
      checked: [previewTab, planTab],
      activePanel: planTab.id,
      panelExpanded: true,
    }),
    committed: [],
    plan: "# 新计划",
    seq: 3,
    route: "keep",
    tabs: [previewTab, planTab],
    active: planTab.id,
    expanded: true,
    planContent: "# 新计划",
    nextSeq: 3,
  },
  {
    name: "缓存没有、屏幕上有 plan 标签（会话切换）：新分配一个追加",
    cached: cachedGroup({ checked: [previewTab], activePanel: previewTab.id }),
    committed: [previewTab, planTab],
    plan: "# 计划",
    seq: 4,
    route: "flip",
    tabs: [previewTab, { kind: "plan", id: "plan-5" }],
    active: "plan-5",
    expanded: true,
    planContent: "# 计划",
    nextSeq: 5,
  },
  {
    name: "没有缓存但屏幕上已有 plan 标签：同样新分配（从空组起）",
    cached: undefined,
    committed: [planTab],
    plan: "# 计划",
    seq: 0,
    route: "flip",
    tabs: [{ kind: "plan", id: "plan-1" }],
    active: "plan-1",
    expanded: true,
    planContent: "# 计划",
    nextSeq: 1,
  },
];

describe("derivePanelState", () => {
  it.each(rows)("$name", (row) => {
    const derived = derivePanelState(
      row.cached,
      row.plan,
      row.committed,
      row.seq,
    );
    expect(derived.planRoute).toBe(row.route);
    expect(derived.planSeq).toBe(row.nextSeq);
    expect(derived.group.tabs).toEqual(row.tabs);
    expect(derived.group.activeTabId).toBe(row.active);
    expect(derived.group.panelExpanded).toBe(row.expanded);
    expect(derived.group.planContent).toBe(row.planContent);
  });

  it("seeds an unseen session with the empty defaults", () => {
    const { group } = derivePanelState(undefined, null, [], 0);
    expect(group.tabs).toEqual([]);
    expect(group.activeTabId).toBeNull();
    // 没有缓存 = 面板收起（空态需要用户显式展开）。
    expect(group.panelExpanded).toBe(false);
    expect(group.panelWidth).toBe(PANEL_DEFAULT_WIDTH);
    expect(group.panelWidthManual).toBe(false);
    expect(group.diffTreeVisible).toBe(true);
    expect(group.fileTreeVisible).toBe(true);
    expect(group.fileTreeWidth).toBe(FILE_TREE_DEFAULT_WIDTH);
    expect(group.diffSelection).toEqual({ kind: "all" });
    expect(group.forward).toBeNull();
    expect(group.forwardError).toBeNull();
  });

  it("restores the cached group verbatim when no plan was replayed", () => {
    const forward = {
      host: "remote-1",
      remotePort: 3000,
      originalUrl: "http://localhost:3000",
      requestId: "r1",
    };
    const { group } = derivePanelState(
      cachedGroup({
        checked: [previewTab, diffTab],
        activePanel: diffTab.id,
        panelWidth: 500,
        panelWidthManual: true,
        panelExpanded: true,
        planContent: "# 旧计划",
        diffTreeVisible: false,
        fileTreeVisible: false,
        fileTreeWidth: 300,
        diffSelection: { kind: "commit", sha: "abc123" },
        forward,
        forwardError: "boom",
      }),
      null,
      [],
      0,
    );
    expect(group.tabs).toEqual([previewTab, diffTab]);
    expect(group.activeTabId).toBe(diffTab.id);
    expect(group.panelWidth).toBe(500);
    expect(group.panelWidthManual).toBe(true);
    expect(group.panelExpanded).toBe(true);
    expect(group.planContent).toBe("# 旧计划");
    expect(group.diffTreeVisible).toBe(false);
    expect(group.fileTreeVisible).toBe(false);
    expect(group.fileTreeWidth).toBe(300);
    expect(group.diffSelection).toEqual({ kind: "commit", sha: "abc123" });
    expect(group.forward).toBe(forward);
    expect(group.forwardError).toBe("boom");
  });

  it("falls back to the first tab when the cached active one was closed", () => {
    const { group } = derivePanelState(
      cachedGroup({ checked: [diffTab], activePanel: "plan-9" }),
      null,
      [],
      0,
    );
    expect(group.activeTabId).toBe(diffTab.id);
  });

  it("never mutates the cached tabs array", () => {
    const checked = [previewTab];
    const { group } = derivePanelState(
      cachedGroup({ checked }),
      "# 计划",
      [planTab],
      0,
    );
    expect(checked).toEqual([previewTab]);
    expect(group.tabs).not.toBe(checked);
    expect(kinds(group.tabs)).toEqual(["preview", "plan"]);
  });
});
