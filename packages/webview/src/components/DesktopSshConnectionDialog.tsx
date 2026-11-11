import React, { useEffect, useRef, useState } from "react";
import { useHostMessage } from "../utils/useHostMessage";
import type { DesktopSshConnection, DesktopSshConnectionInput } from "../types";
import "../styles/DesktopSshConnectionDialog.css";

export interface SshConnectionResult {
  ok: boolean;
  error?: string;
}

interface DesktopSshConnectionDialogProps {
  /** 编辑模式带入的已有条目；新建时为空。 */
  connection?: DesktopSshConnection;
  /** 连接库当前内容：同主机判重、以及「编辑的是哪一条」。 */
  connections: DesktopSshConnection[];
  /** 保存（id 有值即编辑）；宿主回 `desktopSshConnectionResult`。 */
  onSave: (input: DesktopSshConnectionInput, requestId: string) => void;
  /** 删除已有条目（二次确认后调用）。 */
  onDelete: (id: string, requestId: string) => void;
  /** 关闭弹窗：取消、保存成功、删除成功都走这里。 */
  onCancel: () => void;
}

/**
 * 主机栏校验（spec desktop-remote.md 场景 29）。
 *
 * 宿主侧还有一份权威实现（`sshHosts.validateSshConnectionInput`）—— 这里这份是
 * 为了**边填边提示**，不是裁决。两份规则改动时必须同步，否则用户会看到「本机
 * 通过、宿主拒绝」的错愕。
 */
const validateForm = (
  draft: { name: string; host: string; port: string; identityFile: string },
  connections: DesktopSshConnection[],
  editingId: string | undefined,
): string | null => {
  const host = draft.host.trim();
  if (!host) return "请填写主机（user@hostname 或 ~/.ssh/config 里的别名）";
  if (/^ssh:\/\//i.test(host)) return "去掉 ssh:// 前缀，只填 user@hostname";
  if (/\s/.test(host)) return "主机栏不能包含空格";
  if (host.startsWith("-")) return "主机栏不能以 - 开头";
  if (/^(?:[^:@\s]+@)?[^:\s]+:\d+$/.test(host)) {
    return "端口请填到端口栏，主机栏只填主机或别名";
  }
  if (!/^[A-Za-z0-9._:@[\]%~-]+$/.test(host)) {
    return "主机名只能包含字母、数字、. - _ : @ 等字符";
  }
  const port = draft.port.trim();
  if (port) {
    const parsed = Number(port);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      return "端口必须是 1–65535 的数字";
    }
  }
  const duplicate = connections.find(
    (connection) => connection.id !== editingId && connection.host === host,
  );
  if (duplicate) {
    return `已有使用该主机的连接：${duplicate.name || duplicate.host}`;
  }
  return null;
};

/**
 * SSH 连接表单（居中模态，spec desktop-remote.md 场景 5/29/30/31）。
 *
 * 对齐 Claude Code 桌面端的「Add SSH host」：名称 / 主机 / 端口 / 私钥四个字段，
 * 保存写进**应用自己的连接库**——不碰用户的 `~/.ssh/config`。编辑用同一张表单
 * （以 `connection` 打开），删除在表单里二次确认：删除影响的是「这台主机以后
 * 连不上」，不该在菜单里一点就执行。
 *
 * 结果走请求-响应（`desktopSshConnectionResult` + requestId）：宿主是校验与落盘
 * 的唯一权威，失败原因（同主机重复、写盘失败）必须留在弹窗里就地显示，而不是
 * 关掉弹窗再弹个 toast。
 */
export const DesktopSshConnectionDialog: React.FC<
  DesktopSshConnectionDialogProps
