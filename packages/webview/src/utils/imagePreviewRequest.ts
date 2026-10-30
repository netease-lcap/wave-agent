/**
 * 远控页按需取图（spec `ui/remote-control.md`「点消息里的图片路径看原图」）。
 *
 * 页面读不到文件：消息里的图片字节在过中继前就被剥掉了（`uiPayload.ts` 的
 * `messageForRemote`），页面也没有文件系统。所以「点一个 `/tmp/shot.png` 看图」
 * 只能是一个请求-响应：这里发 `getImagePreview`，宿主读盘、按解码后的真实容器
 * 判型、压到单帧预算内之后回 `imagePreviewResponse`。
 *
 * 为什么是模块级的一张表而不是组件内 `useHostMessage`：
 * - 消息列表是虚拟列表，发出请求的那个 `Message` 随时可能被回收，把监听挂在
 *   它身上等于让回复跟着一起消失——用户点开一张图，结果是永远转圈；
 * - 只有一个 `window` 监听器，按 `requestId` 关联（`useHostMessage` 的注释把
 *   「requestId 关联过滤」列为允许就地处理的例外，FilePane / MessageInput 同理）。
 */
interface PostTarget {
  postMessage: (message: unknown) => void;
}

/** 宿主回包（`imagePreviewResponse`）。 */
interface ImagePreviewReply {
  command?: string;
  requestId?: string;
  dataUrl?: string;
  scaled?: boolean;
  error?: string;
}

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

const pending = new Map<string, (reply: ImagePreviewReply) => void>();
let listening = false;

function ensureListener(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("message", (event: MessageEvent) => {
    const reply = event.data as ImagePreviewReply | undefined;
    if (!reply || reply.command !== "imagePreviewResponse") return;
    const settle = reply.requestId ? pending.get(reply.requestId) : undefined;
    if (!settle) return;
    pending.delete(reply.requestId!);
    settle(reply);
  });
}

let sequence = 0;

/**
 * 向宿主要一张图。永远 resolve（失败走 `{ error }`），调用方只需要把两种结果
 * 分别交给预览弹层和可见错误提示。
 */
export function requestImagePreview(
  vscode: PostTarget,
  path: string,
  timeoutMs: number = IMAGE_PREVIEW_TIMEOUT_MS,
): Promise<ImagePreviewOutcome> {
  ensureListener();
  const requestId = `image-preview-${++sequence}`;

  return new Promise<ImagePreviewOutcome>((resolve) => {
    const timer = window.setTimeout(() => {
      pending.delete(requestId);
      resolve({
        error: `等了 ${Math.round(timeoutMs / 1000)} 秒还没拿到这张图。它可能太大，或者这台电脑不支持预览。`,
      });
    }, timeoutMs);

    pending.set(requestId, (reply) => {
      window.clearTimeout(timer);
      if (reply.error) {
        resolve({ error: reply.error });
        return;
      }
      if (!reply.dataUrl) {
        resolve({ error: "这台电脑没有回图片内容。" });
        return;
      }
      resolve({ dataUrl: reply.dataUrl, scaled: reply.scaled === true });
    });

    vscode.postMessage({ command: "getImagePreview", path, requestId });
  });
}

/**
 * Test seam: drop everything in flight. The `window` listener stays installed
 * on purpose — re-registering it per test would let two handlers race for the
 * same `requestId`, which is not a state the running page can reach.
 */
export function __resetImagePreviewRequestsForTesting(): void {
  pending.clear();
  sequence = 0;
}
