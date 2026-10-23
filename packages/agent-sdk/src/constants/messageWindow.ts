/**
 * 消息列表的分页口径 —— 三端（桌面端 / VS Code / JetBrains）与 webview 同源，
 * 对齐 opencode（`initialMessagePageSize = 20` / `historyMessagePageSize = 200`，
 * 见 opencode `packages/app/src/context/server-session.ts`）。
 *
 * 两档页大小都是**内存约束**，不是 UI 口味：压缩只折叠模型上下文，显示历史一条
 * 都不少（转录是 append-only 的 JSONL，全量真源在盘上）；宿主过去把整份列表拉进
 * 内存、再整份推给渲染进程，于是两端从第一屏起就持有全部消息（含 tool 输出与
 * base64 图片），最后以 V8 堆 / GC 的 native 崩溃
 * （`CrRendererMain` 栈顶的 `DijkstraMarkingBarrierRangeSlow`）收场。
 *
 * 现在两端都只持有页：SDK 侧显示流留一个常驻尾窗（够覆盖「还没落盘的尾部 +
 * 一页」），宿主缓存只留首屏那一页，翻更早的页直接从转录读、谁也不留。
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

/**
 * 一页的字节上限。条数挡不住图片：一条消息里的 base64 可以顶到
 * `OUTBOUND_IMAGE_MAX_BASE64_BYTES`（5 MiB），几十条纯文字的页和一条截图的页
 * 在内存上差三个数量级。所以取一页时**条数与字节同时收**，谁先到停谁。
 *
 * 至少保留 1 条：单条就超预算时也得返回它，否则调用方拿同一个锚点反复重问，
 * 永远翻不动。
 */
export const MESSAGE_PAGE_MAX_BYTES = 4 * 1024 * 1024;

/**
 * SDK 侧显示流的常驻条数。它不是页大小：页是给宿主的，常驻窗口是给「还没落盘
 * 的尾部」留的——`saveSession` 在轮次边界上写盘，正在流式生成的那几条只能从内存
 * 取；留够「一格页 + 余量」就够翻页衔接，再多的部分从转录读。
 */
export const MESSAGE_RESIDENT_SIZE = 50;
