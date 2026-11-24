import {
  ASK_USER_QUESTION_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
} from "../../constants/tools.js";

/**
 * `EnterPlanMode` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * 形状与文本照 CC：`EnterPlanModeTool.ts:28-32` 的 outputSchema、`:96-101` 造
 * `data`、`:103-125` 的 `mapToolResultToToolResultBlockParam`。要点：
 *
 * - `data` 只有一个 `message`（CC 整个 schema 就这一个字段），后面那段「进了计划
 *   模式之后该干什么」的固定指令**不进 data**——它是常量，由渲染器现场拼，落盘也
 *   只是把同一段话再抄一遍。
 * - CC 用 `isPlanModeInterviewPhaseEnabled()`（`utils/planModeV2.ts:50`，对外是
 *   feature gate、默认关）在「6 步指令」与「一句话」之间二选一。我方没有这个
 *   gate，取默认那套：与我方计划模式提醒（`prompts/planModeReminders.ts` 的 5 阶段
 *   流程）同源。
 * - 这段指令与计划模式的 system-reminder 内容重叠是照抄 CC 的：CC 也两个都发
 *   （`utils/messages.ts:3211` 起的计划模式 attachment + 这里的 tool_result）。
 *
 * 失败分支（已在计划模式里、用户拒绝）不进 `data`：CC 那边它们压根不经过
 * outputSchema，是权限框架直接回的错误 tool_result（见 issue #3055 的口径「data 不
 * 放失败载荷」）。
 */
export interface EnterPlanModeResultData {
  /** 进入计划模式后的那句确认；字段名照 CC（`EnterPlanModeTool.ts:30`）。 */
  message: string;
}

export function renderEnterPlanModeResultData(
  data: EnterPlanModeResultData,
): string {
  const instructions = `In plan mode, you should:
1. Thoroughly explore the codebase to understand existing patterns
2. Identify similar features and architectural approaches
3. Consider multiple approaches and their trade-offs
4. Use ${ASK_USER_QUESTION_TOOL_NAME} if you need to clarify the approach
5. Design a concrete implementation strategy
6. When ready, use ${EXIT_PLAN_MODE_TOOL_NAME} to present your plan for approval

Remember: DO NOT write or edit any files yet. This is a read-only exploration and planning phase.`;

  return `${data.message}\n\n${instructions}`;
}

/**
 * `EnterPlanMode` 的 `data` 形状（JSON Schema）。
 *
 * 用途只有一个：供 REPL 把工具签名渲染成真实返回类型（spec
 * core/repl-tool.md「公告分档呈现」），模型据此直接写 `const r = await
 * EnterPlanMode(...); r.message`，不用先探一次。与
 * {@link EnterPlanModeResultData} 逐字段对应，改一处必须改另一处。
 */
export const enterPlanModeOutputSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    message: {
      type: "string",
      description:
        "Confirmation that plan mode was entered; the follow-up instructions are appended by the renderer, not stored here.",
    },
  },
  required: ["message"],
  additionalProperties: false,
};
