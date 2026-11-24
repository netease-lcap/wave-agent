/**
 * 工具结果的 `data → 文本` 渲染器注册表（issue #3055 阶段 1）。
 *
 * CC 的模型侧 tool_result 文本由每个工具的 `mapToolResultToToolResultBlockParam(data)`
 * 现场渲染、不预存；这里一一对应地放我方每个工具的那份渲染器。
 *
 * 为什么是一张按名字索引的静态表，而不是挂在 `ToolPlugin` 上：渲染发生在
 * `aiManager.executeToolCall` 里「拿到 `ToolResult`、还没落盘」那一刻，按名字查表
 * 才不用反查插件实例（`Grep`/`Glob` 是 `--tools` 可选、MCP 与插件工具也不在这个
 * 表里，表外工具由调用方退回工具当场的 `content`）。
 *
 * 表里的模块都是纯函数、零 import 副作用。
 *
 * 契约：**成员 = 有这个工具的渲染器；某一份 `data` 没有文本形态时返回 `undefined`。**
 * `data` 是完整的结构化本体（剥掉大块载荷只发生在落盘副本上，见 `strip.ts`），
 * 所以 `undefined` 只剩「这段结果本来就没有纯文本」一种含义：`Read` 的 image
 * （红图块）、pdf / binary（读不了）、超 token 被拒（正文是空串、原因在 `error`）。
 * 除此之外的 `undefined` 都算缺口。
 */
import {
  AGENT_TOOL_NAME,
  ARTIFACT_COMMENTS_TOOL_NAME,
  ARTIFACT_TOOL_NAME,
  ASK_USER_QUESTION_TOOL_NAME,
  BASH_TOOL_NAME,
  CRON_CREATE_TOOL_NAME,
  CRON_DELETE_TOOL_NAME,
  CRON_LIST_TOOL_NAME,
  EDIT_TOOL_NAME,
  ENTER_PLAN_MODE_TOOL_NAME,
  ENTER_WORKTREE_TOOL_NAME,
  REPL_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  EXIT_WORKTREE_TOOL_NAME,
  GLOB_TOOL_NAME,
  GREP_TOOL_NAME,
  KB_GET_DOC_TOOL_NAME,
  KB_SEARCH_TOOL_NAME,
  KB_SUGGEST_TOOL_NAME,
  LSP_TOOL_NAME,
  POLL_TOOL_NAME,
  POWERSHELL_TOOL_NAME,
  READ_TOOL_NAME,
  REPL_TOOL_ALIASES,
  SEND_USER_FILE_TOOL_NAME,
  SKILL_TOOL_NAME,
  TASK_CREATE_TOOL_NAME,
  TASK_GET_TOOL_NAME,
  TASK_LIST_TOOL_NAME,
  TASK_STOP_TOOL_NAME,
  TASK_UPDATE_TOOL_NAME,
  WEB_FETCH_TOOL_NAME,
  WEB_SEARCH_TOOL_NAME,
  WORKFLOW_TOOL_NAME,
  WRITE_TOOL_NAME,
} from "../../constants/tools.js";
import { renderAgentResultData, type AgentResultData } from "./agent.js";
import {
  renderArtifactResultData,
  type ArtifactResultData,
} from "./artifact.js";
import {
  renderArtifactCommentsResultData,
  type ArtifactCommentsResultData,
} from "./artifactComments.js";
import {
  renderAskUserQuestionResultData,
  type AskUserQuestionResultData,
} from "./askUserQuestion.js";
import { renderBashResultData, type BashResultData } from "./bash.js";
import {
  renderCronCreateResultData,
  type CronCreateResultData,
} from "./cronCreate.js";
import {
  renderCronDeleteResultData,
  type CronDeleteResultData,
} from "./cronDelete.js";
import {
  renderCronListResultData,
  type CronListResultData,
} from "./cronList.js";
import { renderEditResultData, type EditResultData } from "./edit.js";
import {
  renderEnterPlanModeResultData,
  type EnterPlanModeResultData,
} from "./enterPlanMode.js";
import {
  renderEnterWorktreeResultData,
  type EnterWorktreeResultData,
} from "./enterWorktree.js";
import {
  renderExitPlanModeResultData,
  type ExitPlanModeResultData,
} from "./exitPlanMode.js";
import {
  renderExitWorktreeResultData,
  type ExitWorktreeResultData,
} from "./exitWorktree.js";
import { renderGlobResultData, type GlobResultData } from "./glob.js";
import { renderGrepResultData, type GrepResultData } from "./grep.js";
import {
  renderKbGetDocResultData,
  type KbGetDocResultData,
} from "./kbGetDoc.js";
import {
  renderKbSearchResultData,
  type KbSearchResultData,
} from "./kbSearch.js";
import {
  renderKbSuggestResultData,
  type KbSuggestResultData,
} from "./kbSuggest.js";
import { renderLspResultData, type LspResultData } from "./lsp.js";
import { renderPollResultData, type PollResultData } from "./poll.js";
import {
  renderPowerShellResultData,
  type PowerShellResultData,
} from "./powershell.js";
import { renderReadResultData, type ReadResultData } from "./read.js";
import { renderReplResultData, type ReplResultData } from "./repl.js";
import {
  renderSendUserFileResultData,
  type SendUserFileResultData,
} from "./sendUserFile.js";
import { renderSkillResultData, type SkillResultData } from "./skill.js";
import {
  renderTaskCreateResultData,
  type TaskCreateResultData,
} from "./taskCreate.js";
import { renderTaskGetResultData, type TaskGetResultData } from "./taskGet.js";
import {
  renderTaskListResultData,
  type TaskListResultData,
} from "./taskList.js";
import {
  renderTaskStopResultData,
  type TaskStopResultData,
} from "./taskStop.js";
import {
  renderTaskUpdateResultData,
  type TaskUpdateResultData,
} from "./taskUpdate.js";
import {
  renderWebFetchResultData,
  type WebFetchResultData,
} from "./webFetch.js";
import {
  renderWebSearchResultData,
  type WebSearchResultData,
} from "./webSearch.js";
import { renderWriteResultData, type WriteResultData } from "./write.js";
import {
  renderWorkflowResultData,
  type WorkflowResultData,
} from "./workflow.js";

