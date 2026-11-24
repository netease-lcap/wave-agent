import { beforeEach, describe, expect, it, vi } from "vitest";
import { replTool } from "@/tools/replTool.js";
import {
  renderReplResultData,
  replResultDataOf,
  type ReplResultData,
} from "@/tools/resultData/repl.js";
import { REPL_PART_CHAR_LIMIT } from "@/repl/constants.js";
import type { ReplRunResult, RunReplOptions } from "@/repl/replRuntime.js";
import type { ToolContext, ToolResult } from "@/tools/types.js";

/**
 * `REPL` 的 golden 断言（issue #3055 阶段 1）：`data` 经它自己的渲染器还原出来的
 * 文本，必须与工具当场产出的 `content` **逐字相等**。期望值是手写字面量 —— 按
 * `resultData/repl.ts` 的契约手写，不从 `content` 抄。
 *
 * 沙箱运行时整体替换掉（与 `tests/tools/replTool.test.ts` 同一手法）：这一层测的是
 * 「运行结果 → data → 文本」，不是跑 JavaScript。
 */
const { runReplScript } = vi.hoisted(() => ({
  runReplScript: vi.fn<(options: RunReplOptions) => Promise<ReplRunResult>>(),
}));

vi.mock("@/repl/replRuntime.js", () => ({ runReplScript }));

/** 一次没有内容的成功运行，作为每个用例的底。 */
function runResult(overrides: Partial<ReplRunResult> = {}): ReplRunResult {
  return { ok: true, logs: [], toolCalls: 0, images: [], ...overrides };
}

const context = {
  workdir: "/tmp",
  toolManager: { getReplPool: () => [], list: () => [] },
} as unknown as ToolContext;

/** 耗时是工具自己掐的表，每次都不一样；比较整段文档时先归一。 */
function withoutMs(content: string): string {
  return content.replace(/ ms="\d+"/, ' ms="0"');
}

/** 渲染 `data` 并断言它**逐字**等于工具给的那段文本。 */
function expectRendersBack(result: ToolResult): ReplResultData {
  const data = result.data as ReplResultData;
  expect(renderReplResultData(data)).toBe(result.content);
  return data;
}

/** 逐字相等的文本与结构相等的 `data` 一起断，任何一边漂了都红。 */
function expectDocument(
  result: ToolResult,
  content: string,
  data: Record<string, unknown>,
): void {
  expect(withoutMs(result.content)).toBe(content);
  const rendered = expectRendersBack(result);
  expect(rendered).toMatchObject(data);
}

beforeEach(() => {
  runReplScript.mockReset();
  runReplScript.mockResolvedValue(runResult());
});

describe("REPL 的 data → 文本：元素档", () => {
  it("固定的子元素顺序，调用行折叠去重，编号与耗时进开标签", async () => {
    runReplScript.mockResolvedValue(
      runResult({
        value: "42",
        logs: ["step one"],
        stderr: ["warning: deprecated"],
        toolsUsed: ["Read", "Grep", "Read"],
        refusedCalls: ["Bash"],
        evalId: 7,
      }),
    );

    const result = await replTool.execute({ code: "return 1;" }, context);

    expectDocument(
      result,
      [
        '<repl-output eval="7" ms="0">',
        "<tools>Read, Grep</tools>",
        "<refused>Bash</refused>",
        "<log>step one</log>",
        "<log>[stderr] warning: deprecated</log>",
        "<result>42</result>",
        "</repl-output>",
      ].join("\n"),
      {
        ok: true,
        evalId: 7,
        result: "42",
        stdout: ["step one"],
        stderr: ["warning: deprecated"],
        toolsUsed: ["Read", "Grep", "Read"],
        refusedCalls: ["Bash"],
      },
    );
  });

  it("标记转义只影响显示：值里的 < > & 变成实体", async () => {
    runReplScript.mockResolvedValue(
      runResult({
        value: '{"k":"<v>"}',
        logs: ["if (a < b && c > d)"],
        toolsUsed: ["Read"],
      }),
    );

    const result = await replTool.execute({ code: "return 1;" }, context);

    expect(result.content).toContain(
      "<log>if (a &lt; b &amp;&amp; c &gt; d)</log>",
    );
    expect(result.content).toContain('<result>{"k":"&lt;v&gt;"}</result>');
    // 转义是渲染出来的，`data` 里仍是脚本产出的原文。
    const data = expectRendersBack(result);
    expect(data.result).toBe('{"k":"<v>"}');
    expect(data.stdout).toEqual(["if (a < b && c > d)"]);
  });

  it("一个产出但为空的流写 <log/>，不是一个空的元素对", async () => {
    runReplScript.mockResolvedValue(runResult({ logs: [""] }));

    const result = await replTool.execute({ code: "return 1;" }, context);

    expectDocument(
      result,
      ['<repl-output ms="0">', "<log/>", "<result/>", "</repl-output>"].join(
        "\n",
      ),
      { stdout: [""] },
    );
  });
});

