import { describe, it, expect } from "vitest";
import { reportFindingsTool } from "../../src/tools/reportFindingsTool.js";
import { REPORT_FINDINGS_TOOL_NAME } from "../../src/constants/tools.js";
import { renderToolResultData } from "../../src/tools/resultData/index.js";
import { validateToolInput } from "../../src/tools/inputValidation.js";
import type { ToolContext } from "../../src/tools/types.js";

/**
 * `ReportFindings`（CC 2.1.332 的同名工具）。
 *
 * 它存在的理由是「清单只走 data，模型看不到逐条内容」：模型调一次，宿主拿到
 * `{ count, level, findings }` 去渲染，而模型自己的 tool_result 只有一句桩
 * （`"N findings reported."` / `"No findings reported."`），所以它不会在正文里
 * 把同一份清单再抄一遍。`--fix` 之后按同样的形状再交一次，每条带 `outcome`。
 *
 * 这里钉三件事：schema 严格（CC 的 zod 上限）、data 形状、模型侧只有那句桩。
 */

const context = { workdir: "/test" } as ToolContext;

/** CC 的 `X1i`（`0640-9992B-aut.js:182`），逐字。 */
const CC_DESCRIPTION =
  "Report code-review findings as a typed list so the host UI can render them. Use this only when the active code-review instructions tell you to report findings with this tool; otherwise follow whatever output format those instructions specify. When reporting a review's results, call it once with the verified findings ranked most-severe first (empty array if nothing survived verification) and do not also print the findings as text. When re-reporting after applying fixes (only if the apply instructions ask for it), set `outcome` on each finding to what actually happened.";

/** 一条字段齐全的发现，各用例只覆盖自己关心的字段。 */
const finding = (over: Record<string, unknown> = {}) => ({
  file: "packages/agent-sdk/src/tools/reportFindingsTool.ts",
  line: 42,
  summary: "ReportFindings 把清单交给宿主，模型侧只留一句桩",
  short_summary: "清单只走 data",
  failure_scenario: "33 条发现一起提交时整份清单被判非法，宿主收不到半份清单。",
  category: "correctness",
  severity: "important",
  verdict: "CONFIRMED",
  ...over,
});

const run = (args: Record<string, unknown>) =>
  reportFindingsTool.execute(args, context);