/** 纯函数：输入是落盘的 `data`，输出是模型侧与四端 UI 看到的那段文本。 */
export type ToolResultRenderer = (data: unknown) => string | undefined;

const RENDERERS: Record<string, ToolResultRenderer> = {
  [AGENT_TOOL_NAME]: (data) => renderAgentResultData(data as AgentResultData),
  [ASK_USER_QUESTION_TOOL_NAME]: (data) =>
    renderAskUserQuestionResultData(data as AskUserQuestionResultData),
  [ARTIFACT_TOOL_NAME]: (data) =>
    renderArtifactResultData(data as ArtifactResultData),
  [ARTIFACT_COMMENTS_TOOL_NAME]: (data) =>
    renderArtifactCommentsResultData(data as ArtifactCommentsResultData),
  [BASH_TOOL_NAME]: (data) => renderBashResultData(data as BashResultData),
  [CRON_CREATE_TOOL_NAME]: (data) =>
    renderCronCreateResultData(data as CronCreateResultData),
  [CRON_DELETE_TOOL_NAME]: (data) =>
    renderCronDeleteResultData(data as CronDeleteResultData),
  [CRON_LIST_TOOL_NAME]: (data) =>
    renderCronListResultData(data as CronListResultData),
  [EDIT_TOOL_NAME]: (data) => renderEditResultData(data as EditResultData),
  [ENTER_PLAN_MODE_TOOL_NAME]: (data) =>
    renderEnterPlanModeResultData(data as EnterPlanModeResultData),
  [ENTER_WORKTREE_TOOL_NAME]: (data) =>
    renderEnterWorktreeResultData(data as EnterWorktreeResultData),
  [REPL_TOOL_NAME]: (data) => renderReplResultData(data as ReplResultData),
  [EXIT_PLAN_MODE_TOOL_NAME]: (data) =>
    renderExitPlanModeResultData(data as ExitPlanModeResultData),
  [EXIT_WORKTREE_TOOL_NAME]: (data) =>
    renderExitWorktreeResultData(data as ExitWorktreeResultData),
  [GLOB_TOOL_NAME]: (data) => renderGlobResultData(data as GlobResultData),
  [GREP_TOOL_NAME]: (data) => renderGrepResultData(data as GrepResultData),
  [KB_GET_DOC_TOOL_NAME]: (data) =>
    renderKbGetDocResultData(data as KbGetDocResultData),
  [KB_SEARCH_TOOL_NAME]: (data) =>
    renderKbSearchResultData(data as KbSearchResultData),
  [KB_SUGGEST_TOOL_NAME]: (data) =>
    renderKbSuggestResultData(data as KbSuggestResultData),
  [LSP_TOOL_NAME]: (data) => renderLspResultData(data as LspResultData),
  [POLL_TOOL_NAME]: (data) => renderPollResultData(data as PollResultData),
  [POWERSHELL_TOOL_NAME]: (data) =>
    renderPowerShellResultData(data as PowerShellResultData),
  [READ_TOOL_NAME]: (data) => renderReadResultData(data as ReadResultData),
  [SEND_USER_FILE_TOOL_NAME]: (data) =>
    renderSendUserFileResultData(data as SendUserFileResultData),
  [SKILL_TOOL_NAME]: (data) => renderSkillResultData(data as SkillResultData),
  [TASK_CREATE_TOOL_NAME]: (data) =>
    renderTaskCreateResultData(data as TaskCreateResultData),
  [TASK_GET_TOOL_NAME]: (data) =>
    renderTaskGetResultData(data as TaskGetResultData),
  [TASK_LIST_TOOL_NAME]: (data) =>
    renderTaskListResultData(data as TaskListResultData),
  [TASK_STOP_TOOL_NAME]: (data) =>
    renderTaskStopResultData(data as TaskStopResultData),
  [TASK_UPDATE_TOOL_NAME]: (data) =>
    renderTaskUpdateResultData(data as TaskUpdateResultData),
  [WEB_FETCH_TOOL_NAME]: (data) =>
    renderWebFetchResultData(data as WebFetchResultData),
  [WEB_SEARCH_TOOL_NAME]: (data) =>
    renderWebSearchResultData(data as WebSearchResultData),
  [WORKFLOW_TOOL_NAME]: (data) =>
    renderWorkflowResultData(data as WorkflowResultData),
  [WRITE_TOOL_NAME]: (data) => renderWriteResultData(data as WriteResultData),
};

