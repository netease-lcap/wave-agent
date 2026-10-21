import type { DesktopSessionGroup } from "../types";

/** 筛选面板的两个维度（spec desktop-sessions.md「侧栏会话搜索与筛选」）。 */
export type SessionStatusFilter = "waiting" | "running" | "done";
export type SessionDateFilter = "today" | "7d" | "30d";

/**
 * 已生效的筛选条件。`statuses` 为空 = 不按状态筛；多项之间为「或」。
 * `date` 为 null = 不按创建日期筛。
 */
export interface SessionFilterState {
  statuses: SessionStatusFilter[];
  date: SessionDateFilter | null;
}

export const EMPTY_SESSION_FILTER: SessionFilterState = {
  statuses: [],
  date: null,
};

export const SESSION_STATUS_OPTIONS: Array<{
  value: SessionStatusFilter;
  label: string;
}> = [
  { value: "waiting", label: "等待中" },
  { value: "running", label: "运行中" },
  { value: "done", label: "已完成" },
];

export const SESSION_DATE_OPTIONS: Array<{
  value: SessionDateFilter;
  label: string;
}> = [
  { value: "today", label: "今天" },
  { value: "7d", label: "近7天" },
  { value: "30d", label: "近30天" },
];

export function isSessionFilterActive(filter: SessionFilterState): boolean {
  return filter.statuses.length > 0 || filter.date !== null;
}

/**
 * 会话状态口径与「会话状态看板」一致：等待确认 > 运行中 > 其余都算已完成。
 * 侧栏行上的绿点语义不同（`newCompleted` 只标「完成且未查看」），拿来做筛选会
 * 漏掉所有看过的旧会话，所以这里不沿用那一套。
 */
function sessionStatus(session: {
  running?: boolean;
  waitingConfirmation?: boolean;
}): SessionStatusFilter {
  if (session.waitingConfirmation) return "waiting";
  if (session.running) return "running";
  return "done";
}

/** 档位的起点（本地时区的当天 0 点），近 7 天 = 今天及之前 6 天（含今天）。 */
function dateWindowStart(date: SessionDateFilter, now: Date): number {
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  if (date === "today") return startOfToday;
  const days = date === "7d" ? 6 : 29;
  return startOfToday - days * 24 * 60 * 60 * 1000;
}

/**
 * 按关键词与筛选条件就地过滤会话树（交集）。
 *
 * - 关键词只匹配会话名称，子串、不区分大小写；不匹配工作目录名。
 * - 分组内没有命中会话时整组隐藏（分组标题一并隐藏）。
 * - 关键词与筛选都为空时原样返回（包含源数据里本来就空的分组）。
 */
export function filterSessionTree(
  groups: DesktopSessionGroup[],
  query: string,
  filter: SessionFilterState,
  now: Date = new Date(),
): DesktopSessionGroup[] {
  const keyword = query.trim().toLowerCase();
  const needStatus = filter.statuses.length > 0;
  const windowStart =
    filter.date === null ? null : dateWindowStart(filter.date, now);
  if (!keyword && !needStatus && windowStart === null) return groups;

  return groups
    .map((group) => ({
      ...group,
      sessions: group.sessions.filter((session) => {
        if (keyword && !(session.title || "").toLowerCase().includes(keyword)) {
          return false;
        }
        if (needStatus && !filter.statuses.includes(sessionStatus(session))) {
          return false;
        }
        if (windowStart !== null) {
          // createdAt 是新增字段，老快照可能没有 —— 回落 lastActiveAt。
          const created = session.createdAt ?? session.lastActiveAt ?? 0;
          if (created < windowStart) return false;
        }
        return true;
      }),
    }))
    .filter((group) => group.sessions.length > 0);
}
