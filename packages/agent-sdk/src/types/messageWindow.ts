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
  /** 这条会话的展示流总条数。 */
  total?: number;
}
