/**
 * SettingsRemoteControlView — 设置页的「远程控制」选项卡（手机接管这台电脑）
 *
 * 2026-10-17 从独立弹层（`RemoteControlDialog`）搬进设置页：它和 MCP 服务一样是
 * 「这台机器上的一项能力」，不该自成一个弹窗占位。入口仍是 `/remote-control`
 * 斜杠命令，只是现在打开的是设置页并选中这一项（spec ui/remote-control.md
 * 「`/remote-control` 打开设置页的远程控制选项卡」）。
 *
 * 搬过来时**三条纪律原样保留**，它们都不依赖「是不是弹窗」：
 *
 * 1. **只在被看见时轮询。** 没有任何东西推送状态变化：链路活在 CLI 进程里，宿主
 *    对它的唯一通道就是与其它命令共用的 request/reply RPC。为它新增一条通知不
 *    划算，所以打开期间每秒问一次——CLI 自己的 `wave remote-control` 等待页面
 *    地址时也是这么做的。本视图挂载 = 这个选项卡被选中（设置页按导航项条件渲染
 *    各视图，切走即卸载），所以「挂载即轮询、卸载即停」正好等于「只在激活时」。
 * 2. **回执按 requestId 过滤。** 轮询会让好几个请求同时在飞；`connect` 还会回两
 *    次（先是 `connecting` 快照，随后带页面地址的那次）。只有与**最新**请求匹配
 *    的回执才能落进状态——一条晚到一秒的 `off` 不能把用户刚建立的链路按回去。
 * 3. **二维码用库自己的白底，不跟随主题。** 深色底 + 浅色模块 = 反相二维码，不做
 *    反相尝试的解码器一个模块都读不出来（实测：`jsQR` 的常规通道在主题化版本上
 *    失败）。这个二维码存在的唯一意义就是被扫，所以不给它换色。
 *
 * 页面地址来自 CLI——持有通道键的那个进程，也是唯一能拼出地址的进程。有了地址才
 * 画二维码（绝不自造一个），并且远控网页自己**不画**：页面本身就是二维码指向的
 * 东西，在那里再画一遍是自我指涉（那一页由 shim 设 `window.waveRemotePage`，
 * IDE 宿主也留着 `waveHostType` 未设，这个标记是唯一能把它们分开的东西）。
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useHostMessage } from "../utils/useHostMessage";
import { isRemotePageHost } from "../utils/platform";
import type { RemoteControlSnapshot } from "wave-agent-sdk/types";

/** How often the view re-reads the link state while its tab is open. */
export const REMOTE_CONTROL_POLL_MS = 1_000;

const STATE_LABELS: Record<RemoteControlSnapshot["state"], string> = {
  off: "未开启",
  connecting: "连接中…",
  online: "已连接",
  error: "出错",
};

interface SettingsRemoteControlViewProps {
  /** Host 消息桥：本视图自己拥有与宿主的对话（轮询 + requestId 关联）。 */
  vscode?: { postMessage: (msg: unknown) => void };
}

const SettingsRemoteControlView: React.FC<SettingsRemoteControlViewProps> = ({
  vscode,
}) => {
  const [snapshot, setSnapshot] = useState<RemoteControlSnapshot | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [actionPending, setActionPending] = useState(false);
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

  const state = snapshot?.state ?? "off";
  // `off` 是唯一「开启」有意义的态；已经连上（或在连的路上）就是断开。
  const showConnect = state === "off" || state === "error";
  // 要打开的页面。CLI 报过地址才显示；还在 connecting 的那种快照没有地址，
  // 下一次轮询会带上来。
  const pageUrl = snapshot?.pageUrl;
  const showQr = Boolean(pageUrl) && !isRemotePageHost();

  const row = (label: string, value?: string) => (
    <div className="settings-row">
      <div className="settings-row-copy">
        <h3>{label}</h3>
        {value ? <p>{value}</p> : null}
      </div>
    </div>
  );

  return (
    <div className="settings-view" data-testid="remote-control-view">
      <header className="settings-page-header">
        <h1>远程控制</h1>
        <p>用手机接管这台电脑上的会话；开关由本机设置里的能力开关决定。</p>
      </header>

      <section className="settings-section">
        <div className="settings-section-heading">
          <h2>连接状态</h2>
        </div>
        <div className="settings-card">
          {row("状态", STATE_LABELS[state])}
          {snapshot?.message ? row("说明", snapshot.message) : null}
          {error ? row("无法读取状态", error) : null}
          {pageUrl ? (
            <div className="settings-row">
              <div className="settings-row-copy">
                <h3>Web 页</h3>
                <p className="settings-remote-value">{pageUrl}</p>
              </div>
              <div className="settings-control">
                <button
                  type="button"
                  className="settings-row-btn"
                  onClick={() => handleOpenPageUrl(pageUrl)}
                >
                  在浏览器中打开
                </button>
              </div>
            </div>
          ) : null}
          {showQr ? (
            <div className="settings-remote-qr" data-testid="remote-control-qr">
              {/* 深色模块落在库自己的白底上，不是 `currentColor` 压在主题底色上：
                  浅色模块 + 深色底 = 反相二维码，不做反相尝试的解码器读不出来
                  （实测 `jsQR` 的常规通道在主题化版本上失败）。这一页用的是深色
                  主题，给二维码换色正好会毁掉它存在的理由。 */}
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
            <>
              <p className="settings-remote-note">
                页面用企业端登录态认证：扫码的浏览器需要已登录同一个企业账号。
              </p>
              <p className="settings-remote-note">
                手机上请用相机扫码或在 Safari
                中打开，再「添加到主屏幕」；控制中心的
                扫码器打开的容器加不了主屏。
              </p>
            </>
          ) : null}
        </div>

        <div className="settings-actions">
          {showConnect ? (
            <button
              type="button"
              className="settings-save-btn"
              onClick={handleConnect}
              disabled={actionPending}
            >
              开启远程控制
            </button>
          ) : (
            <button
              type="button"
              className="settings-save-btn"
              onClick={handleDisconnect}
              disabled={actionPending}
            >
              断开
            </button>
          )}
        </div>
      </section>
    </div>
  );
};

export default SettingsRemoteControlView;
