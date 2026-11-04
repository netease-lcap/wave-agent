import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import { useRovingMenu } from "../utils/useRovingMenu";
import { ContextLocalIcon, PermCaretIcon } from "./HeaderIcons";
import type { DesktopHostOption } from "../types";
import "../styles/DesktopApp.css";

export interface DesktopHostSelectorProps {
  /** Current host id: 'local', an SSH host name, or `wsl:<distro>` (the focused pane's host). */
  host: string;
  /** Selectable SSH hosts parsed from ~/.ssh/config ('local' is always listed). */
  hosts: string[];
  /**
   * Host-owned option list (order, labels, groups, disabled flags). When absent
   * (old host) the menu falls back to 本地 + the `hosts` list.
   */
  hostOptions?: DesktopHostOption[];
  /** Display name of the current host, when the host supplies one. */
  hostLabel?: string;
  /** Switch the focused pane's host. */
  onSelectHost: (host: string) => void;
  /** Add a host from an `ssh user@hostname -p port` connection string (VSC-style). */
  onAddHost: (connectionString: string) => void;
}

/** Group header text per host kind; `local` never gets a header. */
const GROUP_LABEL: Record<"ssh" | "wsl", string> = {
  wsl: "WSL 发行版",
  ssh: "SSH 主机",
};

type MenuRow =
  | { kind: "header"; label: string }
  | { kind: "option"; option: DesktopHostOption; itemIndex: number };

/**
 * Host dropdown at the top-left of the message input (desktop host, new-session
 * state only), sitting left of the workdir selector (spec docs/specs/desktop/desktop-remote.md
 * 「SSH 远程主机」, docs/specs/desktop/desktop-wsl.md「WSL 发行版主机」).
 *
 * The entries, their order, their labels and their disabled flags all come from
 * the host as `hostOptions` — this component groups consecutive entries by
 * `kind` and never parses a host id (WSL ids are `wsl:<distro>`). Without that
 * list (old host) it degrades to 本地 + the `hosts` array. 添加主机… expands
 * into an inline connection-string input; adding a host writes ~/.ssh/config in
 * the main process and auto-selects the new host.
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
  hostLabel,
  onSelectHost,
  onAddHost,
}) => {
  const [adding, setAdding] = useState(false);
  const [connectionString, setConnectionString] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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
      setAdding(false);
      if (id !== host) onSelectHost(id);
    },
    [host, onSelectHost],
  );

  const openAdd = useCallback(() => {
    setAdding(true);
    setConnectionString("");
    // The input renders only when `adding` flips true; focus after the menu has
    // been committed to the DOM.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // The add-host entry lives at itemIndex === options.length and is only a menu
  // item while the input is collapsed (when expanded it is replaced by the
  // input, which takes focus directly).
  const addItemIndex = options.length;

  // 添加主机… expands inline with the menu staying open — selection branches
  // close explicitly (closeOnActivate stays off).
  const { open, openMenu, closeReturningFocus, getItemProps } = useRovingMenu(
    menuRef,
    {
      itemSelector: ".desktop-workdir-menu-item",
      itemCount: options.length + (adding ? 0 : 1),
      triggerRef,
      closeOnActivate: false,
      onActivate: (i) => {
        if (i === addItemIndex) {
          openAdd();
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

  const submitAdd = useCallback(() => {
    const s = connectionString.trim();
    if (!s) return;
    setAdding(false);
    setConnectionString("");
    onAddHost(s);
    closeReturningFocus();
  }, [connectionString, onAddHost, closeReturningFocus]);

  // Leaving the menu (any close path, including click-outside in the hook) also
  // collapses an in-progress add-host input.
  useEffect(() => {
    if (!open && adding) setAdding(false);
  }, [open, adding]);

  const isLocal = host === "local";
  const current = options.find((o) => o.id === host);
  const triggerText = isLocal ? "本地" : (hostLabel ?? current?.label ?? host);

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
          className="desktop-workdir-menu"
          role="listbox"
          data-testid="desktop-host-menu"
        >
          {rows.map((row) =>
            row.kind === "header" ? (
              <div
                key={`group-${row.label}`}
                className="desktop-workdir-menu-label"
              >
                {row.label}
              </div>
            ) : (
              <div
                key={row.option.id}
                className={`desktop-workdir-menu-item${
                  row.option.disabled
                    ? " desktop-workdir-menu-item-disabled"
                    : ""
                }`}
                role="option"
                aria-selected={row.option.id === host}
                aria-disabled={row.option.disabled ? true : undefined}
                {...getItemProps(row.itemIndex)}
                title={row.option.disabled ? row.option.hint : row.option.label}
                data-testid={
                  row.option.kind === "local"
                    ? "desktop-host-local"
                    : "desktop-host-item"
                }
                data-host-id={row.option.id}
                data-host-kind={row.option.kind}
              >
                {row.option.kind === "local" ? (
                  // 1030 评论（她点 `span.codicon.codicon-device-desktop`，指「这里」
                  // 为触发键上那颗 `svg.desktop-host-icon`）：「这个图标和一下一致」——
                  // 菜单里「本地」原来画 codicon-device-desktop 字体字形，与收起态触发键
                  // 的官方 `ContextLocalIcon` 不是一套；这里换成同一颗 svg（同一个
                  // `desktop-host-icon` 类 → 同 16×16 盒、同色、同几何）。
                  <ContextLocalIcon className="desktop-host-icon" />
                ) : (
                  <span className="codicon codicon-remote"></span>
                )}
                <span className="desktop-workdir-menu-name">
                  {row.option.label}
                </span>
                {row.option.disabled && row.option.hint && (
                  <span className="desktop-host-item-hint">
                    {row.option.hint}
                  </span>
                )}
              </div>
            ),
          )}
          <div className="desktop-workdir-menu-separator" />
          {adding ? (
            <div className="desktop-host-add" data-testid="desktop-host-add">
              <input
                ref={inputRef}
                className="desktop-host-add-input"
                placeholder="ssh user@hostname -p port"
                value={connectionString}
                onChange={(e) => setConnectionString(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitAdd();
                  else if (e.key === "Escape") {
                    setAdding(false);
                    closeReturningFocus();
                  }
                }}
              />
            </div>
          ) : (
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
          )}
        </div>
      )}
    </div>
  );
};

export default DesktopHostSelector;
