/**
 * `Agent` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * 形状照 CC：`AgentTool/AgentTool.tsx:141-155` 的 outputSchema（同步档来自
 * `agentToolUtils.ts:227-258` 的 `agentToolResultSchema()`，异步档在
 * `AgentTool.tsx:146-153`）；文本照 `AgentTool.tsx:1298-1379` 的
 * `mapToolResultToToolResultBlockParam`。要点：
 *
 * - 两个状态用 `status` 判别（CC 的 union 判别式）：`completed` / `async_launched`。
 *   用户把前台代理转后台时 CC 也返回 `async_launched`（`AgentTool.tsx:1039-1051`），
 *   所以那一条路径与「直接后台启动」共用同一份 `data` 与同一段文本。
 * - CC 的 `prompt` 不进 `data`：它是模型自己传的参数（回传等于落盘翻倍）。
 *   `content` 进（`AgentCompletedResultData.content`）：CC 的 `data.content` 是子代理
 *   报告的 text block 数组，我方是同一份报告的纯文本（子代理边界只带 `text`），所以
 *   字段同名、内容同义。阶段 2 起正文只在这里，`renderAgentCompletedText()` 从
 *   `data.content` 取它接到尾部前面（CC 的 `data.content` 与尾部也是这两段）。
 * - CC 的 `usage`（input/output/cache 分解）我方拿不到：消息层只留
 *   `getLatestTotalTokens()` 的总数，所以只落 `totalTokens` 一个标量。
 */

import { BASH_TOOL_NAME, READ_TOOL_NAME } from "../../constants/tools.js";
import {
  EXPLORE_SUBAGENT_TYPE,
  PLAN_SUBAGENT_TYPE,
} from "../../constants/subagents.js";

/**
 * CC 的 `ONE_SHOT_BUILTIN_AGENT_TYPES`（`AgentTool/constants.ts:9-12`）：跑一次就
 * 交报告、永远不会被 SendMessage 续跑的内置代理。CC 为它们整段跳过尾部（注释里算
 * 的账是 ~135 字符 × 34M 次 Explore/周），我方沿用同一判据。
 */
const ONE_SHOT_AGENT_TYPES: ReadonlySet<string> = new Set([
  EXPLORE_SUBAGENT_TYPE,
  PLAN_SUBAGENT_TYPE,
]);

/**
 * CC 在子代理一个字都没返回时补的那句（`AgentTool.tsx:1347-1350`）：只有
 * agentId/usage 的 tool_result 会被模型读成「没事可做」，所以明说它没输出。
 */
export const AGENT_NO_OUTPUT_MARKER =
  "(Subagent completed but returned no output.)";

export interface AgentCompletedResultData {
  status: "completed";
  /**
   * 这次子代理的实例 id。CC 里 agentId 与后台 task id 是同一个
   * （`getTaskOutputPath(agentId)`），我方是两个 id 空间：同步分支给 `subagentId`，
   * 异步分支给后台 task id（见下）。
   */
  agentId: string;
  /** CC `agentType`（`agentToolUtils.ts:233`）：尾部是否跳过要靠它。 */
  agentType?: string;
  /**
   * 子代理报告的全文（可能几十 KB），CC 的 `data.content`（那边是 text block 数组，
   * 这里是同一份报告的纯文本 —— 子代理边界只把 `text` block 带回来）。
   *
   * 阶段 2 起正文只在这里：`ToolResult.content` 不再另存一份。
   */
  content: string;
  /** CC `totalToolUseCount`（`agentToolUtils.ts:235`）。 */
  totalToolUseCount: number;
  /** CC `totalDurationMs`（`agentToolUtils.ts:236`）。 */
  totalDurationMs: number;
  /** CC `totalTokens`（`agentToolUtils.ts:237`）。 */
  totalTokens: number;
  /**
   * CC 把 worktree 的路径与分支挂在结果上（`AgentTool.tsx:1342` 读
   * `worktreePath` / `worktreeBranch` 渲进尾部）。我方 worktree 报告已经由
   * `SubagentManager` 折进正文（还带变更计数，CC 没有），尾部不重复渲，
   * 这两个字段留着给脚本与宿主定位。
   */
  worktreePath?: string;
  worktreeBranch?: string;
}