describe("ReportFindings Tool", () => {
  it("名字、常驻声明与 CC 原文描述", () => {
    expect(reportFindingsTool.name).toBe("ReportFindings");
    expect(reportFindingsTool.config.function.name).toBe(
      REPORT_FINDINGS_TOOL_NAME,
    );
    // 不做 defer：/code-review 的交付那一步必须直接可达。
    expect(reportFindingsTool.defer).toBeUndefined();
    // 只写 data、不动文件，并发安全。
    expect(reportFindingsTool.isConcurrencySafe).toBe(true);
    // CC 的 `description()` 与 `prompt()` 返回同一段话，两边逐字照抄。
    expect(reportFindingsTool.config.function.description).toBe(CC_DESCRIPTION);
    expect(reportFindingsTool.prompt?.()).toBe(CC_DESCRIPTION);
    expect(reportFindingsTool.searchHint).toBe(
      "report code-review findings as a structured list",
    );
  });

  it("合法调用：data 带回整份清单，模型侧只有一句桩", async () => {
    const result = await run({
      level: "medium",
      findings: [finding(), finding({ outcome: undefined, line: 7 })],
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe("2 findings reported.");
    expect(result.shortResult).toBe("2 findings");
    expect(result.data).toEqual({
      count: 2,
      level: "medium",
      findings: [
        finding(),
        {
          file: "packages/agent-sdk/src/tools/reportFindingsTool.ts",
          line: 7,
          summary: "ReportFindings 把清单交给宿主，模型侧只留一句桩",
          short_summary: "清单只走 data",
          failure_scenario:
            "33 条发现一起提交时整份清单被判非法，宿主收不到半份清单。",
          category: "correctness",
          severity: "important",
          verdict: "CONFIRMED",
        },
      ],
    });
  });

  it("没有发现时交空数组：data 是空清单，正文是一句「没有发现」", async () => {
    const result = await run({ findings: [] });

    expect(result.success).toBe(true);
    expect(result.content).toBe("No findings reported.");
    expect(result.shortResult).toBe("No findings");
    expect(result.data).toEqual({ count: 0, findings: [] });
  });

  it("一条发现用单数", async () => {
    const result = await run({ findings: [finding()] });

    expect(result.content).toBe("1 finding reported.");
    expect(result.shortResult).toBe("1 finding");
  });

  it("可选字段不传就不进 data（不造空字段）", async () => {
    const result = await run({
      findings: [
        {
          file: "a.ts",
          summary: "s",
          failure_scenario: "f",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      count: 1,
      findings: [{ file: "a.ts", summary: "s", failure_scenario: "f" }],
    });
    expect(
      Object.keys((result.data as { findings: object[] }).findings[0]),
    ).toEqual(["file", "summary", "failure_scenario"]);
  });

  it("32 条是上限内，33 条整份被拒（不截断）", async () => {
    const thirtyTwo = Array.from({ length: 32 }, (_, i) =>
      finding({ line: i + 1 }),
    );
    expect((await run({ findings: thirtyTwo })).success).toBe(true);

    const thirtyThree = Array.from({ length: 33 }, (_, i) =>
      finding({ line: i + 1 }),
    );
    const rejected = await run({ findings: thirtyThree });

    expect(rejected.success).toBe(false);
    expect(rejected.content).toBe("");
    expect(rejected.data).toBeUndefined();
    expect(rejected.error).toBe(
      "ReportFindings: at most 32 findings per call, got 33",
    );
  });

  it("short_summary 超过 60 被拒，正好 60 通过", async () => {
    const ok = await run({
      findings: [finding({ short_summary: "x".repeat(60) })],
    });
    expect(ok.success).toBe(true);

    const rejected = await run({
      findings: [finding({ short_summary: "x".repeat(61) })],
    });

    expect(rejected.success).toBe(false);
    expect(rejected.error).toBe(
      "ReportFindings: findings[0].short_summary is 61 characters, at most 60 allowed",
    );
  });

  it("category 超过 40 被拒", async () => {
    const rejected = await run({
      findings: [finding({ category: "x".repeat(41) })],
    });

    expect(rejected.success).toBe(false);
    expect(rejected.error).toBe(
      "ReportFindings: findings[0].category is 41 characters, at most 40 allowed",
    );
  });

  it("severity / verdict / outcome 非法枚举被拒", async () => {
    const severity = await run({
      findings: [finding({ severity: "critical" })],
    });
    expect(severity.error).toBe(
      'ReportFindings: findings[0].severity is invalid: expected one of "important", "pre_existing", "nit"',
    );

    const verdict = await run({
      findings: [finding({ verdict: "LIKELY" })],
    });
    expect(verdict.error).toBe(
      'ReportFindings: findings[0].verdict is invalid: expected one of "CONFIRMED", "PLAUSIBLE"',
    );

    const outcome = await run({
      findings: [finding({ outcome: "done" })],
    });
    expect(outcome.error).toBe(
      'ReportFindings: findings[0].outcome is invalid: expected one of "fixed", "skipped", "no_change_needed"',
    );
  });

  it("level 非法枚举被拒", async () => {
    const rejected = await run({ level: "ultra", findings: [] });

    expect(rejected.success).toBe(false);
    expect(rejected.error).toBe(
      'ReportFindings: level is invalid: expected one of "low", "medium", "high", "xhigh", "max"',
    );
  });

  it("line 不是整数被拒", async () => {
    const rejected = await run({ findings: [finding({ line: 4.5 })] });

    expect(rejected.success).toBe(false);
    expect(rejected.error).toBe(
      "ReportFindings: findings[0].line must be an integer",
    );
  });

  it("必填字段缺失被拒", async () => {
    const noSummary = finding();
    delete (noSummary as Record<string, unknown>).summary;

    const rejected = await run({ findings: [noSummary] });

    expect(rejected.success).toBe(false);
    expect(rejected.error).toBe(
      "ReportFindings: findings[0].summary is required",
    );
  });

  it("一次报出所有问题（不只第一条）", async () => {
    const rejected = await run({
      level: "nope",
      findings: [finding({ line: "42", short_summary: "x".repeat(61) })],
    });

    expect(rejected.success).toBe(false);
    expect(rejected.error).toBe(
      [
        'ReportFindings: level is invalid: expected one of "low", "medium", "high", "xhigh", "max"',
        "ReportFindings: findings[0].line must be an integer",
        "ReportFindings: findings[0].short_summary is 61 characters, at most 60 allowed",
      ].join("\n"),
    );
  });

  it("--fix 之后复报：同一工具、同一条发现，只多出 outcome", async () => {
    const first = await run({ level: "high", findings: [finding()] });
    const again = await run({
      level: "high",
      findings: [finding({ outcome: "fixed" })],
    });

    expect(again.success).toBe(true);
    // 正文仍是那句桩：复报不会把清单再列一遍。
    expect(again.content).toBe("1 finding reported.");
    expect(again.data).toEqual({
      count: 1,
      level: "high",
      findings: [finding({ outcome: "fixed" })],
    });
    // 第一次没有 outcome，第二次有；两次的清单条目是同一批。
    const firstFindings = (
      first.data as { findings: Record<string, unknown>[] }
    ).findings;
    expect(firstFindings[0].outcome).toBeUndefined();
    expect(
      (again.data as { findings: Record<string, unknown>[] }).findings[0]
        .outcome,
    ).toBe("fixed");
  });

  it("data 经渲染器还原出的文本，逐字等于工具给的正文", async () => {
    for (const args of [
      { findings: [] },
      { level: "max", findings: [finding(), finding({ line: 7 })] },
    ]) {
      const result = await run(args);
      expect(renderToolResultData(REPORT_FINDINGS_TOOL_NAME, result.data)).toBe(
        result.content,
      );
    }
  });
});

describe("ReportFindings 声明的 schema 严格", () => {
  /** 内置工具的调用由 `toolManager.execute` 按这份声明先判一遍。 */
  const gate = (args: Record<string, unknown>) =>
    validateToolInput(
      REPORT_FINDINGS_TOOL_NAME,
      reportFindingsTool.config.function.parameters,
      args,
    );

  it("合法调用过闸", () => {
    expect(gate({ level: "medium", findings: [finding()] })).toBeNull();
    expect(gate({ findings: [] })).toBeNull();
  });

  it("findings 必填", () => {
    expect(gate({ level: "low" })).toBe(
      "ReportFindings failed due to the following issue:\nThe required parameter `findings` is missing",
    );
  });

  it("非法枚举与小数行号在闸上就被判掉", () => {
    const message = gate({
      findings: [finding({ severity: "critical", line: 4.5 })],
    });

    expect(message).toBe(
      [
        "ReportFindings failed due to the following issues:",
        "The parameter `findings[0].line` type is expected as `integer` but provided as `number`",
        'The parameter `findings[0].severity` is invalid: expected one of "important", "pre_existing", "nit"',
      ].join("\n"),
    );
  });

  it("schema 里没有的字段被拒", () => {
    const message = gate({ findings: [finding({ confidence: 92 })] });

    expect(message).toBe(
      "ReportFindings failed due to the following issue:\nAn unexpected parameter `findings[0].confidence` was provided",
    );
  });
});
