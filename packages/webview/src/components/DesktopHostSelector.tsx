import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useLayoutEffect,
  useMemo,
} from "react";
import { useRovingMenu } from "../utils/useRovingMenu";
import { ContextLocalIcon, PermCaretIcon } from "./HeaderIcons";
import { DesktopSshConnectionDialog } from "./DesktopSshConnectionDialog";
import type {
  DesktopHostOption,
  DesktopSshConnection,
  DesktopSshConnectionInput,
} from "../types";
import "../styles/DesktopApp.css";

export interface DesktopHostSelectorProps {
  /** Current host id: 'local', a saved SSH connection id, or `wsl:<distro>` (the focused pane's host). */
  host: string;
  /** Selectable SSH host ids (the saved connections' ids; 'local' is always listed). */
  hosts: string[];
  /**
   * Host-owned option list (order, labels, groups, disabled flags). When absent
   * (old host) the menu falls back to 本地 + the `hosts` list.
   */
  hostOptions?: DesktopHostOption[];
  /** 连接库条目：编辑弹窗要回填名称/主机/端口/私钥；缺省 = 旧宿主，只能选不能编辑。 */
  sshConnections?: DesktopSshConnection[];
  /** Display name of the current host, when the host supplies one. */
  hostLabel?: string;
  /** Switch the focused pane's host. */
  onSelectHost: (host: string) => void;
  /** 保存一条 SSH 连接（新建/编辑），宿主回 `desktopSshConnectionResult`。 */
  onSaveSshConnection: (
    input: DesktopSshConnectionInput,
    requestId: string,
  ) => void;
  /** 删除一条 SSH 连接，宿主回同一条响应。 */
  onDeleteSshConnection: (id: string, requestId: string) => void;
}

/** Group header text per host kind; `local` never gets a header. */
const GROUP_LABEL: Record<"ssh" | "wsl", string> = {
  wsl: "WSL 发行版",
  ssh: "SSH 主机",
};

type MenuRow =
  | { kind: "header"; label: string }
  | { kind: "option"; option: DesktopHostOption; itemIndex: number };

/** Option rows only — what the menu splits its groups into. */
type OptionRow = Extract<MenuRow, { kind: "option" }>;

/** One menu group: a fixed header label (null for 本地) plus its scrollable items. */
interface MenuBlock {
  label: string | null;
  rows: OptionRow[];
}

/**
 * Split the height left over for the group lists (spec 场景 26). Every group
 * starts at its natural height; the overflow is taken from the LONGEST group
 * first, so a 4-row WSL 发行版 group keeps every row while the 80-host SSH 主机
 * group is the one that scrolls. The equal share (`available / groups`) is the
 * stop line — with several over-long groups nobody is squeezed out of sight.
 *
 * (`flex-shrink: 1` on the groups would do the opposite: it shrinks in
 * proportion to content height, i.e. it crushes the small group to a few pixels.)
 */
const fairShareHeights = (naturals: number[], available: number): number[] => {
  const caps = naturals.slice();
  let deficit = caps.reduce((sum, natural) => sum + natural, 0) - available;
  if (deficit <= 0) return caps;
  const floor = Math.max(0, Math.floor(available / caps.length));
  const byNaturalDesc = caps
    .map((natural, index) => ({ natural, index }))
    .sort((a, b) => b.natural - a.natural);
  for (const { index } of byNaturalDesc) {
    if (deficit <= 0) break;
    const cut = Math.min(caps[index] - floor, deficit);
    if (cut <= 0) continue;
    caps[index] -= cut;
    deficit -= cut;
  }
  // 多组同时超长、连均分额都放不下：剩下的缺口均摊（每组仍 ≥ 0）。
  if (deficit > 0) {
    const each = Math.ceil(deficit / caps.length);
    for (let i = 0; i < caps.length; i += 1) {
      caps[i] = Math.max(0, caps[i] - each);
    }
  }
  return caps;
};

