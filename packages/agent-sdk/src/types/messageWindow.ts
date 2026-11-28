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
  /**
   * 起点锚点（**含这条**）：从它开始往后取一页。与 `before` 方向相反——那个是
   * 「这条之前的一页」，这个是「这条及其之后的一页」，给会话消息大纲点一条**还没
   * 加载**的刻度用（spec ui/transcript-outline.md 场景 17）。
   *
   * 语义对齐 CC 桌面端的 `ET(rows, beforeUuid, limit)`：都是「以某个锚点为准收满
   * 一页」，区别只在锚点算不算进这一页——它是排他、我们是含。含的原因是 UI 要
   * 显示这一条本身（点刻度是为了看这条问句），排他的话调用方还得自己补一条。
   *
   * `before` / `since` 与它互斥：三种都是「这一页从哪算起」，同时传两个只会让
   * 调用方以为自己拿到的是一份而实际是另一份，所以宿主的参数校验直接拒绝。
   */
  from?: string;

  /**
   * 这一页最多多少条（首屏 / 上翻 / 远控页尾段都用它）。超过
   * `MESSAGE_PAGE_SIZE_MAX` 的按上限收，不报错。
   */
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
  /**
   * 这一页**之前**还有更早的消息（上翻的终止判据）。
   *
   * 转录超过 `TRANSCRIPT_BYTES_MAX` 时它会在截断点变成 false——那时「没有更早
   * 的」不是实话，只是更早那份读不出来，所以同一个包里还带 `truncated`，界面要
   * 明说「更早的消息无法显示」，别让它安静地当成「会话开头」。
   */
  hasMore?: boolean;
  /**
   * 转录超过 `TRANSCRIPT_BYTES_MAX`，只读了尾部这一段：更早的部分取不出来。带上
   * 它的每一页都在同一个截断点之上，所以界面拿到一次就一直有效（参考物的
   * `transcriptTruncated` 同一语义）。
   */
  truncated?: boolean;
  /**
   * 这一页**之后**还有更新的消息。只有 `from` 取页会给出它：页尾不是会话末尾时
   * 为真，界面据此知道「现在这个窗口在历史里」，底部入口要按「回到最新一页」而
   * 不是「滚到底」来处理（spec 场景 18）。
   */
  hasLater?: boolean;
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
