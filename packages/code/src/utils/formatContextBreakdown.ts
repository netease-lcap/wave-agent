import type { ContextBreakdown, ContextCategory } from "wave-agent-sdk";

/**
 * 把 `/context` 的数据渲染成一条落进对话流的纯文本报告（spec
 * `commands/context-command.md`）。
 *
 * 为什么是纯文本而不是 Ink 组件：它要像普通消息一样可滚动回看、不抢输入框
 * （覆盖层会抢），而消息流里的文本块走 Markdown 渲染、不支持逐字符着色。所以
 * 网格只用字符密度表达用量（`⛁` 已占 / `⛶` 可用 / `⛝` 压缩保留区），颜色留给
 * 桌面端面板。
 */

/** 网格符号：已占 / 压缩保留区 / 可用。CLI 无法逐块着色，靠字符区分。 */
const GRID_CHARS = {
  used: "⛁",
  buffer: "⛝",
  free: "⛶",
  empty: "·",
} as const;

/**
 * 网格尺寸：恒为 10×10。方块代表的量 = 窗口 / 100（200k 窗口 2k 一格、1M 窗口
 * 10k 一格），所以不同窗口下网格看起来一样大、只改变每格的份量。
 */
const GRID_WIDTH = 10;
const GRID_ROWS = 10;

/** 千分位，不引依赖（报告里到处都是 token 数）。 */
function formatTokens(tokens: number): string {
  return tokens.toLocaleString("en-US");
}

function percentOfWindow(tokens: number, window: number): string {
  if (window <= 0) return "—";
  // 小于 0.1% 的项写成 `<0.1%`，免得整行看起来是 0 却还占着 tokens。
  const percent = (tokens / window) * 100;
  if (percent > 0 && percent < 0.1) return "<0.1%";
  return `${percent.toFixed(1)}%`;
}

/**
 * 网格：把窗口切成 `GRID_WIDTH × rows` 个方块，按分类顺序填色块。
 * 窗口未知（0）时画成空网格而不是除零。
 */
function renderGrid(data: ContextBreakdown): string[] {
  const { contextWindow, categories } = data;
  const perSquare =
    contextWindow > 0 ? contextWindow / (GRID_WIDTH * GRID_ROWS) : 0;

  // 每个方块按「累计边界落在哪个分类」定型，避免逐 token 累加。
  const symbols: string[] = [];
  for (let index = 0; index < GRID_WIDTH * GRID_ROWS; index += 1) {
    if (contextWindow <= 0) {
      symbols.push(GRID_CHARS.empty);
      continue;
    }
    // 取方块中点所属的分类，这样最后一块的余数不会把整块判给下一个分类。
    const midpoint = (index + 0.5) * perSquare;
    let consumed = 0;
    let symbol: string = GRID_CHARS.empty;
    for (const category of categories) {
      consumed += category.tokens;
      if (midpoint < consumed) {
        symbol =
          category.kind === "buffer"
            ? GRID_CHARS.buffer
            : category.kind === "free"
              ? GRID_CHARS.free
              : GRID_CHARS.used;
        break;
      }
    }
    symbols.push(symbol);
  }

  const lines: string[] = [];
  for (let row = 0; row < GRID_ROWS; row += 1) {
    lines.push(
      symbols.slice(row * GRID_WIDTH, (row + 1) * GRID_WIDTH).join(" "),
    );
  }
  return lines;
}

export interface FormatContextBreakdownOptions {
  /**
   * 明细最多列多少行（默认全列）。CLI 是滚动区里的一条消息，不设上限；
   * 桌面端面板自己有高度上限。
   */
  maxDetailRows?: number;
}

export function formatContextBreakdown(
  data: ContextBreakdown,
  options: FormatContextBreakdownOptions = {},
): string {
  const { contextWindow, autoCompactThreshold, model } = data;
  const maxDetailRows = options.maxDetailRows ?? Number.POSITIVE_INFINITY;
  const lines: string[] = [];

  lines.push("## Context Usage", "");
  lines.push(...renderGrid(data), "");

  lines.push(
    `**${model}** · ${formatTokens(data.usedTokens)} / ${formatTokens(
      contextWindow,
    )} tokens (${percentOfWindow(data.usedTokens, contextWindow)})`,
  );
  if (!data.measured) {
    // 新会话还没有带 usage 的响应：总量是分项估值的合计，得说清楚。
    lines.push("_No response yet — totals are estimated from the breakdown._");
  }
  if (autoCompactThreshold > 0 && contextWindow > 0) {
    // 用量环的分母是压缩阈值，报告的分母是窗口，这一行是两者的换算依据。
    lines.push(
      `Auto-compact at ${formatTokens(autoCompactThreshold)} tokens (${percentOfWindow(
        autoCompactThreshold,
        contextWindow,
      )} of window)`,
    );
  }
  lines.push("");

  lines.push("### Estimated usage by category", "");
  for (const category of data.categories) {
    lines.push(categoryLine(category, contextWindow));
  }
  lines.push("");

  lines.push(...detailSections(data, maxDetailRows));

  if (data.errors.length > 0) {
    lines.push("### Unavailable sources", "");
    for (const error of data.errors) {
      lines.push(`- ${error}`);
    }
    lines.push("");
  }

  // 末尾不留空行：这条文本会以 Markdown 渲染，尾部空行只是空白。
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}

function categoryLine(
  category: ContextCategory,
  contextWindow: number,
): string {
  const symbol =
    category.kind === "buffer"
      ? GRID_CHARS.buffer
      : category.kind === "free"
        ? GRID_CHARS.free
        : GRID_CHARS.used;
  return `${symbol} ${category.name}: ${formatTokens(category.tokens)} tokens (${percentOfWindow(
    category.tokens,
    contextWindow,
  )})`;
}

function detailSections(
  data: ContextBreakdown,
  maxDetailRows: number,
): string[] {
  const lines: string[] = [];

  const section = (
    title: string,
    hint: string | undefined,
    rows: Array<[string, number]>,
  ) => {
    if (rows.length === 0) return;
    lines.push(`### ${title}${hint ? ` · ${hint}` : ""}`, "");
    const shown = rows.slice(0, maxDetailRows);
    for (const [name, tokens] of shown) {
      lines.push(`- ${name}: ${formatTokens(tokens)} tokens`);
    }
    const hidden = rows.length - shown.length;
    if (hidden > 0) {
      lines.push(`- …and ${hidden} more`);
    }
    lines.push("");
  };

  section(
    "MCP tools",
    "/mcp",
    data.mcpTools.map((tool) => [
      `${tool.serverName} · ${tool.name}`,
      tool.tokens,
    ]),
  );
  section(
    "System tools",
    undefined,
    data.systemTools.map((tool) => [tool.name, tool.tokens]),
  );
  section(
    "Memory files",
    "/memory",
    data.memoryFiles.map((file) => [
      `${file.type} · ${file.path}`,
      file.tokens,
    ]),
  );
  section(
    "Skills",
    "/skills",
    data.skills.map((skill) => [skill.name, skill.tokens]),
  );
  section(
    "Custom agents",
    "/agents",
    data.agents.map((agent) => [agent.name, agent.tokens]),
  );

  return lines;
}
