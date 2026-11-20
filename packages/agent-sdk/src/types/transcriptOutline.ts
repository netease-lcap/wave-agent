/**
 * 会话消息大纲的索引项（spec ui/transcript-outline.md 场景 16）。
 *
 * 整份索引要能一次发给页面，所以只装「画一个刻度 + 点击时当锚点」需要的东西：
 * 消息 id 与文本首段。blocks、工具输出、时间戳、用量一概不进——页面画刻度时
 * 不依赖任何一条正文已经到达（场景 16 的最后一句）。
 */
export interface TranscriptOutlineEntry {
  /**
   * 消息 id。点击这个刻度时，页面拿它当 `MessageWindow.from` 的锚点去要那一页
   * （场景 17），所以索引项的顺序就是刻度从上到下的顺序。
   */
  id: string;
  /** 用户消息的文本首段，已按 `OUTLINE_TEXT_LIMIT` 截断。 */
  text: string;
}
