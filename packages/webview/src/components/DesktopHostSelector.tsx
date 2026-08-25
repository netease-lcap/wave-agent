import React, { useState, useRef, useEffect, useCallback } from "react";
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
 */
export const DesktopHostSelector: React.FC<DesktopHostSelectorProps> = ({
  host,
  hosts,
  onSelectHost,
  onAddHost,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [connectionString, setConnectionString] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  // Close the dropdown when clicking outside of it.
  useEffect(() => {
    if (!menuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setAdding(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [menuOpen]);

  const handleSelect = useCallback(
    (h: string) => {
      setMenuOpen(false);
      setAdding(false);
      if (h !== host) onSelectHost(h);
      triggerRef.current?.focus();
    },
    [host, onSelectHost],
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
    setMenuOpen(false);
    setAdding(false);
    setConnectionString("");
    onAddHost(s);
    triggerRef.current?.focus();
  }, [connectionString, onAddHost]);

  const isLocal = host === "local";

  return (
    <div className="desktop-host-container" ref={menuRef}>
      <div
        className="desktop-host-trigger"
        ref={triggerRef}
        onClick={() => setMenuOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setMenuOpen((o) => !o);
          } else if (e.key === "Escape" && menuOpen) {
            e.preventDefault();
            setMenuOpen(false);
          }
        }}
        title={isLocal ? "本地" : host}
        data-testid="desktop-host"
        aria-expanded={menuOpen}
        aria-haspopup="listbox"
        role="button"
        tabIndex={0}
      >
        <span
          className={`codicon ${isLocal ? "codicon-laptop" : "codicon-remote"}`}
        ></span>
        <span className="desktop-host-name">{isLocal ? "本地" : host}</span>
        <span className="codicon codicon-chevron-down desktop-host-caret"></span>
      </div>
      {menuOpen && (
        <div
          className="desktop-workdir-menu"
          role="listbox"
          data-testid="desktop-host-menu"
        >
          <div
            className="desktop-workdir-menu-item"
            role="option"
            tabIndex={0}
            onClick={() => handleSelect("local")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleSelect("local");
              } else if (e.key === "Escape") {
                e.preventDefault();
                setMenuOpen(false);
                setAdding(false);
                triggerRef.current?.focus();
              }
            }}
            data-testid="desktop-host-local"
          >
            <span className="codicon codicon-laptop"></span>
            <span>本地</span>
          </div>
          {hosts.length > 0 && (
            <div className="desktop-workdir-menu-label">SSH 主机</div>
          )}
          {hosts.map((h) => (
            <div
              key={h}
              className="desktop-workdir-menu-item"
              role="option"
              tabIndex={0}
              onClick={() => handleSelect(h)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleSelect(h);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setMenuOpen(false);
                  setAdding(false);
                  triggerRef.current?.focus();
                }
              }}
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
                    triggerRef.current?.focus();
                  }
                }}
              />
            </div>
          ) : (
            <div
              className="desktop-workdir-menu-item"
              role="option"
              tabIndex={0}
              onClick={openAdd}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openAdd();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setMenuOpen(false);
                  setAdding(false);
                  triggerRef.current?.focus();
                }
              }}
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
