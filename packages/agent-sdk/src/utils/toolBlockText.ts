/**
 * 一段工具结果的文本视图（issue #3055 阶段 2）。
 *
 * 新转录的工具块里**两份都有**：`result` 是模型当时读到的那份全文，`data` 是同一份
 * 结果的结构化骨架（落盘前按工具剥掉了大块载荷，见 `tools/resultData/strip.ts`）。
 * SDK 内部有五个地方要那段文本：模型侧 tool_result（`convertMessagesForAPI`）、mod
 * 事件的 `tool_result`（`modManager`）、导出 markdown（`transcriptArchive`），以及
 * 压缩前抓的两份上下文（`messageManager` 的「最近读过的文件」与「调用过的技能」）。
 * 它们一律走这里，别各自拼 `block.result ?? …`。
 *
 * 顺序是 **`result` 优先、`data` 兜底**，不要反过来 —— 「`data` 更结构化、所以更新」
 * 在这里恰恰不成立：
 *
 * - 老转录只有 `result`（阶段 2 之前写下的），它才是模型当时真正看到的那份文本；
 * - 新转录的 `result` 是**全文**，而 `data` 是剥过的骨架（`Read` 的
 *   `file.content`、`Bash` 的 `stdout` / `stderr` 落盘时已经是空串）。拿 `data`
 *   现渲，`Read` 会渲成一句「文件是空的」的 warning、`Bash` 会渲成空正文。所以
 *   只要有 `result` 就必须用它；
 * - `data` 兜底的场景因此只剩两类：还没有 `result` 的块（测试里手搓的、
 *   老形态只给 `data` 的），以及本来就没有文本形态、只有 `data` 的结果。
 *
 * 两级都拿不到（`Read` 的图片 / pdf / 二进制档这类本来就没有文本形态的结果）时返回
 * `undefined`：调用方必须按「没有文本」处理，不能当成空输出。
 *
 * 渲染器表只依赖 `tools/resultData/` 的纯模块与 `constants/`，可以安全地进任何宿主
 * 侧读路径（webview 拿不到它，那边靠宿主注入，见 spec 与 issue #3055 阶段 C）。
 */
import { renderToolResultData } from "../tools/resultData/index.js";
import type { Message, ToolBlock } from "../types/messaging.js";
import type { ToolBlockUpdateCallbackParams } from "./messageOperations.js";

export function toolBlockText(
  block: Pick<ToolBlock, "name" | "data" | "result">,
): string | undefined {
  if (block.result !== undefined) return block.result;
  return renderToolResultData(block.name ?? "", block.data);
}

/**
 * 反方向的同一份文本：**交给宿主的块**（issue #3055 阶段 2 · C）。
 *
 * 四端 UI 只读 `ToolBlock.result`——webview 尤其如此，它拿不到渲染器（浏览器
 * bundle 只允许 `wave-agent-sdk/types` 与 `/constants`，由 `check-sdk-surface`
 * 把守）。新转录已经双写、块里就有 `result`，所以这条补文本的路径现在只剩两类
 * 历史/边界形状：只有 `data` 的老块（双写之前写下的那种），以及只带 `data`、
 * 没有文本来源的表外结果。
 *
 * 只补不改：已有 `result` 的块、没有渲染器的表外工具（MCP、插件工具）、渲染器渲
 * 不出文本的结果（`Read` 的图片 / pdf / 二进制 / 超 token）原样返回，连对象身份
 * 都不变——所以长会话里绝大多数块是零成本的，也不会因为「补过」而把文本写回转录。
 *
 * 同一块会被反复要（`Agent.messages` 每帧一次），而一份 `data` 可能渲出很长的正文
 * （artifact HTML、知识库全文、子代理报告），所以按块对象缓存：块是不可变的，每次
 * 更新都会换一个新对象，缓存因此天然失效。
 */
const hostTextCache = new WeakMap<ToolBlock, string>();

export function toolBlockForHost(block: ToolBlock): ToolBlock {
  if (block.result !== undefined || block.data === undefined) return block;
  const cached = hostTextCache.get(block);
  const rendered = cached ?? renderToolResultData(block.name ?? "", block.data);
  if (rendered === undefined) return block;
  hostTextCache.set(block, rendered);
  return { ...block, result: rendered };
}

/** 一条消息的宿主视图：工具块补上文本，没有工具块 / 无需补时原样返回。 */
export function messageForHost(message: Message): Message {
  const { blocks } = message;
  if (!Array.isArray(blocks)) return message;
  const hydrated = blocks.map((block) =>
    block.type === "tool" ? toolBlockForHost(block) : block,
  );
  const changed = hydrated.some((block, index) => block !== blocks[index]);
  return changed ? { ...message, blocks: hydrated } : message;
}

/** `messageForHost` over a list / page, preserving the array when nothing changed. */
export function messagesForHost(messages: Message[]): Message[] {
  const hydrated = messages.map(messageForHost);
  const changed = hydrated.some(
    (message, index) => message !== messages[index],
  );
  return changed ? hydrated : messages;
}

/**
 * `toolBlockUpdated` 推送帧的宿主视图：与新转录的块同一口径，`start` / `running`
 * 帧本来就没有结果，原样返回。帧是一次性的，不走上面的块缓存。
 */
export function toolBlockUpdateForHost(
  params: ToolBlockUpdateCallbackParams,
): ToolBlockUpdateCallbackParams {
  if (params.result !== undefined || params.data === undefined) return params;
  const rendered = renderToolResultData(params.name ?? "", params.data);
  return rendered === undefined ? params : { ...params, result: rendered };
}
