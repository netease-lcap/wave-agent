import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DesktopSessionGroup, DesktopSessionEntry } from "../types";
import { SidebarExpandIcon } from "./HeaderIcons";
import { Tooltip } from "./Tooltip";
import "../styles/SessionBoard.css";

export interface SessionBoardProps {
  /** 会话树分组（desktopSessionTree 的 groups），按 (host, workdir) 分组 */
  groups: DesktopSessionGroup[];
  /** 点击某会话卡片 → 恢复该会话（传入 sessionId） */
  onSelectSession: (sessionId: string) => void;
  /** 点击「返回当前会话」→ 退出看板 */
  onBack: () => void;
  /** 左侧导航已收起：看板顶栏补「展开侧边栏」入口与分割线（评论 2026-09：
      header 处「新对话」图标钮已统一拿掉，仅留展开侧栏）。 */
  collapsed?: boolean;
  onExpandSidebar?: () => void;
}

/** 跨平台取路径最后一段（浏览器环境无 node path，兼容 \ 与 /）。 */
const dirName = (workdir: string): string =>
  workdir.split(/[\\/]/).filter(Boolean).pop() ?? workdir;

type ColumnKind = "waiting" | "running" | "done";

interface ColumnDef {
  kind: ColumnKind;
  name: string;
  /** 列头色块/胶囊点取色 class（浅色为 Figma 权威值，深色在 CSS 覆盖）。 */
  className: string;
}

const COLUMNS: ColumnDef[] = [
  {
    kind: "waiting",
    name: "等待中",
    className: "session-board-column--waiting",
  },
  {
    kind: "running",
    name: "运行中",
    className: "session-board-column--running",
  },
  { kind: "done", name: "已完成", className: "session-board-column--done" },
];

/** 卡片状态行（Figma 权威：「刚刚创建 / 运行 4 分钟 / 今天 17:32」）。 */
const formatStatus = (
  session: DesktopSessionEntry,
  kind: ColumnKind,
): string => {
  const elapsedMin = Math.floor((Date.now() - session.lastActiveAt) / 60000);
  if (elapsedMin < 1) return "刚刚创建";
  if (kind === "running") return `运行 ${elapsedMin} 分钟`;
  if (elapsedMin < 60) return `${elapsedMin} 分钟前`;
  const d = new Date(session.lastActiveAt);
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
  const dayKey = (t: Date) =>
    `${t.getFullYear()}-${t.getMonth()}-${t.getDate()}`;
  if (dayKey(d) === dayKey(new Date())) return `今天 ${hhmm}`;
  const yesterday = new Date(Date.now() - 86400000);
  if (dayKey(d) === dayKey(yesterday)) return `昨天 ${hhmm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hhmm}`;
};

/** 三列分类（对齐 spec 场景 2）：待确认优先于运行中（spec 场景 5 同款规则）。 */
const classify = (session: DesktopSessionEntry): ColumnKind => {
  if (session.waitingConfirmation) return "waiting";
  if (session.running) return "running";
  return "done";
};

/**
 * 会话状态看板（desktop 独有）：三列展示全部会话（等待中/运行中/已完成），
 * 支持按项目（workdir）筛选，点击卡片恢复对应会话。数据来自 desktopSessionTree。
 */
