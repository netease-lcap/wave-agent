import { REPORT_FINDINGS_TOOL_NAME } from "../constants/tools.js";
import {
  CATEGORY_MAX_CHARS,
  FINDING_OUTCOMES,
  FINDING_SEVERITIES,
  FINDING_VERDICTS,
  MAX_REPORTED_FINDINGS,
  REVIEW_LEVELS,
  SHORT_SUMMARY_MAX_CHARS,
  findingWord,
  renderReportFindingsResultData,
  reportFindingSchema,
  reportFindingsOutputSchema,
  type ReportFindingData,
  type ReportFindingsResultData,
} from "./resultData/reportFindings.js";
import type { ToolPlugin, ToolResult } from "./types.js";

/**
 * CC 2.1.332 的 `X1i`（`0640-9992B-aut.js:182`），逐字照抄：它是给模型看的工具
 * 描述，改一个字都要先回 CC 对一遍。CC 那边 `description()` 与 `prompt()` 返回
 * 同一段话，这里也一边一份（lean 模式没有更短的变体，同样照 CC）。
 */
const REPORT_FINDINGS_DESCRIPTION =
  "Report code-review findings as a typed list so the host UI can render them. Use this only when the active code-review instructions tell you to report findings with this tool; otherwise follow whatever output format those instructions specify. When reporting a review's results, call it once with the verified findings ranked most-severe first (empty array if nothing survived verification) and do not also print the findings as text. When re-reporting after applying fixes (only if the apply instructions ask for it), set `outcome` on each finding to what actually happened.";

/**
 * `ReportFindings`：`/code-review` 把清单交给宿主的唯一通道。
 *
 * 模型调一次，宿主拿到 `{ count, level, findings }` 去渲染，而模型自己的
 * tool_result 只有一句桩（`"N findings reported."` / `"No findings reported."`）。
 * 这是刻意的：清单不进上下文，模型就没有可抄的东西，于是不会在正文里把同一批
 * 发现再列一遍（CC 的描述原文："do not also print the findings as text"）。
 *
 * 复报用同一个工具第二次、同一条发现、多一个 `outcome`，宿主据此更新每条的状态
 * ——所以这个工具自身不记状态，也不读任何东西：同样的入参永远得到同样的 `data`。
 *
 * 校验分两层，两层都要在：
 *
 * - 声明层（{@link reportFindingSchema} + `config.function.parameters`）由
 *   `toolManager` 用 `validateToolInput` 在调用前判一遍（类型、必填、多余键、
 *   enum、整数行号）；
 * - 这里再判一遍，两层缺一不可：**声明层不认识 `maxItems` / `maxLength`**
 *   （`inputValidation.ts` 只解释 type / required / enum / 未知键），而 32 条、
 *   60 字、40 字这三个上限是 CC 的 zod 会拒的；反过来，直连 `execute` 的调用
 *   （用例、模组）不经过 `toolManager`，也就没有声明层那一遍。
 */
export const reportFindingsTool: ToolPlugin = {
  name: REPORT_FINDINGS_TOOL_NAME,
  // 不做 defer：/code-review 交付那一步必须直接可达，藏进搜索换一轮问句不值。
  searchHint: "report code-review findings as a structured list",
  outputSchema: reportFindingsOutputSchema,
  config: {
    type: "function",
    function: {
      name: REPORT_FINDINGS_TOOL_NAME,
      description: REPORT_FINDINGS_DESCRIPTION,
      // CC 的 `_Va()`（`1032-1649B-Oes.js:19`）。
      parameters: {
        type: "object",
        properties: {
          level: {
            type: "string",
            enum: REVIEW_LEVELS,
            description: "Effort level the review ran at",
          },
          findings: {
            type: "array",
            items: reportFindingSchema,
            maxItems: MAX_REPORTED_FINDINGS,
            description:
              "Verified findings, most-severe first; empty if none survived",
          },
        },
        required: ["findings"],
        additionalProperties: false,
      },
    },
  },
  // 只写自己的结果，不碰文件、不发请求。
  isConcurrencySafe: true,
  prompt: () => REPORT_FINDINGS_DESCRIPTION,
  // 折叠行读的是「值」那半段（工具名由宿主自己拼在前头），形状照 CC 的
  // `renderToolUseMessage`：`<level> · N findings`。
  formatCompactParams: (params) => {
    const level = typeof params.level === "string" ? params.level : "review";
    const count = Array.isArray(params.findings) ? params.findings.length : 0;
    return level + " · " + count + " " + findingWord(count);
  },
  execute: async (args): Promise<ToolResult> => {
    const issues: string[] = [];

    // 顺序即报错顺序：先是级别，再是清单本身的条数上限，最后逐条。
    const level = optionalEnum(args, "", "level", REVIEW_LEVELS, issues);

    let findings: ReportFindingData[] = [];
    const rawFindings = args.findings;
    if (!Array.isArray(rawFindings)) {
      issues.push("findings must be an array");
    } else {
      if (rawFindings.length > MAX_REPORTED_FINDINGS) {
        issues.push(
          "at most " +
            MAX_REPORTED_FINDINGS +
            " findings per call, got " +
            rawFindings.length,
        );
      }
      findings = rawFindings
        .map((raw, index) => normalizeFinding(raw, index, issues))
        .filter(
          (finding): finding is ReportFindingData => finding !== undefined,
        );
    }

    if (issues.length > 0) {
      return {
        success: false,
        content: "",
        error: issues
          .map((issue) => REPORT_FINDINGS_TOOL_NAME + ": " + issue)
          .join("\n"),
      };
    }

    const data: ReportFindingsResultData = {
      count: findings.length,
      level,
      findings,
    };

    return {
      success: true,
      data,
      content: renderReportFindingsResultData(data),
      shortResult:
        findings.length === 0
          ? "No findings"
          : findings.length + " " + findingWord(findings.length),
    };
  },
};