// `REPL` 的历史名（`REPL_TOOL_ALIASES`，老转录里的 tool block 叫 `Eval`）：阶段 2
// 按名字查表，别名也得命中同一份渲染器，否则老会话的这段结果只能退回 `content`。
for (const alias of REPL_TOOL_ALIASES) {
  RENDERERS[alias] = RENDERERS[REPL_TOOL_NAME];
}

/**
 * 按工具名把 `data` 渲染成文本。
 *
 * 返回 `undefined` 表示这个工具还没迁过来、或这段结果没有文本形态（`Read` 的
 * image / pdf / binary / 超 token 被拒，见文件头的契约）：调用方退回工具当场的
 * `content`，不要当成空输出。
 */
export function renderToolResultData(
  toolName: string,
  data: unknown,
): string | undefined {
  if (data === undefined) return undefined;
  const render = RENDERERS[toolName];
  return render ? render(data) : undefined;
}

/**
 * 这个工具是否已经交出渲染器。
 *
 * 只服务一条门禁：`tests/tools/resultData.test.ts` 的「内置工具整表都在」——
 * 新增内置工具时忘了写渲染器不会崩（`aiManager` 会退回工具的 `content`），但文本
 * 会悄悄脱离渲染器口径，那正是阶段 1 要消灭的漂移。`RENDERERS` 表本身不导出，
 * 所以这是唯一判据，别当死代码删掉。
 */
export function hasToolResultRenderer(toolName: string): boolean {
  return toolName in RENDERERS;
}
