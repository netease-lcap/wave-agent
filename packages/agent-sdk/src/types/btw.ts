/**
 * `/btw` 侧聊（旁路提问）的共享类型（spec commands/btw-command.md
 * 「Webview 端继续提问」与「侧聊分段与上下文冻结」）。
 *
 * 一段侧聊 = 一次 fork：宿主带上 `segmentId`，SDK 在**该段首次提问那一刻**取一份
 * 父对话前缀（主对话快照 + 记忆注入），段内每轮原样复用；关闭该段（`closeBtw`）
 * 即释放前缀并中止在途的那一轮。对话内容本身仍是**无状态重放**：每轮都是一次
 * 独立的一轮 fork，此段里已完成的问答由宿主作为历史带上来，接在冻结前缀之后。
 * 这样换宿主、走远控、切会话都不影响，SDK 只需要按段攥住那一份前缀。
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
 * 分不清是哪一轮（也让「关闭/丢弃之后迟到的回包」有了明确的丢弃判据）。
 */
export interface BtwAskOptions {
  /** 此段侧聊里此前已完成的问答（最多 10 轮，见 spec 场景 3）。 */
  history?: BtwHistoryTurn[];
  /** 发起方生成的请求标识，逐跳回填到流式通知与最终回包。 */
  requestId?: string;
  /**
   * 发起方生成的段标识：同一段侧聊内保持不变，关闭面板后重新打开换新值。
   * 省略 = 每轮各自现取前缀（CLI 单轮 overlay）。
   */
  segmentId?: string;
}
