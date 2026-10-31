import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { OpenFileTab } from "../types";
import { fileTabLabels } from "../utils/fileTabs";
import { baseNameOf } from "../utils/fileTreePaths";
import { CloseIcon, MoreIcon } from "./HeaderIcons";
import { CloseTabIcon } from "./CloseTabIcon";
import { createPortal } from "react-dom";
import { PanelKindIcon } from "./PanelKindIcon";
import { isDesktopHost } from "../utils/platform";
import { useClickOutside } from "../utils/useClickOutside";

export interface FileTabStripProps {
  files: OpenFileTab[];
  activeFileId?: string;
  /** 工作目录：把绝对路径折成相对路径，重名后缀与悬浮提示都用它。 */
  workdir?: string;
  /** Activate a file. Re-activating the active one re-reads it (scenario 12). */
  onActivate: (fileId: string) => void;
  onClose: (fileId: string) => void;
  onCloseOthers: (fileId: string) => void;
  onCloseRight: (fileId: string) => void;
  onCloseAll: () => void;
  /** Move a tab by delta (Ctrl+Shift+←/→, scenario 5). */
  onReorder: (fileId: string, delta: number) => void;
}

type MenuState = { fileId: string; x: number; y: number } | null;

/**
 * The file panel's own tab strip (spec desktop-file-panel.md「文件面板已打开文件
 * 的标签」). It sits *inside* the single first-level file tab, so panel-kind tabs
 * and open files never mix: the outer tab still reads 「文件」.
 *
 * Overflow is a two-step answer, in the order the spec asks for: the strip
 * scrolls horizontally (the newly opened tab is scrolled into view), and only
 * the tabs that stay out of view collect into the 「更多文件」 menu.
 */
