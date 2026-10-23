import type { Message } from "../types/messaging.js";
import { MESSAGE_SLICE_MAX_BYTES } from "../constants/messageWindow.js";

/**
 * 一条消息占的字节数。字节预算按它累计——条数挡不住图片，一条消息里的 base64
 * 可以顶到 5 MiB，几十条纯文字和一条截图在内存上差三个数量级。
 */
export function messageBytes(message: Message): number {
  return Buffer.byteLength(JSON.stringify(message), "utf8");
}

/**
 * 从内存里的列表取末尾一段：最多 `limit` 条，收满条数或字节预算就停，**至少收
 * 1 条**（单条就超预算时也得返回它，否则调用方永远拿不到东西）。
 */
export function takeTailFromMemory(
  list: readonly Message[],
  limit: number,
  maxBytes: number = MESSAGE_SLICE_MAX_BYTES,
): Message[] {
  const messages: Message[] = [];
  let bytes = 0;
  for (let index = list.length - 1; index >= 0; index--) {
    if (messages.length >= limit) break;
    const candidate = list[index];
    const size = messageBytes(candidate);
    if (messages.length > 0 && bytes + size > maxBytes) break;
    messages.push(candidate);
    bytes += size;
  }
  messages.reverse();
  return messages;
}
