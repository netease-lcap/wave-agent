import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationCoalescer,
  REMOTE_FRAME_WINDOW_MS,
  type RelayFrame,
} from "../../src/remote/notificationCoalescer.js";

function streaming(messageId: string, chunk: string, sessionId = "s1") {
  return {
    method: "assistantContentUpdated",
    params: { messageId, chunk, stage: "streaming" },
    sessionId,
  };
}

describe("NotificationCoalescer", () => {
  let written: RelayFrame[][];

  beforeEach(() => {
    vi.useFakeTimers();
    written = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createCoalescer(windowMs = REMOTE_FRAME_WINDOW_MS) {
    return new NotificationCoalescer(
      (frames) => written.push(frames),
      windowMs,
    );
  }

  it("should hold a streaming delta until the window closes", () => {
    const c = createCoalescer();
    const f = streaming("m1", "hel");
    c.push(f.method, f.params, f.sessionId);

    expect(written).toHaveLength(0);
    vi.advanceTimersByTime(REMOTE_FRAME_WINDOW_MS);
    expect(written).toHaveLength(1);
    expect(written[0]).toEqual([
      {
        method: "assistantContentUpdated",
        params: { messageId: "m1", stage: "streaming", chunk: "hel" },
        sessionId: "s1",
      },
    ]);
  });

  it("should concatenate every delta of one burst into a single frame", () => {
    const c = createCoalescer();
    for (const chunk of ["h", "e", "l", "l", "o"]) {
      const f = streaming("m1", chunk);
      c.push(f.method, f.params, f.sessionId);
    }
    vi.advanceTimersByTime(REMOTE_FRAME_WINDOW_MS);

    expect(written).toHaveLength(1);
    expect(written[0]).toHaveLength(1);
    expect((written[0][0].params as { chunk: string }).chunk).toBe("hello");
  });

  it("should keep the rest of the params intact on the merged frame", () => {
    const c = createCoalescer();
    const f = streaming("m1", "a");
    c.push(f.method, { ...(f.params as object), model: "m" }, f.sessionId);
    vi.advanceTimersByTime(REMOTE_FRAME_WINDOW_MS);

    expect(written[0][0].params).toEqual({
      messageId: "m1",
      stage: "streaming",
      model: "m",
      chunk: "a",
    });
  });

  it("should not merge across two different messages", () => {
    const c = createCoalescer();
    c.push(
      "assistantContentUpdated",
      { messageId: "m1", chunk: "a", stage: "streaming" },
      "s1",
    );
    c.push(
      "assistantContentUpdated",
      { messageId: "m2", chunk: "b", stage: "streaming" },
      "s1",
    );
    vi.advanceTimersByTime(REMOTE_FRAME_WINDOW_MS);

    expect(written).toHaveLength(1);
    expect(written[0]).toHaveLength(2);
    expect((written[0][0].params as { messageId: string }).messageId).toBe(
      "m1",
    );
    expect((written[0][1].params as { messageId: string }).messageId).toBe(
      "m2",
    );
  });

  it("should not merge the same message across two sessions", () => {
    const c = createCoalescer();
    c.push(
      "assistantContentUpdated",
      { messageId: "m1", chunk: "a", stage: "streaming" },
      "s1",
    );
    c.push(
      "assistantContentUpdated",
      { messageId: "m1", chunk: "b", stage: "streaming" },
      "s2",
    );
    vi.advanceTimersByTime(REMOTE_FRAME_WINDOW_MS);

    expect(written[0]).toHaveLength(2);
    expect(written[0][0].sessionId).toBe("s1");
    expect(written[0][1].sessionId).toBe("s2");
  });

  it("should merge toolBlockUpdated parameter chunks by tool call id", () => {
    const c = createCoalescer();
    const params = (id: string, parametersChunk: string) => ({
      messageId: "m1",
      id,
      stage: "streaming",
      parametersChunk,
    });
    c.push("toolBlockUpdated", params("t1", '{"a"'), "s1");
    c.push("toolBlockUpdated", params("t2", '{"b"'), "s1");
    c.push("toolBlockUpdated", params("t1", ":1}"), "s1");
    vi.advanceTimersByTime(REMOTE_FRAME_WINDOW_MS);

    expect(written[0]).toHaveLength(2);
    expect(
      (written[0][0].params as { parametersChunk: string }).parametersChunk,
    ).toBe('{"a":1}');
    expect(
      (written[0][1].params as { parametersChunk: string }).parametersChunk,
    ).toBe('{"b"');
  });

  it("should merge /btw content chunks of one question into one frame", () => {
    // `/btw` 的答案流与主对话同族：`content` 是纯增量（面板按 `answer + content`
    // 累加），所以合并窗口对它同样成立——不合并的话一次旁路提问在手机上产生的
    // 帧数就与一整轮主对话相当。
    const c = createCoalescer();
    for (const content of ["2026", " 年", "10 月"]) {
      c.push(
        "btwContent",
        { question: "今天几号", content, type: "content" },
        "s1",
      );
    }
    vi.advanceTimersByTime(REMOTE_FRAME_WINDOW_MS);

    expect(written).toHaveLength(1);
    expect(written[0]).toHaveLength(1);
    expect(written[0][0].params).toEqual({
      question: "今天几号",
      type: "content",
      content: "2026 年10 月",
    });
  });

  it("should keep /btw thinking and content apart, and two questions apart", () => {
    const c = createCoalescer();
    c.push(
      "btwContent",
      { question: "q1", content: "想", type: "thinking" },
      "s1",
    );
    c.push(
      "btwContent",
      { question: "q1", content: "答", type: "content" },
      "s1",
    );
    c.push(
      "btwContent",
      { question: "q2", content: "二", type: "content" },
      "s1",
    );
    // 面板在 content 开始后丢弃 thinking，两者若合成一帧就等于把丢弃掉的文本
    // 重新写回去；两个问题合成一帧则会让旧问题的答案画进新面板。
    c.push(
      "btwContent",
      { question: "q1", content: "复", type: "thinking" },
      "s1",
    );
    vi.advanceTimersByTime(REMOTE_FRAME_WINDOW_MS);

    expect(written[0].map((frame) => frame.params)).toEqual([
      { question: "q1", type: "thinking", content: "想复" },
      { question: "q1", type: "content", content: "答" },
      { question: "q2", type: "content", content: "二" },
    ]);
  });

  it("should keep two in-flight rounds of the same question apart by requestId", () => {
    const c = createCoalescer();
    // 多轮追问之后同一句话可以同时在途两次（主输入框连发两次相同的 `/btw …`）：
    // 只按 question 合并会把两轮的增量揉进同一帧，落到一遍面板上。
    c.push(
      "btwContent",
      {
        question: "今天几号",
        requestId: "btw-1",
        content: "一",
        type: "content",
      },
      "s1",
    );
    c.push(
      "btwContent",
      {
        question: "今天几号",
        requestId: "btw-2",
        content: "二",
        type: "content",
      },
      "s1",
    );
    vi.advanceTimersByTime(REMOTE_FRAME_WINDOW_MS);

    expect(written[0].map((frame) => frame.params)).toEqual([
      {
        question: "今天几号",
        requestId: "btw-1",
        type: "content",
        content: "一",
      },
      {
        question: "今天几号",
        requestId: "btw-2",
        type: "content",
        content: "二",
      },
    ]);
  });

  it("should merge compaction summary deltas into one frame", () => {
    // 压缩尾部与主对话同族：`content` 是纯增量（消费端拼接，手机只渲染最后 30
    // 个字符）。不合并的话一次压缩在手机上产生的帧数与一整轮主对话相当。
    const c = createCoalescer();
    for (const content of ["## ", "摘要", "正文"]) {
      c.push("compactionContentUpdate", { content }, "s1");
    }
    vi.advanceTimersByTime(REMOTE_FRAME_WINDOW_MS);

    expect(written).toHaveLength(1);
    expect(written[0][0]).toEqual({
      method: "compactionContentUpdate",
      params: { content: "## 摘要正文" },
      sessionId: "s1",
    });
  });

  it("should flush a buffered compaction run before compactionStateChange", () => {
    // 压缩开始 / 结束是离散事件 ⇒ 先冲刷缓冲。两次压缩因此不可能拼进同一帧。
    const c = createCoalescer();
    c.push("compactionContentUpdate", { content: "第一次的尾" }, "s1");
    c.push("compactionStateChange", { isCompacting: false }, "s1");
    c.push("compactionContentUpdate", { content: "第二次的尾" }, "s1");
    vi.advanceTimersByTime(REMOTE_FRAME_WINDOW_MS);

    expect(written.map((frames) => frames[0].method)).toEqual([
      "compactionContentUpdate",
      "compactionStateChange",
      "compactionContentUpdate",
    ]);
    expect(written[0][0].params).toEqual({ content: "第一次的尾" });
    expect(written[2][0].params).toEqual({ content: "第二次的尾" });
  });

  it("should keep the last shortResult snapshot of one tool and drop the rest", () => {
    // 子代理运行期间 `running` 阶段的 shortResult 是「此刻进度」的完整快照，SDK
    // 每收到一个子代理增量就重写一次（模型帧率）。它不是增量：早先的快照没有任
    // 何信息是最后一帧缺的，所以同键取最后一帧。
    const c = createCoalescer();
    const snap = (shortResult: string, id = "t1") => ({
      messageId: "m1",
      id,
      stage: "running",
      name: "Agent",
      compactParams: '{"description":"跑评测"}',
      shortResult,
    });
    c.push("toolBlockUpdated", snap("1 tool · 2.0k tokens"), "s1");
    c.push("toolBlockUpdated", snap("2 tools · 5.1k tokens\nRead a.ts"), "s1");
    c.push(
      "toolBlockUpdated",
      snap("3 tools · 9.4k tokens\nRead a.ts\nBash pnpm test"),
      "s1",
    );
    vi.advanceTimersByTime(REMOTE_FRAME_WINDOW_MS);

    expect(written).toHaveLength(1);
    expect(written[0]).toHaveLength(1);
    expect(written[0][0].params).toEqual({
      messageId: "m1",
      id: "t1",
      stage: "running",
      name: "Agent",
      compactParams: '{"description":"跑评测"}',
      shortResult: "3 tools · 9.4k tokens\nRead a.ts\nBash pnpm test",
    });
  });

  it("should merge two tools' shortResult snapshots apart", () => {
    const c = createCoalescer();
    const snap = (id: string, shortResult: string) => ({
      messageId: "m1",
      id,
      stage: "running",
      shortResult,
    });
    c.push("toolBlockUpdated", snap("t1", "t1 第一步"), "s1");
    c.push("toolBlockUpdated", snap("t2", "t2 第一步"), "s1");
    c.push("toolBlockUpdated", snap("t1", "t1 第二步"), "s1");
    vi.advanceTimersByTime(REMOTE_FRAME_WINDOW_MS);

    expect(
      written[0].map((f) => (f.params as { shortResult: string }).shortResult),
    ).toEqual(["t1 第二步", "t2 第一步"]);
  });

  it("should keep the same tool's shortResult apart across sessions", () => {
    const c = createCoalescer();
    const snap = (shortResult: string) => ({
      messageId: "m1",
      id: "t1",
      stage: "running",
      shortResult,
    });
    c.push("toolBlockUpdated", snap("会话一"), "s1");
    c.push("toolBlockUpdated", snap("会话二"), "s2");
    vi.advanceTimersByTime(REMOTE_FRAME_WINDOW_MS);

    expect(written[0]).toHaveLength(2);
    expect(written[0].map((f) => f.sessionId)).toEqual(["s1", "s2"]);
  });

  it("should flush a buffered shortResult snapshot before the tool block's end", () => {
    // 工具结束是离散事件：先冲刷快照，再发权威终值。手机因此仍然按「进度 → 终
    // 态」的顺序看到这一块，最后一次进度更新也不会被窗口吞掉。
    const c = createCoalescer();
    c.push(
      "toolBlockUpdated",
      {
        messageId: "m1",
        id: "t1",
        stage: "running",
        shortResult: "跑到第 3 个用例",
      },
      "s1",
    );
    c.push(
      "toolBlockUpdated",
      {
        messageId: "m1",
        id: "t1",
        stage: "end",
        shortResult: "3 passed",
        result: "…",
      },
      "s1",
    );

    expect(written).toHaveLength(2);
    expect((written[0][0].params as { shortResult: string }).shortResult).toBe(
      "跑到第 3 个用例",
    );
    expect((written[1][0].params as { stage: string }).stage).toBe("end");
  });

  it("should write a running frame without shortResult through at once", () => {
    // 「参数已完整、工具开始执行」那条 running 快照不带 shortResult，它是结构性
    // 事件，不能被窗口延迟（否则手机要等 150ms 才知道工具真的开跑了）。
    const c = createCoalescer();
    c.push(
      "toolBlockUpdated",
      {
        messageId: "m1",
        id: "t1",
        stage: "running",
        name: "Bash",
        parameters: '{"command":"pnpm test"}',
        parametersChunk: "",
      },
      "s1",
    );

    expect(written).toHaveLength(1);
    expect((written[0][0].params as { stage: string }).stage).toBe("running");
  });

  it("should not merge a non-streaming stage", () => {
    const c = createCoalescer();
    c.push(
      "assistantContentUpdated",
      { messageId: "m1", chunk: "full", stage: "end" },
      "s1",
    );
    c.push(
      "assistantContentUpdated",
      { messageId: "m1", chunk: "more", stage: "end" },
      "s1",
    );

    expect(written).toHaveLength(2);
  });

  it("should write a discrete event through at once, after flushing buffered deltas", () => {
    const c = createCoalescer();
    c.push(
      "assistantContentUpdated",
      { messageId: "m1", chunk: "a", stage: "streaming" },
      "s1",
    );
    c.push("permissionRequest", { requestId: "r1" }, "s1");

    expect(written).toHaveLength(2);
    expect(written[0][0].method).toBe("assistantContentUpdated");
    expect(written[1][0].method).toBe("permissionRequest");
    // Nothing left behind for the (now cleared) window.
    vi.advanceTimersByTime(REMOTE_FRAME_WINDOW_MS);
    expect(written).toHaveLength(2);
  });

  it("should preserve run order when a discrete event sits between two runs", () => {
    const c = createCoalescer();
    c.push(
      "assistantContentUpdated",
      { messageId: "m1", chunk: "a", stage: "streaming" },
      "s1",
    );
    c.push(
      "assistantContentUpdated",
      { messageId: "m2", chunk: "b", stage: "streaming" },
      "s1",
    );
    c.push(
      "toolBlockUpdated",
      { messageId: "m1", id: "t1", stage: "end" },
      "s1",
    );
    c.push(
      "assistantContentUpdated",
      { messageId: "m1", chunk: "c", stage: "streaming" },
      "s1",
    );
    vi.advanceTimersByTime(REMOTE_FRAME_WINDOW_MS);

    const flat = written.flat();
    expect(flat).toHaveLength(4);
    expect(flat.map((f) => f.method)).toEqual([
      "assistantContentUpdated",
      "assistantContentUpdated",
      "toolBlockUpdated",
      "assistantContentUpdated",
    ]);
    expect((flat[0].params as { chunk: string }).chunk).toBe("a");
    expect((flat[1].params as { chunk: string }).chunk).toBe("b");
    expect((flat[3].params as { chunk: string }).chunk).toBe("c");
  });

  it("should restart the window for a run that arrives after a flush", () => {
    const c = createCoalescer();
    c.push(
      "assistantContentUpdated",
      { messageId: "m1", chunk: "a", stage: "streaming" },
      "s1",
    );
    vi.advanceTimersByTime(REMOTE_FRAME_WINDOW_MS);
    c.push(
      "assistantContentUpdated",
      { messageId: "m1", chunk: "b", stage: "streaming" },
      "s1",
    );

    expect(written).toHaveLength(1);
    vi.advanceTimersByTime(REMOTE_FRAME_WINDOW_MS);
    expect(written).toHaveLength(2);
    expect((written[1][0].params as { chunk: string }).chunk).toBe("b");
  });

  it("should drop buffered frames on discard without writing them", () => {
    const c = createCoalescer();
    c.push(
      "assistantContentUpdated",
      { messageId: "m1", chunk: "a", stage: "streaming" },
      "s1",
    );
    c.discard();

    vi.advanceTimersByTime(REMOTE_FRAME_WINDOW_MS);
    expect(written).toHaveLength(0);
  });

  it("should ignore params that are not an object", () => {
    const c = createCoalescer();
    c.push("assistantContentUpdated", undefined, "s1");

    expect(written).toHaveLength(1);
    expect(written[0][0].params).toBeUndefined();
  });
});
