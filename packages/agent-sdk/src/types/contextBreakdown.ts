/**
 * `/context` 的数据形状（spec `commands/context-command.md`）。
 *
 * 对齐 Claude Code 的 `/context`（CLI 的 `analyzeContextUsage` 与桌面端
 * `get_context_usage` 控制请求）的**语义**，但不照搬它的取数路径：它按分类
 * 额外发 token 计数请求，我们只做本地估算（各部分文本都在进程内）。
 *
 * 两条硬规则，前端必须照此渲染：
 * - 分类**按 `id` / `kind` 判断**，不要按 `name`（显示名会变，CC 的
 *   `get_context_usage` 契约里对同一件事写的是 "Classify on this, never on
 *   the English name"）；
 * - 百分比分母一律是 `contextWindow`，不是压缩阈值。因此
 *   「`kind: "used"` 合计 + `buffer` + `free` = `contextWindow`」恒成立。
 */
export type ContextCategoryId =
  | "systemPrompt"
  | "systemTools"
  | "mcpTools"
  | "memory"
  | "skills"
  | "agents"
  | "messages"
  | "buffer"
  | "free";

/**
 * `used` 占用窗口；`buffer` 是压缩阈值到窗口的保留区（不参与对话）；
 * `free` 是到压缩阈值为止的余量。
 */
export type ContextCategoryKind = "used" | "buffer" | "free";

export interface ContextCategory {
  id: ContextCategoryId;
  kind: ContextCategoryKind;
  /** 显示名（英文，与 CC 的 `/context` 一致）；判断语义请用 `id` */
  name: string;
  tokens: number;
}

export interface ContextBreakdown {
  model: string;
  /** 上下文窗口（百分比分母） */
  contextWindow: number;
  /** 自动压缩阈值；用量环的 100% 就落在这里 */
  autoCompactThreshold: number;
  maxOutputTokens: number;
  /**
   * 已用 tokens：优先取上一次响应报出的 `total_tokens`（与用量环同源），
   * 会话还没有响应时退回分项估值之和。
   */
  usedTokens: number;
  /** `usedTokens` 是否来自实测（false = 纯本地估值） */
  measured: boolean;
  /** 已用占总窗口的百分比（与分类百分比同一分母） */
  usedPercent: number;
  /** 用量环口径的百分比（分母为压缩阈值），便于与输入框旁的环对齐 */
  ringPercent: number;
  categories: ContextCategory[];
  /** MCP 工具明细，按体积降序 */
  mcpTools: Array<{ serverName: string; name: string; tokens: number }>;
  /** 非 MCP 工具 schema 明细，按体积降序 */
  systemTools: Array<{ name: string; tokens: number }>;
  /** 技能清单明细（对话里下发的那份），按体积降序 */
  skills: Array<{ name: string; tokens: number }>;
  /** 子代理清单明细，按体积降序 */
  agents: Array<{ name: string; tokens: number }>;
  /** 注入的记忆明细（项目 / 用户 / 个人 / 自动规则），按体积降序 */
  memoryFiles: Array<{
    type: "project" | "user" | "local" | "rules";
    path: string;
    tokens: number;
  }>;
  /** 取数过程中的失败（不阻断报告，但要可见） */
  errors: string[];
}
