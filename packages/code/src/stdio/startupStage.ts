/**
 * 首次启动的进度上报（spec `ui/stdio-transport.md`「首次启动的进度文案」）。
 *
 * 走的是同一条 stdout 上的 JSON-RPC 通知通道（一条一行），只是没有 `sessionId`
 * ——这些阶段发生在任何会话存在之前。宿主侧 `NotificationRouter` 的全局处理器
 * 收下它，把它变成加载动画下方那一行文案。
 *
 * **旁路**：通知发不出去（stdout 已关、宿主已经退出）不是启动错误，写失败一律
 * 吞掉；上报也不参与任何完成条件，没有宿主消费时启动照旧。
 */

import type { StartupStage } from "wave-agent-sdk";

export function reportStartupStage(stage: StartupStage): void {
  try {
    process.stdout.write(
      `${JSON.stringify({ method: "startupStage", params: { stage } })}\n`,
    );
  } catch {
    // 见文件头：上报失败不影响启动。
  }
}
