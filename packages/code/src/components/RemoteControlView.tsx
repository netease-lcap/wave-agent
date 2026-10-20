/**
 * RemoteControlView — `/remote-control` 的覆盖层（把这条前台会话交给手机）。
 *
 * 规格：docs/specs/ui/remote-control.md「前台 CLI 会话也能被手机接管」。
 *
 * **这个斜杠命令不带参数**：没有 `on` / `off` / `status` 子命令，也不收机器名。
 * 判据是「状态自己决定动作」——`off` / `error` 时唯一合法动作是开启，`connecting`
 * / `online` 时唯一合法动作是断开，所以层里只呈现当前那一个动作，而不是把两个
 * 动词写成命令参数让用户先自己算一遍状态。命名归脚本入口
 * `wave remote-control on <name>`（且只在登记那一次生效）。
 *
 * 所有结果（四态、说明、地址、二维码、失败原因）都只回显在这一层里，**一律不进
 * 消息列表**：这块内容要停在屏幕上够久以便掏手机扫码，而状态还会继续变，一条快照
 * 消息既留不住也更新不了。与 GUI 设置页的「远程控制」选项卡同一口径。
 *
 * 状态怎么刷新：链路活在 CLI 进程里，没有推送通道，`useRemoteControl` 自己每秒读
 * 一次快照（`status` 每次都是新对象），本视图读它即随渲染刷新，不另开轮询。
 */

import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { toString as qrToString } from "qrcode";
import type { RemoteControlStatus } from "wave-agent-sdk";
import { useChat } from "../contexts/useChat.js";

export interface RemoteControlViewProps {
  onCancel: () => void;
}

const STATE_LABELS: Record<RemoteControlStatus["state"], string> = {
  off: "Not serving",
  connecting: "Connecting…",
  online: "Serving",
  error: "Failed",
};

/** Colour per state — literal union, so `<Text color>` takes it as-is. */
function stateColor(state: RemoteControlStatus["state"]) {
  if (state === "online") return "green";
  if (state === "error") return "red";
  if (state === "connecting") return "yellow";
  return "gray";
}

export const RemoteControlView: React.FC<RemoteControlViewProps> = ({
  onCancel,
}) => {
  const { remoteControl } = useChat();
  const { enabled, status, getSnapshot, connect, disconnect } = remoteControl;

  // `status` is the per-second tick that makes this view re-render while it is
  // open; the page address lives only on the snapshot (it is not part of
  // `status`), so both are read on every render.
  const { pageUrl } = getSnapshot();

  const [showQr, setShowQr] = useState(false);
  const [qrText, setQrText] = useState("");

  // Opening this panel *is* the intent to serve: dial when nothing is running.
  // A link that is already connecting or online is left alone — re-dialling
  // would tear down a working connection (same rule as the GUI tab, whose
  // single button flips on `state === "off" || state === "error"`).
  //
  // The deps are the two callbacks, not the `remoteControl` object: that object
  // is rebuilt on every render, so depending on it would re-run this effect
  // after every state change — which is exactly what made `d` unusable (the
  // disconnect set `off`, the effect saw `off` and dialled again).
  useEffect(() => {
    if (!enabled) return;
    const current = getSnapshot().state;
    if (current === "off" || current === "error") connect();
  }, [enabled, connect, getSnapshot]);

  // The QR is folded away by default: it is ~35 rows tall, and the panel also
  // has to stay readable when all the user wants is the state.
  useEffect(() => {
    if (!showQr || !pageUrl) {
      setQrText("");
      return;
    }
    let cancelled = false;
    qrToString(pageUrl, { type: "utf8", errorCorrectionLevel: "L" })
      .then((text) => {
        if (!cancelled) setQrText(text);
      })
      .catch(() => {
        if (!cancelled) setQrText("");
      });
    return () => {
      cancelled = true;
    };
  }, [showQr, pageUrl]);

  const serving = status.state === "connecting" || status.state === "online";

  useInput((input, key) => {
    if (key.escape || key.return) {
      onCancel();
      return;
    }
    if (input === " ") {
      setShowQr((prev) => !prev);
      return;
    }
    // One key, and its label is whichever action is legal right now — the layer
    // never asks the user to work out which of two verbs applies.
    if (input === "d") {
      if (serving) disconnect();
      else connect();
    }
  });

  // The switch is read once per process, so a process started with it off can
  // only be told what to change — it cannot pick the setting up by itself.
  const note = enabled
    ? status.message
    : 'Remote control is unavailable in this process. Set "enableRemoteControl": true in ~/.wave/settings.json (or .wave/settings.json in the project), then restart the CLI — a process that is already running keeps the settings it started with.';

  const row = (label: string, value: string, color?: string) => (
    <Box>
      <Box width={14}>
        <Text color="yellow">{label}</Text>
      </Box>
      <Box flexShrink={1}>
        <Text color={color} wrap="wrap">
          {value}
        </Text>
      </Box>
    </Box>
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      borderLeft={false}
      borderRight={false}
      paddingX={1}
    >
      <Box marginBottom={1}>
        <Text color="cyan" bold underline>
          Remote Control
        </Text>
      </Box>

      {row("Status:", STATE_LABELS[status.state], stateColor(status.state))}

      {note ? row("Note:", note) : null}

      {pageUrl ? row("Phone page:", pageUrl) : null}

      {showQr && qrText ? (
        <Box flexDirection="column" marginTop={1}>
          {qrText
            .split("\n")
            .filter((line) => line.length > 0)
            .map((line, index) => (
              <Text key={index}>{line}</Text>
            ))}
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text dimColor>
          {!enabled
            ? "Esc close"
            : serving
              ? "space QR code · d disconnect · Esc close"
              : "space QR code · d connect · Esc close"}
        </Text>
      </Box>
    </Box>
  );
};
