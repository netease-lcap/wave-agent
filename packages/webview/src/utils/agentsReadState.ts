/**
 * 设置页三档记忆编辑器的**读状态**（spec core/memory-management.md「设置页三档记忆
 * 编辑器」场景 8–13）。
 *
 * `agentsContentResponse` 除内容外还带回三件事：是否存在（`exists`）、本次读取是否
 * 成功（`readable`）、内容 hash（`hash`）。缺了这三项，界面就只能把三种完全不同的
 * 情况显示成同一个「空编辑器」：
 *
 * - 文件不存在 → 可以放心写（保存即新建，场景 11）；
 * - 读取失败（权限 / I/O） → **必须**只读并提示，否则用户点一次保存就把磁盘上的
 *   文件覆盖成空（场景 10）；
 * - 还没读到（首帧 / 切项目重读窗口） → 也必须只读并禁保存，否则上一个项目的正文
 *   会带着旧编辑器一起被写进新项目（场景 9）。
 *
 * hash 是写入并发校验的基准：保存时把它作为 `expectedHash` 发回去，磁盘在这期间被
 * 外部改过就被宿主拒绝（场景 12）。`hash: null` 与 `exists: false` 是同一件事——
 * 读的时候文件还不存在，保存要发 `expectedHash: null`。
 */

export interface AgentsReadState {
  /** 文件是否存在。false = 编辑器可以写，保存即新建这个文件。 */
  exists: boolean;
  /** 本次读取是否成功。false 时内容不可信，编辑器必须只读并禁止保存。 */
  readable: boolean;
  /** 内容 hash（并发校验基准）；`null` = 读取时文件不存在。 */
  hash: string | null;
  /** 读失败原因（`readable: false` 时展示给用户）。 */
  error?: string;
}

/**
 * 从 `agentsContentResponse` 里取读状态。
 *
 * 返回 `null` = 回包不带状态字段：老宿主（未升级）或未接这套契约的宿主。此时调用方
 * **保持原有行为**（可编辑、保存不带 `expectedHash`），见 spec 场景 13——「不带 hash
 * 的调用方不得因此保存失败」。降级到「可编辑」而不是「只读」，是因为这类宿主的
 * `getAgentsContent` 从来不提供 hash，若按场景 9 判只读，它们的记忆编辑器会永久
 * 不可写。
 */
export function agentsReadStateFromMessage(message: {
  exists?: unknown;
  readable?: unknown;
  hash?: unknown;
  error?: unknown;
}): AgentsReadState | null {
  if (
    typeof message.readable !== "boolean" ||
    typeof message.exists !== "boolean"
  ) {
    return null;
  }
  return {
    exists: message.exists,
    readable: message.readable,
    hash: typeof message.hash === "string" ? message.hash : null,
    error: typeof message.error === "string" ? message.error : undefined,
  };
}
