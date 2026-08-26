import type { Message } from "wave-agent-sdk";

/**
 * 判断一条 user 消息能否作为 /rewind 检查点。
 * 后台任务通知（task_notification）、hook 注入的消息（source: "hook"）
 * 都是系统生成、用户不可见的，不能作为回滚点。bash 模式命令消息
 * （`!ls`）是用户真正输入，与 fork skill 命令消息一致，可作为回滚点。
 * CLI 交互式选择器与 stdio listRewindCheckpoints 共用此判定，避免两处漂移。
 */
export function isUserCheckpointMessage(m: Message): boolean {
  if (m.role !== "user" || m.isMeta) return false;
  if (m.blocks.some((b) => b.type === "task_notification")) return false;
  if (m.blocks.some((b) => b.type === "text" && b.source === "hook"))
    return false;
  return true;
}
