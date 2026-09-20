/**
 * 宿主面入口 —— 所有"由宿主进程驱动 agent"的消费者（desktop 主进程、VS Code
 * 扩展宿主）**只从这里导入**，不要碰桶入口（`.`）。
 *
 * 宿主只通过 JSON-RPC 跟 `wave --stdio` 子进程讲话，它需要的东西恰好是这一组：
 *   - `./stdio`：RPC 客户端封装（StdioAgent / rpcClient / NotificationRouter）
 *   - `./constants`：与 CLI 共用的字面量（工具名、逐字文案）
 *   - `./types`：协议与消息类型
 *
 * 为什么要有这个入口：桶入口会把整套 agent 运行时（工具、供应商 SDK、OTel…）连成
 * 一张图，而图里有些模块在**求值期**就会抛（可选原生包缺席时，如 `sharp`）。
 * v1.2.5 的桌面端/插件"装出来打不开"就是有人为了复用两条文案从桶入口 import，
 * 把那份图连坐进了主进程与扩展后端（PR #2267 引入，#2281/#2283 修复）。
 *
 * 过去宿主从 `/types`、`/constants`、`/stdio` 三个窄入口分别取用，纪律是"记住别用
 * 桶"——但需求出现时作者常常不知道新值该去哪个窄入口，于是又走回桶。这里把宿主面
 * 收成一个**正向**入口：宿主需要的值都应该出现在这里，取不到就来这里加，而加完会
 * 撞上 `scripts/check-sdk-surface.mjs` 的闭包预算检查（该入口的闭包必须零第三方
 * 依赖、体积在预算内）。旧的三个子路径继续保留给外部消费者，不 breaking。
 */
export * from "../constants/index.js";
export * from "../stdio/index.js";
export * from "../types/index.js";