/**
 * Host dropdown at the top-left of the message input (desktop host, new-session
 * state only), sitting left of the workdir selector (spec docs/specs/desktop/desktop-remote.md
 * 「SSH 远程主机」, docs/specs/desktop/desktop-wsl.md「WSL 发行版主机」).
 *
 * The entries, their order, their labels and their disabled flags all come from
 * the host as `hostOptions` — this component groups consecutive entries by
 * `kind` and never parses a host id (WSL ids are `wsl:<distro>`). Without that
 * list (old host) it degrades to 本地 + the `hosts` array. 添加主机… opens the
 * connection form (`DesktopSshConnectionDialog`), and each SSH row exposes an
 * edit affordance that reopens the same form on that entry — saving stores the
 * entry in the app's own connection library and never touches the user's
 * `~/.ssh/config` (spec scenario 5).
 *
 * Same dropdown pattern as DesktopWorkdirSelector: relative container, trigger,
 * absolutely-positioned menu expanding UPWARD (bottom:100%) — the input sits at
 * the bottom of the viewport and a native <select> popup would be clipped.
 * Keyboard model shared too: roving tabindex + Arrow keys via useRovingMenu.
 */
export const DesktopHostSelector: React.FC<DesktopHostSelectorProps> = ({
  host,
  hosts,
  hostOptions,
  sshConnections,
  hostLabel,
  onSelectHost,
  onSaveSshConnection,
  onDeleteSshConnection,
}) => {
  /**
   * 连接弹窗：`{}` = 新建，`{ id }` = 编辑该条目。弹窗自己发请求并等
   * `desktopSshConnectionResult`（requestId 精确配对），保存成功即关闭——
   * 列表随宿主推下来的 `desktopWorkdirState` 更新。
   */
  const [editing, setEditing] = useState<{ id?: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  // Selectable entries. Some mount paths render before the host list arrives
  // (undefined), so default here rather than only in the menu.
  const options: DesktopHostOption[] = useMemo(() => {
    if (hostOptions && hostOptions.length > 0) return hostOptions;
    const fallback: DesktopHostOption[] = [
      { id: "local", label: "本地", kind: "local" },
    ];
    for (const h of hosts ?? []) {
      fallback.push({ id: h, label: h, kind: "ssh" });
    }
    return fallback;
  }, [hostOptions, hosts]);

  /** Menu rows: a header before each non-local group, options in host order. */
  const rows = useMemo(() => {
    const out: MenuRow[] = [];
    let lastKind: DesktopHostOption["kind"] | null = null;
    let itemIndex = 0;
    for (const option of options) {
      if (option.kind !== "local" && option.kind !== lastKind) {
        out.push({ kind: "header", label: GROUP_LABEL[option.kind] });
      }
      lastKind = option.kind;
      out.push({ kind: "option", option, itemIndex });
      itemIndex += 1;
    }
    return out;
  }, [options]);

  const selectHost = useCallback(
    (id: string) => {
      setEditing(null);
      if (id !== host) onSelectHost(id);
    },
    [host, onSelectHost],
  );

  // 添加入口是菜单最后一行（itemIndex === options.length）：点它开连接表单，
  // 表单是模态，菜单同时收起。
  const addItemIndex = options.length;

  // 添加主机… 打开模态表单 — selection branches close explicitly
  // (closeOnActivate stays off).
  const { open, openMenu, closeReturningFocus, getItemProps } = useRovingMenu(
    menuRef,
    {
      itemSelector: ".desktop-workdir-menu-item",
      itemCount: options.length + 1,
      triggerRef,
      closeOnActivate: false,
      onActivate: (i) => {
        if (i === addItemIndex) {
          setEditing({});
          closeReturningFocus();
          return;
        }
        const option = options[i];
        // Disabled entries (WSL 1 distros) keep their slot so the roving
        // indices stay aligned with the DOM, but activating them does nothing.
        if (!option || option.disabled) return;
        selectHost(option.id);
        closeReturningFocus();
      },
    },
  );

  const openEdit = useCallback(
    (id: string) => {
      setEditing({ id });
      closeReturningFocus();
    },
    [closeReturningFocus],
  );

  /** 弹窗要编辑的那条：id 找不到（刚被删掉）就当成新建。 */
  const editingConnection = editing?.id
    ? sshConnections?.find((connection) => connection.id === editing.id)
    : undefined;

  const isLocal = host === "local";
  const current = options.find((o) => o.id === host);
  const triggerText = isLocal ? "本地" : (hostLabel ?? current?.label ?? host);

  // 菜单切成「本地」+「每个主机分组」若干块：块里的**分组标题固定**，只有组内
  // 的具体主机条目滚动（规格 scene 26：上百台主机时用户滚到哪儿都还看得见
  // 「本地」和「SSH 主机」这类标题，也不必滚到底才找得到「添加主机…」）。
  // 只钉排在第一位的「本地」：useRovingMenu 用 querySelectorAll(itemSelector)
  // [index] 定位条目，DOM 顺序必须与 itemIndex 一致，把非首项挪到最前会让方向
  // 键落到错的条目上（宿主给的顺序本来就是「本地」在最前）。
  const blocks = useMemo(() => {
    const out: MenuBlock[] = [];
    for (const row of rows) {
      if (row.kind === "header") out.push({ label: row.label, rows: [] });
      else if (out.length === 0) out.push({ label: null, rows: [row] });
      else out[out.length - 1].rows.push(row);
    }
    return out;
  }, [rows]);
  const pinnedBlock = blocks[0]?.label === null ? blocks[0] : null;
  const scrollBlocks = pinnedBlock ? blocks.slice(1) : blocks;

  // 每个分组条目区的高度上限，按上面 fairShareHeights 算（与 scrollBlocks 同序）。
  // 只有一组时留空，交给 flex 自己分配。
  const [itemCaps, setItemCaps] = useState<number[]>([]);
  // 窗口尺寸变了上限也跟着变（.desktop-host-menu 是 min(340px, 40vh)）。
  const [resizeTick, setResizeTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const onResize = () => setResizeTick((tick) => tick + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setItemCaps((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const menu =
      menuRef.current?.querySelector<HTMLElement>(".desktop-host-menu");
    if (!menu) return;
    const lists = Array.from(
      menu.querySelectorAll<HTMLElement>(".desktop-host-menu-items"),
    );
    // 单组（只有 SSH 主机，或只有 WSL 发行版）：flex 的 1 1 auto 就够，不必量。
    if (lists.length < 2) {
      setItemCaps((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const style = getComputedStyle(menu);
    const padding =
      parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    // 用计算出来的 max-height 而不是 clientHeight：后者会被上一次分配的上限
    // 反噬（量出来正好等于当前内容高），窗口尺寸变化后重算就会越算越小。菜单是
    // content-box，max-height 已经不含内边距；border-box 时才需要再扣。
    const cap = parseFloat(style.maxHeight);
    const border =
      parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    const inner =
      style.boxSizing === "border-box" ? cap - padding - border : cap;
    // 菜单里除「分组条目区」以外的固定件：本地行、分组标题、分隔线、添加入口
    // （展开后是输入行）。它们都不参与分配，先扣掉。
    let chrome = 0;
    for (const child of Array.from(menu.children)) {
      if (child.classList.contains("desktop-host-menu-group")) {
        const label = child.querySelector(":scope > .desktop-host-menu-label");
        chrome += label instanceof HTMLElement ? label.offsetHeight : 0;
      } else {
        chrome += (child as HTMLElement).offsetHeight;
      }
    }
    // scrollHeight 是各组的自然高度（与当前被压成多少无关）。
    const available = inner - chrome;
    // 还没量到高度时（首帧、菜单隐在触发层下方未布局），别把上限算成 0
    // 把条目压没。
    if (!(available > 0)) {
      setItemCaps((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const caps = fairShareHeights(
      lists.map((list) => list.scrollHeight),
      available,
    );
    setItemCaps((prev) =>
      prev.length === caps.length && prev.every((v, i) => v === caps[i])
        ? prev
        : caps,
    );
  }, [open, scrollBlocks, resizeTick]);

  const renderOption = (row: OptionRow) => (
    <div
      key={row.option.id}
      className={`desktop-workdir-menu-item${
        row.option.disabled ? " desktop-workdir-menu-item-disabled" : ""
      }`}
      role="option"
      aria-selected={row.option.id === host}
      aria-disabled={row.option.disabled ? true : undefined}
      {...getItemProps(row.itemIndex)}
      title={row.option.disabled ? row.option.hint : row.option.label}
      data-testid={
        row.option.kind === "local" ? "desktop-host-local" : "desktop-host-item"
      }
      data-host-id={row.option.id}
      data-host-kind={row.option.kind}
    >
      {/* 只有「本地」那一行带图标（与触发键同款，见下）；具体主机名不再各带一颗
          ——远程图标挪到分组标题「SSH 主机」前面，标题行和「本地」行一样是
          「一颗图标 + 文字」，主机名缩进到与标题文字对齐。 */}
      {row.option.kind === "local" && (
        // 1030 评论（她点 `span.codicon.codicon-device-desktop`，指「这里」
        // 为触发键上那颗 `svg.desktop-host-icon`）：「这个图标和一下一致」——
        // 菜单里「本地」原来画 codicon-device-desktop 字体字形，与收起态触发键
        // 的官方 `ContextLocalIcon` 不是一套；这里换成同一颗 svg（同一个
        // `desktop-host-icon` 类 → 同 16×16 盒、同色、同几何）。
        <ContextLocalIcon className="desktop-host-icon" />
      )}
      <span className="desktop-workdir-menu-name">{row.option.label}</span>
      {row.option.disabled && row.option.hint && (
        <span className="desktop-host-item-hint">{row.option.hint}</span>
      )}
      {/* 编辑入口：SSH 条目才有（本地/WSL 不是连接库里的东西）。常驻但默认透明，
          指针停到这一行、或键盘焦点进到这一行/这颗按钮上才显形——与行内 ✕ 同一
          套显隐规则；点击不能冒泡成「选中该主机」。 */}
      {row.option.kind === "ssh" && (
        <button
          type="button"
          className="desktop-host-item-edit"
          data-testid="desktop-host-edit"
          aria-label={`编辑连接 ${row.option.label}`}
          title="编辑连接"
          onClick={(e) => {
            e.stopPropagation();
            openEdit(row.option.id);
          }}
        >
          <span className="codicon codicon-edit"></span>
        </button>
      )}
    </div>
  );

  return (
    <div className="desktop-host-container" ref={menuRef}>
      <div
        className="desktop-host-trigger"
        ref={triggerRef}
        onClick={() => {
          if (open) closeReturningFocus();
          else openMenu();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openMenu();
          } else if (e.key === "Escape" && open) {
            e.preventDefault();
            closeReturningFocus();
          }
        }}
        title={triggerText}
        data-testid="desktop-host"
        aria-expanded={open}
        aria-haspopup="listbox"
        role="button"
        tabIndex={0}
      >
        <ContextLocalIcon className="desktop-host-icon" />
        <span className="desktop-host-name">{triggerText}</span>
        <PermCaretIcon className="desktop-host-caret" />
      </div>
      {open && (
        <div
          className="desktop-workdir-menu desktop-host-menu"
          role="listbox"
          data-testid="desktop-host-menu"
        >
          {/* 菜单四段：顶部「本地」、每个分组的分组标题（如「SSH 主机」）与
              底部「添加主机…」都固定，只有分组内的具体主机条目滚动。上百台
              主机时本地/标题/添加入口都常驻（规格 scene 26）。 */}
          {pinnedBlock && (
            <div className="desktop-host-menu-pinned">
              {pinnedBlock.rows.map(renderOption)}
              {scrollBlocks.length > 0 && (
                <div className="desktop-workdir-menu-separator" />
              )}
            </div>
          )}
          {scrollBlocks.map((block, index) => (
            <div
              className={`desktop-host-menu-group${
                itemCaps[index] === undefined
                  ? ""
                  : " desktop-host-menu-group-capped"
              }`}
              key={block.label ?? "ungrouped"}
            >
              {block.label && (
                <div className="desktop-workdir-menu-label desktop-host-menu-label">
                  {/* 远程图标跟着分组标题走（原来每台主机前面各一颗）：这样
                      「SSH 主机」标题行与「本地」行都是「一颗图标 + 文字」。 */}
                  <span className="codicon codicon-remote"></span>
                  {block.label}
                </div>
              )}
              <div
                className="desktop-host-menu-items"
                // 多组时按组分配高度（上面的 useLayoutEffect）：够用的组保持自然
                // 高度，吃不下的那组才滚动，短的一组不会被长的顶没。
                style={
                  itemCaps[index] === undefined
                    ? undefined
                    : { maxHeight: itemCaps[index] }
                }
              >
                {block.rows.map(renderOption)}
              </div>
            </div>
          ))}
          <div className="desktop-workdir-menu-separator" />
          <div
            className="desktop-workdir-menu-item"
            role="option"
            aria-selected={false}
            {...getItemProps(addItemIndex)}
            data-testid="desktop-host-add-entry"
          >
            <span className="codicon codicon-add"></span>
            <span>添加主机…</span>
          </div>
        </div>
      )}
      {editing && (
        <DesktopSshConnectionDialog
          // 每条条目一个独立弹窗实例：切换编辑对象时表单必须以新条目重新初始化。
          key={editing.id ?? "new"}
          connection={editingConnection}
          connections={sshConnections ?? []}
          onSave={onSaveSshConnection}
          onDelete={onDeleteSshConnection}
          onCancel={() => setEditing(null)}
        />
      )}
    </div>
  );
};

export default DesktopHostSelector;
