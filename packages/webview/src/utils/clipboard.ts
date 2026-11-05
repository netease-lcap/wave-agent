/**
 * 复制文本到剪贴板，成功返回 true。
 *
 * `navigator.clipboard` 在 Electron 的 `file://` 页面 / 无用户手势的调用里会偶发
 * 不可用（NotAllowedError 或整块 API 不存在），此时退回旧式 textarea +
 * `execCommand("copy")`，两路都失败才返回 false —— 调用方据此给成功/失败提示。
 *
 * 注意：`ArtifactsPage.tsx` 里还有一份同款实现（2026-10-23 那批加的），本轮没动
 * 那边；要合并时把它换成这里的导入即可。
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * 带格式地复制：同一段内容的纯文本 + HTML 两份表示（spec: ui/message-rendering-system.md
 * 「助手消息底部的复制按钮」场景 10/11）。
 *
 * `navigator.clipboard.write` + `ClipboardItem` 是唯一能一次写入多种 flavor 的路径，
 * 但不是处处都有：jsdom、旧宿主、以及某些沙箱页面里 `ClipboardItem` 干脆不存在。
 * 那就**降级为纯文本**（`text/plain` 本来就是我们要的那份 Markdown），而不是报失败 ——
 * 用户拿到 Markdown 源码仍然是「复制到了」，只是粘进富文本编辑器不带排版。
 *
 * 返回 `false` 只代表两条路都没写进去（调用方据此不给成功反馈）。
 */
export async function copyToClipboard({
  text,
  html,
}: {
  text: string;
  html?: string;
}): Promise<boolean> {
  if (
    html &&
    typeof ClipboardItem !== "undefined" &&
    typeof navigator.clipboard?.write === "function"
  ) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
      return true;
    } catch {
      // 写 html 被拒（权限、焦点、宿主实现缺失）：退回纯文本，不向上报错。
    }
  }
  return copyTextToClipboard(text);
}
