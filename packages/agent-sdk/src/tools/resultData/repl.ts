import {
  REPL_DEFAULT_MAX_RESULT_CHARS,
  REPL_PART_CHAR_LIMIT,
} from "../../repl/constants.js";

/**
 * `REPL` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * 形状照 CC 的 EvalTool outputSchema（`2007-225920B-EvalTool.js:6407`，CC 里这个
 * 工具叫 `Eval`，:6402 是它的 inputSchema），文本照它的那条渲染链：
 * `:8192` 的 `Ya`（拼出元素表）→ `:8229` 的 `To`（`<repl-output>` 形态）/
 * `:8246` 的 `tc`（纯文本形态）。逐字段的出处写在下面 interface 的每条注释里。
 *
 * 三件能对上、不用解释的事：元素名与属性（`<repl-output eval ms>` 加
 * `<tools>/<refused>/<log>/<result>/<error>`）、head 占 60% 的截断
 * （`qn(e) = floor(e * 0.6)`，:8311）、以及「结构化就上元素、只有结论就退回纯文本」
 * （`To` 与 `tc` 的分叉）。这些本来就是照 CC 抄的，这里只是把拼装点从工具里挪到
 * 渲染器里。
 *
 * 逐条偏差（CC 有我没有 / 我有 CC 没有 / 同名不同形），每条都给原因：
 *
 * 1. **`stdout` 是 `string[]`，不是 CC 的 `string`**。CC 的 `stdout` 是脚本
 *    `self.log` 拼好的一整串；我方的 `logs` 是「一个流 = 一个元素」，而「脚本产出了
 *    一个空流」与「脚本没产出流」在正文里必须可区分（前者写 `<log/>`，后者整个元素
 *    不出现）—— 拼成字符串就丢掉这个区别了。
 * 2. **`stderr` 是宿主注记数组，不是控制台 stderr**。CC 的 `stderr` 是
 *    `console.error` 的捕获流；我方的 `console.*` 进内存环、不进正文，这里的每条是
 *    宿主自己写的注记（调用上限、附件被丢、watchdog 上限），所以每条前缀 `[stderr] `
 *    （`logParts`）。CC 的 `[stderr] ` 前缀同样在（:8211），只是流的内容不同。
 * 3. **回执的正文不进 `result`**。CC 派发成功时把 `(dispatched #N)` 这四个字写进
 *    `result`（`:7320` 的 `result: ` + `` `(dispatched #${N})` ``），渲染器照常渲
 *    `<result>` 段；这是我方与 CC 唯一「同一份信息存在哪儿」的分歧：编号本来就在
 *    `evalId` 里，再存一份渲染好的字符串就等于让 `data` 里出现两处真值。我方只在
 *    渲染时把 `evalId` 拼成那行（{@link renderDispatched}），`data` 里仍是一个数字。
 * 4. **`ok` / `contextReset` 是我方扩展**。CC 用 `error` 的有无 + `stoppedBy` /
 *    `neverRan` / `keptByTurnAbort` 这套宿主侧判定来表达「没跑成」，那些判定的输入
 *    在 CC 的宿主里，我方没有对应车道，硬造字段只会让 `data` 里出现没人能填的值。
 *    我方只需要两个结论：跑成没跑成（`ok`，决定 `<error>` 还是 `<result>`；回执那两
 *    档不看它，看的是有没有 `evalId`）、上下文是不是新的（`contextReset`，决定那句
 *    注记）。两者都是运行时就有的结论，不是宿主侧的推测。
 *    回执的 `neverRan` / `stoppedBy` / `keptByTurnAbort` 也不迁：CC 在「已派发但从未
 *    真跑」时靠宿主侧终态判出来（`:7276` 的取消档 = 拒绝档 + `neverRan`），我方那三条
 *    车道（回合中止、脚本被 ceiling 杀掉、上下文丢弃）都没有对应的产生点，`ok` +
 *    `error` 已经是当时能拿到的全部结论。
 * 5. **`result` 是字符串，`images` 不在 `data` 里**。CC 的 `result` 是任意
 *    serialized 值，渲染时再过 `bo()`（:8275）；我方的 `value` 在运行时已经序列化成
 *    字符串（截断留给渲染器），所以这里就是它。图片按既有口径留在
 *    `ToolResult.images` 上（阶段 1 不减顶层字段），正文不引用它们 —— CC 的
 *    `images` 走 content block（:7448），我方的宿主走同名字段，所以 `data` 里不带
 *    base64，免得把几十 MB 塞进转录。
 * 6. **CC 的 `code` / `notifications` / `documents*` / `carriedMarkers` /
 *    `imagesOmitted` / `imagesRefused` / `imagePagesFailed*` / `late` /
 *    `plainErrorLine` / `stoppedBy` / `neverRan` / `keptByTurnAbort` 都不迁**。
 *    `code` 是入参回显（`ToolBlock.parameters` 里已有第二副本），`notifications` /
 *    `documents*` / `carriedMarkers` 是 CC 的插件与 Read 通知车道（我方没有），其余是
 *    CC 宿主侧的异步车道与终态判定 —— 这批字段的值在 CC 的宿主进程里产生，我方没有产生
 *    它们的地方，`data` 里留空字段只会让阶段 2 的读路径以为「这里本该有值」。
 * 7. **`toolsUsed` 在组装期就把 fallback 走完**（见 {@link replResultDataOf}）：
 *    原渲染器的取法是 `result.toolsUsed ?? calls`，两个来源在极端情况下能不一样
 *    （调用上限/关闭之后，`onToolCall` 仍会报名字，但运行时不再把它记进
 *    `toolsUsed`）。把 fallback 放在组装期，渲出的元素与改动前逐字一致，渲染器也就
 *    不必再认识「calls」这个只有工具层才知道的参数。
 */

