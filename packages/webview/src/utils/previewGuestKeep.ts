import type { DesktopPane, DesktopSessionGroup } from "../types";

/**
 * preview guest 跨会话保活的台账（spec desktop-panels.md「右侧面板 · preview
 * guest 跨会话保活」）。
 *
 * guest（面板里的 `<webview>`）的生命周期不再绑在槽位的 React 树上：切走的会话
 * 的 preview guest 只被「停靠」（保活但不显示）。谁还留着停靠 guest、超出额度先
 * 丢谁，都是窗口级的信息——分屏下每个 pane 各有自己的 ChatApp 实例，但额度必须
 * 跨分屏共享，所以台账放在模块级（与 sessionUiStore 同一层），各实例订阅后只渲染
 * 自己名下的条目。
 *
 * 条目归属（owner）是必需的：会话键（组）是全局共享的，若不加归属，同一个 tab
 * 会在多个 pane 的停靠层里各挂一个 guest（各自持有一个真实 Electron guest）。
 */

/**
 * 同时驻留的 guest 上限（全局、窗口级、跨分屏共享）。超出时按 LRU 逐出最久未
 * 活动的停靠组。一个会话可能开着多个 preview tab，每个 tab 各自算一个 guest。
 */
export const PREVIEW_GUEST_LIMIT = 4;

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
  /** 该组挂着几个 preview guest（= 该组的 preview tab 数）。 */
  guests: number;
}

// MRU 升序——最旧在前，逐出从队首取。
let parked: ParkedGroup[] = [];
// 各实例当前可见（非停靠）的那一组及其 guest 数：额度含当前可见者，必须跨实例
// 汇总。记的是「哪一组」而不只是数量——额度按**组**去重（同一组的 guest 只算
// 一份），否则刚切换的那一瞬间「上一组既算可见又算停靠」会把额度凭空吃掉一个。
const liveGroups = new Map<object, { group: string; guests: number }>();
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

/** 某实例名下要渲染的停靠组（MRU 升序）。 */
export function parkedGroupsFor(owner: object): string[] {
  const cached = snapshots.get(owner);
  if (cached) return cached;
  const next = parked.filter((p) => p.owner === owner).map((p) => p.group);
  snapshots.set(owner, next);
  return next;
}

function totalGuests(): number {
  const byGroup = new Map<string, number>();
  for (const entry of liveGroups.values()) {
    byGroup.set(
      entry.group,
      Math.max(byGroup.get(entry.group) ?? 0, entry.guests),
    );
  }
  for (const entry of parked) {
    byGroup.set(
      entry.group,
      Math.max(byGroup.get(entry.group) ?? 0, entry.guests),
    );
  }
  let total = 0;
  for (const count of byGroup.values()) total += count;
  return total;
}

/** 按额度从队首逐出最旧的停靠组；返回是否逐出了条目。 */
function trimToLimit(): boolean {
  let total = totalGuests();
  let dropped = false;
  while (total > PREVIEW_GUEST_LIMIT && parked.length > 0) {
    const victim = parked.shift() as ParkedGroup;
    total -= victim.guests;
    dropped = true;
  }
  return dropped;
}

/**
 * 某实例从该组切走：该组进入台账（MRU 末尾），并按额度逐出最旧的。`guests` 为
 * 0 表示这个组其实没有 preview tab（没有 guest 要保活）——不留空条目。
 */
export function parkGroup(owner: object, group: string, guests: number): void {
  if (guests <= 0) {
    unparkGroup(group);
    return;
  }

  parked = parked.filter((p) => p.group !== group);
  parked.push({ group, owner, guests });
  trimToLimit();
  invalidate();
}

/** 该组回到前台（任意实例切到它）：移出台账，改由前台实例渲染它的 guest。 */
export function unparkGroup(group: string): void {
  const next = parked.filter((p) => p.group !== group);
  if (next.length === parked.length) return;
  parked = next;
  invalidate();
}

/** 实例卸载（分屏关闭 / 窗口关闭）：它名下的停靠 guest 一并销毁、释放额度。 */
export function releaseParkedGroups(owner: object): void {
  liveGroups.delete(owner);
  snapshots.delete(owner);
  const next = parked.filter((p) => p.owner !== owner);
  if (next.length === parked.length) return;
  parked = next;
  invalidate();
}

/**
 * 上报本实例当前可见（非停靠）的组及其 guest 数。可见数变多也可能挤掉停靠组
 * （额度是含可见者的窗口级总量）。
 */
export function reportLiveGuests(
  owner: object,
  group: string,
  guests: number,
): void {
  const prev = liveGroups.get(owner);
  if (prev && prev.group === group && prev.guests === guests) return;
  liveGroups.set(owner, { group, guests });
  if (trimToLimit()) invalidate();
}

/**
 * 测试隔离：台账是模块级状态（与 sessionUiStore 同级），同一个 jsdom 进程里跨用例
 * 存活，用例之间要清空。
 */
export function resetParkedGroups(): void {
  parked = [];
  liveGroups.clear();
  invalidate();
}

/** 会话/分屏消失后的清理（与 sessionUi.prune 同口径）：已不存在的组不再保活。 */
export function pruneParkedGroups(keepKeys: Set<string>): void {
  const next = parked.filter((p) => keepKeys.has(p.group));
  if (next.length === parked.length) return;
  parked = next;
  invalidate();
}
