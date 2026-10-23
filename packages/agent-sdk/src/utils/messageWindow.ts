import type { Message } from "../types/messaging.js";
import { MESSAGE_PAGE_MAX_BYTES } from "../constants/messageWindow.js";

/**
 * 一条消息占的字节数。页面预算按它累计——条数挡不住图片，一条消息里的 base64
 * 可以顶到 5 MiB，几十条纯文字的页和一条截图的页在内存上差三个数量级。
 */
export function messageBytes(message: Message): number {
  return Buffer.byteLength(JSON.stringify(message), "utf8");
}

export interface MemoryPage {
  messages: Message[];
  /** 这份列表里，这一页之前还有被挤掉的消息。 */
  more: boolean;
}

/**
 * 从内存里的列表取一页：`end` 之前（缺省 = 末尾）的最新几条，收满条数或字节
 * 预算就停，**至少收 1 条**（单条就超预算时也得返回它，否则调用方拿同一个锚点
 * 反复重问，永远翻不动）。
 */
export function takePageFromMemory(
  list: readonly Message[],
  limit: number,
  maxBytes: number = MESSAGE_PAGE_MAX_BYTES,
  end: number = list.length,
): MemoryPage {
  const messages: Message[] = [];
  let bytes = 0;
  let index = Math.min(end, list.length) - 1;
  for (; index >= 0; index--) {
    if (messages.length >= limit) break;
    const candidate = list[index];
    const size = messageBytes(candidate);
    if (messages.length > 0 && bytes + size > maxBytes) break;
    messages.push(candidate);
    bytes += size;
  }
  messages.reverse();
  return { messages, more: index >= 0 };
}
