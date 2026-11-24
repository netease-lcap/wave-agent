import { TASK_STOP_TOOL_NAME } from "../../constants/tools.js";

/**
 * `Workflow` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * 形状照 CC：`2082-83255B-WorkflowTool.js:2767-2780` 的 outputSchema（局部名 `rn`，
 * 工具类的 `get outputSchema` 在 `:2922`），构造点 `:3227-3236`（编译失败）与
 * `:3293-3303`（后台启动成功）；文本照 `:3329-3378` 的
 * `mapToolResultToToolResultBlockParam`。要点：
 *
 * - CC 的 tool_result 只是「已经交给后台了」的回执
 *   （`Workflow launched in background. Task ID: …`），脚本自己的返回值不在里面，
 *   它随 `<task-notification>` 到达。我方回执比 CC 细（名字、描述、阶段、上限、
 *   脚本落盘路径），因为模型要在钱还没花掉之前把这份成本包线讲给用户
 *   （spec `multi-agent/workflow.md`「预算与规模硬上限」场景 8）。所以下面除了 CC
 *   的同名字段，还有几个只为我方正文服务的扩展字段。
 * - `status` 是 CC union 的判别式（CC 是 `async_launched` / `remote_launched`，
 *   后者属于 CCR 远程会话，我方没有那条路）。
 * - CC 的 `summary` 就是脚本 `meta.description`（`:3222` 的
 *   `W = j.meta.description` 直接喂给 `summary`）：同一个来源，只是我方正文那行
 *   的标签叫 `Description:`，字段名沿用 `summary`。
 * - `taskId` 与 `runId` 在 CC 是两个 id 空间（后台任务 id vs 运行 id，远程档甚至
 *   只有前者）；我方「run 就是那个后台任务」，两者同值（`backgroundTaskId` 也是
 *   它），但都留着，因为正文两处分别按这两个字段渲。
 * - 不进 `data` 的：`script`（模型自己传的正文，CC 也不存）、`args`（同理）、
 *   `phases` 的 `detail`/`model`（正文只列标题）。`scriptPath` 是落盘副本的路径，
 *   短且能定位，CC 同。
 * - 正文为空的分支（`workflowManager` 缺失、脚本来源数量不对、脚本文件读不到、
 *   名字解析不到）不产出 `data`：正文是空串，模型侧看到的是 `aiManager` 的
 *   `Error: <error>` 兜底（`aiManager.ts:2280`），`data` 里没有能还原的正文。
 *   与 `bash.ts` 的 spawn 失败分支同一口径。
 *
 * CC 有、我方没有的字段：
 * - `transcriptDir`：CC 把子代理转录目录写进回执。我方的转录落在 run 目录的
 *   `agents/` 下，但工具这一层拿不到那个路径（`WorkflowManager` 内部才知道），
 *   正文也不打印它。
 * - `sessionUrl` + 整个 `remote_launched` 档：CC 的 CCR 远程会话，我方没有远程执行。
 * - `warning`：CC 用来提示「本地 git 状态与云会话将要 clone 的分支不一致」，同样只
 *   存在于远程档。
 */

/** 后台已经跑起来的回执。字段名对齐 CC 的 `rn` schema。 */
export interface WorkflowLaunchedResultData {
  /** CC 同名判别式。我方只有本地后台跑这一条路，所以恒为 `async_launched`。 */
  status: "async_launched";
  /**
   * CC 同名：后台任务 id。我方 run 就是那个后台任务，取值同 `runId`，也正是
   * `ToolResult.backgroundTaskId`（工具行直达任务面板靠它）。
   */
  taskId: string;
  /** CC 同名：`local_workflow`（CC 的另一档 `remote_agent` 我方没有）。 */
  taskType: "local_workflow";
  /** CC 同名：脚本 `meta.name`。 */
  workflowName: string;
  /** CC 同名：这次运行的 id，`resumeFromRunId` 用它。 */
  runId: string;
  /**
   * CC 同名：CC 在这里放的就是 `meta.description`（见文件头）。我方正文那行写作
   * `Description: …`。
   */
  summary: string;
  /** CC 同名：脚本落盘副本的路径，正文最后一行 `Script saved to: …`。 */
  scriptPath: string;
  /**
   * 我方扩展，CC 无此字段：CC 的 schema 不带 `meta.phases`，正文也不列阶段
   * （阶段是 UI 里 `/workflows` 的事）。我方正文有一行
   * `Phases: Scan → Fix`，只放标题。
   */
  phaseTitles?: string[];
  /**
   * 我方扩展，CC 无此字段：这次运行硬上限的 `agent()` 调用数
   * （`WORKFLOW_AGENT_CALL_CAP`）。CC 也有规模上限，但既不在 schema 里也不在回执
   * 文本里。放进 `data` 而不是让渲染器去 import 常量，是为了让历史转录能重建当时
   * 生效的那个数。
   */
  agentCallCap: number;
  /**
   * 我方扩展，CC 无此字段：本回合的输出 token 目标；用户没设就没有这个键（CC 的
   * 预算走 `runOpOutputFields`，没有这一档）。
   */
  turnTokenTarget?: number;
}

/**
 * 没跑起来的分支。`status` 的 `failed` 取值是**我方扩展**：CC 的语法错误分支仍报
 * `async_launched`（`:3227-3236`），因为它在编译前就已经注册好后台上台任务、手上有
 * `taskId`；我方 `createRun`/`startRun` 抛错时既没有 run 也没有 task，报
 * `async_launched` 会让界面去找一个不存在的任务。字段名 `error` 与 CC 同（CC 用它
 * 表达「语法检查失败，没启动」）。
 */
export interface WorkflowFailedResultData {
  status: "failed";
  /** 原始错误消息（渲染器加前后缀，见 `renderWorkflowResultData`）。 */
  error: string;
}

export type WorkflowResultData =
  | WorkflowLaunchedResultData
  | WorkflowFailedResultData;

/**
 * CC 在用户没给 token 目标时那句话（`:3356-3378` 只渲 `Summary`/`Transcript dir`，
 * 这半句是我方回执自己的台词，措辞不动）。
 */
const NO_TOKEN_TARGET =
  'no token target set for this turn (the user can set one, e.g. "+500k")';

function renderLaunched(data: WorkflowLaunchedResultData): string {
  const phases = data.phaseTitles?.length
    ? `Phases: ${data.phaseTitles.join(" → ")}`
    : "";
  const limits =
    data.turnTokenTarget === undefined
      ? NO_TOKEN_TARGET
      : `${data.turnTokenTarget} output tokens for this turn`;

  return [
    `Workflow started with run ID: ${data.runId}`,
    `Name: ${data.workflowName}`,
    `Description: ${data.summary}`,
    phases,
    `Limits: ${data.agentCallCap} agents maximum for this run, and ${limits}.`,
    `The workflow is running in the background. You will be notified automatically when it completes.`,
    `To stop it, use ${TASK_STOP_TOOL_NAME} with task_id "${data.runId}".`,
    `Use /workflows to watch live progress.`,
    `Script saved to: ${data.scriptPath}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function renderWorkflowResultData(data: WorkflowResultData): string {
  return data.status === "failed"
    ? `Workflow failed: ${data.error}. Fix the error and try again.`
    : renderLaunched(data);
}
