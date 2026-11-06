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
