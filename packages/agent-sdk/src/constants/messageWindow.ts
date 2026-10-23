/**
 * 消息列表的分页口径 —— 三端（桌面端 / VS Code / JetBrains）与 webview 同源，
 * 对齐 opencode（`initialMessagePageSize = 20` / `historyMessagePageSize = 200`，
 * 见 opencode `packages/app/src/context/server-session.ts`）。
 *
 * 两档页大小都是**内存与首屏时间**的约束，不是 UI 口味：一条连续用了六周的会话
 * 里有几十张 Read / MCP 读进来的截图（base64），宿主过去把整份列表推给渲染进程，
 * 最后以 V8 堆 / GC 的 native 崩溃（`CrRendererMain` 栈顶的
 * `DijkstraMarkingBarrierRangeSlow`）收场。
 *
 * 列表本身已经不再等于整条会话：它从「最近一次压缩」开始（见
 * `ui/message-rendering-system.md`「列表就是压缩后的上下文」）。分页只解决首屏
 * ——先把最近一页给渲染进程，往上滚再一页页补，而不是一次把整份列表塞过去。
 *
 * `MESSAGE_HISTORY_PAGE_SIZE` 是翻页手感与帧预算的折中：一页要够读到「刚才那几轮」，
 * 又不该一次把几 MB 的 tool 输出塞进渲染进程。
 *
 * 手机页（`packages/webview/remote/shim.js`）有自己的一套数字：它隔着中继，帧超过
 * 订阅缓冲的 1 MiB 会被**静默丢弃**，所以首屏按字节折算成 100 条 —— 那是传输约束，
 * 与本文件的宿主内推不是同一件事。
 */
export const MESSAGE_FIRST_PAGE_SIZE = 20;
export const MESSAGE_HISTORY_PAGE_SIZE = 200;

/**
 * 一页的字节上限。条数挡不住图片：一条消息里的 base64 可以顶到
 * `OUTBOUND_IMAGE_MAX_BASE64_BYTES`（5 MiB），几十条纯文字的页和一条截图的页
 * 在内存上差三个数量级。所以取一页时**条数与字节同时收**，谁先到停谁。
 *
 * 至少保留 1 条：单条就超预算时也得返回它，否则调用方拿同一个锚点反复重问，
 * 永远翻不动。
 */
export const MESSAGE_PAGE_MAX_BYTES = 4 * 1024 * 1024;
