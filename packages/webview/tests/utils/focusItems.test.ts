import { describe, expect, it } from "vitest";
import type { Message, MessageBlock } from "wave-agent-sdk/types";
import { buildFocusItems } from "../../src/utils/focusItems";

const user = (id: string): Message => ({
  id,
  role: "user",
  timestamp: "2025-01-01T00:00:00.000Z",
  blocks: [{ type: "text", content: "我" + id }],
});

const assistant = (id: string, blocks: MessageBlock[]): Message => ({
  id,
  role: "assistant",
  timestamp: "2025-01-01T00:00:00.000Z",
  blocks,
});

const text = (content: string, stage?: "streaming" | "end"): MessageBlock => ({
  type: "text",
  content,
  stage,
});

const tool = (
  id: string,
  stage: "start" | "streaming" | "running" | "end",
  extra: Record<string, unknown> = {},
): MessageBlock =>
  ({
    type: "tool",
    id,
    name: "Bash",
    stage,
    ...extra,
  }) as unknown as MessageBlock;

const foldOf = (items: ReturnType<typeof buildFocusItems>["items"]) =>
  items.filter((item) => item.kind === "fold");

describe("buildFocusItems", () => {
  it("关闭聚焦视图时一条消息一行，下标翻译是恒等的", () => {
    const messages = [
      user("u1"),
      assistant("a1", [tool("t1", "end")]),
      assistant("a2", [text("答复")]),
    ];
    const { items, rowIndexByMessageIndex } = buildFocusItems(messages, false);

    expect(items.map((item) => item.kind)).toEqual([
      "message",
      "message",
      "message",
    ]);
    expect(rowIndexByMessageIndex).toEqual([0, 1, 2]);
  });

  it("按「一条用户消息到下一条用户消息之前」切轮，轮尾无工具的答复留在卡外", () => {
    const messages = [
      user("u1"),
      assistant("a1", [tool("t1", "end")]),
      assistant("a2", [tool("t2", "end")]),
      assistant("a3", [text("这一轮的答复")]),
    ];
    const { items, rowIndexByMessageIndex } = buildFocusItems(messages, true);

    expect(items).toHaveLength(3);
    const fold = foldOf(items)[0];
    if (fold.kind !== "fold") throw new Error("expected fold");
    expect(fold.messages.map((message) => message.id)).toEqual(["a1", "a2"]);
    expect(fold.callCount).toBe(2);
    expect(fold.startMessageIndex).toBe(1);
    expect(fold.endMessageIndex).toBe(2);
    // 轮尾答复单独一行，不进卡。
    expect(items[2].kind).toBe("message");
    // 卡内两条消息都指向卡那一行。
    expect(rowIndexByMessageIndex).toEqual([0, 1, 1, 2]);
  });

  it("轮尾仍是工具调用时整轮进卡、卡外没有答复", () => {
    const messages = [
      user("u1"),
      assistant("a1", [tool("t1", "end")]),
      assistant("a2", [tool("t2", "end")]),
    ];
    const { items, rowIndexByMessageIndex } = buildFocusItems(messages, true);

    expect(items.map((item) => item.kind)).toEqual(["message", "fold"]);
    expect(rowIndexByMessageIndex).toEqual([0, 1, 1]);
  });

  it("轮尾那条消息里思考 + 答复并存时，思考进卡、卡外只留答复（按块切）", () => {
    // 用户的真实会话就是这个形状：同一条 assistant 消息 blocks = [reasoning, text]。
    // 折叠粒度若是整条消息，思考会跟着答复一起露在卡外（spec 场景 2 的反例）。
    const messages = [
      user("u1"),
      assistant("a1", [tool("t1", "end")]),
      assistant("a2", [
        { type: "reasoning", content: "想一想", stage: "end" },
        { type: "text", content: "这一轮的答复", stage: "end" },
      ]),
    ];
    const { items, rowIndexByMessageIndex } = buildFocusItems(messages, true);

    expect(items.map((item) => item.kind)).toEqual([
      "message",
      "fold",
      "message",
    ]);
    const fold = items[1];
    if (fold.kind !== "fold") throw new Error("expected fold");
    // 卡内最后一份是 a2 的前段（只有思考），id 加后缀避免同一视图出现两条同 id。
    expect(fold.messages.map((message) => message.id)).toEqual([
      "a1",
      "a2:process",
    ]);
    expect(fold.messages[1].blocks.map((block) => block.type)).toEqual([
      "reasoning",
    ]);
    expect(fold.hasReasoning).toBe(true);
    // 卡外那半含答复、仍用原 id。
    const tail = items[2];
    if (tail.kind !== "message") throw new Error("expected message");
    expect(tail.message.id).toBe("a2");
    expect(tail.message.blocks.map((block) => block.type)).toEqual(["text"]);
    // 行坐标按消息算：这条消息的答复在卡外，所以它整条指向卡外那一行。
    expect(rowIndexByMessageIndex).toEqual([0, 1, 2]);
  });

  it("轮尾只有思考、没有答复时整轮进卡，卡外不留孤零零的思考行", () => {
    const messages = [
      user("u1"),
      assistant("a1", [tool("t1", "end")]),
      assistant("a2", [{ type: "reasoning", content: "想一想", stage: "end" }]),
    ];
    const { items } = buildFocusItems(messages, true);

    expect(items.map((item) => item.kind)).toEqual(["message", "fold"]);
    const fold = items[1];
    if (fold.kind !== "fold") throw new Error("expected fold");
    expect(fold.messages.map((message) => message.id)).toEqual(["a1", "a2"]);
    expect(fold.hasReasoning).toBe(true);
    expect(fold.live).toBe(false);
  });

  it("轮尾消息里的通知行仍留在卡外（不折叠）", () => {
    const messages = [
      user("u1"),
      assistant("a1", [tool("t1", "end")]),
      assistant("a2", [
        { type: "reasoning", content: "想一想", stage: "end" },
        { type: "notice", level: "error", content: "Request was aborted" },
      ]),
    ];
    const { items } = buildFocusItems(messages, true);

    expect(items.map((item) => item.kind)).toEqual([
      "message",
      "fold",
      "message",
    ]);
    const tail = items[2];
    if (tail.kind !== "message") throw new Error("expected message");
    expect(tail.message.blocks.map((block) => block.type)).toEqual(["notice"]);
  });

  it("工具都跑完了但模型还没给答复时，这一轮仍是进行态（不回落成结算文案）", () => {
    // 进行态的口径是整轮：工具刚 end、下一段响应还没开始，所有块都是 end，
    // 但轮没结束。按块级判定会在这里翻成「N 次工具调用」，下一段流式开始再
    // 跳回进行态 —— 折叠行文案来回抖的根因（spec 场景 3）。
    const messages = [
      user("u1"),
      assistant("a1", [tool("t1", "end")]),
      assistant("a2", [tool("t2", "end")]),
    ];
    const fold = buildFocusItems(messages, true).items[1];

    if (fold.kind !== "fold") throw new Error("expected fold");
    expect(fold.live).toBe(true);
    expect(fold.runningToolName).toBeUndefined();
  });

  it("只有一条纯文本答复的轮不折叠（没有可折叠的活动）", () => {
    const messages = [user("u1"), assistant("a1", [text("答复")])];
    const { items } = buildFocusItems(messages, true);

    expect(items.map((item) => item.kind)).toEqual(["message", "message"]);
  });

  it("每轮的折叠 key 取这一轮的用户消息，跨轮不重复", () => {
    const messages = [
      user("u1"),
      assistant("a1", [tool("t1", "end")]),
      user("u2"),
      assistant("a2", [tool("t2", "end")]),
    ];
    const folds = foldOf(buildFocusItems(messages, true).items);

    expect(folds.map((fold) => fold.key)).toEqual([
      "focus-fold:u1",
      "focus-fold:u2",
    ]);
  });

  it("这一轮又长出一条消息时 key 不变（用户展开的卡不会被收回去）", () => {
    const before = [
      user("u1"),
      assistant("a1", [tool("t1", "end")]),
      assistant("a2", [tool("t2", "running")]),
    ];
    const after = [
      ...before,
      assistant("a3", [tool("t3", "end")]),
      assistant("a4", [tool("t4", "running")]),
    ];

    const keyOf = (messages: Message[], index: number) => {
      const fold = buildFocusItems(messages, true).items[index];
      if (fold.kind !== "fold") throw new Error("expected fold");
      return fold.key;
    };
    expect(keyOf(after, 1)).toBe(keyOf(before, 1));
  });

  it("历史起点落在助手消息上（上一页还没取回）时退回轮首消息 id", () => {
    const messages = [
      assistant("a1", [tool("t1", "end")]),
      assistant("a2", [tool("t2", "end")]),
      user("u1"),
      assistant("a3", [tool("t3", "end")]),
    ];
    const folds = foldOf(buildFocusItems(messages, true).items);

    expect(folds.map((fold) => fold.key)).toEqual([
      "focus-fold:a1",
      "focus-fold:u1",
    ]);
  });

  it("运行中的一轮整轮进卡，并带上最后那个未结束的工具名", () => {
    const messages = [
      user("u1"),
      assistant("a1", [tool("t1", "end")]),
      assistant("a2", [tool("t2", "running")]),
    ];
    const { items } = buildFocusItems(messages, true);
    const fold = items[1];

    if (fold.kind !== "fold") throw new Error("expected fold");
    expect(fold.live).toBe(true);
    expect(fold.runningToolName).toBe("Bash");
    expect(fold.callCount).toBe(2);
  });

  it("轮尾文本还在流式输出时也整轮进卡（没有落定的答复可留在卡外）", () => {
    const messages = [
      user("u1"),
      assistant("a1", [tool("t1", "end")]),
      assistant("a2", [text("正在写…", "streaming")]),
    ];
    const { items } = buildFocusItems(messages, true);

    expect(items).toHaveLength(2);
    const fold = items[1];
    if (fold.kind !== "fold") throw new Error("expected fold");
    expect(fold.messages.map((message) => message.id)).toEqual(["a1", "a2"]);
    expect(fold.live).toBe(true);
    expect(fold.runningToolName).toBeUndefined();
  });

  it("统计失败的调用与思考块", () => {
    const messages = [
      user("u1"),
      assistant("a1", [
        { type: "reasoning", content: "想一想", stage: "end" },
        tool("t1", "end", { error: "boom" }),
        tool("t2", "end", { success: false }),
        tool("t3", "end"),
      ]),
      assistant("a2", [tool("t4", "end")]),
      assistant("a3", [text("这一轮的答复")]),
    ];
    const { items } = buildFocusItems(messages, true);
    const fold = items[1];

    if (fold.kind !== "fold") throw new Error("expected fold");
    expect(fold.callCount).toBe(4);
    expect(fold.errorCount).toBe(2);
    expect(fold.hasReasoning).toBe(true);
    expect(fold.live).toBe(false);
  });

  it("空白思考块不算「思考过程」", () => {
    const messages = [
      user("u1"),
      assistant("a1", [
        { type: "reasoning", content: "  ", stage: "end" },
        tool("t1", "end"),
      ]),
    ];
    const fold = buildFocusItems(messages, true).items[1];

    if (fold.kind !== "fold") throw new Error("expected fold");
    expect(fold.hasReasoning).toBe(false);
  });

  it("连续多条用户消息各自成行，不会并进上一张卡", () => {
    const messages = [
      user("u1"),
      assistant("a1", [tool("t1", "end")]),
      user("u2"),
      user("u3"),
      assistant("a2", [tool("t2", "end")]),
    ];
    const { items, rowIndexByMessageIndex } = buildFocusItems(messages, true);

    expect(items.map((item) => item.kind)).toEqual([
      "message",
      "fold",
      "message",
      "message",
      "fold",
    ]);
    expect(rowIndexByMessageIndex).toEqual([0, 1, 2, 3, 4]);
  });
});
