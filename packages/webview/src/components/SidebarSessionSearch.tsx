import React, { useEffect, useRef, useState } from "react";
import { useClickOutside } from "../utils/useClickOutside";
import { Tooltip } from "./Tooltip";
import {
  SESSION_DATE_OPTIONS,
  SESSION_STATUS_OPTIONS,
  EMPTY_SESSION_FILTER,
  isSessionFilterActive,
  type SessionDateFilter,
  type SessionFilterState,
  type SessionStatusFilter,
} from "../utils/sessionFilter";
import "../styles/SidebarSessionSearch.css";

const SearchIcon: React.FC = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
  >
    <circle cx="7" cy="7" r="4.4" stroke="currentColor" strokeWidth="1.4" />
    <path
      d="m10.4 10.4 3 3"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);

const FilterIcon: React.FC = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M2.5 4h11M4.5 8h7M6.5 12h3"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);

interface SidebarSessionSearchProps {
  /** 搜索关键词（受控；过滤在调用方做，输入框只管取值）。 */
  query: string;
  onQueryChange: (query: string) => void;
  /** 已生效的筛选条件（面板打开时的初值，也决定按钮是否高亮）。 */
  filter: SessionFilterState;
  onApplyFilter: (filter: SessionFilterState) => void;
}

/**
 * 侧栏会话搜索框 + 筛选面板（spec desktop-sessions.md「侧栏会话搜索与筛选」）。
 *
 * 搜索是即时的（输入即过滤，无回车）；筛选项要在面板里勾完点「确定」才生效，
 * 「重置」只清面板内的勾选、需再点「确定」才清掉已应用的筛选。
 */
export const SidebarSessionSearch: React.FC<SidebarSessionSearchProps> = ({
  query,
  onQueryChange,
  filter,
  onApplyFilter,
}) => {
  const [open, setOpen] = useState(false);
  const [draftStatuses, setDraftStatuses] = useState<SessionStatusFilter[]>([]);
  const [draftDate, setDraftDate] = useState<SessionDateFilter | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const close = () => setOpen(false);

  // 打开面板时把已生效的筛选回填成草稿：用户看到的是「当前生效的状态」，
  // 而不是一张空表。
  const toggleOpen = () => {
    if (!open) {
      setDraftStatuses(filter.statuses);
      setDraftDate(filter.date);
    }
    setOpen(!open);
  };

  useClickOutside({ refs: [rootRef], onClickOutside: close });
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const filterActive = isSessionFilterActive(filter);

  return (
    <div className="desktop-sidebar-search" ref={rootRef}>
      <div className="desktop-sidebar-search-field">
        <span className="desktop-sidebar-search-icon">
          <SearchIcon />
        </span>
        <input
          type="text"
          className="desktop-sidebar-search-input"
          data-testid="desktop-session-search"
          placeholder="搜索会话"
          aria-label="搜索会话"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            // 侧栏行上有裸键/行菜单快捷键：输入框里的按键不得冒泡出去。
            e.stopPropagation();
            if (e.key === "Escape") {
              e.preventDefault();
              if (query) onQueryChange("");
              else (e.currentTarget as HTMLInputElement).blur();
            }
          }}
        />
      </div>
      <Tooltip text="筛选" position="bottom">
        <button
          type="button"
          className={`desktop-sidebar-search-filter${filterActive ? " is-active" : ""}`}
          data-testid="desktop-session-filter-btn"
          aria-label="筛选"
          aria-haspopup="true"
          aria-expanded={open}
          aria-pressed={filterActive}
          onClick={toggleOpen}
        >
          <FilterIcon />
        </button>
      </Tooltip>
      {open && (
        <div
          className="desktop-session-filter-pop"
          data-testid="desktop-session-filter-pop"
          role="group"
          aria-label="筛选会话"
        >
          <div className="desktop-session-filter-title">会话状态</div>
          <div className="desktop-session-filter-opts">
            {SESSION_STATUS_OPTIONS.map((option) => {
              const checked = draftStatuses.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`desktop-session-filter-opt${checked ? " is-on" : ""}`}
                  data-testid={`desktop-session-filter-status-${option.value}`}
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() =>
                    setDraftStatuses((prev) =>
                      prev.includes(option.value)
                        ? prev.filter((v) => v !== option.value)
                        : [...prev, option.value],
                    )
                  }
                >
                  <span
                    className="desktop-session-filter-box"
                    aria-hidden="true"
                  />
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
          <div className="desktop-session-filter-title">创建日期</div>
          <div className="desktop-session-filter-opts">
            {SESSION_DATE_OPTIONS.map((option) => {
              const checked = draftDate === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`desktop-session-filter-opt${checked ? " is-on" : ""}`}
                  data-testid={`desktop-session-filter-date-${option.value}`}
                  role="radio"
                  aria-checked={checked}
                  onClick={() => setDraftDate(checked ? null : option.value)}
                >
                  <span
                    className="desktop-session-filter-box desktop-session-filter-box--dot"
                    aria-hidden="true"
                  />
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
          <div className="desktop-session-filter-actions">
            <button
              type="button"
              className="desktop-session-filter-btn desktop-session-filter-btn--ghost"
              data-testid="desktop-session-filter-reset"
              // 只清面板内的勾选：已生效的筛选要再点「确定」才清。
              onClick={() => {
                setDraftStatuses(EMPTY_SESSION_FILTER.statuses);
                setDraftDate(EMPTY_SESSION_FILTER.date);
              }}
            >
              重置
            </button>
            <button
              type="button"
              className="desktop-session-filter-btn desktop-session-filter-btn--primary"
              data-testid="desktop-session-filter-confirm"
              onClick={() => {
                onApplyFilter({ statuses: draftStatuses, date: draftDate });
                setOpen(false);
              }}
            >
              确定
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default SidebarSessionSearch;
