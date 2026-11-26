/**
 * 预览面板「查看源码」取文件内容（spec desktop-preview.md「HTML 预览的源码视图」）。
 *
 * 面板自己读不到盘：桌面端 webview 只有宿主那条通道。所以这里复用**文件面板同
 * 一条读路径**——宿主侧 `readLocalFileForPanel` / `readRemoteFileForPanel`，
 * 本地会话直接读 fs、远程会话经该会话的 host 读，截断口径（2 MB / 2000 行）也
 * 与文件面板完全一致，源码视图里看到的就是文件面板里会看到的那份。
 *
 * 请求-响应底座见 `previewRequest.ts`（远控页取图/取文本共用同一个）：这里只
 * 写命令名与「怎么把回包翻译成结果」。超时给 15 秒：一笔读盘没有 LLM 回合，慢
 * 到十几秒基本是链路断了，早点把失败画出来比一直转圈好。
 */
import {
  requestPreview,
  __resetPreviewRequestsForTesting,
} from "./previewRequest";

export interface PreviewSourcePayload {
  content: string;
  /** 宿主读到的字节超过了面板口径（2 MB / 2000 行）——只显示开头部分。 */
  truncated: boolean;
}

export type PreviewSourceOutcome = PreviewSourcePayload | { error: string };

export const PREVIEW_SOURCE_TIMEOUT_MS = 15_000;

/**
 * 向宿主要一份源码文本。永远 resolve（失败走 `{ error }`）。
 *
 * `post` 是宿主通道的发送函数（桌面端是 ChatApp 的 `postToHost`：它负责补
 * paneId，宿主按 paneId 决定读本地还是读远程）；不直接吃 `vscode`，因为
 * 缺 paneId 时宿主会退回「当前焦点 pane」，分屏下等于读错会话。
 */
export function requestPreviewSource(
  post: (message: Record<string, unknown>) => void,
  path: string,
  timeoutMs: number = PREVIEW_SOURCE_TIMEOUT_MS,
): Promise<PreviewSourceOutcome> {
  const target = {
    postMessage: (message: unknown) => post(message as Record<string, unknown>),
  };
  return requestPreview<PreviewSourcePayload>(target, {
    command: "desktopPreviewSource",
    responseCommand: "desktopPreviewSourceResult",
    path,
    timeoutMs,
    timeoutMessage: "读取文件超时，请稍后重试。",
    parse: (reply) => {
      if (typeof reply.content !== "string") {
        return { error: "这台电脑没有回文件内容。" };
      }
      return { content: reply.content, truncated: reply.truncated === true };
    },
  });
}

/** Test seam: drop everything in flight（见 `previewRequest.ts`）。 */
export const __resetPreviewSourceRequestsForTesting =
  __resetPreviewRequestsForTesting;