/** 一段脚本渲染进的元素。列在 CC 的元素名里，故不翻译。 */
const OUTPUT_TAG = "repl-output";

/**
 * 被截断的一段里从头保留的比例（60%）。
 *
 * 与 CC 的 `qn(e) = floor(e * 0.6)`（`2007-225920B-EvalTool.js:8311`）同一个数：
 * 值的开头说明它是什么，结尾说明它到哪里为止，中间是一段摘要付得起的部分。
 */
const HEAD_SHARE = 0.6;

/** 值被截断时，指出去 REPL 上下文里读完整内容的那句（不重跑、不重读）。 */
const FULL_VALUE_NOTE =
  "The part above was cut. The full value is still under its key in the REPL context — slice or search it there instead of reading it again or re-running anything.";

/** 这个上下文没有更早脚本的记忆时那句。 */
const CONTEXT_RESET_NOTE =
  "This is a new REPL context: the variables, functions and timers of earlier scripts are gone.";

/**
 * 纯文本档在「什么都没有」时那一句。
 *
 * 元素档不需要它 —— 它写 `<result/>`，CC 也这么渲。纯文本档没有可以留空的元素，
 * 而空的工具结果不算一个回答，所以这一档留着这句话。能走到它的一定是「没有值、
 * 没有日志、没有 stderr、没有内层调用」，所以这句话在那时是真的。
 */
const NO_OUTPUT_TEXT =
  "The script finished without a return value and without any self.log() output.";

/**
 * 运行时报告失败但没给理由时的兜底句。
 *
 * 也导出给工具填 `ToolResult.error`：失败结果的 `error` 与正文里的 `<error>` 必须是
 * 同一句话，两个出口都从这里取，才不会一处有理由一处没有。
 */
export const REPL_FAILURE_TEXT = "The REPL script failed.";

/**
 * 渲染需要的那些运行结果字段（`ReplRunResult` 的子集）。
 *
 * 故意在这里另写一份、而不是 `import type { ReplRunResult } from
 * "../../repl/replRuntime.js"`：这个模块要能被阶段 2 的宿主读路径加载（纯函数、零
 * import 副作用），而 `replRuntime.js` 会拖进整个沙箱运行时。结构类型下两者可以互相
 * 赋值，所以工具那边不用转换。
 */