export interface AgentAsyncLaunchedResultData {
  status: "async_launched";
  /**
   * CC `agentId`（`AgentTool.tsx:148`）：异步代理的 id，它的输出文件与完成通知都
   * 按这个 id 索引。我方取的是后台 task id——后台侧同一套索引（task 表、
   * `outputPath`、task_notification 的 taskId）都按它走，与
   * `ToolResult.backgroundTaskId` 同值。
   */
  agentId: string;
  /** CC `description`（`AgentTool.tsx:149`）：给人看的那句短标签，文本里不出现。 */
  description: string;
  /**
   * CC `outputFile`（`AgentTool.tsx:151`）。我方只有后台任务真的建出来才有；没有
   * 任务时文本改走「没有可读输出」那一档。
   */
  outputFile?: string;
  /**
   * CC `canReadOutputFile`（`AgentTool.tsx:152`）：调用方手里有 Read 或 Bash 才谈
   * 得上去看输出文件。CC 用它决定尾部指令是哪一档，这里同样。
   */
  canReadOutputFile?: boolean;
}

export type AgentResultData =
  | AgentCompletedResultData
  | AgentAsyncLaunchedResultData;

/** CC 后台档的两档尾部指令（`AgentTool.tsx:1329`），逐字照抄。 */
const ASYNC_DUPLICATE_WARNING =
  "Do not duplicate this agent's work — avoid working with the same files or topics it is using. Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.";

const ASYNC_INSTRUCTIONS_BLIND =
  "Briefly tell the user what you launched and end your response. Do not generate any other text — agent results will arrive in a subsequent message.";

function renderAsyncLaunched(data: AgentAsyncLaunchedResultData): string {
  const instructions =
    data.canReadOutputFile && data.outputFile
      ? [
          ASYNC_DUPLICATE_WARNING,
          `output_file: ${data.outputFile}`,
          `If asked, you can check progress before completion by using ${READ_TOOL_NAME} or ${BASH_TOOL_NAME} tail on the output file.`,
        ].join("\n")
      : ASYNC_INSTRUCTIONS_BLIND;

  // CC 那行的括号里还有半句 `Use SendMessage with to: '<id>' to continue this
  // agent.`，我方没有 SendMessage 工具，只留前半句「别对用户报内部 id」。
  return [
    "Async agent launched successfully.",
    `agentId: ${data.agentId} (internal ID - do not mention to user.)`,
    "The agent is working in the background. You will be notified automatically when it completes.",
    instructions,
  ].join("\n");
}

function renderCompletedTrailer(data: AgentCompletedResultData): string {
  if (
    data.agentType &&
    ONE_SHOT_AGENT_TYPES.has(data.agentType) &&
    !data.worktreePath
  ) {
    return "";
  }
  // CC 那行原文还带 ``(use SendMessage with to: '<id>' to continue this agent)``，
  // 我方没有 SendMessage 工具，带上只会教模型用一个不存在的工具，所以只留 id。
  return [
    `agentId: ${data.agentId}`,
    `<usage>total_tokens: ${data.totalTokens}`,
    `tool_uses: ${data.totalToolUseCount}`,
    `duration_ms: ${data.totalDurationMs}</usage>`,
  ].join("\n");
}

export function renderAgentResultData(data: AgentResultData): string {
  return data.status === "async_launched"
    ? renderAsyncLaunched(data)
    : renderAgentCompletedText(data);
}

/**
 * 同步分支的完整文本 = 子代理报告（`data.content`）+ 渲染出的尾部。
 *
 * 报告为空时补 CC 的 `(Subagent completed but returned no output.)`；一次性内置代理
 * （Explore / Plan）的尾部按 CC 整段跳过，所以那时文本就是报告本身。
 */
export function renderAgentCompletedText(
  data: AgentCompletedResultData,
): string {
  const body = data.content.length > 0 ? data.content : AGENT_NO_OUTPUT_MARKER;
  const trailer = renderCompletedTrailer(data);
  return trailer ? `${body}\n${trailer}` : body;
}
