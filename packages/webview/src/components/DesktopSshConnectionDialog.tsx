import React, { useEffect, useRef, useState } from "react";
import { useHostMessage } from "../utils/useHostMessage";
import { isDesktopHost } from "../utils/platform";
import { ConversationCloseIcon } from "./HeaderIcons";
import type { DesktopSshConnection, DesktopSshConnectionInput } from "../types";
import "../styles/DesktopSshConnectionDialog.css";

/** 删除二次确认的说明文案（单一字符串常量：写在 JSX 里跨行的中文会被折成空格）。 */
const DELETE_CONFIRM_TEXT =
  "删除后，该主机上的会话不再自动重连，列表里也选不到它。会话记录与最近打开目录会保留，重新添加同一主机即可接回。";

/**
 * 模态焦点陷阱要抓的可聚焦元素。disabled / 不可见的都剔掉（删除态切换后
 * 表单整块卸载，靠 querySelector 每次重算，不做缓存）。
 */
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** 会被本机校验点到名的字段。 */
type FieldKey = "host" | "port";

/**
 * 一条表单错误。`field` 有值就贴在该字段下面 —— 契约 :147「supporting text …
 * 8px from their associated control」；缺省是表单级（宿主回传的保存/删除失败，
 * 本机校验给不出具体字段）。
 */
interface FormError {
  field?: FieldKey;
  message: string;
}

/** 错误行 id：对应 input 用 `aria-describedby` 指过来（契约 :71「description association」）。 */
const FIELD_ERROR_ID: Record<FieldKey, string> = {
  host: "ssh-conn-host-error",
  port: "ssh-conn-port-error",
};

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
 *
 * 每条都带 `field`：错误要贴在出问题的那一栏下面，而不是统一堆在表单底部
 * （原来「端口必须是 1–65535」也会标红「主机」栏，归错栏）。
 */
