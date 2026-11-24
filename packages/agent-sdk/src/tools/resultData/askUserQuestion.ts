import type { AskUserQuestionAnnotation } from "../../types/tools.js";

/**
 * `AskUserQuestion` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * 形状与文本照 CC：`AskUserQuestionTool.tsx:69-73` 的 outputSchema、`:209-223` 的
 * `call()`、`:224-244` 的 `mapToolResultToToolResultBlockParam`。要点：
 *
 * - 答案表以**题面原文**为 key（CC 用的是 `z.record(z.string(), z.string())`），
 *   `annotations` 按同一个 key 对齐，两处必须是同一个字符串。
 * - 多选在 CC 里是**一个逗号分隔的字符串**，不是数组：UI 层
 *   `label.join(", ")`（`AskUserQuestionPermissionRequest.tsx:426-429`），
 *   outputSchema 的注释也写「multi-select answers are comma-separated」。
 *   我方宿主发过来的是 `string[]`，工具在组 `data` 前就并好。
 * - 「其他」里填的字、以及只写了备注没选选项时的 `(notes only)`，都是**答案原文**，
 *   渲染器原样打出来，不判空、不过滤——`(notes only)` 不等于没答。
 * - 文本形态是纯散文，没有结构化骨架：每道题一段 `"题面"="答案"`，逗号连接，后接
 *   一句「可以继续了」。
 *
 * CC 的 outputSchema 还有 `questions`（`AskUserQuestionTool.tsx:70`），我方不落盘：
 * 那是模型自己传进来的题面（选项带 `preview` 时可能是整段 markdown），而渲染器一个
 * 字段都不用它——题面原文已经在 `answers` 的 key 里了。
 *
 * `annotations` 里的 `preview` 是唯一一个「模型传进来的原文」还留在 `data` 里的
 * 字段，因为它就是 CC 文本的一部分（`selected preview:\n…`）。丢掉它，模型在
 * 选项预览题上就再也看不到自己给用户看的那份东西。
 */
export interface AskUserQuestionResultData {
  /** 题面原文 → 答案。多选是 `", "` 连接后的一整串。 */
  answers: Record<string, string>;
  /** 与 `answers` 同 key：选中项的预览全文与用户备注（CC 原字段名）。 */
  annotations?: Record<string, AskUserQuestionAnnotation>;
}

export function renderAskUserQuestionResultData(
  data: AskUserQuestionResultData,
): string {
  const answersText = Object.entries(data.answers)
    .map(([questionText, answer]) => {
      const annotation = data.annotations?.[questionText];
      const parts = [`"${questionText}"="${answer}"`];
      if (annotation?.preview) {
        parts.push(`selected preview:\n${annotation.preview}`);
      }
      if (annotation?.notes) {
        parts.push(`user notes: ${annotation.notes}`);
      }
      return parts.join(" ");
    })
    .join(", ");

  return `User has answered your questions: ${answersText}. You can now continue with the user's answers in mind.`;
}
