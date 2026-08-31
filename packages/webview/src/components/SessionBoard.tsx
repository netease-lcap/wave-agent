import React, { useMemo, useState } from "react";
import type { DesktopSessionGroup, DesktopSessionEntry } from "../types";
import "../styles/SessionBoard.css";

export interface SessionBoardProps {
  /** 会话树分组（desktopSessionTree 的 groups），按 (host, workdir) 分组 */
  groups: DesktopSessionGroup[];
  /** 点击某会话卡片 → 恢复该会话（传入 sessionId） */
  onSelectSession: (sessionId: string) => void;
  /** 点击「返回当前会话」→ 退出看板 */
  onBack: () => void;
}

/** 跨平台取路径最后一段（浏览器环境无 node path，兼容 \ 与 /）。 */
const dirName = (workdir: string): string =>
  workdir.split(/[\\/]/).filter(Boolean).pop() ?? workdir;

type ColumnKind = "waiting" | "running" | "done";

interface ColumnDef {
  kind: ColumnKind;
  name: string;
  /** 列头状态点颜色，复用消息时间线的状态色方案（--vscode-* 变量 + 兜底色）。 */
  color: string;
}

const COLUMNS: ColumnDef[] = [
  {
    kind: "waiting",
    name: "等待中",
    color: "var(--vscode-editorWarning-foreground, #cca700)",
  },
  {
    kind: "running",
    name: "运行中",
    color: "var(--vscode-descriptionForeground, #888)",
  },
  {
    kind: "done",
    name: "已完成",
    color: "var(--vscode-testing-iconPassed, #73c991)",
  },
];

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

  return (
    <div className="session-board" data-testid="session-board">
      <div className="session-board-header">
        <button
          type="button"
          className="session-board-back"
          onClick={onBack}
          title="返回当前会话"
        >
          <span className="codicon codicon-arrow-left" aria-hidden="true" />
          返回当前会话
        </button>
        <div className="session-board-header-right">
          <span className="session-board-title">会话状态</span>
          <select
            className="session-board-filter"
            aria-label="筛选项目"
            value={selectedWorkdir}
            onChange={(event) => setSelectedWorkdir(event.target.value)}
          >
            <option value="">全部项目</option>
            {filterOptions.map((option, index) => (
              <option key={`${option.workdir}-${index}`} value={option.workdir}>
                {option.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="session-board-columns">
        {columns.map((column) => (
          <section key={column.kind} className="session-board-column">
            <header className="session-board-column-header">
              <span
                className="session-board-column-dot"
                style={{ color: column.color }}
              >
                ●
              </span>
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
                    <span className="session-card-title">
                      {session.title || "新对话"}
                    </span>
                    <span className="session-card-project">
                      {dirName(workdir)}
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
