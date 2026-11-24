import {
  renderReplResultData,
  replResultDataOf,
  type ReplResultData,
  type ReplRunShape,
} from "./repl.js";

/**
 * `Poll` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * 形状照 CC 的 Poll outputSchema（`2008-9909B-uso.js:44` 的 `fso`）：`content` /
 * `eventCount` / `remainingWakeCount` / `media` / `toolsUsed` / `provenance` /
 * `declared`；文本照它的 `mapToolResultToToolResultBlockParam`（`:99`，正文在 `:103`）。
 *
 * 与 CC 的一处根本差别：**CC 把渲染好的整段文本存进 `data.content`**（`:280` 的
 * `content: Kde(m, _, L)`），它的渲染器只是把这段文本和 `media` 拼起来
 * （`:103` 的 `LGt(e.content, e.media)`，正文一条都不重建）。我方不照抄 —— 那等于把
 * 文本存两份，阶段 2「落盘只留 `data`」就失去意义。这里 `data` 放结构化原件，文本由
 * {@link renderPollResultData} 现场重建，逐字等于工具当场产出的 `content`。
 *
 * CC 也没有「状态行」这个 `data`：等待超时那几条分支各自把一句话塞进 `content`
 * （`:344`、`:357` 的 `nothing has reported yet…` / `No events yet — N background
 * tasks still running…`），`eventCount` / `remainingWakeCount` 一律写 0。我方的状态行
 * 是 `<event kind="repl-status" pending="N"/>` 加每个运行中脚本一行（见
 * {@link renderPollResultData}），所以那批快照必须能落盘（`running`，见下）。
 *
 * 字段对照（CC 出处 `2008-9909B-uso.js`）：
 *
 * | 我方 `data` | CC `fso`（:44） | 说明 |
 * |---|---|---|
 * | `events` | — | 我方扩展：CC 的事件正文已经渲染进 `content`，结构化原件它不存 |
 * | `events.length` | `eventCount`（:46） | 同一个数，不另存一份（见文件头末条） |
 * | `remaining` | `remainingWakeCount`（:47） | 同一语义（还有多少条排队等下一次交付），省掉 `Wake` 是因为我方排队的是脚本结局，不是唤醒 |
 * | `running` | — | 我方扩展：状态行那批快照（见下） |
 * | 不迁 | `content` / `media` / `toolsUsed` / `provenance` / `declared` | `content` 是重复的正文；`media` 走 `ToolResult.images`；`provenance` / `declared` 是 CC 宿主侧的出品方/声明车道，我方没有产生它们的地方；`toolsUsed` 是 CC 把整批事件的工具名去重后汇总一份（`:49`），而我方正文按事件逐个写 `<tools>`，汇总一份反而重建不出来 —— 每条事件的 `ReplResultData.toolsUsed` 已经带着它 |
 *
 * **为什么 `running` 必须进 `data`**：状态行现在由 `listRunningReplScripts()` 现场
 * 读运行时（谁在跑、跑了多久、脚本片段）。阶段 2 从历史转录重建这段文本时，那个运行时
 * 早就没了 —— 不落快照就重建不出状态行。快照只留渲染用得上的四个字段（`id` /
 * `state` / `ageMs` / `snippet`），运行时的 `abort` 闭包、`self`、`settled` 都不落盘。
 *
 * 两处形态是我方既有口径，保持逐字不变：事件外壳是
 * `<event kind="repl-eval" eval="N">`，不带 CC envelope 的 `at="…"` 属性
 * （`0444-12927B-k3e.js:195`）；状态行是自闭合的 `<event kind="repl-status" …/>`
 * 加纯文本行，不是 CC 那种散文。
 */

/** 一条已结算脚本的 `data`：编号 + 它自己的结果 + 这次运行的墙钟耗时。 */
export interface PollEventData {
  /** 运行时给脚本的编号，渲成 `eval="N"`。 */
  evalId: number;
  /**
   * 脚本这次的运行结果，形状与 `REPL` 的 `data` 完全一致（同一个
   * {@link renderReplResultData} 渲染）。
   *
   * **`ms` 不在它里面**：这条事件的耗时只在下面的 {@link elapsedMs} 上留一份，
   * 渲染时再并进开标签。两个来源各存一份只会在将来某次改动后打架。
   */
  result: ReplResultData;
  /**
   * 从派发到结局的墙钟耗时，渲成 `<repl-output ms="…">`。缺席（老转录里没有这个
   * 数）就不写这个属性 —— 与 `REPL` 同步运行的 `data.ms` 同一个口径。
   */
  elapsedMs?: number;
}

/** 状态行里的一行：一个还在跑的脚本。只留渲染用得上的字段。 */
export interface PollRunningScriptData {
  /** 脚本编号，渲成 `#N`。 */
  id: number;
  /** 运行时给的状态字（`running` / `waiting` / `settled` / `abandoned` / `stopped`）。 */
  state: string;
  /** 已经跑了多久（毫秒），渲成 `1234ms`。 */
  ageMs: number;
  /** 脚本开头的片段，状态行最后那一段。 */
  snippet: string;
}

/**
 * 渲染器唯一认识的输入：`data`。
 *
 * `events` 为空就是一条状态行回答（等待超时 / 本来就没东西可等）；非空就是若干个
 * 事件信封，`remaining > 0` 时末尾追加一行「还有 N 条」。两者互斥，因为工具不会在
 * 同一个回答里既给事件又给状态行。
 */
