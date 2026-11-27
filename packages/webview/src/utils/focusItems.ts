import type { Message, MessageBlock } from "../types";

/**
 * Focus 视图的布局项。
 *
 * 折叠**只改变布局项**，不改变消息本身：渲染仍由虚拟列表按行窗口化，所以展开
 * 一个含上百条活动的轮也只挂视口里的那几行（见 docs/specs/ui/focus-view.md
 * 场景 7）。参考实现是 Claude 桌面端 6.28899.6 的 turn 布局引擎，不是 VSCode
 * 扩展那套「重新分组后全量渲染」。
 */
export interface FocusFoldItem {
  kind: "fold";
  /** 虚拟列表的行 key。复合 key：首尾消息 id，跨轮不重复。 */
  key: string;
  messages: Message[];
  /** 覆盖的可见消息下标区间（闭区间），用于把消息坐标翻译成行坐标。 */
  startMessageIndex: number;
  endMessageIndex: number;
  callCount: number;
  errorCount: number;
  hasReasoning: boolean;
  /** 这一轮还在跑（有未结束的工具块或流式文本）。 */
  live: boolean;
  runningToolName?: string;
}

export interface FocusMessageItem {
  kind: "message";
  key: string;
  message: Message;
  messageIndex: number;
}

export type FocusItem = FocusFoldItem | FocusMessageItem;

export interface FocusItems {
  items: FocusItem[];
  /** 可见消息下标 → 行下标。折叠项覆盖的每条消息都指向同一个行。 */
  rowIndexByMessageIndex: number[];
}

const isToolBlock = (block: MessageBlock): boolean => block.type === "tool";

function hasToolBlock(message: Message): boolean {
  return (message.blocks ?? []).some(isToolBlock);
}

/** 最后一块还没结束的工具名（文案「正在执行 X…」用它）。 */
function openToolName(message: Message): string | undefined {
  let name: string | undefined;
  for (const block of message.blocks ?? []) {
    if (block.type !== "tool") continue;
    if (block.stage === "end") continue;
    if (block.name) name = block.name;
  }
  return name;
}

function messageIsLive(message: Message): boolean {
  for (const block of message.blocks ?? []) {
    if (block.type === "tool" && block.stage !== "end") return true;
    if (
      (block.type === "text" || block.type === "reasoning") &&
      block.stage === "streaming"
    ) {
      return true;
    }
  }
  return false;
}

function countToolBlocks(messages: Message[]): {
  calls: number;
  errors: number;
} {
  let calls = 0;
  let errors = 0;
  for (const message of messages) {
    for (const block of message.blocks ?? []) {
      if (block.type !== "tool") continue;
      calls++;
      if (block.error || block.success === false) errors++;
    }
  }
  return { calls, errors };
}

/**
 * 轮尾答复在这条消息里的起点块下标（spec ui/focus-view.md 场景 2）。
 *
 * 答复的判据是**块**而不是整条消息：这条消息里最后一个非空文本块就是答复本身；
 * `notice` / `compact` 属于「不折叠」的说明行，也一起留卡外，所以取两者中更早
 * 的位置。排在它前面的块（思考等）仍归本轮折叠 —— 参考实现同样按「轮内块下标」
 * 切分（Claude 桌面端 6.28899.6 `cac57de41` 的 `shownAt = rqe(items, …,
 * focusClosing)`）。没有这样的块时返回 -1：整条消息都是过程，整轮进卡。
 */
function replyStartIndex(message: Message): number {
  const blocks = message.blocks ?? [];
  let textStart = -1;
  let keptStart = -1;
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (block.type === "text" && block.content?.trim()) textStart = index;
    if (
      (block.type === "notice" || block.type === "compact") &&
      keptStart < 0
    ) {
      keptStart = index;
    }
  }
  if (textStart < 0) return keptStart;
  return keptStart < 0 ? textStart : Math.min(textStart, keptStart);
}

/**
 * 只保留一段块的消息副本，用于把一条消息拆成「卡内过程 + 卡外答复」。
 *
 * 渲染层仍按整条消息渲染（`<Message message={…} />` 只认 `blocks`），所以折叠
 * 不需要给 `Message` 加参数；卡外那半沿用的原 id（保持 `data-measured-message-id`
 * 等锚点不变），卡内这半加后缀，避免同一视图里出现两条同 id 的消息行。
 */
function sliceBlocks(
  message: Message,
  start: number,
  end: number,
  suffix: string,
): Message {
  return {
    ...message,
    id: message.id + suffix,
    blocks: (message.blocks ?? []).slice(start, end),
  };
}

function hasReasoningBlock(messages: Message[]): boolean {
  return messages.some((message) =>
    (message.blocks ?? []).some(
      (block) => block.type === "reasoning" && !!block.content?.trim(),
    ),
  );
}