/** `findings[0].short_summary` / 顶层的 `level`：同一个拼法。 */
function fieldPath(parent: string, key: string): string {
  return parent === "" ? key : parent + "." + key;
}

/** 必填字符串（CC 的 `r()`，没有长度上限）。 */
function requiredText(
  input: Record<string, unknown>,
  parent: string,
  key: string,
  issues: string[],
): string | undefined {
  const value = input[key];
  const name = fieldPath(parent, key);
  if (value === undefined || value === null) {
    issues.push(name + " is required");
    return undefined;
  }
  if (typeof value !== "string") {
    issues.push(name + " must be a string");
    return undefined;
  }
  return value;
}

/** 可选字符串（CC 的 `r().max(n).optional()`）：不传就不进 `data`。 */
function optionalText(
  input: Record<string, unknown>,
  parent: string,
  key: string,
  maxChars: number,
  issues: string[],
): string | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  const name = fieldPath(parent, key);
  if (typeof value !== "string") {
    issues.push(name + " must be a string");
    return undefined;
  }
  if (value.length > maxChars) {
    issues.push(
      name +
        " is " +
        value.length +
        " characters, at most " +
        maxChars +
        " allowed",
    );
    return undefined;
  }
  return value;
}

/** 可选整数（CC 的 `E().int().optional()`）：1 起算的行号。 */
function optionalLine(
  input: Record<string, unknown>,
  parent: string,
  issues: string[],
): number | undefined {
  const value = input.line;
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    issues.push(fieldPath(parent, "line") + " must be an integer");
    return undefined;
  }
  return value;
}

/** 可选枚举（CC 的 `U([...])`）：取值只在 CC 列出的那几个里。 */
function optionalEnum<T extends string>(
  input: Record<string, unknown>,
  parent: string,
  key: string,
  allowed: readonly T[],
  issues: string[],
): T | undefined {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== "string" ||
    !(allowed as readonly string[]).includes(value)
  ) {
    issues.push(
      fieldPath(parent, key) +
        " is invalid: expected one of " +
        allowed.map((entry) => JSON.stringify(entry)).join(", "),
    );
    return undefined;
  }
  return value as T;
}

/**
 * 一条发现的规范化：只保留 CC schema 里有的键，可选键没给就不出现（不造空字段），
 * 顺便把模型多传的键丢掉，然后原样回传。
 */
function normalizeFinding(
  raw: unknown,
  index: number,
  issues: string[],
): ReportFindingData | undefined {
  const parent = "findings[" + index + "]";
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    issues.push(parent + " must be an object");
    return undefined;
  }
  const input = raw as Record<string, unknown>;
  const before = issues.length;

  const file = requiredText(input, parent, "file", issues);
  const line = optionalLine(input, parent, issues);
  const summary = requiredText(input, parent, "summary", issues);
  const shortSummary = optionalText(
    input,
    parent,
    "short_summary",
    SHORT_SUMMARY_MAX_CHARS,
    issues,
  );
  const failureScenario = requiredText(
    input,
    parent,
    "failure_scenario",
    issues,
  );
  const category = optionalText(
    input,
    parent,
    "category",
    CATEGORY_MAX_CHARS,
    issues,
  );
  const severity = optionalEnum(
    input,
    parent,
    "severity",
    FINDING_SEVERITIES,
    issues,
  );
  const verdict = optionalEnum(
    input,
    parent,
    "verdict",
    FINDING_VERDICTS,
    issues,
  );
  const outcome = optionalEnum(
    input,
    parent,
    "outcome",
    FINDING_OUTCOMES,
    issues,
  );

  if (
    issues.length > before ||
    file === undefined ||
    summary === undefined ||
    failureScenario === undefined
  ) {
    return undefined;
  }

  return {
    file,
    ...(line === undefined ? {} : { line }),
    summary,
    ...(shortSummary === undefined ? {} : { short_summary: shortSummary }),
    failure_scenario: failureScenario,
    ...(category === undefined ? {} : { category }),
    ...(severity === undefined ? {} : { severity }),
    ...(verdict === undefined ? {} : { verdict }),
    ...(outcome === undefined ? {} : { outcome }),
  };
}
