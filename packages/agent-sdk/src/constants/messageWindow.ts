/**
 * 消息列表的分页口径 —— 三端（桌面端 / VS Code / JetBrains）与 webview 同源，
 * 对齐 opencode（`initialMessagePageSize = 20` / `historyMessagePageSize = 200`，
 * 见 opencode `packages/app/src/context/server-session.ts`）。
 *
 * `MESSAGE_FIRST_PAGE_SIZE` 是**内存约束**，不是 UI 口味：压缩只折叠模型上下文
 * （`messageManager` 的 `displayMessages` 全量保留、永不裁剪），一个连续用了 6 周
 * 的会话一条消息都不少；宿主过去把整份列表推给渲染进程，于是渲染进程从第一屏起就
 * 持有全部消息（含 tool 输出与 base64 图片），最后以 V8 堆 / GC 的 native 崩溃
 * （`CrRendererMain` 栈顶的 `DijkstraMarkingBarrierRangeSlow`）收场。首屏只进一页，
 * 历史按需拉。
 *
 * `MESSAGE_HISTORY_PAGE_SIZE` 是翻页手感与帧预算的折中：一页要够读到「刚才那几轮」，
 * 又不该一次把几 MB 的 tool 输出塞回渲染进程。
 *
 * 手机页（`packages/webview/remote/shim.js`）有自己的一套数字：它隔着中继，帧超过
 * 订阅缓冲的 1 MiB 会被**静默丢弃**，所以首屏按字节折算成 100 条 —— 那是传输约束，
 * 与本文件的宿主内推不是同一件事。
 */
export const MESSAGE_FIRST_PAGE_SIZE = 20;
export const MESSAGE_HISTORY_PAGE_SIZE = 200;
