/**
 * 一页的条数：首屏、上翻取更早、不带 `limit` 时的默认页大小都用它。
 *
 * `200` 与参考物同值（它取最新窗口与更早一页都是 `limit: 200`，条数交给渲染侧
 * 虚拟化扛）。**只按条数收，没有字节上限**——参考物也没有这一层。曾经有过一道
 * `4 MiB` 的字节预算，数的是「还没剥离工具图片 base64」的字节，而那批字节在
 * 下发 UI 前就被 `packages/code/src/stdio/uiPayload.ts` 剥掉了：它量的东西不会
 * 上线，只会把带截图的会话首屏砍短。
 */
export const MESSAGE_PAGE_SIZE = 200;

/**
 * 一页条数的上限：`normaliseLimit` 把超出的按这个数收，不是报错。
 *
 * `1000` 与参考物同值——它读本地转录分页时对 `limit` 做 `clamp(1, 1000)`。
 * 我们的调用方都传 `MESSAGE_PAGE_SIZE`，这道闸门只防一个写错的数字（宿主透传、
 * 或将来新增的调用点）把整份历史一次拉进回包。
 */
export const MESSAGE_PAGE_SIZE_MAX = 1000;

/**
 * 大纲索引里每条问句的文本上限（spec ui/transcript-outline.md 场景 16）。
 *
 * 与 webview 的 `OUTLINE_QUESTION_LIMIT` 同值：索引决定「最多带过去多少」，页面
 * 决定「预览卡最多展示多少」。两边不同值只会在悬停时露半句话——所以页面那边
 * 直接引用这个常量，不另写一份数字。
 */
export const OUTLINE_TEXT_LIMIT = 400;