export interface PollResultData {
  /** 这次交付的事件，按结算顺序（运行时排队即 oldest first）。 */
  events: PollEventData[];
  /**
   * 这条回答之后还有多少条排队 —— 渲成 `(N more settled — read them with another
   * poll)`。对应 CC 的 `remainingWakeCount`（`2008-9909B-uso.js:47`）；`0` 不出现那行。
   */
  remaining: number;
  /**
   * 状态行快照。**只在 `events` 为空时有**：事件回答里状态行不出现，落一份没人读的
   * 运行列表只会让转录里的 `data` 与正文对不上。缺席读作「没有脚本在跑」（老转录）。
   */
  running?: PollRunningScriptData[];
}

/**
 * 组装一个事件要的那两个形状。
 *
 * 故意在这里另写一份、而不是 `import type { ReplEvent } from "../../repl/replRuntime.js"`：
 * 这个模块要能被阶段 2 的宿主读路径加载（纯函数、零 import 副作用），而
 * `replRuntime.js` 会拖进整个沙箱运行时。结构类型下 `ReplEvent` 可以直接传进来。
 */
export interface PollEventShape {
  evalId: number;
  result: ReplRunShape;
  elapsedMs?: number;
}

/**
 * 一份运行结果 → 一条事件的 `data`：纯字段搬运。
 *
 * 唯一的判断是 `toolsUsed` 的 fallback，照抄 `REPL` 那条路（`replRuntime.ts:1129`
 * 报名字、`:1181` 才记进 `toolsUsed`，两处在调用上限/关闭之后能分叉）：运行时那份
 * 优先，只有它缺席时才看工具层报上来的名字。fallback 放在组装期，`data` 才是自足的
 * ——阶段 2 读历史时没有「这次运行碰过哪些工具」的第二个来源。
 */
export function pollEventDataOf(event: PollEventShape): PollEventData {
  return {
    evalId: event.evalId,
    result: replResultDataOf(event.result, event.result.toolsUsed ?? []),
    ...(event.elapsedMs === undefined ? {} : { elapsedMs: event.elapsedMs }),
  };
}

/**
 * 运行中的脚本 → 状态行快照。
 *
 * 逐字段挑，不是把 `listRunningReplScripts()` 的元素直接塞进 `data`：那些对象带
 * `abort` 闭包（函数进不了转录 JSON）和 `self` / `settled` 这类渲染用不上的判定。
 */
export function pollRunningDataOf(
  scripts: readonly PollRunningScriptData[],
): PollRunningScriptData[] {
  return scripts.map((script) => ({
    id: script.id,
    state: script.state,
    ageMs: script.ageMs,
    snippet: script.snippet,
  }));
}

/**
 * 一条事件的信封。
 *
 * 正文直接交给 `REPL` 的渲染器：后台脚本的结局与脚本当场返回的结果必须是同一段
 * 文本（`<repl-output>` 元素、60% 头 / 40% 尾的截断、注记顺序都跟着走），否则模型
 * 会以为「等一下才回来的结果」和「当场回来的结果」是两种东西。
 *
 * 耗时从 {@link PollEventData.elapsedMs} 并进 `ms`：并出来的是同一份 `ReplResultData`，
 * 所以老转录里 `elapsedMs` 缺席时渲出的开标签没有 `ms` 属性，与改动前一致。
 */
function renderEventEnvelope(event: PollEventData): string {
  const result: ReplResultData =
    event.elapsedMs === undefined
      ? event.result
      : { ...event.result, ms: event.elapsedMs };
  return `<event kind="repl-eval" eval="${event.evalId}">\n${renderReplResultData(
    result,
  )}\n</event>`;
}

/** 状态行：那个自闭合元素、每个运行中脚本一行、没有脚本时那一句。 */
function renderStatusLine(data: PollResultData): string {
  const running = data.running ?? [];
  const lines = [`<event kind="repl-status" pending="${running.length}"/>`];
  for (const script of running) {
    lines.push(
      `#${script.id} ${script.state} ${script.ageMs}ms — ${script.snippet}`,
    );
  }
  // 一个空正文不算一个回答，而这一档没有可以留空的元素（事件那一档才有信封）。
  if (running.length === 0) {
    lines.push("No REPL script is running in this context.");
  }
  return lines.join("\n");
}

/**
 * 把一份 `data` 渲成模型侧与四端 UI 看到的那段文本。
 *
 * 三条路，互斥：
 *
 * - `events` 为空 → 状态行（{@link renderStatusLine}）。
 * - 不空 → 每个事件一个 `<event kind="repl-eval">` 信封，用 `\n` 拼；`remaining > 0`
 *   时末尾一行说明还有几条。那一行是必须的：边界处无声地砍掉，等于教模型「你看到的
 *   就是全部」，而下一批要它自己再 `Poll` 一次。
 * - 单事件（`remaining` 写 0）也走这条 —— `aiManager` 把后台结局当
 *   `<system-reminder>` 消息投递时用的就是它（`pollTool.ts` 的 `renderReplEvent`），
 *   同一份 `data`，所以「等回来的」与「投过来的」不会有两种长相。
 */
export function renderPollResultData(data: PollResultData): string {
  if (data.events.length === 0) return renderStatusLine(data);

  const lines = data.events.map(renderEventEnvelope);
  if (data.remaining > 0) {
    lines.push(
      `(${data.remaining} more settled — read them with another poll)`,
    );
  }
  return lines.join("\n");
}
