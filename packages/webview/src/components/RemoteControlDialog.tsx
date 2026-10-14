/**
 * RemoteControlDialog — 远程控制（手机接管本机会话）
 *
 * Opened via the `/remote-control` slash command. Shows the outbound relay link
 * this machine's own `wave --stdio` child holds, and lets the user open or close
 * it.
 *
 * Two things about this dialog are deliberate:
 *
 * 1. **It polls.** Nothing pushes a status change: the link lives in the CLI
 *    process, and the only channel the host has to it is the same request /
 *    reply RPC everything else uses. A push would mean a new notification out
 *    of the CLI (a wider change than this dialog is worth), so the dialog asks
 *    once per second while it is open — the CLI's own `wave remote-control` does
 *    the same thing while it waits for the page address.
 * 2. **It filters replies by requestId.** Polling puts several requests in
 *    flight; `connect` also answers twice (the immediate `connecting` snapshot
 *    and the later one carrying the page address). Only a reply matching the
 *    newest request may render — a stale "off" arriving one second late must not
 *    undo a link the user just brought up.
 *
 * The page address comes from the CLI — the process that holds the channel key,
 * and the only one that can build the address. It is shown as text and as a QR:
 * scanning is the shortest path to a phone (the page is a plain web page, so a
 * desktop browser can also just open the address). Two limits keep that honest —
 * no address in the reply means no QR (never a made-up one), and the Web page
 * itself never draws one: it *is* what the QR points at, so drawing it there
 * would be circular (that page sets `window.waveRemotePage`; the IDE hosts leave
 * `waveHostType` unset too, so this flag is the only way to tell them apart).
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useClickOutside } from "../utils/useClickOutside";
import { useHostMessage } from "../utils/useHostMessage";
import { isRemotePageHost } from "../utils/platform";
import { RemoteControlDialogProps } from "../types";
import type { RemoteControlSnapshot } from "wave-agent-sdk/types";
import "../styles/ConfigurationDialog.css";

/** How often the dialog re-reads the link state while it is open. */
export const REMOTE_CONTROL_POLL_MS = 1_000;

const STATE_LABELS: Record<RemoteControlSnapshot["state"], string> = {
  off: "未开启",
  connecting: "连接中…",
  online: "已连接",
  error: "出错",
};

const RemoteControlDialog: React.FC<
  RemoteControlDialogProps & {
    vscode: { postMessage: (msg: unknown) => void };
  }
> = ({ onClose, vscode }) => {
  const [snapshot, setSnapshot] = useState<RemoteControlSnapshot | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [actionPending, setActionPending] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  // The newest request id: replies for anything else are stale by definition.
  const latestRequestRef = useRef<string | null>(null);
  const requestSeqRef = useRef(0);

  const request = useCallback(
    (action: "status" | "connect" | "disconnect") => {
      const requestId = `remote-control-${++requestSeqRef.current}`;
      latestRequestRef.current = requestId;
      vscode?.postMessage({ command: "remoteControl", action, requestId });
    },
    [vscode],
  );

  useEffect(() => {
    request("status");
    const timer = setInterval(() => request("status"), REMOTE_CONTROL_POLL_MS);
    return () => clearInterval(timer);
  }, [request]);

  useHostMessage((message) => {
    if (message.command !== "remoteControlResponse") return;
    if (message.requestId !== latestRequestRef.current) return;
    setSnapshot(message.snapshot ?? null);
    setError(message.error);
    setActionPending(false);
  });

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

  const handleConnect = () => {
    setActionPending(true);
    request("connect");
  };

  const handleDisconnect = () => {
    setActionPending(true);
    request("disconnect");
  };

  const handleOpenPageUrl = (url: string) => {
    // `openExternal` 是四端都注册过的既有命令，因此这里不引入新的宿主契约；
    // Web 页（shim）把它列在忽略清单里 —— 页面上本来就在浏览器里，不需要再开。
    vscode?.postMessage({ command: "openExternal", url });
  };

  const Row = ({ label, value }: { label: string; value?: string }) => (
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

  const state = snapshot?.state ?? "off";
  // `off` is the only state where connecting makes sense; a link that is already
  // up (or on its way) is disconnected instead.
  const showConnect = state === "off" || state === "error";
  // The page to open. Shown whenever the CLI reported one; a link that is still
  // connecting has none yet, and the next poll picks it up.
  const pageUrl = snapshot?.pageUrl;
  const showQr = Boolean(pageUrl) && !isRemotePageHost();

  return (
    <div className="configuration-dialog-overlay">
      <div
        ref={dialogRef}
        className="configuration-dialog"
        data-testid="remote-control-dialog"
        // 内容（状态/Web 页/按钮/二维码/提示）比普通配置弹窗高，压到 500
        // 会把二维码与提示挤进滚动区。高度仍受窗口限制，矮窗口下退回滚动。
        style={{ height: "auto", maxHeight: "min(680px, 88vh)" }}
      >
        <div className="configuration-dialog-header">
          <h3>远程控制</h3>
        </div>

        <div className="configuration-form">
          <div className="configuration-fields-scroll-area">
            <Row label="状态" value={STATE_LABELS[state]} />
            {snapshot?.message ? (
              <Row label="说明" value={snapshot.message} />
            ) : null}
            {error ? <Row label="无法读取状态" value={error} /> : null}
            {pageUrl ? (
              <>
                <Row label="Web 页" value={pageUrl} />
                <div className="configuration-field">
                  <div style={{ padding: "4px 0" }}>
                    <button
                      type="button"
                      className="configuration-cancel-btn"
                      onClick={() => handleOpenPageUrl(pageUrl)}
                    >
                      在浏览器中打开
                    </button>
                  </div>
                </div>
              </>
            ) : null}
            {showQr ? (
              <div
                data-testid="remote-control-qr"
                style={{
                  display: "flex",
                  justifyContent: "center",
                  padding: "8px 0",
                }}
              >
                {/* Dark modules on the library's own white background, not
                    `currentColor` over the themed backdrop: a light-on-dark QR
                    is inverted, and a decoder that does not try the inverted
                    polarity reads nothing (measured — `jsQR` fails the normal
                    pass on the themed version). The theme here is dark, so
                    theming the code would break exactly the scanning this QR
                    exists for. */}
                <QRCodeSVG
                  value={pageUrl as string}
                  size={160}
                  level="M"
                  marginSize={2}
                  title="扫码打开远程控制页"
                />
              </div>
            ) : null}
            {pageUrl ? (
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--vscode-descriptionForeground)",
                  padding: "2px 0",
                }}
              >
                页面用企业端登录态认证：扫码的浏览器需要已登录同一个企业账号。
              </div>
            ) : null}
          </div>

          <div className="configuration-actions">
            {showConnect ? (
              <button
                type="button"
                className="configuration-save-btn"
                onClick={handleConnect}
                disabled={actionPending}
              >
                开启远程控制
              </button>
            ) : (
              <button
                type="button"
                className="configuration-save-btn"
                onClick={handleDisconnect}
                disabled={actionPending}
              >
                断开
              </button>
            )}
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

export default RemoteControlDialog;