export interface ReplRunShape {
  /** 运行时给出的成败结论。 */
  ok: boolean;
  /** 这个上下文给脚本的编号；渲染成 `eval="N"`。 */
  evalId?: number;
  /** 脚本最后一个表达式序列化后的值（截断由渲染器做）。 */
  value?: string;
  /** 失败原因。 */
  error?: string;
  /** `self.log` 的每条输出，一条一个 `<log>` 元素。 */
  logs: string[];
  /** 宿主注记（不是控制台 stderr，见文件头偏差 2）。 */
  stderr?: string[];
  /** 脚本碰到过的工具，按调用顺序、重复保留。 */
  toolsUsed?: string[];
  /** 被权限规则、hook 或调用上限拒绝的调用。 */
  refusedCalls?: string[];
  /** 有值 = 这次调用只回了回执（脚本在后台跑，或没启动就被拒了）。 */
  asyncDispatched?: true;
  /** 上下文被判定中毒丢弃，`error` 里写了原因。 */
  contextReset?: boolean;
}

/**
 * 渲染器唯一认识的输入：`data`。
 *
 * 字段名尽量沿 CC 的 outputSchema，`result` / `stdout` / `stderr` / `error` /
 * `evalId` / `ms` / `toolsUsed` / `refusedCalls` 都是它的同名字段
 * （`2007-225920B-EvalTool.js:6407`）。三处同名不同形与两处我方扩展见文件头。
 */
export interface ReplResultData {
  /**
   * CC 没有这个字段（用 `error` 有无 + 宿主侧终态字段表达）：我方运行时的成败结论，
   * 决定 `<error>` 还是 `<result>`（`outcomePart`）。回执那两档不看它 —— `evalId`
   * 在不在才是「已派发」与「没启动就被拒」的分界（`renderDispatched`）。
   */
  ok: boolean;
  /** CC 同名：脚本在这个上下文里的编号，渲染成 `eval="N"`，缺失就不写这个属性。 */
  evalId?: number;
  /**
   * CC 同名（`result`，`Return value from the code execution`）：脚本的返回值。
   * 我方的运行时已经把它序列化成字符串；`undefined` 与空串都读作「没有返回值」。
   */
  result?: string;
  /**
   * CC 同名（`stdout`，`What the script logged`），但我方是**块数组**而不是一整串：
   * 一条 `self.log` 一个元素，「产出了一个空流」（`[""]` → `<log/>`）与「没产出流」
   * （`[]` → 不出现）必须可区分，见文件头偏差 1。
   */
  stdout: string[];
  /** CC 同名（`stderr`），但我方是宿主注记数组，每条前缀 `[stderr] `（偏差 2）。 */
  stderr?: string[];
  /** CC 同名：失败原因。缺失或空时用 {@link REPL_FAILURE_TEXT}。 */
  error?: string;
  /**
   * CC 同名：脚本碰到的工具名，按调用顺序、重复保留（渲染时去重、保首次出现序）。
   * 组装期已经把工具层那份 fallback 走完，见 {@link replResultDataOf}。
   */
  toolsUsed?: string[];
  /** CC 同名：被拒绝的调用名，正文里是一个 `<refused>` 元素。 */
  refusedCalls?: string[];
  /**
   * CC 同名（`asyncDispatched`）：这份结果没有执行输出，只是一张回执 —— 脚本已在
   * 后台跑（`evalId` 在时正文写 `(dispatched #N)`），或这次调用被拒绝了根本没启动
   * （`evalId` 不在，正文只有 `error`）。CC 用同一个字段同时盖住这两档
   * （`2007-225920B-EvalTool.js:6414` 的 schema 说明）。
   */
  asyncDispatched?: true;
  /** 我方扩展：上下文是新的，正文末尾追加 {@link CONTEXT_RESET_NOTE}（偏差 4）。 */
  contextReset?: boolean;
  /**
   * CC 同名（`ms`，`How long the script ran, in milliseconds`）：只在有值且非
   * `undefined` 时写进开标签；后台脚本的结局没有人在等时钟，所以那里不出现。
   */
  ms?: number;
}

