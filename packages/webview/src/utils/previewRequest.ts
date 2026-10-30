/**
 * 远控页「按需读取」请求器的底座：图片与文本两条通道共用。
 *
 * 页面读不到文件：消息里的字节在过中继前就被剥掉了，页面也没有文件系统。所以
 * 「点一个 `/tmp/build.log` 看内容」只能是一个请求-响应——页面发请求，宿主读盘、
 * 判型、截断之后回包。两条通道（`getImagePreview` / `getTextPreview`）在页面这
 * 一侧形状完全一样，差别只在命令名与回包里那几个字段，所以底座留在这里、各自
 * 只写「怎么把回包翻译成结果」。
 *
 * 为什么是模块级的一张表而不是组件内 `useHostMessage`：
 * - 消息列表是虚拟列表，发出请求的那个 `Message` 随时可能被回收，把监听挂在
 *   它身上等于让回复跟着一起消失——用户点开一个文件，结果是永远转圈；
 * - 只有一个 `window` 监听器（每个回包命令一个），按 `requestId` 关联
 *   （`useHostMessage` 的注释把「requestId 关联过滤」列为允许就地处理的例外，
 *   FilePane / MessageInput 同理）。
 */

export interface PreviewPostTarget {
  postMessage: (message: unknown) => void;
}

/** 宿主回包的公共形状：`command` 选通道、`requestId` 对号、`error` 是失败。 */
export interface PreviewReply {
  command?: string;
  requestId?: string;
  error?: string;
  [key: string]: unknown;
}

type Settle = (reply: PreviewReply) => void;

const pending = new Map<string, Settle>();
const listening = new Set<string>();
let sequence = 0;

function ensureListenerFor(responseCommand: string): void {
  if (listening.has(responseCommand) || typeof window === "undefined") return;
  listening.add(responseCommand);
  window.addEventListener("message", (event: MessageEvent) => {
    const reply = event.data as PreviewReply | undefined;
    if (!reply || reply.command !== responseCommand) return;
    const requestId = reply.requestId;
    if (!requestId) return;
    const settle = pending.get(requestId);
    if (!settle) return;
    pending.delete(requestId);
    settle(reply);
  });
}

export interface PreviewRequestSpec<T> {
  /** 页面 → 宿主的命令名。 */
  command: string;
  /** 宿主 → 页面的回包命令名（按它装监听器）。 */
  responseCommand: string;
  /** 要读的那个绝对路径。 */
  path: string;
  /** 回包 → 结果；字段不合格时返回 `{ error }`。 */
  parse: (reply: PreviewReply) => T | { error: string };
  /** 链路没回音时给用户看的那句话（两条通道措辞不同：图 / 文件）。 */
  timeoutMessage: string;
  timeoutMs: number;
}

/**
 * 向宿主要一份内容。永远 resolve（失败走 `{ error }`），调用方只需要把两种
 * 结果分别交给预览弹层和可见错误提示。
 */
export function requestPreview<T>(
  target: PreviewPostTarget,
  spec: PreviewRequestSpec<T>,
): Promise<T | { error: string }> {
  ensureListenerFor(spec.responseCommand);
  const requestId = `${spec.command}-${++sequence}`;

  return new Promise<T | { error: string }>((resolve) => {
    const timer = window.setTimeout(() => {
      pending.delete(requestId);
      resolve({ error: spec.timeoutMessage });
    }, spec.timeoutMs);

    pending.set(requestId, (reply) => {
      window.clearTimeout(timer);
      if (reply.error) {
        resolve({ error: reply.error });
        return;
      }
      resolve(spec.parse(reply));
    });

    target.postMessage({ command: spec.command, path: spec.path, requestId });
  });
}

/**
 * Test seam: drop everything in flight. The `window` listeners stay installed
 * on purpose — re-registering them per test would let two handlers race for the
 * same `requestId`, which is not a state the running page can reach.
 */
export function __resetPreviewRequestsForTesting(): void {
  pending.clear();
  sequence = 0;
}
