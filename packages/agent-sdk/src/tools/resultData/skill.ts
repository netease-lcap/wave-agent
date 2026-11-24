/**
 * `Skill` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * 形状与文本照 CC：`SkillTool.ts:301-326` 的 outputSchema（inline / forked 两支
 * 的 union）、`:276-284`（forked 的 data）、`:767-773`（inline 的 data）、
 * `:843-862` 的 `mapToolResultToToolResultBlockParam`。要点：
 *
 * - 一支一套字段，`status: "forked"` 是判别键（CC 用 `'status' in result`，我方的
 *   inline 数据不写 `status`，所以这里直接比 `"forked"`）。
 * - CC 的 inline 文本是 `Launching skill: <name>`：它把技能正文当**新消息**注入
 *   （`SkillTool.ts:729-755` 的 `newMessages`），tool_result 里只有这一行。
 * - CC 的 forked 文本把子代理的最终答复整段带在 `Result:` 下面，所以 `result`
 *   必须留在 `data` 里，否则这条分支就没有文本形态了（它是模型产出，不是模型传进
 *   来的参数，也不是文件正文）。
 * - 技能正文（SKILL.md 的内容）在 `data.content`：**这是与 CC 的一处偏差**。CC 的
 *   inline data 里没有正文——它把技能正文当 `newMessages` 另起一条 user 消息注进对
 *   话（`SkillTool.ts:729-755`），tool_result 里只有 `Launching skill: <name>`。我方
 *   SDK 没有这条通道（`ToolResult` 没有 `newMessages`，AIManager 也不为 Skill 特判），
 *   正文只能走 tool_result，于是它必须能从 `data` 重建，否则阶段 2 丢掉 `content` 之
 *   后正文就没了来源。字段叫 `content`（不是 CC 的字段名，CC 那边没有），语义是
 *   「这次注入的技能正文」。
 */

export interface SkillInlineResultData {
  /** 这次调用是否成功；本工具只在成功分支组 `data`，恒为 true。 */
  success: boolean;
  /** 技能名（我方入参叫 `skill_name`，CC 的字段叫 `commandName`）。 */
  commandName: string;
  /**
   * 技能正文（SKILL.md 的内容，可能几千字）。
   *
   * 与 CC 的偏差：CC 走 `newMessages` 通道、tool_result 里只有 `Launching skill:`
   * 一行，data 里没有正文。我方没有那条通道，正文只能留在 tool_result 里，所以它
   * 是 inline 分支文本的全部（见文件头最后一条）。
   */
  content: string;
  /** 技能声明的 `allowed-tools`；没声明就不写这个键（CC 同样给 undefined）。 */
  allowedTools?: string[];
  /** 技能 frontmatter 里的 `model` 覆盖。 */
  model?: string;
  /**
   * CC 的 inline schema 里有这个可选字段，但它只在 CC 的远程技能路径上写
   * （`SkillTool.ts:1102`）；本地 inline 技能的 data 里没有，我方也不写。
   */
  status?: "inline";
}

export interface SkillForkedResultData {
  success: boolean;
  commandName: string;
  status: "forked";
  /** 跑这个技能的子代理 id（CC 的 `agentId`，我方即 `instance.subagentId`）。 */
  agentId: string;
  /** 子代理的最终答复全文；CC 把它渲染进 `Result:` 段。 */
  result: string;
}

export type SkillResultData = SkillInlineResultData | SkillForkedResultData;

/** forked 分支的模型侧文本，逐字照 CC `SkillTool.ts:852`。 */
export function renderSkillForkedResultData(
  data: SkillForkedResultData,
): string {
  return `Skill "${data.commandName}" completed (forked execution).\n\nResult:\n${data.result}`;
}

/**
 * inline 分支的文本就是 `data.content`（技能正文）。
 *
 * 与 CC 的偏差在 `SkillInlineResultData.content` 与文件头写明：CC 的 inline 文本是
 * `Launching skill: <name>` 一行（正文走 `newMessages` 另起一条消息），我方没有那条
 * 通道，正文只能由 tool_result 承载 —— 所以这里渲出全文，而不是一行的回执（渲一行
 * 会把正文悄悄丢掉）。
 */
export function renderSkillInlineResultData(
  data: SkillInlineResultData,
): string {
  return data.content;
}

export function renderSkillResultData(data: SkillResultData): string {
  return data.status === "forked"
    ? renderSkillForkedResultData(data)
    : renderSkillInlineResultData(data);
}
