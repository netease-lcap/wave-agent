/**
 * 远控页按需取图（spec `remote/remote-web.md`「点消息里的图片路径看原图」）。
 *
 * 通道底座（请求-响应、按 `requestId` 对号、超时收场）在 `previewRequest.ts`，
 * 这里只定义取图那条的命令名与回包翻译。为什么是模块级的一张表而不是组件内
 * `useHostMessage`，理由见底座文件的注释。
 */
import {
  requestPreview,
  __resetPreviewRequestsForTesting,
} from "./previewRequest";

export type ImagePreviewOutcome =
  | { dataUrl: string; scaled: boolean }
  | { error: string };

/**
 * 取图挂在 shim 的普通请求档（20 秒，见 `remote/shim.js` 的
 * `REQUEST_TIMEOUT_MS`）。页面这层只兜「中继没回音」，所以比它长 5 秒：
 * 让宿主的明确拒绝（不是图片 / 太大 / 缺图像处理库）先到，用户看到的
 * 是原因而不是笼统的超时。
 */
export const IMAGE_PREVIEW_TIMEOUT_MS = 25_000;

/**
 * 向宿主要一张图。永远 resolve（失败走 `{ error }`），调用方只需要把两种结果
 * 分别交给预览弹层和可见错误提示。
 */
export function requestImagePreview(
  vscode: { postMessage: (message: unknown) => void },
  path: string,
  timeoutMs: number = IMAGE_PREVIEW_TIMEOUT_MS,
): Promise<ImagePreviewOutcome> {
  return requestPreview<{ dataUrl: string; scaled: boolean }>(vscode, {
    command: "getImagePreview",
    responseCommand: "imagePreviewResponse",
    path,
    timeoutMs,
    timeoutMessage: `等了 ${Math.round(timeoutMs / 1000)} 秒还没拿到这张图。它可能太大，或者这台电脑不支持预览。`,
    parse: (reply) => {
      if (typeof reply.dataUrl !== "string" || !reply.dataUrl) {
        return { error: "这台电脑没有回图片内容。" };
      }
      return { dataUrl: reply.dataUrl, scaled: reply.scaled === true };
    },
  });
}

/** Test seam: drop everything in flight（见 `previewRequest.ts`）。 */
export const __resetImagePreviewRequestsForTesting =
  __resetPreviewRequestsForTesting;
