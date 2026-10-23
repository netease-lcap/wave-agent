import type { Message } from "./messaging.js";

/**
 * `getMessages` 的取数参数（宿主 → `wave --stdio`）。不传 = 整份列表（= 压缩后
 * 的上下文），三个本机宿主走的就是这条。
 */
export interface MessageWindow {
  /** 排他下锚点：取这条消息**之后**新增的部分（重连补差）。 */
  since?: string;
  /** 只要最近这么多条（远控页首屏；按中继单帧预算折算，见 `remote/shim.js`）。 */
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
