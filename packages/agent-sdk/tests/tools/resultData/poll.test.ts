import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  pollTool,
  renderReplEvent,
  renderReplStatus,
} from "@/tools/pollTool.js";
import {
  renderPollResultData,
  type PollResultData,
} from "@/tools/resultData/poll.js";
import type { ReplEvent, RunningReplScript } from "@/repl/replRuntime.js";
import type { ToolContext, ToolResult } from "@/tools/types.js";

/**
 * `Poll` 的 golden 断言（issue #3055 阶段 1）：`data` 经它自己的渲染器还原出来的
 * 文本，必须与工具当场产出的 `content` **逐字相等**。期望值全部手写字面量 —— 按
 * `resultData/poll.ts` 的契约手写，不从 `content` 抄。
 *
 * 运行时整体替换掉（与 `tests/tools/pollTool.test.ts` 同一手法）：这一层测的是
 * 「队列里的东西 → data → 文本」，不是真跑脚本。
 */
const { waitForReplEvents, replPendingEventCount, listRunningReplScripts } =
  vi.hoisted(() => ({
    waitForReplEvents: vi.fn(),
    replPendingEventCount: vi.fn(),
    listRunningReplScripts: vi.fn(),
  }));

vi.mock("@/repl/replRuntime.js", () => ({
  waitForReplEvents,
  replPendingEventCount,
  listRunningReplScripts,
  // `replTool` imports the runner at module scope; nothing here calls it.
  runReplScript: vi.fn(),
}));

const context = {} as unknown as ToolContext;

/** 一条已结算的后台脚本：默认成功、带一个工具、耗时 1200ms。 */
function event(
  evalId: number,
  overrides: Partial<ReplEvent["result"]> = {},
): ReplEvent {
  return {
    evalId,
    elapsedMs: 1_200,
    result: {
      ok: true,
      evalId,
      value: `done ${evalId}`,
      logs: [],
      toolCalls: 1,
      toolsUsed: ["Read"],
      images: [],
      ...overrides,
    },
  };
}

/** 一个还在跑的脚本。运行时的对象比状态行要的多（`abort` / `self` / `settled`）。 */
function script(
  id: number,
  overrides: Partial<RunningReplScript> = {},
): RunningReplScript {
  return {
    id,
    snippet: "await sleep(60000)",
    ageMs: 5_000,
    state: "running",
    settled: false,
    self: false,
    abort: () => {},
    ...overrides,
  };
}

/** 渲染 `data` 并断言它**逐字**等于工具给的那段文本。 */
function expectRendersBack(result: ToolResult): PollResultData {
  const data = result.data as PollResultData;
  expect(renderPollResultData(data)).toBe(result.content);
  return data;
}

/**
 * 让「有东西可以等」那条路放行（闸门只看排队数是不是 0），交付之后按 `after` 报
 * 剩余数 —— 也就是末尾那行 `(N more settled …)` 的有无。
 */
function queuedThen(after: number): void {
  replPendingEventCount.mockReturnValueOnce(1);
  replPendingEventCount.mockReturnValue(after);
}

beforeEach(() => {
  vi.clearAllMocks();
  replPendingEventCount.mockReturnValue(0);
  listRunningReplScripts.mockReturnValue([]);
  waitForReplEvents.mockResolvedValue([]);
});

describe("Poll 的 data → 文本：状态行", () => {
  it("没有脚本在跑时是自闭合元素加一句说明", async () => {
    const result = await pollTool.execute({}, context);

    expect(result.content).toBe(
      [
        '<event kind="repl-status" pending="0"/>',
        "No REPL script is running in this context.",
      ].join("\n"),
    );
    const data = expectRendersBack(result);
    expect(data).toEqual({ events: [], remaining: 0, running: [] });
    expect(result.shortResult).toBe("idle");
    expect(result.success).toBe(true);
  });

  it("每个还在跑的脚本一行：编号、状态、已跑时长、片段", async () => {
    listRunningReplScripts.mockReturnValue([
      script(3),
      script(4, {
        ageMs: 800,
        state: "waiting",
        snippet: "await fetch(url)",
      }),
    ]);

    const result = await pollTool.execute({ timeoutMs: 4_000 }, context);

    expect(result.content).toBe(
      [
        '<event kind="repl-status" pending="2"/>',
        "#3 running 5000ms — await sleep(60000)",
        "#4 waiting 800ms — await fetch(url)",
      ].join("\n"),
    );
    // `aiManager` 投递状态行走的是同一个渲染器，两处不可能有两种长相。
    expect(renderReplStatus()).toBe(result.content);

    const data = expectRendersBack(result);
    // 快照只留渲染用得上的四个字段：`abort` 这样的闭包不能进转录。
    expect(data.running).toEqual([
      { id: 3, state: "running", ageMs: 5_000, snippet: "await sleep(60000)" },
      { id: 4, state: "waiting", ageMs: 800, snippet: "await fetch(url)" },
    ]);
    expect(data.running?.[0]).not.toHaveProperty("abort");
    expect(data.running?.[0]).not.toHaveProperty("self");
    expect(result.shortResult).toBe("still running");
    expect(result.success).toBe(true);
  });
});

