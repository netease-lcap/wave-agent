import type { Message } from "./messaging.js";

/**
 * `getMessages` 的窗口参数（宿主 → `wave --stdio`）。不传窗口 = 全量，那是老
 * 宿主 / 老调用方走的路径，保持原样（见 `sliceMessageWindow`）。
 */
export interface MessageWindow {
  /** 排他上锚点：取这条消息**之前**的一页（翻更早）。 */
  before?: string;
  /** 排他下锚点：取这条消息**之后**新增的部分（重连补差）。 */
  since?: string;
  limit?: number;
}

/**
 * `getMessages` 的窗口回包。`hasMore` 缺席意味着对端不认识窗口（老版本 CLI 会把
 * 整份列表原样答回来）——调用方按「没有更早的了」处理，否则会拿同一个锚点无限重问。
 */
export interface MessageWindowResult {
  messages: Message[];
  /** 回包这一页之前还有更早的消息。 */
  hasMore?: boolean;
  /** `since` 锚点已经不在了：整份重取尾页。 */
  reset?: boolean;
  /**
   * 该会话的上下文用量百分比。随每次取页一起回：宿主的窗口查询是只读的（不写
   * SDK 客户端那份缓存），用量要由宿主自己存，就必须搭在同一份回包上送过来。
   */
  contextUsagePercent?: number;
  /** 线程总量（见 `MessageThreadSummary`）。 */
  threadSummary?: MessageThreadSummary;
}

/**
 * 线程总量。宿主缓存只留一页之后，它的长度已答不了「这条会话有多少条消息」，
 * 首条用户消息（会话标题的兜底）也不在窗口里了，所以这两个值由 SDK 的计数器给。
 * 随 `getMessages` 回包一起下发（不单独开一条 RPC）。
 */
export interface MessageThreadSummary {
  messageCount: number;
  /** 首条非 meta 用户消息的正文；会话没有自定义标题时拿它当标题。 */
  firstUserText?: string;
  /** 最新一条展示消息的时间戳：会话列表的排序键。 */
  lastActiveAt?: string;
}
