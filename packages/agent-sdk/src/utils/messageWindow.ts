import type { Message } from "../types/messaging.js";

/**
 * 从内存里的列表取末尾一段：最多 `limit` 条。
 *
 * 只按条数收，没有字节上限：消息里的图片 base64 在下发 UI 前已经被剥掉
 * （`packages/code/src/stdio/uiPayload.ts`），按含图的字节砍页挡的是不会上线的
 * 量，只会把带截图的会话首屏砍短。
 */
export function takeTailFromMemory(
  list: readonly Message[],
  limit: number,
): Message[] {
  if (list.length <= limit) return [...list];
  return list.slice(list.length - limit);
}