describe("Poll 的 data → 文本：事件信封", () => {
  it("单事件：编号与耗时在开标签上，正文就是 REPL 的那段元素", async () => {
    queuedThen(0);
    waitForReplEvents.mockResolvedValue([event(7)]);

    const result = await pollTool.execute({ timeoutMs: 5_000 }, context);

    expect(result.content).toBe(
      [
        '<event kind="repl-eval" eval="7">',
        '<repl-output eval="7" ms="1200">',
        "<tools>Read</tools>",
        "<result>done 7</result>",
        "</repl-output>",
        "</event>",
      ].join("\n"),
    );

    const data = expectRendersBack(result);
    expect(data).toEqual({
      events: [
        {
          evalId: 7,
          elapsedMs: 1_200,
          result: {
            ok: true,
            evalId: 7,
            result: "done 7",
            stdout: [],
            toolsUsed: ["Read"],
          },
        },
      ],
      remaining: 0,
    });
    // 耗时只在事件的 `elapsedMs` 上存一份，不重复进里层的 `ms`。
    expect(data.events[0].result.ms).toBeUndefined();
    // 事件回答里没有状态行，运行列表也就没有落盘的理由。
    expect(data.running).toBeUndefined();
    expect(result.shortResult).toBe("1 result");
    expect(result.success).toBe(true);
  });

  it("多事件：一个信封一段，用换行拼，顺序就是结算顺序", async () => {
    queuedThen(0);
    waitForReplEvents.mockResolvedValue([event(1), event(2)]);

    const result = await pollTool.execute({ timeoutMs: 5_000 }, context);

    expect(result.content).toBe(
      [
        '<event kind="repl-eval" eval="1">',
        '<repl-output eval="1" ms="1200">',
        "<tools>Read</tools>",
        "<result>done 1</result>",
        "</repl-output>",
        "</event>",
        '<event kind="repl-eval" eval="2">',
        '<repl-output eval="2" ms="1200">',
        "<tools>Read</tools>",
        "<result>done 2</result>",
        "</repl-output>",
        "</event>",
      ].join("\n"),
    );
    const data = expectRendersBack(result);
    expect(data.events.map((item) => item.evalId)).toEqual([1, 2]);
    expect(result.shortResult).toBe("2 results");
  });

  it("还有一批排着队时，末尾一行说明要再 Poll 一次", async () => {
    queuedThen(2);
    waitForReplEvents.mockResolvedValue([event(1), event(2)]);

    const result = await pollTool.execute({ timeoutMs: 5_000 }, context);

    expect(result.content).toBe(
      [
        '<event kind="repl-eval" eval="1">',
        '<repl-output eval="1" ms="1200">',
        "<tools>Read</tools>",
        "<result>done 1</result>",
        "</repl-output>",
        "</event>",
        '<event kind="repl-eval" eval="2">',
        '<repl-output eval="2" ms="1200">',
        "<tools>Read</tools>",
        "<result>done 2</result>",
        "</repl-output>",
        "</event>",
        "(2 more settled — read them with another poll)",
      ].join("\n"),
    );
    const data = expectRendersBack(result);
    expect(data.remaining).toBe(2);
  });

  it("失败事件的正文照原样带错误，顶层 success / error 各说一次结论", async () => {
    queuedThen(0);
    waitForReplEvents.mockResolvedValue([
      event(9, { ok: false, value: undefined, error: "boom" }),
    ]);

    const result = await pollTool.execute({ timeoutMs: 1_000 }, context);

    expect(result.content).toBe(
      [
        '<event kind="repl-eval" eval="9">',
        '<repl-output eval="9" ms="1200">',
        "<tools>Read</tools>",
        "<error>boom</error>",
        "</repl-output>",
        "</event>",
      ].join("\n"),
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("A background REPL script failed.");
    const data = expectRendersBack(result);
    expect(data.events[0].result).toMatchObject({
      ok: false,
      error: "boom",
    });
  });

  it("一个工具都没碰到的事件，正文退回纯文本档（与 REPL 同一份渲染器）", async () => {
    queuedThen(0);
    waitForReplEvents.mockResolvedValue([event(5, { toolsUsed: [] })]);

    const result = await pollTool.execute({ timeoutMs: 5_000 }, context);

    expect(result.content).toBe(
      [
        '<event kind="repl-eval" eval="5">',
        "result:",
        "done 5",
        "</event>",
      ].join("\n"),
    );
    expectRendersBack(result);
  });

  it("老转录里没有耗时就不写 ms 属性", async () => {
    queuedThen(0);
    // 手写一份没有 `elapsedMs` 的事件（老转录的样子），不是从新事件里删字段。
    waitForReplEvents.mockResolvedValue([
      { evalId: 6, result: event(6).result },
    ]);

    const result = await pollTool.execute({ timeoutMs: 5_000 }, context);

    expect(result.content).toBe(
      [
        '<event kind="repl-eval" eval="6">',
        '<repl-output eval="6">',
        "<tools>Read</tools>",
        "<result>done 6</result>",
        "</repl-output>",
        "</event>",
      ].join("\n"),
    );
    const data = expectRendersBack(result);
    expect(data.events[0].elapsedMs).toBeUndefined();
  });
});

describe("Poll 的 data → 文本：另一条投递路径", () => {
  it("turn 之间投递的单事件与 Poll 答问同一个渲染器、同一段文本", () => {
    expect(renderReplEvent(event(4))).toBe(
      [
        '<event kind="repl-eval" eval="4">',
        '<repl-output eval="4" ms="1200">',
        "<tools>Read</tools>",
        "<result>done 4</result>",
        "</repl-output>",
        "</event>",
      ].join("\n"),
    );
  });
});
