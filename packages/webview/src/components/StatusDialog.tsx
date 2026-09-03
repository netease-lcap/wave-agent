/**
 * StatusDialog - Status info dialog
 *
 * Opened via the /status slash command. Shows read-only status:
 * version, session ID, working directory.
 */

import React, { useState, useEffect, useRef } from "react";
import { useClickOutside } from "../utils/useClickOutside";
import { StatusDialogProps } from "../types";
import "../styles/ConfigurationDialog.css";

const StatusDialog: React.FC<
  StatusDialogProps & {
    vscode: { postMessage: (msg: unknown) => void };
    isDesktop: boolean;
  }
> = ({ onClose, vscode, isDesktop }) => {
  const [version, setVersion] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [workdir, setWorkdir] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    vscode?.postMessage({ command: "getStatus" });
  }, [vscode]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      switch (message.command) {
        case "statusResponse":
          setVersion(message.version || "");
          setSessionId(message.sessionId || "");
          setWorkdir(message.workdir || "");
          break;
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Click-outside close (listener registered one tick later inside the hook,
  // so the click that opened this dialog doesn't immediately close it).
  useClickOutside({
    refs: [dialogRef],
    onClickOutside: onClose,
  });

  useEffect(() => {
    // Escape closes only the dialog. A capture-phase listener with
    // stopPropagation runs before React's synthetic onKeyDown (attached at the
    // root container), so the keypress never reaches MessageInput's
    // onAbortMessage and the in-flight agent loop keeps running.
    const handleEscapeKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handleEscapeKey, true);
    return () => document.removeEventListener("keydown", handleEscapeKey, true);
  }, [onClose]);

  const StatusRow = ({ label, value }: { label: string; value?: string }) => (
    <div className="configuration-field">
      <label>{label}:</label>
      <div
        style={{
          fontSize: "13px",
          color: "var(--vscode-descriptionForeground)",
          fontFamily: "var(--vscode-editor-font-family, monospace)",
          wordBreak: "break-all",
          padding: "4px 0",
        }}
      >
        {value || "—"}
      </div>
    </div>
  );

  return (
    <div className="configuration-dialog-overlay">
      <div
        ref={dialogRef}
        className="configuration-dialog"
        data-testid="status-dialog"
        style={{ height: "auto", maxHeight: "500px" }}
      >
        <div className="configuration-dialog-header">
          <h3>状态信息</h3>
        </div>

        <div className="configuration-form">
          <div className="configuration-fields-scroll-area">
            <div className="configuration-field">
              <label>版本:</label>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "13px",
                  color: "var(--vscode-descriptionForeground)",
                  fontFamily: "var(--vscode-editor-font-family, monospace)",
                  wordBreak: "break-all",
                  padding: "4px 0",
                }}
              >
                <span>{version || "—"}</span>
                {/* Extension updates are handled by the official marketplace
                    (spec: plugin-updates.md); only the desktop app keeps its own
                    update check (electron-updater). */}
                {isDesktop && (
                  <button
                    type="button"
                    onClick={() =>
                      vscode?.postMessage({ command: "checkForUpdates" })
                    }
                    className="configuration-cancel-btn"
                    style={{ padding: "2px 8px" }}
                  >
                    检查更新
                  </button>
                )}
              </div>
            </div>
            <StatusRow label="Session ID" value={sessionId} />
            <StatusRow label="工作目录" value={workdir} />
          </div>

          <div className="configuration-actions">
            <button
              type="button"
              onClick={onClose}
              className="configuration-cancel-btn"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StatusDialog;