/**
 * 把一次运行映射成 `data`：纯字段搬运，不含判断。
 *
 * 唯一的判断是 `toolsUsed` 的 fallback，而且照抄原来的取法：渲染器一直用的是
 * `result.toolsUsed ?? calls` —— 运行时那份优先，只有它缺席时才看工具层报上来的
 * 名字。两个来源确实可能不一样（脚本撞上调用上限或被关闭之后，`onToolCall` 仍会报
 * 名字，但运行时不再把它记进 `toolsUsed`；`$` 那条路两处都报，所以不会分叉）。把
 * fallback 放在这里而不是渲染器里，渲出来的元素与改动前逐字一致，`data` 也就是一份
 * 自足的记录 —— 阶段 2 的读路径不需要再知道「calls」这种只有工具层才有的参数。
 *
 * `ms` 单独传：背景脚本的结局由 `Poll` 带上来，同步运行由工具自己掐表。
 */
export function replResultDataOf(
  run: ReplRunShape,
  calls: readonly string[] = [],
  ms?: number,
): ReplResultData {
  const toolsUsed =
    run.toolsUsed ?? (calls.length > 0 ? [...calls] : undefined);
  return {
    ok: run.ok,
    ...(typeof run.evalId === "number" ? { evalId: run.evalId } : {}),
    ...(run.value !== undefined ? { result: run.value } : {}),
    stdout: [...run.logs],
    ...(run.stderr !== undefined ? { stderr: [...run.stderr] } : {}),
    ...(run.error !== undefined ? { error: run.error } : {}),
    ...(toolsUsed !== undefined ? { toolsUsed } : {}),
    ...(run.refusedCalls !== undefined
      ? { refusedCalls: [...run.refusedCalls] }
      : {}),
    ...(run.asyncDispatched === true ? { asyncDispatched: true } : {}),
    ...(run.contextReset === true ? { contextReset: true } : {}),
    ...(ms !== undefined ? { ms } : {}),
  };
}

/**
 * 把会被当成标记的三个字符转义。
 *
 * 只影响显示：脚本产出的值一个字节都没动，而把转义后的文本抄回文件的模型拿到的是
 * 实体而不是字符 —— 工具描述里说了这一点。
 */
