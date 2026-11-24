import type { AskUserQuestionAnnotation } from "../../types/tools.js";

/**
 * 宿主「只填了备注、没选选项」时写在答案位的哨兵值（CC 的 `nur`）。它只是
 * **传输形态**：模型读到的文本是 `(no option selected)`，见下面的渲染器。
 */
export const NOTES_ONLY_ANSWER = "(notes only)";

/**
 * `AskUserQuestion` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * 形状与文本照 CC 2.1.331：`1005-20922B-mDn.js:410` 的 outputSchema、`:600`
 * 的 `call()`、`:671` 的 `mapToolResultToToolResultBlockParam`。要点：
 *
 * - 答案表以**题面原文**为 key，`annotations` 按同一个 key 对齐，两处必须是
 *   同一个字符串。
 * - 多选在 CC 里是**一个逗号分隔的字符串**，不是数组：UI 层
 *   `label.join(", ")`，outputSchema 的注释也写「multi-select answers are
 *   comma-separated」。我方宿主发过来的是 `string[]`，工具在组 `data` 前就并好。
 * - `(notes only)` 是传输哨兵，不进模型看到的文本：那一题渲染成
 *   `"题干"=(no option selected) notes: …`（CC 同形）。
 * - 外层句子分两档：有备注、或答案不是该题选项里的 label（用户走「其他」写了
 *   自定义答案）→ 「读仔细」；否则 → 「可以继续」。这条判据要拿 `questions`
 *   对答案，而 `data` 不落 `questions`（issue #3055 的决定）、渲染器又是纯
 *   `data → string`，所以工具在解析回执时就把结论算好，只带一个
 *   `readCarefully` 标记下来——重放历史时也才能渲染出与当场一致的文本。
 *
 * CC 的 outputSchema 还有 `questions`（`1005-20922B-mDn.js:411`），我方不落盘：
 * 那是模型自己传进来的题面（选项带 `preview` 时可能是整段 markdown），渲染器
 * 不需要它。
 */
export interface AskUserQuestionResultData {
  /** 题面原文 → 答案。多选是 `", "` 连接后的一整串。 */
  answers: Record<string, string>;
  /** 与 `answers` 同 key：选中项的预览全文与用户备注（CC 原字段名）。 */
  annotations?: Record<string, AskUserQuestionAnnotation>;
  /**
   * 至少一题的答案不是该题选项的 label，或至少一题带了备注：模型该读仔细再动手。
   * 渲染器自己判不了（`data` 里没有 `questions`），由工具层算好带下来。
   */
  readCarefully?: true;
}

export function renderAskUserQuestionResultData(
  data: AskUserQuestionResultData,
): string {
  // `answers` 里没有、但 `annotations` 里有的题面（「只写备注、一个选项都没选」）
  // 也要出现——丢掉它等于把用户说的话丢掉。
  const questionTexts = [
    ...Object.keys(data.answers),
    ...Object.keys(data.annotations ?? {}).filter(
      (questionText) =>
        !Object.prototype.hasOwnProperty.call(data.answers, questionText),
    ),
  ];

  const answeredText = questionTexts
    .map((questionText) => {
      const answer = data.answers[questionText];
      const annotation = data.annotations?.[questionText];
      // 哨兵与空串都不是答案：CC 的 `v = w && w !== nur` 同样把它们当「没选」。
      const selected =
        typeof answer === "string" &&
        answer !== "" &&
        answer !== NOTES_ONLY_ANSWER
          ? answer
          : undefined;
      // 既没答案也没备注 = 这题没答，整条不出现（CC 的 `!v && !A?.notes`）。
      if (!selected && !annotation?.notes) return null;
      const parts = [
        selected
          ? '"' + questionText + '"="' + selected + '"'
          : '"' + questionText + '"=(no option selected)',
      ];
      if (annotation?.preview) {
        parts.push("selected preview:\n" + annotation.preview);
      }
      if (annotation?.notes) {
        parts.push("notes: " + annotation.notes);
      }
      return parts.join(" ");
    })
    .filter((entry): entry is string => entry !== null)
    .join(", ");

  if (answeredText === "") {
    return "The user did not answer the questions.";
  }

  // 备注不是选项标签，它在说「用户还有话要说」：模型该读仔细再动手。
  const hasNotes = questionTexts.some(
    (questionText) => !!data.annotations?.[questionText]?.notes,
  );
  if (hasNotes || data.readCarefully === true) {
    return (
      "The user answered: " +
      answeredText +
      ". Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say."
    );
  }
  return (
    "Your questions have been answered: " +
    answeredText +
    ". You can now continue with these answers in mind."
  );
}
