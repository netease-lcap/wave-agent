import type { DesktopPane, DesktopSessionGroup } from "../types";

/**
 * preview guest 跨会话保活的台账（spec desktop-right-panel.md「右侧面板 · preview
 * guest 跨会话保活」）。
 *
 * guest（面板里的 `<webview>`）的生命周期不绑在槽位的 React 树上：切走的会话
 * 的 preview guest 只被「停靠」（保活但不显示）。谁还留着停靠 guest 是窗口级的
 * 信息——分屏下每个 pane 各有自己的 ChatApp 实例，所以台账放在模块级（与
 * sessionUiStore 同一层），各实例订阅后只渲染自己名下的条目。
 *
 * **没有数量上限，也不做逐出**：对齐 Claude 桌面端（Browser pane）——保活只由
 * 「用户关闭该 preview tab / 会话被删除 / 分屏被关闭 / 退出应用」终结，不存在按
 * 数量或空闲时间的回收。于是台账退化成纯「谁停靠了哪些组」的集合，条目次序不
 * 参与任何判定（渲染次序由 ChatApp 的 guestOrderRef 按首次出现分配，绝不能因
 * 台账增减而重排——重排会移动 <webview> 的 DOM 节点，等于 guest 重建）。
 *
 * 条目归属（owner）是必需的：会话键（组）是全局共享的，若不加归属，同一个 tab
 * 会在多个 pane 的停靠层里各挂一个 guest（各自持有一个真实 Electron guest）。
 */

/**
 * 面板组的存活键集合：分屏的新会话桶 `new:<paneId>`、已绑定的会话，以及会话树
 * 里仍然存在的会话。
 *
 * 同一口径同时喂两处清理——sessionUi 快照与 guest 保活（DesktopApp.prunePanels
 * 一并调用）。两处必须一致：口径分叉就会出现「快照还在但 guest 被丢」或反之
 * （后者更糟：切回时没有 URL 可恢复）。
 */
export function livePanelGroupKeys(
  panes: DesktopPane[],
  sessionTree: DesktopSessionGroup[],
): Set<string> {
  const keep = new Set<string>();
  for (const p of panes) {
    keep.add(`new:${p.paneId}`);
    if (p.sessionId) keep.add(p.sessionId);
  }
  for (const g of sessionTree) {
    for (const s of g.sessions) keep.add(s.sessionId);
  }
  return keep;
}

/** 台账里的一个停靠组。 */
interface ParkedGroup {
  group: string;
  /** 归属实例（分屏下每个 pane 一个 ChatApp）：只有切走它的实例渲染它的 guest。 */
  owner: object;
}

let parked: ParkedGroup[] = [];
const listeners = new Set<() => void>();
// 每实例的快照缓存（useSyncExternalStore 要求同一份数据返回同一个引用）。
const snapshots = new Map<object, string[]>();

/**
 * 台账变更后的通知（同步）。注意：登记发生在 ChatApp 的会话 swap effect 里，同步
 * 通知会让 React 插一次只带这条高优先级更新的渲染——那次渲染的 `tabs` 还是上一
 * 会话的。渲染侧必须能承受这种「新组名 + 旧 tabs」的提交：guest 的 key 只跟
 * state 自己声明的组（ChatApp 的 stateGroupKey）走，不跟 groupKey/groupKeyRef。
 */
function invalidate(): void {
  snapshots.clear();
  for (const fn of [...listeners]) fn();
}

export function subscribeParkedGroups(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 某实例名下要渲染的停靠组。 */
export function parkedGroupsFor(owner: object): string[] {
  const cached = snapshots.get(owner);
  if (cached) return cached;
  const next = parked.filter((p) => p.owner === owner).map((p) => p.group);
  snapshots.set(owner, next);
  return next;
}

/**
 * 某实例从该组切走：该组进入台账（永不被逐出）。`previewTabs` 只用来判断「这个
 * 组到底有没有 preview tab 要保活」——0 表示没有 guest 需要留着，不留空条目。
 */
export function parkGroup(
  owner: object,
  group: string,
  previewTabs: number,
): void {
  if (previewTabs <= 0) {
    unparkGroup(group);
    return;
  }
  const existing = parked.find((p) => p.group === group);
  // 已在台账里（同一实例重复登记）：不动、也不通知，避免无谓的重渲染。
  if (existing && existing.owner === owner) return;
  parked = [...parked.filter((p) => p.group !== group), { group, owner }];
  invalidate();
}

/** 该组回到前台（任意实例切到它）：移出台账，改由前台实例渲染它的 guest。 */
export function unparkGroup(group: string): void {
  const next = parked.filter((p) => p.group !== group);
  if (next.length === parked.length) return;
  parked = next;
  invalidate();
}

/** 实例卸载（分屏关闭 / 窗口关闭）：它名下的停靠 guest 一并销毁。 */
export function releaseParkedGroups(owner: object): void {
  snapshots.delete(owner);
  const next = parked.filter((p) => p.owner !== owner);
  if (next.length === parked.length) return;
  parked = next;
  invalidate();
}

/**
 * 测试隔离：台账是模块级状态（与 sessionUiStore 同级），同一个测试文件里的
 * 用例共用一个页面，它会跨用例存活，用例之间要清空。
 */
export function resetParkedGroups(): void {
  parked = [];
  invalidate();
}

/** 会话/分屏消失后的清理（与 sessionUi.prune 同口径）：已不存在的组不再保活。 */
export function pruneParkedGroups(keepKeys: Set<string>): void {
  const next = parked.filter((p) => keepKeys.has(p.group));
  if (next.length === parked.length) return;
  parked = next;
  invalidate();
}