function escapeOutput(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 一段输出套上单个上限之后的样子。 */
interface CutPart {
  /** 进正文的文本：够短就是原文，被截过则是头 + 标记 + 尾。 */
  text: string;
  /** 中间丢掉的字符数；没截是 0。 */
  elided: number;
}

/**
 * 单段上限：留头留尾，中间换成标明丢了多少的标记。
 *
 * 上限按段而不是按整个结果，因为各段回答的是不同问题 —— 一整屏 `self.log` 不该吃掉
 * 模型真正要的那个值的那份预算。头尾比例与 CC 的 `qn()` 同一个数（:8311）。
 */
function cutPart(text: string): CutPart {
  if (text.length <= REPL_PART_CHAR_LIMIT) return { text, elided: 0 };
  const headChars = Math.floor(REPL_PART_CHAR_LIMIT * HEAD_SHARE);
  const tailChars = REPL_PART_CHAR_LIMIT - headChars;
  const elided = text.length - REPL_PART_CHAR_LIMIT;
  return {
    text: `${text.slice(0, headChars)}\n... [${elided} chars elided] ...\n${text.slice(
      text.length - tailChars,
    )}`,
    elided,
  };
}

/**
 * 总闸：整段正文截到 `REPL_DEFAULT_MAX_RESULT_CHARS`。
 *
 * 单段上限管住每一段，但没说有多少段，所以「一次脚本打五十个值」仍然付五十段的
 * 上下文。CC 在同一处也有第二道上限（块结果那条走 `fo`，:7453）。那句一行注记是
 * 必须的：边界处无声地砍掉，等于教模型「你看得到的就是全部」。
 */
function cutTotal(content: string): string {
  if (content.length <= REPL_DEFAULT_MAX_RESULT_CHARS) return content;
  const elided = content.length - REPL_DEFAULT_MAX_RESULT_CHARS;
  return (
    `${content.slice(0, REPL_DEFAULT_MAX_RESULT_CHARS)}\n` +
    `[... ${elided} more chars truncated — a REPL result carries at most ${REPL_DEFAULT_MAX_RESULT_CHARS} characters of text]`
  );
}

/** 一个子元素；空正文写成 `<tag/>`，永远不写成空的一对标签。 */
function element(tag: string, body: string): string {
  return body.length === 0
    ? `<${tag}/>`
    : `<${tag}>${escapeOutput(body)}</${tag}>`;
}

/** 脚本碰到过的每个工具，重复折叠，按首次调用顺序（CC 的 `<tools>` 同一形态）。 */
function toolNames(data: ReplResultData): readonly string[] {
  return [...new Set(data.toolsUsed ?? [])];
}

/**
 * 日志段：一股流一段，不是一行一段。
 *
 * 流才是模型推理的单位（「构建打印了什么」），一份两百行的构建是一个回答而不是两百个
 * 元素 —— 元素边界没有携带换行之外的信息。CC 同样一股流一个 `<log>`（`Ya`，:8192-8221）。
 * `[stderr] ` 留在每条注记上，因为我方的 stderr 是分开的宿主注记而不是一股排好的流。
 */
function logParts(data: ReplResultData): string[] {
  const parts: string[] = [];
  // 全空的 `logs` 也仍然写 `<log/>`：那是脚本真的产出、并留空的流，不是它没产出的段。
  if (data.stdout.length > 0) parts.push(data.stdout.join("\n"));
  const stderr = data.stderr ?? [];
  if (stderr.length > 0) {
    parts.push(stderr.map((line) => `[stderr] ${line}`).join("\n"));
  }
  return parts;
}

/**
 * 这份回答有没有结构可承载。
 *
 * 有结构的走元素档；只有结论（一个值或一个错误，没有调用也没有日志）的退回纯文本档，
 * 因为把单个字符串包进元素是模型得读过去的噪声 —— CC 的 `To` / `tc` 分叉同理。
 */
function isStructured(data: ReplResultData, logs: readonly string[]): boolean {
  return (
    toolNames(data).length > 0 ||
    (data.refusedCalls?.length ?? 0) > 0 ||
    logs.length > 0
  );
}

/**
 * 结论段：成功给脚本的值，失败给原因。
 *
 * 两个渲染器共用它，所以元素档与纯文本档不可能对「什么算没输出」「什么时候该指回
 * REPL 上下文」有不同答案。
 */
function outcomePart(
  data: ReplResultData,
  notes: string[],
): { tag: "result" | "error"; body: string } {
  if (!data.ok) {
    return {
      tag: "error",
      body: data.error?.trim() ? data.error : REPL_FAILURE_TEXT,
    };
  }
  // `undefined` 是没有 `return` 的脚本序列化出来的样子，它必须读作「什么都没回来」
  // 而不是字符串 "undefined"。空正文就是整个结论：元素档把它写成 `<result/>`，正是
  // CC 渲的样子（`e.result === undefined → ""`）。在这里改成「脚本没有返回值」这句话
  // 才是让一个结果跟自己的 `<log>` / `<stderr>` 兄弟自相矛盾的写法。
  const value = data.result ?? "";
  if (value.length === 0 || value === "undefined") {
    return { tag: "result", body: "" };
  }
  const part = cutPart(value);
  if (part.elided > 0) notes.push(FULL_VALUE_NOTE);
  return { tag: "result", body: part.text };
}

/** 元素档：固定的子元素顺序，每一段单独套上限。 */
function renderMarkup(
  data: ReplResultData,
  logs: readonly string[],
  notes: string[],
): string {
  const lines: string[] = [
    `<${OUTPUT_TAG}${data.evalId === undefined ? "" : ` eval="${data.evalId}"`}${
      data.ms === undefined ? "" : ` ms="${data.ms}"`
    }>`,
  ];
  // 脚本没产出的段直接不出现，而不是写一个空的。每个回答都带一个自闭合的
  // `<refused/>`，对没法分辨真假拒绝的模型来说就是在说「有东西被拒了」。
  const tools = toolNames(data);
  if (tools.length > 0) lines.push(element("tools", tools.join(", ")));
  const refused = data.refusedCalls ?? [];
  if (refused.length > 0) lines.push(element("refused", refused.join(", ")));
  for (const log of logs) {
    lines.push(element("log", cutPart(log).text));
  }
  const outcome = outcomePart(data, notes);
  lines.push(element(outcome.tag, outcome.body));
  lines.push(`</${OUTPUT_TAG}>`);
  return lines.join("\n");
}

/**
 * 纯文本档：回答里没有任何结构时，按固定顺序排的那些段。
 *
 * 实际上只有结论段会出现在这里 —— 一行日志或一个被拒的调用本身就是结构，会把回答
 * 送去元素档 —— 但两股流的标签仍从同一份 `data` 渲出，所以两档不可能对「一股流叫
 * 什么」有不同说法。
 */
function renderText(data: ReplResultData, notes: string[]): string {
  const sections: string[] = [];
  const stdout = data.stdout.join("\n");
  if (stdout.length > 0) sections.push(`stdout:\n${cutPart(stdout).text}`);
  const stderr = (data.stderr ?? []).join("\n");
  if (stderr.length > 0) sections.push(`stderr:\n${cutPart(stderr).text}`);
  const outcome = outcomePart(data, notes);
  // 脚本没产出的段不出现 —— 空正文就是「没产出」。元素档有可以留空的元素
  // （`<result/>`）；这里没有，于是下面的兜底负责「一段都不剩」的情况。
  if (outcome.body.length > 0) {
    sections.push(`${outcome.tag}:\n${outcome.body}`);
  }
  if (sections.length === 0) sections.push(`result:\n${NO_OUTPUT_TEXT}`);
  return sections.join("\n\n");
}

/**
 * 派发回执：脚本超过等待窗口时，代替结果的那两行。
 *
 * 它必须说清意思，而不只是「发生了点事」：只读到 `(dispatched #7)` 的模型会把同一个
 * 脚本再交一遍，而宿主故意不去重 —— 所以「再交一次就是跑两次」正是无声回执造成的。
 * 拒绝档（并发上限）没有编号可回，正文只剩原因。
 */
function renderDispatched(data: ReplResultData): string {
  // 派发档：有编号，模型要靠它去 `Poll`（不回执编号就没法把回执和结果对上）。
  if (data.evalId !== undefined) {
    return [
      `(dispatched #${data.evalId})`,
      "The script is already running (or queued), so submitting it again would run it twice — wait for its result with `Poll` instead.",
    ].join("\n");
  }
  // 拒绝档（CC `:6972`）：编号根本没发出去，也就没有 `(dispatched #N)` 那行 ——
  // 印一个不存在的编号会把模型引去 `Poll` 一个永远不会 settle 的 id。
  return data.error?.trim()
    ? data.error
    : `${REPL_FAILURE_TEXT} The script was not started.`;
}

/**
 * 把一份 `data` 渲成模型侧与四端 UI 看到的那段文本。
 *
 * 同一个渲染器服务两条路：脚本当场的结果（`REPL` 的 `execute`），和后台脚本的结局
 * （`Poll` 的答问、`<event kind="repl-eval">` 那条消息）。一个渲染器，两条路就不可
 * 能对「一个结果长什么样」有不同说法 —— `ms` 只在有人等过时钟时出现，所以后台结局
 * 的开标签没有这个属性。
 */
export function renderReplResultData(data: ReplResultData): string {
  // 回执只有那两行：没有分段、没有注记、也不进总闸（本来就短）。
  if (data.asyncDispatched === true) return renderDispatched(data);

  const notes: string[] = [];
  const logs = logParts(data);
  let content = isStructured(data, logs)
    ? renderMarkup(data, logs, notes)
    : renderText(data, notes);
  if (data.contextReset) notes.push(CONTEXT_RESET_NOTE);
  if (notes.length > 0) content = [content, ...notes].join("\n");
  // 总闸排在注记之后：注记也是模型要读的内容，而一句解释这次截断的注记如果自己先被
  // 截掉就没有意义了。
  return cutTotal(content);
}