export const FileTabStrip: React.FC<FileTabStripProps> = ({
  files,
  activeFileId,
  workdir,
  onActivate,
  onClose,
  onCloseOthers,
  onCloseRight,
  onCloseAll,
  onReorder,
}) => {
  const stripRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const [overflowing, setOverflowing] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  /** 「更多」菜单改为 portal + fixed：菜单住在带子里会被带子的 overflow:hidden
   *  裁掉（带高 39，菜单要往下伸 4px 以上），所以要把它挂到 body 上，用触发键的
   *  屏幕坐标定位。这里存 right（视口右缘到触发键右缘的距离）与 top（触发键底边
   *  + 4），菜单右缘与触发键右缘对齐、向上/向左展开。 */
  const [moreAnchor, setMoreAnchor] = useState<{
    top: number;
    right: number;
  } | null>(null);

  // 场景 4：正文永远是文件名，同名文件才在名字后面追加一段灰色小字 —— 能把彼此
  // 区分开的最短目录尾巴（`index.ts src` / `index.ts test`），而不是整条相对路径。
  // 目录部分因此不占标签宽度，区分点还紧贴名字，被 200px 上限截断时也先保住它。
  const labels = useMemo(
    () =>
      fileTabLabels(
        files.map((file) => file.path),
        workdir,
      ),
    [files, workdir],
  );

  // New tab (or switch) must be visible: scroll the active tab into range.
  useEffect(() => {
    if (!activeFileId || !stripRef.current) return;
    stripRef.current
      .querySelector<HTMLElement>(
        `[data-file-tab="${CSS.escape(activeFileId)}"]`,
      )
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeFileId, files.length]);

  // Horizontal scroll only wins while there is room to scroll; the menu is for
  // the rest. Measured rather than counted so it follows the panel's width.
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const measure = () => setOverflowing(el.scrollWidth > el.clientWidth + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [files.length]);

  const openMore = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    const list = Array.from(
      el.querySelectorAll<HTMLElement>("[data-file-tab]"),
    );
    const left = el.scrollLeft;
    const right = left + el.clientWidth;
    setHiddenIds(
      list
        .filter((node) => {
          const start = node.offsetLeft - el.offsetLeft;
          return start < left - 1 || start + node.offsetWidth > right + 1;
        })
        .map((node) => node.dataset.fileTab ?? ""),
    );
    const anchor = moreRef.current?.getBoundingClientRect();
    if (anchor) {
      setMoreAnchor({
        top: anchor.bottom + 4,
        right: Math.max(8, window.innerWidth - anchor.right),
      });
    }
    setMoreOpen(true);
  }, []);

  useClickOutside({
    refs: [moreRef, moreMenuRef],
    enabled: moreOpen,
    onClickOutside: () => setMoreOpen(false),
  });
  useClickOutside({
    refs: [menuRef],
    enabled: menu !== null,
    onClickOutside: () => setMenu(null),
  });

  const hiddenFiles = hiddenIds
    .map((id) => files.find((f) => f.id === id))
    .filter((f): f is OpenFileTab => !!f);

  const runMenuAction = useCallback(
    (action: (fileId: string) => void) => {
      if (!menu) return;
      const fileId = menu.fileId;
      setMenu(null);
      action(fileId);
    },
    [menu],
  );

  if (files.length === 0) return null;

  return (
    <div className="file-tab-strip" data-testid="file-tab-strip">
      <div
        className="file-tab-strip-scroll"
        ref={stripRef}
        role="tablist"
        aria-label="已打开的文件"
      >
        {files.map((file) => {
          const active = file.id === activeFileId;
          const label = labels.get(file.path);
          return (
            <div
              key={file.id}
              data-file-tab={file.id}
              data-testid="file-tab"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              className={`file-tab${active ? " file-tab--active" : ""}${file.deleted ? " file-tab--deleted" : ""}`}
              title={label?.relativePath ?? file.path}
              onClick={() => onActivate(file.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({
                  fileId: file.id,
                  x: event.clientX,
                  y: event.clientY,
                });
              }}
              onKeyDown={(event) => {
                if (event.key === "Delete" || event.key === "Backspace") {
                  event.preventDefault();
                  onClose(file.id);
                } else if (
                  event.key === "ArrowRight" &&
                  (event.ctrlKey || event.metaKey) &&
                  event.shiftKey
                ) {
                  event.preventDefault();
                  onReorder(file.id, 1);
                } else if (
                  event.key === "ArrowLeft" &&
                  (event.ctrlKey || event.metaKey) &&
                  event.shiftKey
                ) {
                  event.preventDefault();
                  onReorder(file.id, -1);
                }
              }}
            >
              {isDesktopHost() ? (
                // 桌面端与面板标签同一颗官方「文件」图标（PanelKindIcon kind="file"），
                // 1029 第十轮设计师评论「和这里保持一致」；插件端保留 codicon 字形。
                <PanelKindIcon
                  kind="file"
                  size={16}
                  className="file-tab-icon"
                />
              ) : (
                <i
                  className="codicon codicon-file file-tab-icon"
                  aria-hidden="true"
                />
              )}
              <span className="file-tab-name">
                {label?.name ?? baseNameOf(file.path)}
                {label?.suffix && (
                  <span className="file-tab-name-suffix">
                    {/* 逗号只给读屏：视觉上是并排的两段（名字 / 灰色后缀）。 */}
                    <span className="file-tab-name-sep">, </span>
                    {label.suffix}
                  </span>
                )}
              </span>
              {file.deleted && (
                <span className="file-tab-deleted-tag">已删除</span>
              )}
              <button
                type="button"
                className="file-tab-close"
                data-testid="file-tab-close"
                aria-label={`关闭 ${label?.name ?? baseNameOf(file.path)}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(file.id);
                }}
              >
                {isDesktopHost() ? (
                  // 1029 第五批设计师评论（点这颗图标）「关闭图标和以下保持一致」：
                  // 与面板页签关闭键同一颗官方 ×（CloseTabIcon，9×9）。插件端
                  // 保留 base 的 CloseIcon，与上面 .file-tab-icon 的分叉口径一致。
                  <CloseTabIcon className="file-tab-close-icon" />
                ) : (
                  <CloseIcon className="file-tab-close-icon" />
                )}
              </button>
            </div>
          );
        })}
      </div>
      {overflowing && (
        <div className="file-tab-more" ref={moreRef}>
          <button
            type="button"
            className={`file-tab-more-trigger${moreOpen ? " active" : ""}`}
            data-testid="file-tab-more"
            aria-expanded={moreOpen}
            aria-label="更多文件"
            onClick={moreOpen ? () => setMoreOpen(false) : openMore}
          >
            {isDesktopHost() ? (
              // 1029 第十七批设计师评论（点这颗「⋯」）「这个图标的样式和以下保持一致」，
              // 参照 = 侧栏会话行的更多按钮 `.desktop-session-more-btn`：同一颗官方
              // MoreIcon（16×16、三个 2px 圆点、点距 5），字色取同一档。插件端保留
              // base 的 codicon 字形（与旁边 `.file-tab-close-icon` 的分叉口径一致）。
              <MoreIcon className="file-tab-more-icon" />
            ) : (
              <i className="codicon codicon-ellipsis" aria-hidden="true" />
            )}
          </button>
          {moreOpen &&
            moreAnchor &&
            createPortal(
              <div
                ref={moreMenuRef}
                className="file-tab-more-menu"
                data-testid="file-tab-more-menu"
                role="menu"
                style={{
                  position: "fixed",
                  top: moreAnchor.top,
                  right: moreAnchor.right,
                }}
              >
                {hiddenFiles.length === 0 && (
                  <div className="file-tab-more-empty">没有收起的文件</div>
                )}
                {hiddenFiles.map((file) => {
                  const label = labels.get(file.path);
                  return (
                    <button
                      key={file.id}
                      type="button"
                      role="menuitem"
                      className="file-tab-more-item"
                      data-testid="file-tab-more-item"
                      title={label?.relativePath ?? file.path}
                      onClick={() => {
                        setMoreOpen(false);
                        onActivate(file.id);
                      }}
                    >
                      {/* 两排：名字 / 所在目录。菜单里不需要标签带那段最短后缀 ——
                          整条目录已经摆在第二排，再叠后缀就成了 `liblib`。 */}
                      <span className="file-tab-more-item-name">
                        {label?.name ?? baseNameOf(file.path)}
                      </span>
                      {label?.dir && (
                        <span className="file-tab-more-item-dir">
                          {label.dir}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>,
              document.body,
            )}
        </div>
      )}
      {menu && (
        <div
          ref={menuRef}
          className="file-tab-menu"
          data-testid="file-tab-menu"
          role="menu"
          style={{ top: menu.y, left: menu.x }}
        >
          {[
            ["关闭", onClose],
            ["关闭其他", onCloseOthers],
            ["关闭右侧", onCloseRight],
            ["全部关闭", onCloseAll],
          ].map(([label, action]) => (
            <button
              key={label as string}
              type="button"
              role="menuitem"
              className="file-tab-menu-item"
              data-testid="file-tab-menu-item"
              onClick={() => runMenuAction(action as (fileId: string) => void)}
            >
              {label as string}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default FileTabStrip;