describe("REPL 的 data → 文本：纯文本档", () => {
  it("只有一个值时不出元素，抬头是 result:", async () => {
    runReplScript.mockResolvedValue(runResult({ value: "hello" }));

    const result = await replTool.execute({ code: "return 1;" }, context);

    expectDocument(result, "result:\nhello", { ok: true, result: "hello" });
  });

  it("没有返回值也没有日志时是那一句固定的说明", async () => {
    const result = await replTool.execute({ code: "return 1;" }, context);

    expectDocument(
      result,
      "result:\nThe script finished without a return value and without any self.log() output.",
      { stdout: [] },
    );
  });

  it("`undefined` 与空串一样读作没有返回值", async () => {
    runReplScript.mockResolvedValue(runResult({ value: "undefined" }));

    const result = await replTool.execute({ code: "return 1;" }, context);

    expectDocument(
      result,
      "result:\nThe script finished without a return value and without any self.log() output.",
      { result: "undefined" },
    );
  });
});

describe("REPL 的 data → 文本：失败档", () => {
  it("原因进 error: 抬头，同时是结果的 error 字段", async () => {
    runReplScript.mockResolvedValue(runResult({ ok: false, error: "boom" }));

    const result = await replTool.execute({ code: "return 1;" }, context);

    expectDocument(result, "error:\nboom", { ok: false, error: "boom" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("boom");
  });

  it("运行时没给理由时，正文与 error 字段是同一句兜底话", async () => {
    runReplScript.mockResolvedValue(runResult({ ok: false }));

    const result = await replTool.execute({ code: "return 1;" }, context);

    expectDocument(result, "error:\nThe REPL script failed.", { ok: false });
    expect(result.error).toBe("The REPL script failed.");
  });

  it("有日志的失败走元素档，结论是 <error>", async () => {
    runReplScript.mockResolvedValue(
      runResult({ ok: false, error: "boom", logs: ["half way"] }),
    );

    const result = await replTool.execute({ code: "return 1;" }, context);

    expectDocument(
      result,
      [
        '<repl-output ms="0">',
        "<log>half way</log>",
        "<error>boom</error>",
        "</repl-output>",
      ].join("\n"),
      { ok: false, error: "boom", stdout: ["half way"] },
    );
  });
});

describe("REPL 的 data → 文本：派发回执", () => {
  it("回执说清「已在跑」「再交一次就是跑两次」", async () => {
    runReplScript.mockResolvedValue(
      runResult({ asyncDispatched: true, evalId: 12 }),
    );

    const result = await replTool.execute({ code: "return 1;" }, context);

    expectDocument(
      result,
      [
        "(dispatched #12)",
        "The script is already running (or queued), so submitting it again would run it twice — wait for its result with `Poll` instead.",
      ].join("\n"),
      { ok: true, asyncDispatched: true, evalId: 12 },
    );
  });

  it("被拒的派发没有编号，正文只剩理由；没理由时说明脚本没启动", async () => {
    // 拒绝档与 CC 同形：`asyncDispatched: true` 但没有 `evalId`，所以正文里没有
    // `(dispatched #N)` —— 编号根本没发出去，印一个会把模型引去 Poll 不存在的 id。
    runReplScript.mockResolvedValue(
      runResult({
        ok: false,
        error: "Too many scripts are already running.",
        asyncDispatched: true,
      }),
    );
    const refused = await replTool.execute({ code: "return 1;" }, context);
    expectDocument(refused, "Too many scripts are already running.", {
      ok: false,
      asyncDispatched: true,
    });

    runReplScript.mockResolvedValue(
      runResult({ ok: false, asyncDispatched: true }),
    );
    const bare = await replTool.execute({ code: "return 1;" }, context);
    expectDocument(
      bare,
      "The REPL script failed. The script was not started.",
      { ok: false, asyncDispatched: true },
    );
  });
});

describe("REPL 的 data → 文本：注记与截断", () => {
  it("上下文是新的时，注记追加在正文之后", async () => {
    runReplScript.mockResolvedValue(
      runResult({ value: "v", contextReset: true }),
    );

    const result = await replTool.execute({ code: "return 1;" }, context);

    expectDocument(
      result,
      [
        "result:",
        "v",
        "This is a new REPL context: the variables, functions and timers of earlier scripts are gone.",
      ].join("\n"),
      { contextReset: true, result: "v" },
    );
  });

  it("超长的值留头留尾、裁掉中间，并指回 REPL 上下文", async () => {
    // 头尾正好用满上限：60% 从头、其余从尾，中间全部丢掉。
    const head = "A".repeat(18_000);
    const middle = "M".repeat(22_000);
    const tail = "Z".repeat(12_000);
    runReplScript.mockResolvedValue(runResult({ value: head + middle + tail }));

    const result = await replTool.execute({ code: "return 1;" }, context);

    expect(withoutMs(result.content)).toBe(
      [
        "result:",
        `${head}\n... [22000 chars elided] ...\n${tail}`,
        "The part above was cut. The full value is still under its key in the REPL context — slice or search it there instead of reading it again or re-running anything.",
      ].join("\n"),
    );
    // 中间那段一个字都没留下，而头尾都完整。
    expect(result.content).not.toContain("M");
    expect(result.content).toContain(head);
    expect(result.content).toContain(tail);

    // `data` 里是**未截断**的原值：截断是渲染器的事（阶段 2 靠这条重建同一段文本）。
    const data = expectRendersBack(result);
    expect(data.result).toHaveLength(52_000);
    expect(data.result).toBe(head + middle + tail);
    expect(REPL_PART_CHAR_LIMIT).toBe(30_000);
  });

  it("日志按流成段，每段单独套上限", async () => {
    runReplScript.mockResolvedValue(
      runResult({
        logs: ["L".repeat(1_000), "second line"],
        stderr: ["N".repeat(40_000)],
        toolsUsed: ["Read"],
      }),
    );

    const result = await replTool.execute({ code: "return 1;" }, context);

    // 两股流两个元素：stdout 那一段是一整块（不是一行一个），stderr 那一段自己截。
    expect(result.content).toContain(
      `<log>${"L".repeat(1_000)}\nsecond line</log>`,
    );
    expect(result.content).toContain("... [10009 chars elided] ...");
    const data = expectRendersBack(result);
    expect(data.stdout).toEqual(["L".repeat(1_000), "second line"]);
    expect(data.stderr?.[0]).toHaveLength(40_000);
  });
});

describe("REPL 的 data 组装", () => {
  it("图片留在 ToolResult.images 上，不进 data", async () => {
    runReplScript.mockResolvedValue(
      runResult({
        value: "ok",
        images: [{ data: "BASE64", mediaType: "image/png" }],
      }),
    );

    const result = await replTool.execute({ code: "return 1;" }, context);

    expect(result.content).toBe("result:\nok");
    expect(result.images).toEqual([{ data: "BASE64", mediaType: "image/png" }]);
    const data = expectRendersBack(result);
    expect(data).not.toHaveProperty("images");
  });

  it("运行时没报 toolsUsed 时用工具层看到的名字，报了就听运行时的", () => {
    const run = { ok: true, logs: [] as string[] };

    // 脚本撞上调用上限之后，只有工具层还看得到这些名字（`onToolCall` 仍会报）。
    expect(replResultDataOf(run, ["Bash", "Read"], 5)).toMatchObject({
      toolsUsed: ["Bash", "Read"],
      ms: 5,
    });
    // 运行时那份优先，哪怕它和工具层不一样。
    expect(
      replResultDataOf({ ...run, toolsUsed: ["Bash"] }, ["Bash", "Read"]),
    ).toMatchObject({ toolsUsed: ["Bash"] });
    // 空的 `toolsUsed` 也是一个结论（「一个都没碰到」），不退回工具层。
    expect(replResultDataOf({ ...run, toolsUsed: [] }, ["Bash"])).toMatchObject(
      { toolsUsed: [] },
    );
    // 两处都没有：字段干脆不出现，渲染器据此走纯文本档。
    expect(replResultDataOf(run)).not.toHaveProperty("toolsUsed");
    expect(replResultDataOf(run)).not.toHaveProperty("ms");
  });
});