const validateForm = (
  draft: { name: string; host: string; port: string; identityFile: string },
  connections: DesktopSshConnection[],
  editingId: string | undefined,
): FormError | null => {
  const host = draft.host.trim();
  if (!host) {
    return {
      field: "host",
      message: "请填写主机（user@hostname 或 ~/.ssh/config 里的别名）",
    };
  }
  if (/^ssh:\/\//i.test(host)) {
    return { field: "host", message: "去掉 ssh:// 前缀，只填 user@hostname" };
  }
  if (/\s/.test(host)) return { field: "host", message: "主机栏不能包含空格" };
  if (host.startsWith("-")) {
    return { field: "host", message: "主机栏不能以 - 开头" };
  }
  if (/^(?:[^:@\s]+@)?[^:\s]+:\d+$/.test(host)) {
    return {
      field: "host",
      message: "端口请填到端口栏，主机栏只填主机或别名",
    };
  }
  if (!/^[A-Za-z0-9._:@[\]%~-]+$/.test(host)) {
    return {
      field: "host",
      message: "主机名只能包含字母、数字、. - _ : @ 等字符",
    };
  }
  const port = draft.port.trim();
  if (port) {
    const parsed = Number(port);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      return { field: "port", message: "端口必须是 1–65535 的数字" };
    }
  }
  const duplicate = connections.find(
    (connection) => connection.id !== editingId && connection.host === host,
  );
  if (duplicate) {
    return {
      field: "host",
      message: `已有使用该主机的连接：${duplicate.name || duplicate.host}`,
    };
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
  const [error, setError] = useState<FormError | null>(null);
  // 保存/删除中：挡住 Enter 连打与按钮连点，一个动作一笔请求。
  const [busy, setBusy] = useState(false);
  // 删除的第二步：先亮出「会影响什么」，再执行。
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const hostRef = useRef<HTMLInputElement>(null);
  const portRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const requestSeq = useRef(0);
  /** 在途请求：只认自己那一笔 requestId 的回复（晚到的旧回复即弃）。 */
  const pending = useRef<{
    requestId: string;
    resolve: (result: SshConnectionResult) => void;
  } | null>(null);

  // 契约 common-components.md:120「restoration to the trigger」—— 弹窗关掉后焦点
  // 要回到打开它的那颗键上，不能留成 `body`（键盘 / 屏幕阅读器用户会掉回文档开头）。
  // 打开路径（DesktopHostSelector:189/:205）先 `closeReturningFocus()` 把焦点还给
  // 「主机」触发键、再挂载本弹窗，所以挂载瞬间的 activeElement 就是回退目标。
  // ⚠️ 这条 effect 必须排在下面「焦点进表单」之前：effect 按声明顺序执行，晚一步
  // 量到的就是刚被拉进来的输入框了。
  const returnFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const active = document.activeElement;
    returnFocusRef.current =
      active instanceof HTMLElement &&
      active !== document.body &&
      active !== document.documentElement
        ? active
        : null;
  }, []);
  useEffect(
    () => () => {
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      // 触发键可能已经不在文档里（例如宿主菜单项在弹窗打开时就关掉了）——
      // isConnected 是便宜的护栏：脱离文档的节点 focus() 是静默无效，
      // 与其静默失败，不如显式跳过。
      if (!target?.isConnected) return;
      // 推一帧再还：点遮罩关闭走的是 `onMouseDown`（见下面的 overlay），而浏览器对
      // mousedown 的**默认动作**——「点到不可聚焦元素就把焦点收到 body」——是在监听器
      // 返回之后才执行的，同步 focus() 会被它盖掉（实测只有这一条路会掉回 body）。
      // 护栏：这一帧里用户若已经点进别处（焦点不在 body 上），就别再抢回来。
      requestAnimationFrame(() => {
        const current = document.activeElement;
        if (
          current !== null &&
          current !== document.body &&
          current !== document.documentElement
        ) {
          return;
        }
        if (target.isConnected) target.focus();
      });
    },
    [],
  );

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
      // 焦点落到出错的那一栏，而不是永远回「主机」
      (validation.field === "port" ? portRef : hostRef).current?.focus();
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
      // 宿主拒绝的都是这次「保存」本身（写盘失败、宿主侧判重）—— 归到主机栏，
      // 与本机校验同一条可见位置，用户改一栏就能重试。
      setError({ field: "host", message: result.error ?? "保存失败" });
      hostRef.current?.focus();
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
      setError({ message: result.error ?? "删除失败" });
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

  /**
   * 焦点陷阱（审计 E2 / 契约 common-components.md:120「focus containment」）
   * + 弹窗级 Escape。
   *
   * 挂在 **capture** 阶段：输入框的 onFieldKeyDown 会 `stopPropagation()`，
   * 冒泡阶段收不到那一路的 Tab。焦点走到最后/最前一颗时折回另一端；
   * 焦点若已漏到弹窗外（浏览器扩展、程序化 focus），也拉回第一颗。
   *
   * Escape 原来只在输入框里处理（onFieldKeyDown），焦点落到按钮上就关不掉 ——
   * 契约 :120 要的是模态级「appropriate Escape/close behavior」。这里统一在
   * capture 阶段接掉并 `stopPropagation()`，输入框那一路就不会再触发一次。
   */
  const onDialogKeyDownCapture = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
      return;
    }
    if (e.key !== "Tab") return;
    const root = dialogRef.current;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
    ).filter((el) => el.offsetParent !== null);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    const outside = !active || !root.contains(active);
    if (e.shiftKey) {
      if (outside || active === first) {
        e.preventDefault();
        last.focus();
      }
    } else if (outside || active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const editing = Boolean(connection);
  const title = editing ? "编辑 SSH 连接" : "添加 SSH 连接";
  /** 表单级错误：没有归属字段（宿主回传的保存/删除失败）。 */
  const formError = error && !error.field ? error : null;
  /**
   * 字段级错误行：贴在所属控件下面（间距由 `.ssh-conn-field` 的 8px gap 给，
   * 不给自身 margin），并带 id 供 input 的 `aria-describedby` 指向 ——
   * 契约 :147 的「8px from their associated control」+ :71 的「description association」。
   */
  const fieldError = (key: FieldKey) =>
    error?.field === key ? (
      <div
        className="ssh-conn-error"
        id={FIELD_ERROR_ID[key]}
        role="alert"
        data-testid="desktop-ssh-error"
      >
        {error.message}
      </div>
    ) : null;

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
        ref={dialogRef}
        className="ssh-conn-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="desktop-ssh-connection-dialog"
        onKeyDownCapture={onDialogKeyDownCapture}
      >
        {isDesktopHost() && (
          <button
            type="button"
            className="ssh-conn-close"
            data-testid="desktop-ssh-close"
            onClick={onCancel}
            aria-label="关闭"
            title="关闭"
          >
            {/* 与 pane 头部 / toast / 确认弹窗同一个官方关闭矢量 */}
            <ConversationCloseIcon className="ssh-conn-close-icon" />
          </button>
        )}
        <div className="ssh-conn-title">{title}</div>

        {confirmingDelete ? (
          <div
            className="ssh-conn-confirm"
            data-testid="desktop-ssh-delete-confirm"
          >
            {DELETE_CONFIRM_TEXT}
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
                aria-invalid={error?.field === "host" ? true : undefined}
                aria-describedby={
                  error?.field === "host" ? FIELD_ERROR_ID.host : undefined
                }
                onChange={(e) => {
                  setHost(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={onFieldKeyDown}
              />
              {fieldError("host")}
            </label>
            <label className="ssh-conn-field ssh-conn-field--pair">
              <span className="ssh-conn-label">端口</span>
              <input
                ref={portRef}
                className="ssh-conn-input"
                data-testid="desktop-ssh-port"
                value={port}
                inputMode="numeric"
                placeholder="22"
                aria-invalid={error?.field === "port" ? true : undefined}
                aria-describedby={
                  error?.field === "port" ? FIELD_ERROR_ID.port : undefined
                }
                onChange={(e) => {
                  setPort(e.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={onFieldKeyDown}
              />
              {fieldError("port")}
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

        {formError && (
          <div
            className="ssh-conn-error"
            role="alert"
            data-testid="desktop-ssh-error"
          >
            {formError.message}
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
