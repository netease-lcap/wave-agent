import React, { useEffect, useState } from "react";
import type { SessionMetadata } from "wave-agent-sdk/types";
import { formatLastActive, formatSessionLabel } from "../utils/session";
import "../styles/RemoteSessionListPage.css";

interface RemoteResumeListPageProps {
  /** 这台机器磁盘上的主会话（宿主已按最近活跃时间截到上限）。 */
  sessions: SessionMetadata[];
  loading: boolean;
  /** 恢复请求在途：行暂时点不动，顶部给一句话（避免连点发出两条 initialize）。 */
  busy: boolean;
  /** 读列表或恢复失败时的一句话（已由 shim 翻成人话）。 */
  error?: string;
  /** 选中一条：父组件负责发恢复请求、并在成功后关掉本页。 */
  onSelect: (session: SessionMetadata) => void;
  onBack: () => void;
}

/**
 * 远控 Web 页的「恢复会话」整页列表（spec remote/remote-web.md「手机端也能接着
 * 磁盘上的历史会话聊」）。
 *
 * 与「手机端的会话列表与删除」那张整页列表是**两张不同的表**，刻意不复用同一份
 * 组件：那一边列的是**进程内活会话**（带状态点、行级重命名 / 删除），这一边列的
 * 是**磁盘上的历史会话**（还不在进程里，没有状态可标，也没有可删的对象）。因此
 * 这里只保留两侧都需要的形态——返回键、标题、搜索框、两行行文——并复用同一份
 * 样式（`RemoteSessionListPage.css`），行级动作一个都不挂。
 *
 * 第二行给的是**工作目录完整路径**而不是目录名：这份列表跨项目，「两个都叫
 * wave-agent 的目录」在这一行必须能分辨（桌面端那张同源列表也是给完整路径）。
 */
export const RemoteResumeListPage: React.FC<RemoteResumeListPageProps> = ({
  sessions,
  loading,
  busy,
  error,
  onSelect,
  onBack,
}) => {
  const [query, setQuery] = useState("");

  // Esc 退回对话页（与「会话」整页列表同一手感；页面上没有别的一层要收）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onBack();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onBack]);

  const filtered = (() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return sessions;
    return sessions.filter(
      (session) =>
        formatSessionLabel(session).toLowerCase().includes(trimmed) ||
        (session.workdir ?? "").toLowerCase().includes(trimmed),
    );
  })();

  return (
    <div
      className="remote-session-page"
      data-testid="remote-resume-page"
      role="dialog"
      aria-modal="true"
      aria-label="恢复会话"
    >
      <div className="remote-session-page-header">
        <button
          type="button"
          className="remote-session-page-back"
          data-testid="remote-resume-page-back"
          aria-label="返回"
          onClick={onBack}
        >
          <span className="codicon codicon-chevron-left" aria-hidden="true" />
          <span>返回</span>
        </button>
        <div className="remote-session-page-title">恢复会话</div>
      </div>

      <input
        type="text"
        className="remote-session-page-search"
        data-testid="remote-resume-page-search"
        placeholder="搜索关键词"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {busy && (
        <div
          className="remote-session-page-notice"
          data-testid="remote-resume-restoring"
          role="status"
        >
          正在恢复这条会话...
        </div>
      )}

      {error && (
        <div
          className="remote-session-page-notice"
          data-testid="remote-resume-error"
          role="alert"
        >
          {error}
        </div>
      )}

      {loading ? (
        <div className="remote-session-page-empty">正在加载...</div>
      ) : filtered.length === 0 ? (
        <div className="remote-session-page-empty">
          {sessions.length === 0
            ? "电脑侧还没有历史会话。"
            : "未找到匹配的会话"}
        </div>
      ) : (
        <ul
          className="remote-session-page-list"
          data-testid="remote-resume-page-list"
        >
          {filtered.map((session) => {
            const meta = [
              session.workdir,
              formatLastActive(session.lastActiveAt),
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <li
                key={session.id}
                className="remote-session-row"
                data-testid={`remote-resume-row-${session.id}`}
              >
                <button
                  type="button"
                  className="remote-session-row-main"
                  data-testid={`remote-resume-row-select-${session.id}`}
                  disabled={busy}
                  onClick={() => onSelect(session)}
                >
                  <span className="remote-session-row-title">
                    <span className="remote-session-row-title-text">
                      {formatSessionLabel(session)}
                    </span>
                  </span>
                  {meta && (
                    <span className="remote-session-row-meta" title={meta}>
                      {meta}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default RemoteResumeListPage;
