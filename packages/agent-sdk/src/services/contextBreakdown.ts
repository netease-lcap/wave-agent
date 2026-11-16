import type {
  ContextBreakdown,
  ContextCategory,
} from "../types/contextBreakdown.js";
import { contextUsagePercent } from "../utils/tokenCalculation.js";

export interface ContextBreakdownInput {
  model: string;
  contextWindow: number;
  maxOutputTokens: number;
  /** 自动压缩阈值（与用量环同一口径） */
  autoCompactThreshold: number;
  /** 请求体里 system prompt 的全文（各块拼起来） */
  systemPromptTokens: number;
  /** 非 MCP 工具的 schema 体积 */
  systemTools: Array<{ name: string; tokens: number }>;
  /** MCP 工具的 schema 体积 */
  mcpTools: Array<{ serverName: string; name: string; tokens: number }>;
  /** 注入的记忆文本体积 */
  memoryFiles: Array<{
    type: "project" | "user" | "rules";
    path: string;
    tokens: number;
  }>;
  /** 技能清单（对话里下发的那条元消息）的逐项体积 */
  skills: Array<{ name: string; tokens: number }>;
  /** 子代理清单的逐项体积 */
  agents: Array<{ name: string; tokens: number }>;
  /**
   * 持久对话历史的估值，**含**上面两份清单（它们本身就是历史里的消息）。
   * 服务会把清单体积扣出去，避免同一段文字被算两次。
   */
  messagesTokens: number;
  /**
   * 上一次响应报出的 `total_tokens`（与输入框旁用量环同源）。
   * 0 表示这个会话还没有任何带 usage 的响应。
   */
  measuredTokens: number;
  errors?: string[];
}

function sumTokens(items: Array<{ tokens: number }>): number {
  return items.reduce((sum, item) => sum + item.tokens, 0);
}

/**
 * 把各部分体积装配成 `/context` 的报告数据。
 *
 * 分母规则（见 spec `commands/context-command.md` 用户故事 3）：分类百分比
 * 一律以**上下文窗口**为分母，所以「used 合计 + buffer + free = 窗口」恒成立；
 * `ringPercent` 额外给一份以压缩阈值为分母的百分比，让用户能把报告和输入框旁
 * 的用量环对上。
 *
 * 顶部 `usedTokens` 优先用实测（上次响应的 `total_tokens`，含 system prompt /
 * 工具 schema / cache 命中）；分类则各自是本地估值。两者不保证相加相等 ——
 * 估算只回答「谁占的」，实测回答「一共多少」。
 */
export function buildContextBreakdown(
  input: ContextBreakdownInput,
): ContextBreakdown {
  const window = Number.isFinite(input.contextWindow)
    ? Math.max(0, input.contextWindow)
    : 0;

  const systemTools = [...input.systemTools].sort(
    (a, b) => b.tokens - a.tokens,
  );
  const mcpTools = [...input.mcpTools].sort((a, b) => b.tokens - a.tokens);
  const memoryFiles = [...input.memoryFiles]
    .filter((file) => file.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);
  const skills = [...input.skills]
    .filter((item) => item.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);
  const agents = [...input.agents]
    .filter((item) => item.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);

  // 两份清单是历史消息的一部分（`utils/skillListing.ts` /
  // `utils/agentListing.ts` 下发），已经计入 `messagesTokens`。单列它们就必须
  // 从 Messages 里扣掉，否则同一段文字在报告里出现两次。
  const listingTokens = sumTokens(skills) + sumTokens(agents);
  const messagesTokens = Math.max(0, input.messagesTokens - listingTokens);

  const estimated: Array<{
    id: ContextCategory["id"];
    name: string;
    tokens: number;
  }> = [
    {
      id: "systemPrompt",
      name: "System prompt",
      tokens: input.systemPromptTokens,
    },
    { id: "systemTools", name: "System tools", tokens: sumTokens(systemTools) },
    { id: "mcpTools", name: "MCP tools", tokens: sumTokens(mcpTools) },
    { id: "memory", name: "Memory files", tokens: sumTokens(memoryFiles) },
    { id: "skills", name: "Skills", tokens: sumTokens(skills) },
    { id: "agents", name: "Custom agents", tokens: sumTokens(agents) },
    { id: "messages", name: "Messages", tokens: messagesTokens },
  ];

  const estimatedUsed = estimated.reduce((sum, item) => sum + item.tokens, 0);
  const measured = input.measuredTokens > 0;
  const usedTokens = measured ? input.measuredTokens : estimatedUsed;

  // 估算偶尔会高过实测（字符估算偏保守、CJK 按 1 字 1 token）。取两者较大值
  // 算剩余空间，避免出现「free 为负」或「分项加起来超过窗口」的观感。
  const consumed = Math.max(usedTokens, estimatedUsed);
  const autoCompactThreshold =
    input.autoCompactThreshold > 0
      ? Math.min(
          input.autoCompactThreshold,
          window || input.autoCompactThreshold,
        )
      : window;
  const bufferTokens = Math.max(0, window - autoCompactThreshold);
  const freeTokens = Math.max(0, autoCompactThreshold - consumed);

  const categories: ContextCategory[] = estimated
    .filter((item) => item.tokens > 0)
    .map((item) => ({
      id: item.id,
      kind: "used" as const,
      name: item.name,
      tokens: item.tokens,
    }));

  if (bufferTokens > 0) {
    categories.push({
      id: "buffer",
      kind: "buffer",
      name: "Autocompact buffer",
      tokens: bufferTokens,
    });
  }
  categories.push({
    id: "free",
    kind: "free",
    name: "Free space",
    tokens: freeTokens,
  });

  const percentOfWindow = (tokens: number): number =>
    window > 0 ? Math.round((tokens / window) * 100) : 0;

  return {
    model: input.model,
    contextWindow: window,
    autoCompactThreshold,
    maxOutputTokens: input.maxOutputTokens,
    usedTokens,
    measured,
    usedPercent: percentOfWindow(usedTokens),
    ringPercent:
      window > 0
        ? contextUsagePercent(usedTokens, window, input.maxOutputTokens)
        : 0,
    categories,
    mcpTools,
    systemTools,
    memoryFiles,
    skills,
    agents,
    errors: input.errors ?? [],
  };
}
