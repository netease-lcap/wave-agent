import React, { useState, useRef, useEffect, useCallback } from "react";
import { useRovingMenu } from "../utils/useRovingMenu";
import "../styles/DesktopApp.css";

export interface DesktopHostSelectorProps {
  /** Current host: 'local' or an SSH host name (the focused pane's host). */
  host: string;
  /** Selectable SSH hosts parsed from ~/.ssh/config ('local' is always listed). */
  hosts: string[];
  /** Switch the focused pane's host. */
  onSelectHost: (host: string) => void;
  /** Add a host from an `ssh user@hostname -p port` connection string (VSC-style). */
  onAddHost: (connectionString: string) => void;
}

/**
 * Host dropdown at the top-left of the message input (desktop host, new-session
 * state only), sitting left of the workdir selector (spec docs/specs/ui/desktop-app.md
 * 「SSH 远程主机」). Lists 本地 + SSH hosts parsed from ~/.ssh/config, plus
 * 添加主机… which expands into an inline connection-string input. The host
 * switch itself is handled by the main process (desktopSelectHost); adding a
 * host writes the config there and auto-selects the new host.
 *
 * Same dropdown pattern as DesktopWorkdirSelector: relative container, trigger,
 * absolutely-positioned menu expanding UPWARD (bottom:100%) — the input sits at
 * the bottom of the viewport and a native <select> popup would be clipped.
 * Keyboard model shared too: roving tabindex + Arrow keys via useRovingMenu.
 */
export const DesktopHostSelector: React.FC<DesktopHostSelectorProps> = ({
  host,
  hosts,
  onSelectHost,
  onAddHost,
}) => {
  const [adding, setAdding] = useState(false);
  const [connectionString, setConnectionString] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  // Selectable SSH host entries; some mount paths render before the host
  // list arrives (undefined), so default here rather than only in the menu.
  const sshHosts = hosts ?? [];

  // 添加主机… expands inline with the menu staying open — selection branches
  // close explicitly (closeOnActivate stays off).
  const { open, openMenu, closeReturningFocus, getItemProps } = useRovingMenu(
    menuRef,
    {
      itemSelector: ".desktop-workdir-menu-item",
      itemCount: sshHosts.length + (adding ? 1 : 2),
      triggerRef,
      closeOnActivate: false,
      onActivate: (i) => {
        if (i === 0) selectHost("local");
        else if (i <= sshHosts.length) selectHost(sshHosts[i - 1]);
        else openAdd();
      },
    },
  );

  const selectHost = useCallback(
    (h: string) => {
      setAdding(false);
      if (h !== host) onSelectHost(h);
      closeReturningFocus();
    },
    [host, onSelectHost, closeReturningFocus],
  );

  const openAdd = useCallback(() => {
    setAdding(true);
    setConnectionString("");
    // The input renders only when `adding` flips true; focus after the menu
    // has been committed to the DOM.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const submitAdd = useCallback(() => {
    const s = connectionString.trim();
    if (!s) return;
    setAdding(false);
    setConnectionString("");
    onAddHost(s);
    closeReturningFocus();
  }, [connectionString, onAddHost, closeReturningFocus]);

  // Leaving the menu (any close path, including click-outside in the hook)
  // also collapses an in-progress add-host input.
  useEffect(() => {
    if (!open && adding) setAdding(false);
  }, [open, adding]);

  const isLocal = host === "local";

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
        title={isLocal ? "本地" : host}
        data-testid="desktop-host"
        aria-expanded={open}
        aria-haspopup="listbox"
        role="button"
        tabIndex={0}
      >
        <span
          className={`codicon ${isLocal ? "codicon-device-desktop" : "codicon-remote"}`}
        ></span>
        <span className="desktop-host-name">{isLocal ? "本地" : host}</span>
        <span className="codicon codicon-chevron-down desktop-host-caret"></span>
      </div>
      {open && (
        <div
          className="desktop-workdir-menu"
          role="listbox"
          data-testid="desktop-host-menu"
        >
          <div
            className="desktop-workdir-menu-item"
            role="option"
            aria-selected={isLocal}
            {...getItemProps(0)}
            data-testid="desktop-host-local"
          >
            <span className="codicon codicon-device-desktop"></span>
            <span>本地</span>
          </div>
          {sshHosts.length > 0 && (
            <div className="desktop-workdir-menu-label">SSH 主机</div>
          )}
          {sshHosts.map((h, i) => (
            <div
              key={h}
              className="desktop-workdir-menu-item"
              role="option"
              aria-selected={h === host}
              {...getItemProps(i + 1)}
              title={h}
              data-testid="desktop-host-item"
            >
              <span className="codicon codicon-remote"></span>
              <span className="desktop-workdir-menu-name">{h}</span>
            </div>
          ))}
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
              {...getItemProps(sshHosts.length + 1)}
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
