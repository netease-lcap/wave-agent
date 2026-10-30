/**
 * 远控页按需取文本（spec `remote/remote-web.md`「点消息里的文件路径看内容」）。
 *
 * 与取图同一条形态：页面读不到文件，只能向宿主要——发 `getTextPreview`，宿主
 * 读盘、按内容判「这是不是文本」、只回开头 256 KiB，页面把那段内容渲染进全屏
 * 弹层。底座见 `previewRequest.ts`。
 *
 * 两个字段值得留意：`truncated` 与 `encodingIssue` 都是**宿主**说的，页面不
 * 自己数——截断发生在字节层（多字节字符的边界只有读过那段字节的人知道），编码
 * 问题也是同一个地方判出来的。页面只负责把它们写进头部那行说明。
 */
import {
  requestPreview,
  __resetPreviewRequestsForTesting,
} from "./previewRequest";

export interface TextPreviewPayload {
  content: string;
  /** 文件在磁盘上的真实大小（不是回包大小）。 */
  bytes: number;
  /** 实际解出来的字节数（≤ 256 KiB）。 */
  returnedBytes: number;
  /** 文件比回包大——头部要写「只显示前 X」。 */
  truncated: boolean;
  /** 内容里有解不出来的字节（零星乱码），照常显示但提示一句。 */
  encodingIssue: boolean;
}

export type TextPreviewOutcome = TextPreviewPayload | { error: string };

/**
 * 与取图同一档（25 秒，比 shim 的普通请求档长 5 秒，让宿主的明确拒绝先到）。
 * 取文件不产生 LLM 回合，所以不用回合级那档。
 */
export const TEXT_PREVIEW_TIMEOUT_MS = 25_000;

/**
 * 向宿主要一份文本。永远 resolve（失败走 `{ error }`）。
 */
export function requestTextPreview(
  vscode: { postMessage: (message: unknown) => void },
  path: string,
  timeoutMs: number = TEXT_PREVIEW_TIMEOUT_MS,
): Promise<TextPreviewOutcome> {
  return requestPreview<TextPreviewPayload>(vscode, {
    command: "getTextPreview",
    responseCommand: "textPreviewResponse",
    path,
    timeoutMs,
    timeoutMessage: `等了 ${Math.round(timeoutMs / 1000)} 秒还没拿到这份文件。它可能太大，或者这台电脑不支持预览。`,
    parse: (reply) => {
      if (typeof reply.content !== "string") {
        return { error: "这台电脑没有回文件内容。" };
      }
      return {
        content: reply.content,
        bytes: typeof reply.bytes === "number" ? reply.bytes : 0,
        returnedBytes:
          typeof reply.returnedBytes === "number" ? reply.returnedBytes : 0,
        truncated: reply.truncated === true,
        encodingIssue: reply.encodingIssue === true,
      };
    },
  });
}

/** Test seam: drop everything in flight（见 `previewRequest.ts`）。 */
export const __resetTextPreviewRequestsForTesting =
  __resetPreviewRequestsForTesting;
