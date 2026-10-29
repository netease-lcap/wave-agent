import type { Message } from "./messaging.js";

/**
 * `getMessages` 的取数参数（宿主 → `wave --stdio`）。不传 = 整份列表（= 压缩后
 * 的上下文），三个本机宿主走的就是这条。
 */
export interface MessageWindow {
  /** 排他下锚点：取这条消息**之后**新增的部分（重连补差）。 */
  since?: string;
  /**
   * 排他上锚点：取这条消息**之前**的一页（上翻取更早）。锚点不存在时回包里
   * `anchorLost`，调用方换一个更早的 id 重试，见 `ui/message-rendering-system.md`
   * 「首屏一页，上翻按需取更早」。
   */
  before?: string;
  /** 这一页最多多少条（首屏 / 上翻 / 远控页尾段都用它，字节预算同时生效）。 */
  limit?: number;
}

/**
 * `getMessages` 的回包。
 */
export interface MessageWindowResult {
  messages: Message[];
  /** `since` 锚点已经不在了：整份重取。 */
  reset?: boolean;
  /**
   * `before` 锚点在转录里找不到：调用方换一个更早的已知 id 重试，**不要**当成
   * 「没有更早」——那会让这段历史再也翻不出来。
   */
  anchorLost?: boolean;
  /** 这一页之前还有更早的消息（上翻的终止判据）。 */
  hasMore?: boolean;
  /**
   * 该会话的上下文用量百分比。随每次取数一起回：宿主的查询是只读的（不写
   * SDK 客户端那份缓存），用量要由宿主自己存，就必须搭在同一份回包上送过来。
   */
  contextUsagePercent?: number;
  /** 线程总量（见 `MessageThreadSummary`）。 */
  threadSummary?: MessageThreadSummary;
}

/**
 * 线程总量。列表从最近一次压缩开始，它的长度答不了「这条会话有多少条消息」，
 * 首条用户消息（会话标题的兜底）也可能不在列表里，所以这两个值由 SDK 的计数器给。
 * 随 `getMessages` 回包一起下发（不单独开一条 RPC）。
 */
export interface MessageThreadSummary {
  messageCount: number;
  /** 首条非 meta 用户消息的正文；会话没有自定义标题时拿它当标题。 */
  firstUserText?: string;
  /** 最新一条展示消息的时间戳：会话列表的排序键。 */
  lastActiveAt?: string;
}
