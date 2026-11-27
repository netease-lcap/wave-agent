/**
 * `ReportFindings` 的 `data` 形状与 `data → 文本` 渲染器。
 *
 * 形状与文本都照 CC 2.1.332（`~/.cache/cc-reference/2.1.332-win32-x64/js/`）：
 *
 * - 输出 schema `ol()`：`1050-213838B-CQo.js:2853`；
 * - `create().call()` 返回 `{ count, level, findings }`：`:2916`；
 * - `mapToolResultToToolResultBlockParam`：`:2933` —— `count === 0` 给
 *   `"No findings reported."`，否则给 `N finding(s) reported.`（`x()` 的单复数）；
 * - 入参 schema `_Va()` 与单条发现 `$li()`：`1032-1649B-Oes.js:19-22`。
 *
 * 要点：
 *
 * - **明细只在 `data` 里**。模型侧那段文本是一句桩，不含任何条目 —— 这正是这个
 *   工具存在的理由：模型没有可抄的清单，就不会在正文里把同一批发现再列一遍
 *   （CC 的描述原文写着 "do not also print the findings as text"）。
 * - `count` 由工具数出来再交给渲染器，所以宿主读 `data.count` 与模型读到的
 *   那句话永远一致。
 * - `level` 在 CC 里可选；`call()` 里写成 `{ count, level, findings }`，没传时
 *   这个键的值是 `undefined`（落盘成 JSON 时整个键消失），所以这里也照抄这个
 *   形状，而不是自己另造一个判据。
 * - 上限与枚举取值全是 CC 的数字，见下面几个常量与 {@link reportFindingSchema}。
 */

/** CC 的 `findings: O($li()).max(32)`（`1032-1649B-Oes.js:21`）。 */
export const MAX_REPORTED_FINDINGS = 32;

/** CC 的 `short_summary: r().max(60)`。 */
export const SHORT_SUMMARY_MAX_CHARS = 60;

/** CC 的 `category: r().max(40)`。 */
export const CATEGORY_MAX_CHARS = 40;

/** CC 的 `level: U(["low","medium","high","xhigh","max"])`。 */
export const REVIEW_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

/** CC 的 `Oes`（`1032-1649B-Oes.js:18`）：`severity` 的三个取值。 */
export const FINDING_SEVERITIES = ["important", "pre_existing", "nit"] as const;

/** CC 的 `verdict` 两个取值：核实过 / 只是看起来像。 */
export const FINDING_VERDICTS = ["CONFIRMED", "PLAUSIBLE"] as const;

/** CC 的 `outcome` 三个取值：`--fix` 之后每条发现的结果。 */
export const FINDING_OUTCOMES = [
  "fixed",
  "skipped",
  "no_change_needed",
] as const;

export type ReviewLevel = (typeof REVIEW_LEVELS)[number];
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];
export type FindingVerdict = (typeof FINDING_VERDICTS)[number];
export type FindingOutcome = (typeof FINDING_OUTCOMES)[number];

/** 一条发现（CC 的 `$li()`）。字段名照抄 CC 的 snake_case。 */
export interface ReportFindingData {
  /** 仓库相对路径。 */
  file: string;
  /** 1 起算的行号；锚不到具体行时不传。 */
  line?: number;
  /** 缺陷陈述。 */
  summary: string;
  /** 紧凑 UI 用的压扁标签（≤60 字）：只留主张，不带理由与后果。 */
  short_summary?: string;
  /** 具体的输入/状态 → 错误输出/崩溃。 */
  failure_scenario: string;
  /** 发现类型的短 kebab-case 标签（≤40 字）。 */
  category?: string;
  /** 审查指令要求时才带。 */
  severity?: FindingSeverity;
  /** 跑过核实那一遍时才带。 */
  verdict?: FindingVerdict;
  /** 只在 `--fix` 之后复报时带：这条最后怎么了。 */
  outcome?: FindingOutcome;
}

/** 这个工具唯一的 `data`（CC 的 `ol()`）。 */
export interface ReportFindingsResultData {
  /** 发现条数 —— 与模型读到的桩句里的数字同源。 */
  count: number;
  /** 本次审查的努力级别；不是按级别跑的审查就不带。 */
  level?: ReviewLevel;
  /** 整份清单原样回传，宿主据此渲染。 */
  findings: ReportFindingData[];
}

/**
 * 单条发现的 JSON Schema（CC 的 `$li()`），入参的 `findings.items` 与输出 schema
 * 的 `findings.items` 共用同一份：CC 那边是同一个 zod 对象。
 */
export const reportFindingSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    file: {
      type: "string",
      description: "Repo-relative path of the file the finding is in",
    },
    line: {
      type: "integer",
      description: "1-indexed line the finding anchors to",
    },
    summary: { type: "string", description: "Statement of the defect" },
    short_summary: {
      type: "string",
      maxLength: SHORT_SUMMARY_MAX_CHARS,
      description:
        "Compressed label for compact UI (max " +
        SHORT_SUMMARY_MAX_CHARS +
        " chars): the claim alone, no rationale or consequence clause",
    },
    failure_scenario: {
      type: "string",
      description: "Concrete inputs/state → wrong output/crash",
    },
    category: {
      type: "string",
      maxLength: CATEGORY_MAX_CHARS,
      description:
        'Short kebab-case slug of the finding type, e.g. "correctness", "simplification", "efficiency", "test-coverage"',
    },
    severity: {
      type: "string",
      enum: FINDING_SEVERITIES,
      description:
        "Set when the review instructions ask for it. important: a bug the change adds or makes worse; pre_existing: a bug that was there before the change; nit: a minor issue",
    },
    verdict: {
      type: "string",
      enum: FINDING_VERDICTS,
      description: "Set when a verify pass ran; absent on inline-only reviews",
    },
    outcome: {
      type: "string",
      enum: FINDING_OUTCOMES,
      description:
        "Set ONLY when re-reporting after applying fixes: what happened to this finding",
    },
  },
  required: ["file", "summary", "failure_scenario"],
  additionalProperties: false,
};

/**
 * `ReportFindings` 的 `data` 形状（JSON Schema），供 REPL 把签名渲染成真实返回
 * 类型（spec core/repl-tool.md「公告分档呈现」）。与 {@link ReportFindingsResultData}
 * 逐字段对应，改一处必须改另一处。
 */
export const reportFindingsOutputSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    count: {
      type: "number",
      description: "Number of findings reported",
    },
    level: {
      type: "string",
      enum: REVIEW_LEVELS,
      description: "Effort level the review ran at",
    },
    findings: {
      type: "array",
      items: reportFindingSchema,
      description: "Echoed for the result body",
    },
  },
  required: ["count", "findings"],
  additionalProperties: false,
};

/**
 * 模型侧文本：一句桩，没有条目（CC 的 `mapToolResultToToolResultBlockParam`）。
 *
 * `count === 0` 单独一句，因为「没有发现」是审查的正常结论，不该长成
 * `0 findings reported.`。
 */
export function renderReportFindingsResultData(
  data: ReportFindingsResultData,
): string {
  if (data.count === 0) return "No findings reported.";
  return data.count + " " + findingWord(data.count) + " reported.";
}

/** CC 的 `x(n, "finding")`：1 用单数，其余用复数。 */
export function findingWord(count: number): string {
  return count === 1 ? "finding" : "findings";
}
