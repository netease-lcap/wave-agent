import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SEND_USER_FILE_TOOL_NAME } from "wave-agent-sdk/constants";
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

/** 一次 `SendUserFile` 调用：结果里带一个已落盘的文件。 */
const delivery = (
  id: string,
  stage: "running" | "end" = "end",
  extra: Record<string, unknown> = {},
): MessageBlock =>
  ({
    type: "tool",
    id,
    name: SEND_USER_FILE_TOOL_NAME,
    stage,
    data: {
      attachments: [
        {
          path: join("fake", "project", "report.md"),
          name: "report.md",
          kind: "text",
        },
      ],
    },
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
    const { items, rowIndexByMessageIndex, processRowByMessageIndex } =
      buildFocusItems(messages, false, false);

    expect(items.map((item) => item.kind)).toEqual([
      "message",
      "message",
      "message",
    ]);
    expect(rowIndexByMessageIndex).toEqual([0, 1, 2]);
    // 没有折叠行，也就没有「过程半」。
    expect(processRowByMessageIndex).toEqual([-1, -1, -1]);
  });

  it("按「一条用户消息到下一条用户消息之前」切轮，轮尾无工具的答复留在卡外", () => {
    const messages = [
      user("u1"),
      assistant("a1", [tool("t1", "end")]),
      assistant("a2", [tool("t2", "end")]),
      assistant("a3", [text("这一轮的答复")]),
    ];
    const { items, rowIndexByMessageIndex } = buildFocusItems(
      messages,
      true,
      false,
    );

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
    // 末条以（已结束的）工具块收尾、这一轮还在跑：整轮进卡，卡外没有答复。
    const { items, rowIndexByMessageIndex } = buildFocusItems(
      messages,
      true,
      true,
    );

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
    const { items, rowIndexByMessageIndex, processRowByMessageIndex } =
      buildFocusItems(messages, true, false);

    expect(items.map((item) => item.kind)).toEqual([
      "message",
      "fold",
      "message",
    ]);
    const fold = items[1];
    if (fold.kind !== "fold") throw new Error("expected fold");
    // 卡内最后一份是 a2 的前段（只有思考）。这条消息横跨两行（思考在卡里、
    // 答复在卡外），两半都各自成行，所以两半都换 id 后缀 —— 同一视图里不能
    // 出现两条同 id 的行（虚拟列表的 key 与测量锚点都会撞）。
    expect(fold.messages.map((message) => message.id)).toEqual([
      "a1",
      "a2:process",
    ]);
    expect(fold.messages[1].blocks.map((block) => block.type)).toEqual([
      "reasoning",
    ]);
    expect(fold.hasReasoning).toBe(true);
    // 卡外那半含答复，带 :kept 后缀（reveal 的锚点跟着它）。
    const tail = items[2];
    if (tail.kind !== "message") throw new Error("expected message");
    expect(tail.message.id).toBe("a2:kept");
    expect(tail.message.blocks.map((block) => block.type)).toEqual(["text"]);
    // 行坐标按消息算：这条消息的答复在卡外，所以它整条指向卡外那一行。
    expect(rowIndexByMessageIndex).toEqual([0, 1, 2]);
    // 但它还有一半在卡里（思考那半）。reveal 只按上面那份坐标展开
    // 会「跳过来看到答复、思考仍收着」，所以过程半的卡行坐标单独给一份：
    // 只有被拆开的那条（a2，下标 2）有，指向卡那一行（1）。
    expect(processRowByMessageIndex).toEqual([-1, -1, 1]);
  });

  it("轮尾只有思考、没有答复时整轮进卡，卡外不留孤零零的思考行", () => {
    const messages = [
      user("u1"),
      assistant("a1", [tool("t1", "end")]),
      assistant("a2", [{ type: "reasoning", content: "想一想", stage: "end" }]),
    ];
    const { items } = buildFocusItems(messages, true, false);

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
    const { items } = buildFocusItems(messages, true, false);

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
    const fold = buildFocusItems(messages, true, true).items[1];

    if (fold.kind !== "fold") throw new Error("expected fold");
    expect(fold.live).toBe(true);
    expect(fold.runningToolName).toBeUndefined();
  });

  it("中断的那一轮按已结束处理（形状等不到答复，真信号说它已经停了）", () => {
    // 用户按 Esc 时 SDK 把在飞的工具块 finalize 成 end，这一轮就此收口；末条
    // 仍以工具块收尾 —— 形状上这一轮「还没等到答复」。只有运行时信号能说它已经
    // 结束（spec ui/focus-view.md「失败与中断」：用户中断的那一轮按已结束处理）。
    // #3159 只按形状判定，这一行因此永久停在「正在思考…」。
    const messages = [
      user("u1"),
      assistant("a1", [
        text("我先跑个命令", "end"),
        tool("t1", "end", { error: "Request was aborted" }),
      ]),
    ];
    const fold = buildFocusItems(messages, true, false).items[1];

    if (fold.kind !== "fold") throw new Error("expected fold");
    expect(fold.live).toBe(false);
    // 结算文案要用的两个数照旧：1 次调用、1 个失败。
    expect(fold.callCount).toBe(1);
    expect(fold.errorCount).toBe(1);
  });

  it("中断真实形状：末块是那行收尾提示时，提示留在卡外", () => {
    // 中断时 SDK 收口工具块之后会往**同一条消息**里压一行 error 级收尾提示
    // （aiManager 的 catch 分支）。那一行是「这一轮怎么收的场」，按 spec
    //「失败与中断」要留在卡外 —— 不能因为前面还躺着工具块就整轮吞进卡里。
    const messages = [
      user("u1"),
      assistant("a1", [tool("t1", "end")]),
      assistant("a2", [
        tool("t2", "end", { error: "Request was aborted" }),
        { type: "notice", level: "error", content: "Request was aborted" },
      ]),
    ];
    const { items } = buildFocusItems(messages, true, false);

    expect(items.map((item) => item.kind)).toEqual([
      "message",
      "fold",
      "message",
    ]);
    const fold = items[1];
    if (fold.kind !== "fold") throw new Error("expected fold");
    expect(fold.live).toBe(false);
    expect(fold.messages.map((message) => message.id)).toEqual([
      "a1",
      "a2:process",
    ]);
    const tail = items[2];
    if (tail.kind !== "message") throw new Error("expected message");
    expect(tail.message.blocks.map((block) => block.type)).toEqual(["notice"]);
  });

  it("更早那一轮已经结束：后面一轮在跑时它不冒充进行态", () => {
    // 只有窗口里最后那一轮可能是进行中的。历史中断轮同样是「末条以工具块收尾」，
    // 若只看 isStreaming 不看位置，它会跟着后面那轮一起亮成进行态。
    const messages = [
      user("u1"),
      assistant("a1", [tool("t1", "end", { error: "Request was aborted" })]),
      user("u2"),
      assistant("a2", [tool("t2", "running")]),
    ];
    const folds = foldOf(buildFocusItems(messages, true, true).items);

    expect(folds.map((fold) => fold.live)).toEqual([false, true]);
  });

  it("只有一条纯文本答复的轮不折叠（没有可折叠的活动）", () => {
    const messages = [user("u1"), assistant("a1", [text("答复")])];
    const { items } = buildFocusItems(messages, true, false);

    expect(items.map((item) => item.kind)).toEqual(["message", "message"]);
  });

  it("每轮的折叠 key 取这一轮的用户消息，跨轮不重复", () => {
    const messages = [
      user("u1"),
      assistant("a1", [tool("t1", "end")]),
      user("u2"),
      assistant("a2", [tool("t2", "end")]),
    ];
    const folds = foldOf(buildFocusItems(messages, true, false).items);

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
      const fold = buildFocusItems(messages, true, true).items[index];
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
    const folds = foldOf(buildFocusItems(messages, true, false).items);

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
    const { items } = buildFocusItems(messages, true, true);
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
    const { items } = buildFocusItems(messages, true, true);

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
    const { items } = buildFocusItems(messages, true, false);
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
    const fold = buildFocusItems(messages, true, false).items[1];

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
    const { items, rowIndexByMessageIndex } = buildFocusItems(
      messages,
      true,
      false,
    );

    expect(items.map((item) => item.kind)).toEqual([
      "message",
      "fold",
      "message",
      "message",
      "fold",
    ]);
    expect(rowIndexByMessageIndex).toEqual([0, 1, 2, 3, 4]);
  });

  it("轮尾只有一次成功交付时，卡片留在卡外、也不计入工具调用数", () => {
    // spec ui/focus-view.md「交付内容」：交付是「结果」不是「过程」。模型交付完
    // 常常就收工 —— 末条以工具块收尾，按老规则整轮进卡，卡片用户根本看不见。
    const messages = [
      user("u1"),
      assistant("a1", [tool("t1", "end")]),
      assistant("a2", [delivery("d1")]),
    ];
    const { items, rowIndexByMessageIndex } = buildFocusItems(
      messages,
      true,
      false,
    );

    expect(items.map((item) => item.kind)).toEqual([
      "message",
      "fold",
      "message",
    ]);
    const fold = items[1];
    if (fold.kind !== "fold") throw new Error("expected fold");
    expect(fold.messages.map((message) => message.id)).toEqual(["a1"]);
    expect(fold.callCount).toBe(1);
    expect(fold.endMessageIndex).toBe(1);
    // 卡外那行就是原消息（锚点不变），里面是那张卡片。
    const card = items[2];
    if (card.kind !== "message") throw new Error("expected message");
    expect(card.message.id).toBe("a2");
    expect(card.message.blocks).toHaveLength(1);
    // 末条消息的行坐标指向卡外那半。
    expect(rowIndexByMessageIndex).toEqual([0, 1, 2]);
  });

  it("轮中间的交付也留卡外，同一条消息的其余块仍收在卡里", () => {
    const messages = [
      user("u1"),
      assistant("a1", [tool("t1", "end"), delivery("d1"), tool("t2", "end")]),
      assistant("a2", [text("答复")]),
    ];
    const { items, rowIndexByMessageIndex } = buildFocusItems(
      messages,
      true,
      false,
    );

    expect(items.map((item) => item.kind)).toEqual([
      "message",
      "fold",
      "message",
      "message",
    ]);
    const fold = items[1];
    if (fold.kind !== "fold") throw new Error("expected fold");
    // 两半各自成行，各自换后缀：卡内那半是 :process，卡外那半是 :kept
    // （reveal 的锚点跟着卡外那半）。
    expect(fold.messages.map((message) => message.id)).toEqual(["a1:process"]);
    expect(fold.messages[0].blocks.map((block) => block.type)).toEqual([
      "tool",
      "tool",
    ]);
    expect(fold.callCount).toBe(2);
    const card = items[2];
    if (card.kind !== "message") throw new Error("expected message");
    expect(card.message.id).toBe("a1:kept");
    expect(card.message.blocks).toHaveLength(1);
    // 更早那条消息的行坐标不动：它的主体在卡里。
    expect(rowIndexByMessageIndex).toEqual([0, 1, 3]);
  });

  it("交付与答复同在一条消息里时，两者都留卡外并按原顺序排列", () => {
    const messages = [
      user("u1"),
      assistant("a1", [tool("t1", "end")]),
      assistant("a2", [delivery("d1"), text("答复")]),
    ];
    const { items } = buildFocusItems(messages, true, false);

    expect(items.map((item) => item.kind)).toEqual([
      "message",
      "fold",
      "message",
    ]);
    const tail = items[2];
    if (tail.kind !== "message") throw new Error("expected message");
    expect(tail.message.id).toBe("a2");
    expect(tail.message.blocks.map((block) => block.type)).toEqual([
      "tool",
      "text",
    ]);
  });

  it("交付失败或还在跑的 SendUserFile 按普通过程处理，仍收在卡里", () => {
    const failed = buildFocusItems(
      [
        user("u1"),
        assistant("a1", [delivery("d1", "end", { success: false })]),
      ],
      true,
      false,
    ).items;
    expect(failed.map((item) => item.kind)).toEqual(["message", "fold"]);
    const failedFold = failed[1];
    if (failedFold.kind !== "fold") throw new Error("expected fold");
    expect(failedFold.callCount).toBe(1);
    expect(failedFold.errorCount).toBe(1);

    const running = buildFocusItems(
      [user("u1"), assistant("a1", [delivery("d1", "running")])],
      true,
      true,
    ).items;
    expect(running.map((item) => item.kind)).toEqual(["message", "fold"]);
    const runningFold = running[1];
    if (runningFold.kind !== "fold") throw new Error("expected fold");
    expect(runningFold.runningToolName).toBe(SEND_USER_FILE_TOOL_NAME);
  });

  it("展开的卡把这一轮的活动拆成各自的行，行坐标各指自己的行", () => {
    // 对齐 CC 桌面端：展开 = 把收起的活动放回列表，每条活动各自是虚拟列表的一
    // 行（行高与挂载都按行算）。卡头仍占一行，卡外答复不动。
    const messages = [
      user("u1"),
      assistant("a1", [tool("t1", "end")]),
      assistant("a2", [tool("t2", "end")]),
      assistant("a3", [text("这一轮的答复")]),
    ];
    const { items, rowIndexByMessageIndex, processRowByMessageIndex } =
      buildFocusItems(messages, true, false, new Set(["focus-fold:u1"]));

    expect(items.map((item) => item.kind)).toEqual([
      "message",
      "fold",
      "message",
      "message",
      "message",
    ]);
    expect(rowIndexByMessageIndex).toEqual([0, 2, 3, 4]);
    // 展开态整条消息就是自己的行，「过程半」这份坐标不再需要。
    expect(processRowByMessageIndex).toEqual([-1, -1, -1, -1]);
    const inFoldKeys: string[] = [];
    for (const item of items) {
      if (item.kind === "message" && item.foldKey) {
        inFoldKeys.push(item.key);
        expect(item.foldKey).toBe("focus-fold:u1");
      }
    }
    expect(inFoldKeys).toEqual(["a1", "a2"]);
  });

  it("展开态卡内只放过程半，轮尾答复仍留在卡外", () => {
    // 展开不改变「哪一半属于卡内」：卡内是这一轮被折叠的活动（思考），答复一直
    // 是卡外那一行（spec 场景 2 与 4）。两半各自成行、各自带后缀。
    const messages = [
      user("u1"),
      assistant("a1", [tool("t1", "end")]),
      assistant("a2", [
        { type: "reasoning", content: "想一想", stage: "end" },
        { type: "text", content: "这一轮的答复", stage: "end" },
      ]),
    ];
    const { items, rowIndexByMessageIndex, processRowByMessageIndex } =
      buildFocusItems(messages, true, false, new Set(["focus-fold:u1"]));

    expect(items.map((item) => item.kind)).toEqual([
      "message",
      "fold",
      "message",
      "message",
      "message",
    ]);
    const inFold: Message[] = [];
    for (const item of items) {
      if (item.kind === "message" && item.foldKey) inFold.push(item.message);
    }
    expect(inFold.map((message) => message.id)).toEqual(["a1", "a2:process"]);
    expect(inFold[1].blocks.map((block) => block.type)).toEqual(["reasoning"]);
    const outside = items[4];
    if (outside.kind !== "message") throw new Error("expected message");
    expect(outside.message.id).toBe("a2:kept");
    expect(outside.foldKey).toBeUndefined();
    // 整条消息的行坐标指卡外那半；过程半单独一份（reveal 用它展开卡）。
    expect(rowIndexByMessageIndex).toEqual([0, 2, 4]);
    expect(processRowByMessageIndex).toEqual([-1, -1, 3]);
  });

  it("一轮只有一次交付时不出摘要行（没有可折叠的活动）", () => {
    const messages = [user("u1"), assistant("a1", [delivery("d1")])];
    const { items } = buildFocusItems(messages, true, false);

    expect(items.map((item) => item.kind)).toEqual(["message", "message"]);
    const card = items[1];
    if (card.kind !== "message") throw new Error("expected message");
    expect(card.message.id).toBe("a1");
  });
});