export const SessionBoard: React.FC<SessionBoardProps> = ({
  groups,
  onSelectSession,
  onBack,
  collapsed,
  onExpandSidebar,
}) => {
  // 项目筛选：空字符串 = 全部项目；否则为选中的 workdir 完整路径。
  const [selectedWorkdir, setSelectedWorkdir] = useState<string>("");

  // 下拉选项：每个分组的 workdir 目录名（label），value 用 workdir 完整路径。
  const filterOptions = useMemo(
    () =>
      groups.map((group) => ({
        workdir: group.workdir,
        name: dirName(group.workdir),
      })),
    [groups],
  );

  // 当前筛选下的分组 → 带所属 workdir 的会话列表（卡片项目名按分组展示）。
  const visibleSessions = useMemo(() => {
    const filtered = selectedWorkdir
      ? groups.filter((group) => group.workdir === selectedWorkdir)
      : groups;
    return filtered.flatMap((group) =>
      group.sessions.map((session) => ({
        session,
        workdir: group.workdir,
      })),
    );
  }, [groups, selectedWorkdir]);

  const columns = useMemo(
    () =>
      COLUMNS.map((column) => ({
        ...column,
        sessions: visibleSessions.filter(
          (item) => classify(item.session) === column.kind,
        ),
      })),
    [visibleSessions],
  );

  // 筛选框文案：选中项的目录名（与下拉选项 label 一致），未选 = 全部项目。
  const filterLabel =
    filterOptions.find((option) => option.workdir === selectedWorkdir)?.name ??
    "全部项目";

  // 文案是否溢出（溢出时才需要 Tooltip；hover 展示完整项目名，与活动图标
  // 等统一 Tooltip 样式一致，不用浏览器原生 title）。注意：Tooltip 的
  // disabled 翻转会让 filter 在「直接子节点/包裹节点」间换父重挂，测量须在
  // 每次提交后对新节点重跑（deps 含 filterOverflow），不可用 ResizeObserver
  // 观察旧节点——旧节点移除时回调会把状态误置回 false。
  const filterTextRef = useRef<HTMLSpanElement>(null);
  const [filterOverflow, setFilterOverflow] = useState(false);
  useLayoutEffect(() => {
    const el = filterTextRef.current;
    if (!el) return;
    setFilterOverflow(el.scrollWidth > el.clientWidth + 0.5);
  }, [filterLabel, filterOverflow]);

  return (
    <div className="session-board" data-testid="session-board">
      {/* 顶栏（Figma 13561:39312 Header，44px 行）：导航收起时左起为
          「展开侧边栏」功能钮（24×24），1×16 分割线后是「返回当前会话」
          （评论 2026-09：顶栏「新对话」钮已拿掉）；导航展开时这些入口在
          侧边栏上，看板不再重复。 */}
      <div className="session-board-toolbar">
        {collapsed && (
          <>
            {onExpandSidebar && (
              <Tooltip text="展开侧边栏" position="bottom">
                <button
                  type="button"
                  className="session-board-icon-btn"
                  onClick={onExpandSidebar}
                  data-testid="session-board-expand-sidebar"
                  aria-label="展开侧边栏"
                >
                  <SidebarExpandIcon />
                </button>
              </Tooltip>
            )}
            <span className="session-board-toolbar-divider" />
          </>
        )}
        <button
          type="button"
          className="session-board-back"
          onClick={onBack}
          title="返回当前会话"
        >
          <span className="codicon codicon-arrow-left" aria-hidden="true" />
          返回当前会话
        </button>
      </div>
      {/* 标题行：会话状态 + 项目筛选（Figma Select Input：14px 文案，
          超长省略、hover 用统一 Tooltip 展示完整项目名——原生 select 无省略
          与自绘提示，故用文字层 + 透明 select 覆盖交互） */}
      <div className="session-board-header">
        <span className="session-board-title">会话状态</span>
        <Tooltip
          text={filterLabel}
          position="bottom"
          className="session-board-filter-tooltip"
          disabled={!filterOverflow}
        >
          <div
            className="session-board-filter"
            data-testid="session-board-filter"
          >
            <span ref={filterTextRef} className="session-board-filter-text">
              {filterLabel}
            </span>
            <span
              className="codicon codicon-chevron-down session-board-filter-arrow"
              aria-hidden="true"
            />
            <select
              className="session-board-filter-select"
              aria-label="筛选项目"
              value={selectedWorkdir}
              onChange={(event) => setSelectedWorkdir(event.target.value)}
            >
              <option value="">全部项目</option>
              {filterOptions.map((option, index) => (
                <option
                  key={`${option.workdir}-${index}`}
                  value={option.workdir}
                >
                  {option.name}
                </option>
              ))}
            </select>
          </div>
        </Tooltip>
      </div>
      <div className="session-board-columns">
        {columns.map((column) => (
          <section
            key={column.kind}
            className={`session-board-column ${column.className}`}
          >
            <header className="session-board-column-header">
              <span className="session-board-column-dot" />
              <span className="session-board-column-name">{column.name}</span>
              <span className="session-board-column-count">
                {column.sessions.length}
              </span>
            </header>
            <div className="session-board-column-body">
              {column.sessions.length === 0 ? (
                <div className="session-board-empty">暂无会话</div>
              ) : (
                column.sessions.map(({ session, workdir }) => (
                  <button
                    key={session.sessionId}
                    type="button"
                    className="session-card"
                    data-testid={`session-card-${session.sessionId}`}
                    onClick={() => onSelectSession(session.sessionId)}
                    title={session.title || "新对话"}
                  >
                    {/* Figma 会话卡 Container 13656:5280：标题独占一行可省略；
                        副行 = 项目名（可省略）+ 状态（间距 8） */}
                    <span className="session-card-title-row">
                      <span className="session-card-title">
                        {session.title || "新对话"}
                      </span>
                    </span>
                    <span className="session-card-meta-row">
                      <span className="session-card-project">
                        {dirName(workdir)}
                      </span>
                      <span className="session-card-status">
                        {formatStatus(session, column.kind)}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};
