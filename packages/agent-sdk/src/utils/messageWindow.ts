import type { Message } from "../types/messaging.js";
import { MESSAGE_FIRST_PAGE_SIZE } from "../constants/messageWindow.js";

/**
 * 宿主推给渲染进程的第一页：整份缓存里**最近** `limit` 条 + 是否还有更早的。
 *
 * 三个宿主（桌面端 / VS Code / JetBrains）的第一屏推送都走这条口径：宿主自己那份
 * 缓存必须是全量（翻更早、/rewind、搜索都要读它），但推给渲染进程的永远只有一页
 * —— 原因见 `constants/messageWindow.ts`。
 *
 * 不复制数组：`all` 没被裁时原样返回同一个引用，调用方可以拿它做同一性判断。
 */
export function tailMessagePage(
  all: Message[],
  limit: number = MESSAGE_FIRST_PAGE_SIZE,
): { messages: Message[]; hasMore: boolean } {
  if (limit < 1 || all.length <= limit) {
    return { messages: all, hasMore: false };
  }
  return { messages: all.slice(all.length - limit), hasMore: true };
}
