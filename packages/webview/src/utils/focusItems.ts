import { SEND_USER_FILE_TOOL_NAME } from "wave-agent-sdk/constants";
import type { Message, MessageBlock } from "../types";
import { readDeliveredFiles } from "./deliveredFiles";
import { displayToolName } from "./toolDisplayName";

/**
 * Focus 视图的布局项。
 *
 * 折叠**只改变布局项**，不改变消息本身：收起态一轮收成一行卡头，展开态把这一
 * 轮的活动拆成各自的行 —— 两种情况都由虚拟列表按行窗口化，所以展开一个含上百条
 * 活动的轮也只挂视口里的那几行（见 docs/specs/ui/focus-view.md 场景 7）。参考
 * 实现是 Claude 桌面端 6.28899.6 的 turn 布局引擎（行粒度是 step，展开就是把
 * 收起的 step 放回列表），不是 VSCode 扩展那套「重新分组后全量渲染」。
 */
export interface FocusFoldItem {
  kind: "fold";
  /** 虚拟列表的行 key（`focus-fold:<轮 key>`），跨轮不重复。 */
  key: string;
  /**
   * 被折进卡里的消息（已按块切过：轮尾答复与交付卡片不在里面）。
   *
   * 只用于卡头的计数与「有没有思考」的判定 —— 卡内内容不从这里渲染。声明展开
   * 态后，这一轮的活动由 `FocusMessageItem` 各自成行（带 `foldKey`）。
   */
  messages: Message[];
  /** 覆盖的可见消息下标区间（闭区间），用于把消息坐标翻译成行坐标。 */
  startMessageIndex: number;
  endMessageIndex: number;
  callCount: number;
  errorCount: number;
  hasReasoning: boolean;
  /** 这一轮还在跑：只有窗口里最后那一轮、形状上还没等到轮尾答复、且宿主那边
   * 确实还在跑（`isStreaming`）三条同时成立。 */

  live: boolean;
  runningToolName?: string;
}

export interface FocusMessageItem {
  kind: "message";
  key: string;
  message: Message;
  messageIndex: number;
  /**
   * 展开的折叠卡里的活动行：它属于哪张卡（`FocusFoldItem.key`）。
   *
   * 只有展开态才有这个标记 —— 收起态卡里的消息没有自己的行。它只给渲染层
   * 分「卡内行 / 卡外行」用：卡外行在聚焦视图下不画时间线节点，卡内行要画
   * （与普通视图的行同款）。
   */
  foldKey?: string;
}

/**
 * 转录被截断时列表顶端那一行说明（「更早的消息无法显示」）。
 *
 * 它是一行**布局项**而不是列表外的一张浮层：只有落进虚拟列表，它才跟正文一起
 * 滚动、一起参与填窗测量，也不会盖住第一条消息（行的绝对定位决定任何流内的
 * 兄弟节点都会被压在同一处）。
 */
export interface FocusNoticeItem {
  kind: "notice";
  /** 虚拟列表的行 key：全局只有一个这条说明。 */
  key: string;
  text: string;
}

export type FocusItem = FocusFoldItem | FocusMessageItem | FocusNoticeItem;

export interface FocusItems {
  items: FocusItem[];
  /**
   * 可见消息下标 → 行下标。收起态的折叠项覆盖的每条消息都指向同一个卡头行；
   * 展开态各条消息指向自己的行。
   */
  rowIndexByMessageIndex: number[];
  /**
   * 可见消息下标 → 这条消息**被折进卡里那半**所在的折叠行下标；消息没被拆开时
   * 为 -1（展开态一律 -1：整条消息就是自己的行）。
   *
   * 轮尾那条消息可以横跨两行：思考进卡、答复留卡外，此时
   * `rowIndexByMessageIndex` 指向卡外的答复行。reveal（搜索命中、大纲刻度）只
   * 按那份坐标展开，就会「跳过去看到答复、思考仍收着」——命中落在思考里等于
   * 没定位到（spec ui/focus-view.md 场景 8）。所以过程半的行坐标单独给一份。
   */
  processRowByMessageIndex: number[];
}

