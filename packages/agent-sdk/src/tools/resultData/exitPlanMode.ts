/**
 * `ExitPlanMode` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * 形状与文本照 CC：`ExitPlanModeV2Tool.ts:110-142` 的 outputSchema、`:409-417` 造
 * `data`、`:419-492` 的 `mapToolResultToToolResultBlockParam`。
 *
 * CC 的 outputSchema 还有一批字段，我方一律不放：
 * `plan`（计划正文——模型自己写进计划文件的全文，正是「大字段不落盘」要挡的）、
 * `isAgent` / `awaitingLeaderApproval` / `requestId`（teammate 走队长审批通道，
 * 我方没有团队）、`hasTaskTool`（只为拼一句 `TeamCreate` 提示，我方没有该工具）、
 * `planWasEdited`（用户改写计划后批准；我方审批卡只读）。
 *
 * 于是两支文本在 CC 那边拿不到：`isAgent` 的「Please respond with "ok"」和计划正文
 * 的 `## Approved Plan:` 段。前者要我方 `ToolContext` 上没有的 agent 标记（`data`
 * 里只有一个恒假的 `isAgent` 是不诚实的），后者要 `plan`。用户批准这段话本身照抄
 * CC，只是把它与 `## Approved Plan:` 之间那句收尾留住、不回声正文。
 */
export interface ExitPlanModeResultData {
  /**
   * 计划文件的绝对路径；字段名照 CC（`ExitPlanModeV2Tool.ts:117-120`），批准后
   * 模型回头改计划、宿主把「计划存在哪」显示出来都要它。
   */
  filePath: string;
}

export function renderExitPlanModeResultData(
  data: ExitPlanModeResultData,
): string {
  return `User has approved your plan. You can now start coding. Start with updating your todo list if applicable

Your plan has been saved to: ${data.filePath}
You can refer back to it if needed during implementation.`;
}

/**
 * `ExitPlanMode` 的 `data` 形状（JSON Schema）。
 *
 * 用途只有一个：供 REPL 把工具签名渲染成真实返回类型（spec
 * core/repl-tool.md「公告分档呈现」），模型据此直接写 `const r = await
 * ExitPlanMode(...); r.filePath`，不用先探一次。与
 * {@link ExitPlanModeResultData} 逐字段对应，改一处必须改另一处。
 */
export const exitPlanModeOutputSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    filePath: {
      type: "string",
      description:
        "Absolute path of the approved plan file; the plan body itself is not part of this data.",
    },
  },
  required: ["filePath"],
  additionalProperties: false,
};
