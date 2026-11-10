/**
 * `/btw` 侧聊（旁路提问）的共享类型（spec commands/btw-command.md
 * 「Webview 端继续提问」）。
 *
 * 追问的语义是**无状态重放**：每轮都是一次独立的一轮 fork，把此前已经完成的
 * 问答当普通 user/assistant 消息接在主对话前缀之后（对齐 Claude Code 桌面端
 * Side chat 的 `btw_history`）。这样侧聊不需要在 SDK 里持有状态，换宿主、
 * 走远控、切会话都不影响。
 */

/** 一轮已完成的侧聊问答。 */
export interface BtwHistoryTurn {
  question: string;
  answer: string;
}

/**
 * `askBtw` 请求的可选附加参数（stdio / host RPC 层）。
 *
 * `requestId` 由发起方（webview）生成并逐跳回填到 `btwContent` 与回包上：
 * 侧聊支持多轮之后，同一会话里可能先后问同一个问题，回包只靠问题文本已经
 * 分不清是哪一轮（也让「清空后迟到的回包」有了明确的丢弃判据）。
 */
export interface BtwAskOptions {
  /** 此前的侧聊问答（最多 10 轮，见 spec 场景 3）。 */
  history?: BtwHistoryTurn[];
  /** 发起方生成的请求标识，逐跳回填到流式通知与最终回包。 */
  requestId?: string;
}
