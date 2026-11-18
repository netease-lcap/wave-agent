import React, { useRef } from "react";
import { useRovingMenu } from "../utils/useRovingMenu";
import { useTruncation } from "../utils/useTruncation";
import { isDesktopHost } from "../utils/platform";
import { PermCaretIcon } from "./HeaderIcons";
import { GitBranchIcon } from "./QuickStartCategoryIcon";
import { Tooltip } from "./Tooltip";
import "../styles/DesktopApp.css";

export interface DesktopWorktreeControlsProps {
  branches: string[];
  /** Selected base branch. */
  branch: string;
  /** Whether the worktree checkbox is on. */
  worktreeChecked: boolean;
  /** Worktree creation is in flight — show "创建中" and disable the controls. */
  creating?: boolean;
  onBranchChange: (branch: string) => void;
  onWorktreeChange: (checked: boolean) => void;
}

/**
 * Branch selector + worktree checkbox shown next to the workdir selector on
 * the new-session page (FR-022/FR-023). Only rendered when the current workdir
 * is a git repo. Same dropdown pattern as DesktopWorkdirSelector: relative
 * container, menu expands upward, click-outside closes. Keyboard: roving
 * tabindex + Arrow keys via useRovingMenu; opening focuses the current branch.
 */
export const DesktopWorktreeControls: React.FC<
  DesktopWorktreeControlsProps
> = ({
  branches,
  branch,
  worktreeChecked,
  creating = false,
  onBranchChange,
  onWorktreeChange,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const menuListRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  // 分支名 hover 出全文气泡（设计师 2026-11-18：菜单宽度「要参考规范…超出的字符
  // 省略，hover 通过 tooltip 提示」，同轮答复「只在被省略时出」，并在第二轮把主机 /
  // 最近打开两条菜单一起点名要求补上 ⇒ 三处共用 utils/useTruncation）。
  // 只在桌面端挂 —— 插件端原生 `title` 本来就看得见，桌面端 webview 里看不到
  // （1029 评论「我这还是看不到，换成桌面端自绘的 Tooltip」），所以两端各用各的。
  const desktopHost = isDesktopHost();

  // Opening focuses the currently selected branch (permission-mode dropdown
  // precedent), so Enter re-confirms it and Arrow keys move from there.
  const selectedBranchIndex = Math.max(0, branches.indexOf(branch));

  const { open, openMenu, closeReturningFocus, getItemProps } = useRovingMenu(
    menuRef,
    {
      itemSelector: ".desktop-workdir-menu-item",
      itemCount: branches.length,
      triggerRef,
      closeOnActivate: true,
      onActivate: (i) => onBranchChange(branches[i]),
    },
  );

  const { register: registerName, truncated } = useTruncation(
    open && desktopHost,
    branches.join("\n"),
  );

  // 原生控件（语义 / 键盘 / 命中层），两个宿主共用同一份 JSX —— 桌面端只是把它
  // 视觉隐藏、由 `.desktop-worktree-check` 画框，插件端仍是它自己画。
  const checkbox = (
    <input
      type="checkbox"
      checked={worktreeChecked}
      disabled={creating}
      onChange={(e) => onWorktreeChange(e.target.checked)}
    />
  );

  return (
    <div
      className="desktop-worktree-controls"
      data-testid="desktop-worktree-controls"
    >
      <div className="desktop-workdir-container" ref={menuRef}>
        <div
          className="desktop-workdir-trigger"
          ref={triggerRef}
          onClick={() => {
            if (open) closeReturningFocus();
            else openMenu(selectedBranchIndex);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openMenu(selectedBranchIndex);
            } else if (e.key === "Escape" && open) {
              e.preventDefault();
              closeReturningFocus();
            }
          }}
          title={`基准分支：${branch}`}
          data-testid="desktop-branch-selector"
          aria-expanded={open}
          aria-haspopup="listbox"
          role="button"
          tabIndex={0}
        >
          <GitBranchIcon className="desktop-branch-icon" />
          <span className="desktop-workdir-name">{branch}</span>
          <PermCaretIcon className="desktop-workdir-caret" />
        </div>
        {open && (
          <div
            className="desktop-workdir-menu"
            role="listbox"
            ref={menuListRef}
            data-testid="desktop-branch-menu"
          >
            {branches.map((b, i) => {
              const label = (
                <span className="desktop-workdir-menu-path">
                  <span
                    className="desktop-workdir-menu-name"
                    ref={registerName(b)}
                  >
                    {b}
                  </span>
                </span>
              );
              // 被省略的那几条才包气泡（同一行其余的悬停事件不额外挂东西）。
              const showTip = truncated.includes(b);
              return (
                <div
                  key={b}
                  className={`desktop-workdir-menu-item${b === branch ? " desktop-branch-active" : ""}`}
                  role="option"
                  aria-selected={b === branch}
                  {...getItemProps(i)}
                  /* 桌面端改用自绘气泡，同一触发点不再留原生 title（原生提示在桌面
                     webview 里根本不显示）；插件端仍走原生 title，行为一行没变。 */
                  title={desktopHost ? undefined : b}
                  data-testid="desktop-branch-item"
                >
                  <GitBranchIcon className="desktop-branch-icon" />
                  {showTip ? (
                    <Tooltip
                      text={b}
                      position="right"
                      /* 水平锚点让给菜单外框：按名称节点自己的右缘算，气泡会压进
                         菜单右内衬 13px（1116 斜杠指令弹层同一个坑，设计师当时
                         的口径是「距下拉面板 4px 的右侧」）。 */
                      rightEdgeRef={menuListRef}
                      className="desktop-branch-name-tip"
                      /* 分支名是路径、没有空格：单行气泡（nowrap + max-width 250
                         + 省略号）会把要提示的全文又截一次。开 multiline 让它按
                         360 折行（`overflow-wrap: anywhere` 才断得开长串）。 */
                      multiline
                    >
                      {label}
                    </Tooltip>
                  ) : (
                    label
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <label
        className="desktop-worktree-checkbox"
        data-testid="desktop-worktree-checkbox"
      >
        {/* 勾选指示器：设计师 2026-11-18 点这颗标签「这个 checkbox 也按规范优化
            一下」⇒ 桌面端换成 skill `references/common-components.md` §Choice
            controls「Desktop Radio and Checkbox」那一套（可见盒 16×16 / 未选中
            1px 圆角方框 / 选中实心 action-primary + action-primary-text 勾）。
            原生 input 不删：它仍是语义与键盘的唯一来源，只是视觉隐藏成 16×16 的
            透明命中层压在指示器上（`.artifacts-table-check` 同一手法）。
            插件端的 choice 控件视觉归宿主（契约里写明），所以那边原样保留原生控件
            —— DOM 与改前逐节点相同。 */}
        {desktopHost ? (
          <span className="desktop-worktree-check-wrap">
            {checkbox}
            <span className="desktop-worktree-check" aria-hidden="true">
              <svg viewBox="0 0 16 16" fill="none">
                <path
                  d="M4 8 L6.75 10.75 L12 5.5"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </span>
        ) : (
          checkbox
        )}
        <span>worktree</span>
        {creating && (
          <span
            className="desktop-worktree-creating"
            data-testid="desktop-worktree-creating"
          >
            worktree 创建中…
          </span>
        )}
      </label>
    </div>
  );
};

export default DesktopWorktreeControls;