> = ({ connection, connections, onSave, onDelete, onCancel }) => {
  const [name, setName] = useState(connection?.name ?? "");
  const [host, setHost] = useState(connection?.host ?? "");
  const [port, setPort] = useState(
    connection?.port === undefined ? "" : String(connection.port),
  );
  const [identityFile, setIdentityFile] = useState(
    connection?.identityFile ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  // 保存/删除中：挡住 Enter 连打与按钮连点，一个动作一笔请求。
  const [busy, setBusy] = useState(false);
  // 删除的第二步：先亮出「会影响什么」，再执行。
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const hostRef = useRef<HTMLInputElement>(null);
  const requestSeq = useRef(0);
  /** 在途请求：只认自己那一笔 requestId 的回复（晚到的旧回复即弃）。 */
  const pending = useRef<{
    requestId: string;
    resolve: (result: SshConnectionResult) => void;
  } | null>(null);

  useEffect(() => {
    // 新建时最常改的是主机栏；编辑时先全选名称（改名的常见动作是整段替换）。
    if (connection) {
      hostRef.current?.focus();
      hostRef.current?.select();
      return;
    }
    hostRef.current?.focus();
  }, [connection]);

  useHostMessage((message) => {
    if (message.command !== "desktopSshConnectionResult") return;
    const waiting = pending.current;
    if (!waiting || message.requestId !== waiting.requestId) return;
    pending.current = null;
    waiting.resolve({ ok: message.ok, error: message.error });
  });

  /** 发一笔请求并等它自己的回复（requestId 精确配对，弃旧）。 */
  const send = (
    post: (requestId: string) => void,
  ): Promise<SshConnectionResult> =>
    new Promise((resolve) => {
      requestSeq.current += 1;
      const requestId = `ssh-conn-${requestSeq.current}-${Date.now()}`;
      pending.current = { requestId, resolve };
      post(requestId);
    });

  const submit = async () => {
    if (busy) return;
    const validation = validateForm(
      { name, host, port, identityFile },
      connections,
      connection?.id,
    );
    if (validation) {
      setError(validation);
      hostRef.current?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    const result = await send((requestId) =>
      onSave(
        {
          id: connection?.id,
          name: name.trim(),
          host: host.trim(),
          port: port.trim() || undefined,
          identityFile: identityFile.trim() || undefined,
        },
        requestId,
      ),
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "保存失败");
      return;
    }
    // 成功即关窗：列表由宿主随 `desktopWorkdirState` 推下来。
    onCancel();
  };

  const submitDelete = async () => {
    if (busy || !connection) return;
    setError(null);
    setBusy(true);
    const result = await send((requestId) =>
      onDelete(connection.id, requestId),
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "删除失败");
      return;
    }
    onCancel();
  };

  const onFieldKeyDown = (e: React.KeyboardEvent) => {
    // 焦点在输入框内：按键不外泄给侧栏/输入区的快捷键。
    e.stopPropagation();
    // 组合输入中的 Enter 是「上屏」，不是保存。
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter") {
      e.preventDefault();
      void submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  const editing = Boolean(connection);
  const title = editing ? "编辑 SSH 连接" : "添加 SSH 连接";

  return (
    <div
      className="ssh-conn-overlay"
      data-testid="desktop-ssh-connection-overlay"
      onMouseDown={(e) => {
        // 点遮罩关闭（与其它模态一致）；点弹窗内部不关。
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="ssh-conn-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="desktop-ssh-connection-dialog"
      >
        <div className="ssh-conn-title">{title}</div>

        {confirmingDelete ? (
          <div
            className="ssh-conn-confirm"
            data-testid="desktop-ssh-delete-confirm"
          >
            删除后，该主机上的会话不再自动重连，列表里也选不到它。会话记录与最近
            打开目录会保留，重新添加同一主机即可接回。
          </div>
        ) : (
          <div className="ssh-conn-fields">
            <label className="ssh-conn-field">
              <span className="ssh-conn-label">名称</span>
              <input
                className="ssh-conn-input"
                data-testid="desktop-ssh-name"
                value={name}
                placeholder="留空则用主机栏内容"
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={onFieldKeyDown}
              />
            </label>
            <label className="ssh-conn-field">
              <span className="ssh-conn-label">主机</span>
              <input
                ref={hostRef}
                className="ssh-conn-input"
                data-testid="desktop-ssh-host"
                value={host}
                placeholder="user@hostname 或 ~/.ssh/config 里的别名"
                aria-invalid={error ? true : undefined}
                onChange={(e) => {
                  setHost(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={onFieldKeyDown}
              />
            </label>
            <label className="ssh-conn-field ssh-conn-field--pair">
              <span className="ssh-conn-label">端口</span>
              <input
                className="ssh-conn-input"
                data-testid="desktop-ssh-port"
                value={port}
                inputMode="numeric"
                placeholder="22"
                onChange={(e) => {
                  setPort(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={onFieldKeyDown}
              />
            </label>
            <label className="ssh-conn-field">
              <span className="ssh-conn-label">私钥</span>
              <input
                className="ssh-conn-input"
                data-testid="desktop-ssh-identity"
                value={identityFile}
                placeholder="~/.ssh/id_ed25519（留空交给 ssh 决定）"
                onChange={(e) => {
                  setIdentityFile(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={onFieldKeyDown}
              />
            </label>
          </div>
        )}

        {error && (
          <div
            className="ssh-conn-error"
            role="alert"
            data-testid="desktop-ssh-error"
          >
            {error}
          </div>
        )}

        <div className="ssh-conn-actions">
          {editing && !confirmingDelete && (
            <button
              type="button"
              className="ssh-conn-btn ssh-conn-btn--danger"
              data-testid="desktop-ssh-delete"
              disabled={busy}
              onClick={() => {
                setError(null);
                setConfirmingDelete(true);
              }}
            >
              删除
            </button>
          )}
          <div className="ssh-conn-actions-right">
            {confirmingDelete ? (
              <>
                <button
                  type="button"
                  className="ssh-conn-btn ssh-conn-btn--ghost"
                  data-testid="desktop-ssh-delete-cancel"
                  disabled={busy}
                  onClick={() => {
                    setConfirmingDelete(false);
                    setError(null);
                  }}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="ssh-conn-btn ssh-conn-btn--danger-solid"
                  data-testid="desktop-ssh-delete-confirm-button"
                  disabled={busy}
                  onClick={() => void submitDelete()}
                >
                  删除
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="ssh-conn-btn ssh-conn-btn--ghost"
                  data-testid="desktop-ssh-cancel"
                  onClick={onCancel}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="ssh-conn-btn ssh-conn-btn--primary"
                  data-testid="desktop-ssh-save"
                  disabled={busy}
                  onClick={() => void submit()}
                >
                  保存
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DesktopSshConnectionDialog;