/**
 * 把可见消息折叠成布局项。
 *
 * 折叠的单位是**一轮**：一条用户消息之后、下一条用户消息之前的连续助手消息。
 * 一轮里最后一条助手消息若已结束且**不含工具块**，它里面的答复（最后一个非空
 * 文本块，以及 notice / compact 说明行）留在卡外，排在它前面的块（思考等）仍进
 * 摘要；这条消息没有任何可留卡外的块（纯思考收尾），或这一轮还在跑 / 最后一次
 * 响应又调了工具时，整轮进摘要，卡外没有答复文本。
 *
 * 不折叠的情况只有两种：关闭 focus 视图，以及这一轮没有可折叠的活动（只有一条
 * 纯文本答复）。
 */
export function buildFocusItems(
  messages: Message[],
  focus: boolean,
): FocusItems {
  const items: FocusItem[] = [];
  const rowIndexByMessageIndex: number[] = new Array(messages.length).fill(0);

  const pushMessage = (message: Message, messageIndex: number) => {
    rowIndexByMessageIndex[messageIndex] = items.length;
    items.push({
      kind: "message",
      key: message.id,
      message,
      messageIndex,
    });
  };

  const pushFold = (
    run: Message[],
    startMessageIndex: number,
    turnKey: string,
    live: boolean,
  ) => {
    const { calls, errors } = countToolBlocks(run);
    let runningToolName: string | undefined;
    for (let index = run.length - 1; index >= 0 && !runningToolName; index--) {
      runningToolName = openToolName(run[index]);
    }
    for (let offset = 0; offset < run.length; offset++) {
      rowIndexByMessageIndex[startMessageIndex + offset] = items.length;
    }
    items.push({
      kind: "fold",
      key: "focus-fold:" + turnKey,
      messages: run,
      startMessageIndex,
      endMessageIndex: startMessageIndex + run.length - 1,
      callCount: calls,
      errorCount: errors,
      hasReasoning: hasReasoningBlock(run),
      live,
      runningToolName,
    });
  };

  if (!focus) {
    messages.forEach(pushMessage);
    return { items, rowIndexByMessageIndex };
  }

  let index = 0;
  while (index < messages.length) {
    const message = messages[index];
    if (message.role !== "assistant") {
      pushMessage(message, index);
      index++;
      continue;
    }
    let runEnd = index;
    while (runEnd < messages.length && messages[runEnd].role === "assistant") {
      runEnd++;
    }
    const run = messages.slice(index, runEnd);
    const lastMessage = run[run.length - 1];
    // 轮尾答复按**块**切（spec ui/focus-view.md 场景 2）：这条消息结束了且不含
    // 工具块时，从它的答复起点（最后一个非空文本块 / notice / compact）起留卡外，
    // 排在它前面的块（思考等）仍归本轮折叠。没有这样的块（纯思考收尾）就整轮进卡。
    const ended = !hasToolBlock(lastMessage) && !messageIsLive(lastMessage);
    const replyStart = ended ? replyStartIndex(lastMessage) : -1;
    // 折叠行的 key 用**这一轮的用户消息**，不用首尾消息 id：进行中的一轮
    // 每来一条新消息尾部就会变，首尾 id 会让 key 跟着漂、把用户刚展开的卡
    // 又收回去。分页取回更早的消息时轮首也可能变，用户消息则一直在原处。
    // 轮首那一侧的上一页还没取回时（历史起点就在助手消息上）退回 run[0].id。
    const previous = index > 0 ? messages[index - 1] : undefined;
    const turnKey =
      previous && previous.role !== "assistant" ? previous.id : run[0].id;
    // 卡内消息：末条之前的全部；末条自己若只有一部分是答复，前半段也进卡。
    const folded =
      !ended || replyStart < 0
        ? run
        : replyStart === 0
          ? run.slice(0, -1)
          : [
              ...run.slice(0, -1),
              sliceBlocks(lastMessage, 0, replyStart, ":process"),
            ];
    if (folded.length <= 0) {
      run.forEach((runMessage, offset) =>
        pushMessage(runMessage, index + offset),
      );
    } else {
      // 进行态的口径是**整轮**，不是「此刻有没有未结束的块」：工具刚跑完、
      // 模型还没开始下一段响应时，所有块都是 end，但这一轮并没结束。按块级
      // 判定会在轮内回落到结算文案（「N 次工具调用」），下一段流式开始又跳回
      // 进行态 —— 那正是折叠行文案来回抖的根因。判据取「还没出现轮尾答复」，
      // 与桌面端 focus 的 turnEnded 语义一致（CC desktop 6.28899.6
      // cac57de41:53621 focusGrows = opensTurn && inFlight && !turnEnded）。
      // 以工具块收尾却没有后续的轮只出现在中断/报错，那两种都会带一条结束
      // 消息（timeout / notice / error），不会落到这里。
      pushFold(folded, index, turnKey, !ended);
      // 卡外只留答复段。答复起点不在 0 时，前面的块已经在卡内，这里切掉它们。
      if (ended && replyStart > 0) {
        pushMessage(
          sliceBlocks(
            lastMessage,
            replyStart,
            (lastMessage.blocks ?? []).length,
            "",
          ),
          index + run.length - 1,
        );
      } else if (ended && replyStart === 0) {
        pushMessage(lastMessage, index + run.length - 1);
      }
    }
    index = runEnd;
  }

  return { items, rowIndexByMessageIndex };
}
