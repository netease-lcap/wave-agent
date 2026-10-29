/**
 * `/rewind` 的检查点投影。
 *
 * 选择器要的是「整条线程里哪些消息可以回滚到」，但它真正需要的字段只有
 * `id`、一段文本、以及在完整线程里的位置——把整份消息读进来（工具结果里的
 * 图片是 base64）只是为了数出一个下标，这就是这条路径以前的做法。
 *
 * 投影放在 SDK，是因为三端（CLI 选择器、远控页、桌面端/VS Code 弹窗）列的
 * 是同一张表：判定与字段口径只写这一处，显示格式（截断、压空白）各端自己定。
 */
import type { Message } from "../types/messaging.js";
import { getMessageContent } from "./messageOperations.js";

export interface RewindCheckpoint {
  id: string;
  /** 第一条文本块的原文：不截断、不压空白，显示成什么样由宿主决定。 */
  content: string;
  /**
   * 这条消息在完整线程里的绝对位置（从 0 起，与
   * `getFullMessageThread()` 数组的下标同义），可直接传给
   * `truncateHistory(index)`。
   */
  index: number;
}

/**
 * 判断一条 user 消息能否作为 `/rewind` 检查点。
 *
 * 后台任务通知（task_notification）与 hook 注入的消息都是系统生成、用户不可见
 * 的（meta），不能作为回滚点。bash 模式命令消息（`!ls`）是用户真正输入，与
 * fork skill 命令消息一致，可作为回滚点。
 */
export function isUserCheckpointMessage(message: Message): boolean {
  if (message.role !== "user" || message.isMeta) return false;
  if (message.blocks.some((b) => b.type === "task_notification")) return false;
  return true;
}

/** 投影成检查点；不是检查点、或没有 id（无法回滚定位）时返回 undefined。 */
export function toRewindCheckpoint(
  message: Message,
  index: number,
): RewindCheckpoint | undefined {
  if (!message.id) return undefined;
  if (!isUserCheckpointMessage(message)) return undefined;
  return { id: message.id, content: getMessageContent(message), index };
}