const isToolBlock = (block: MessageBlock): boolean => block.type === "tool";

/**
 * 这一块是不是「已经交付成功的文件卡片」（spec ui/focus-view.md「交付内容」）。
 *
 * 交付内容属于「结果」而不是「过程」：折进摘要里用户既看不见也点不到，交付就
 * 等于没发生。判据与 Message 的渲染分支同源 —— 同一个工具名、同一份解析
 * （`readDeliveredFiles`），只有这一块已经结束、没报错、且真解析出文件才算。
 * 还在跑、失败、被拒、被中断的一律当普通过程，留在卡内。
 */
function isDeliveredFileBlock(block: MessageBlock): boolean {
  if (block.type !== "tool") return false;
  if (block.name !== SEND_USER_FILE_TOOL_NAME) return false;
  if (block.stage !== "end" || block.error || block.success === false) {
    return false;
  }
  return readDeliveredFiles(block).files.length > 0;
}

/** 这一轮里还能被折起来的工具块 —— 已经交付成功的文件卡片不算。 */
function hasFoldableToolBlock(message: Message): boolean {
  return (message.blocks ?? []).some(
    (block) => isToolBlock(block) && !isDeliveredFileBlock(block),
  );
}

/** 最后一块还没结束的工具名（文案「正在执行 X…」用它）。 */
function openToolName(message: Message): string | undefined {
  let name: string | undefined;
  for (const block of message.blocks ?? []) {
    if (block.type !== "tool") continue;
    if (block.stage === "end") continue;
    if (block.name) name = displayToolName(block.name);
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

/**
 * 末块是一行 error 级收尾提示时，这一轮已经收口。
 *
 * 用户中断（以及报错退出）时 SDK 先把没跑完的块 finalize，再把这一行追加到末条
 * 助手消息尾部（aiManager 的 catch 分支 → `addNoticeBlock`），之后这条消息不会
 * 再长 —— 但前面还躺着工具块，只看「末条有没有工具块」就会把整轮（连同这行提示）
 * 吞进卡里。spec ui/focus-view.md「失败与中断」要求这种提示留在卡外，参考实现
 * 也把「非 Claude 自己结束」的收尾算作 turnEnded（桌面端 6.28899.6
 * cac57de41:53621 的 `!turnEnded`）。
 */
function endsWithErrorNotice(message: Message): boolean {
  const blocks = message.blocks ?? [];
  const last = blocks[blocks.length - 1];
  return last?.type === "notice" && last.level === "error";
}

function countToolBlocks(messages: Message[]): {
  calls: number;
  errors: number;
} {
  let calls = 0;
  let errors = 0;
  for (const message of messages) {
    for (const block of message.blocks ?? []) {
      // 已经把文件交到用户手里的那次调用不计入摘要：卡片就摆在卡外，再数一遍
      // 会让卡头的「N 次工具调用」和展开后看到的行数对不上。
      if (block.type !== "tool" || isDeliveredFileBlock(block)) continue;
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

/** 一条消息留在卡里的那半。 */
interface FoldedPart {
  message: Message;
  /** 它是原来的哪一条消息（这条消息在可见消息里的下标）。 */
  sourceIndex: number;
  /** 原消息还有一半留在卡外（这条消息横跨两行）。 */
  hasKeptPart: boolean;
}

/** 一条消息留在卡外的那半。 */
interface KeptPart {
  message: Message;
  /** 它是原来的哪一条消息（这条消息在可见消息里的下标）。 */
  sourceIndex: number;
  /** 是不是这一轮的最后一条消息。 */
  isTail: boolean;
  /** 原消息还有一半留在卡里（这条消息横跨两行）。 */
  hasFoldedPart: boolean;
}

interface TurnSplit {
  folded: FoldedPart[];
  kept: KeptPart[];
  /** 卡内最后一条消息的原下标（摘要覆盖到哪条为止）；没有卡内内容时为 -1。 */
  foldedEndIndex: number;
}

/**
 * 把一轮拆成「卡内」与「卡外」两半（spec ui/focus-view.md 场景 2 +「交付内容」）。
 *
 * 两类块留卡外：**轮尾答复段**（末条消息里从 `tailStart` 起的块）与**已经交付成功
 * 的文件卡片**（`isDeliveredFileBlock`）。其余进卡。交付卡片不受 `tailStart`
 * 约束 —— 它可能出现在轮中间，只要交付已经完成就该让用户看到，而不是等这一轮
 * 结束（模型交付完常常还会接着干活）。
 *
 * 渲染层仍按整条消息渲染（`<Message message={…} />` 只认 `blocks`），所以折叠
 * 不需要给 `Message` 加参数。
 *
 * 一条消息被拆开时，两半都会各自成行：卡外那半在收起态就露着，卡内那半在展开态
 * 才露出来。所以**两半都要换 id 后缀**（`:kept` / `:process`）—— 同一视图里不
 * 能出现两条同 id 的行，虚拟列表的 key 与 `data-measured-message-id` 都会撞。
 * 卡外那半的 id 带着「这条消息」的身份，reveal 的锚点跟着它。
 */
function splitTurn(
  run: Message[],
  tailStart: number,
  startMessageIndex: number,
): TurnSplit {
  const folded: FoldedPart[] = [];
  const kept: KeptPart[] = [];
  let foldedEndIndex = -1;
  run.forEach((message, offset) => {
    const isTail = offset === run.length - 1;
    const foldedBlocks: MessageBlock[] = [];
    const keptBlocks: MessageBlock[] = [];
    (message.blocks ?? []).forEach((block, blockIndex) => {
      const inTailReply = isTail && tailStart >= 0 && blockIndex >= tailStart;
      if (inTailReply || isDeliveredFileBlock(block)) {
        keptBlocks.push(block);
      } else {
        foldedBlocks.push(block);
      }
    });
    if (keptBlocks.length === 0) {
      folded.push({
        message,
        sourceIndex: startMessageIndex + offset,
        hasKeptPart: false,
      });
      foldedEndIndex = startMessageIndex + offset;
      return;
    }
    if (foldedBlocks.length === 0) {
      kept.push({
        message,
        sourceIndex: startMessageIndex + offset,
        isTail,
        hasFoldedPart: false,
      });
      return;
    }
    folded.push({
      message: {
        ...message,
        id: message.id + ":process",
        blocks: foldedBlocks,
      },
      sourceIndex: startMessageIndex + offset,
      hasKeptPart: true,
    });
    foldedEndIndex = startMessageIndex + offset;
    kept.push({
      message: { ...message, id: message.id + ":kept", blocks: keptBlocks },
      sourceIndex: startMessageIndex + offset,
      isTail,
      hasFoldedPart: true,
    });
  });
  return { folded, kept, foldedEndIndex };
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
 * 一轮里最后一条助手消息若已结束且**不含可折叠的工具块**（已经交付成功的
 * `SendUserFile` 不算），它里面的答复（最后一个非空文本块，以及 notice /
 * compact 说明行）留在卡外，排在它前面的块（思考等）仍进摘要；这条消息没有
 * 任何可留卡外的块（纯思考收尾），或这一轮还在跑 / 最后一次响应又调了工具时，
 * 整轮进摘要，卡外没有答复文本。
 *
 * **交付内容不参与折叠**：成功交付的文件卡片不管落在哪条消息、哪个位置，都留在
 * 卡外（spec「交付内容」）—— 它是「结果」，折进去用户就点不到了。
 *
 * 不折叠的情况：关闭 focus 视图，以及这一轮没有可折叠的活动（只有一条纯文本
 * 答复，或只把文件交出来）。
 *
 * `isStreaming` 是「这一轮真的在跑」这个**运行时信号**（宿主 `onLoadingChange`
 * 推过来的那一颗）。折叠行的进行态必须由它说了算，不能只看末条消息长什么样：
 * 用户按 Esc 中断时 SDK 不会再补消息（工具块被 finalize 成 end、没有后续答复），
 * 一条纯按形状的判据会把那一轮**永久**当成「还没结束」，卡头永远「正在思考…」+
 * 脉冲点，失败计数也再不出来 —— 而 spec 明确「用户中断（Stop）的那一轮按已结束
 * 处理」（docs/specs/ui/focus-view.md「失败与中断」）。
 */
export function buildFocusItems(
  messages: Message[],
  focus: boolean,
  isStreaming: boolean,
  /**
   * 当前展开着的卡（`FocusFoldItem.key`）。展开的轮会把卡里的活动拆成独立的
   * 消息行交给虚拟列表，收起态仍是「卡头一行」。
   */
  expandedFolds?: ReadonlySet<string>,
  /**
   * 有值时在最前面插一行说明（转录被截断，「更早的消息无法显示」）。行号在
   * push 时按 `items.length` 现算，所以插在最前面不会让消息坐标错位。
   */
  notice?: string,
): FocusItems {
  const items: FocusItem[] = [];
  const rowIndexByMessageIndex: number[] = new Array(messages.length).fill(0);
  const processRowByMessageIndex: number[] = new Array(messages.length).fill(
    -1,
  );

  if (notice)
    items.push({ kind: "notice", key: "transcript-notice", text: notice });

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
    folded: Message[],
    /** 这一轮占了几条消息（含留在卡外的那些），按它回填行坐标。 */
    coveredCount: number,
    /** 卡内最后一条消息的原下标 —— 摘要覆盖到的位置。 */
    endMessageIndex: number,
    startMessageIndex: number,
    foldKey: string,
    live: boolean,
  ) => {
    const { calls, errors } = countToolBlocks(folded);
    let runningToolName: string | undefined;
    for (
      let index = folded.length - 1;
      index >= 0 && !runningToolName;
      index--
    ) {
      runningToolName = openToolName(folded[index]);
    }
    for (let offset = 0; offset < coveredCount; offset++) {
      rowIndexByMessageIndex[startMessageIndex + offset] = items.length;
    }
    items.push({
      kind: "fold",
      key: foldKey,
      messages: folded,
      startMessageIndex,
      endMessageIndex,
      callCount: calls,
      errorCount: errors,
      hasReasoning: hasReasoningBlock(folded),
      live,
      runningToolName,
    });
  };

  if (!focus) {
    messages.forEach(pushMessage);
    return { items, rowIndexByMessageIndex, processRowByMessageIndex };
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
    const ended =
      endsWithErrorNotice(lastMessage) ||
      (!hasFoldableToolBlock(lastMessage) && !messageIsLive(lastMessage));
    const replyStart = ended ? replyStartIndex(lastMessage) : -1;
    // 折叠行的 key 用**这一轮的用户消息**，不用首尾消息 id：进行中的一轮
    // 每来一条新消息尾部就会变，首尾 id 会让 key 跟着漂、把用户刚展开的卡
    // 又收回去。分页取回更早的消息时轮首也可能变，用户消息则一直在原处。
    // 轮首那一侧的上一页还没取回时（历史起点就在助手消息上）退回 run[0].id。
    const previous = index > 0 ? messages[index - 1] : undefined;
    const turnKey =
      previous && previous.role !== "assistant" ? previous.id : run[0].id;
    // 卡内 / 卡外两半：交付成功的文件卡片不管落在哪条消息里都留卡外
    // （「交付内容」），轮尾答复段按块切（场景 2）。见 splitTurn。
    const { folded, kept, foldedEndIndex } = splitTurn(run, replyStart, index);
    if (folded.length === 0) {
      // 这一轮没有可折叠的活动（例如只有一条把文件交出来的响应）：不出摘要行。
      kept.forEach((part) => pushMessage(part.message, part.sourceIndex));
    } else {
      // 进行态的口径是**整轮**，不是「此刻有没有未结束的块」：工具刚跑完、
      // 模型还没开始下一段响应时，所有块都是 end，但这一轮并没结束。按块级
      // 判定会在轮内回落到结算文案（「N 次工具调用」），下一段流式开始又跳回
      // 进行态 —— 那正是折叠行文案来回抖的根因。判据取「还没出现轮尾答复」，
      // 与桌面端 focus 的 turnEnded 语义一致（CC desktop 6.28899.6
      // cac57de41:53621 focusGrows = opensTurn && inFlight && !turnEnded）。
      // 形状只说「还没等到轮尾答复」，说不了「是不是真的还在跑」：中断那轮
      // SDK 把在飞的工具块 finalize 成 end、再往同一条消息里压一行 error 级收尾
      // 提示（见 endsWithErrorNotice），末条于是以工具块收尾、形状上等不到答复 ——
      // 只信形状就让那一行永久停在「正在思考…」+ 脉冲点（#3159 遗留）。所以
      // 再叠一道运行时信号 `isStreaming`（宿主推的那颗），两个都对才算进行态。
      // 而且只有**窗口里最后那一轮**可能是进行中的：更早的轮后面已经有新一轮
      // 的用户消息，它一定结束了（哪怕它自己是以中断形状收尾的）。少了这一条，
      // 一条历史中断轮会在后面那轮跑着的时候冒充进行态。
      const isTailRun = runEnd >= messages.length;
      const foldKey = "focus-fold:" + turnKey;
      // 展开的这一轮不再是一行：卡里的活动各自成行，交给虚拟列表按行窗口化
      // （对齐 CC 桌面端 —— 它的行粒度是 step，展开就是把收起的 step 放回列表，
      // 行高估算与挂载都按行算）。收起态仍是「卡头一行 + 卡外答复」。
      const expanded = expandedFolds?.has(foldKey) === true;
      pushFold(
        folded.map((part) => part.message),
        expanded ? 0 : run.length,
        foldedEndIndex,
        index,
        foldKey,
        isTailRun && !ended && isStreaming,
      );
      if (expanded) {
        // 展开态：卡内的活动按 splitTurn 的拆半结果各自成行，**卡外那半仍留在
        // 卡外** —— 展开一轮不会把轮尾答复挪进卡里（spec 场景 2 与 4：卡内显示
        // 的是这一轮被折叠的活动，答复一直是卡外的那一行）。卡内行带 `foldKey`
        // 供 CSS 区分（卡外行在聚焦视图下不画时间线节点、不留左内衬）。
        for (const part of folded) {
          const rowIndex = items.length;
          rowIndexByMessageIndex[part.sourceIndex] = rowIndex;
          // 被拆开的消息：卡外那半才是「整条消息」的行坐标，这里先记下过程半，
          // 循环结束前会被卡外那半覆盖；过程半的行号给 reveal 用。
          if (part.hasKeptPart) {
            processRowByMessageIndex[part.sourceIndex] = rowIndex;
          }
          items.push({
            kind: "message",
            key: part.message.id,
            message: part.message,
            messageIndex: part.sourceIndex,
            foldKey,
          });
        }
        // 卡外的行排在卡内行之后，与收起态同序。
        for (const part of kept) {
          rowIndexByMessageIndex[part.sourceIndex] = items.length;
          items.push({
            kind: "message",
            key: part.message.id,
            message: part.message,
            messageIndex: part.sourceIndex,
          });
        }
      } else {
        const foldRow = items.length - 1;
        for (const part of kept) {
          // 末条消息：行坐标指向卡外那半（答复与交付卡片露在这里），卡内那半由
          // processRowByMessageIndex 单独记 —— reveal 要一并展开，否则会「跳过来
          // 看到答复、思考仍收着」（场景 8）。更早的消息主体仍在卡里：行坐标不动，
          // 卡外那半只是多出来的一行。
          if (part.isTail) {
            rowIndexByMessageIndex[part.sourceIndex] = items.length;
            if (part.hasFoldedPart) {
              processRowByMessageIndex[part.sourceIndex] = foldRow;
            }
          }
          items.push({
            kind: "message",
            key: part.message.id,
            message: part.message,
            messageIndex: part.sourceIndex,
          });
        }
      }
    }
    index = runEnd;
  }

  return { items, rowIndexByMessageIndex, processRowByMessageIndex };
}
