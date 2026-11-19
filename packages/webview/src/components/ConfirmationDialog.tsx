import React, {
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
} from "react";
import {
  ASK_USER_QUESTION_TOOL_NAME,
  ENTER_PLAN_MODE_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  EDIT_TOOL_NAME,
  WRITE_TOOL_NAME,
  isShellToolName,
} from "wave-agent-sdk/constants";
import {
  CloseIcon,
  ConversationCloseIcon,
  QueueChevronIcon,
} from "./HeaderIcons";
import { isDesktopHost } from "../utils/platform";
import type {
  ConfirmationDialogProps,
  ConfirmationDecision,
  AskUserQuestionInput,
} from "../types";
import "../styles/ConfirmationDialog.css";
import { DiffViewer } from "./DiffViewer";
import { marked } from "marked";
import DOMPurify from "dompurify";

/**
 * Sanitiser allowlist for the plan body. Deliberately the same set the message
 * renderer allows (see `Message.tsx` `parseMarkdownWithMermaid`): the plan is
 * model-authored markdown like any message, and `div` only survives because the
 * table renderer wraps wide tables in a scroll container. Anything else
 * (script/style/iframe/event handlers) is dropped by DOMPurify.
 */
const PLAN_ALLOWED_TAGS = [
  "div",
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "code",
  "pre",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "a",
  "blockquote",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "del",
];
const PLAN_ALLOWED_ATTR = ["href", "title", "align"];

/**
 * Render model-authored markdown to sanitised HTML. Used for the plan body and
 * for option previews — both are markdown the model wrote, so they share one
 * allowlist rather than two sets that drift apart.
 */
const renderMarkdownHtml = (content: string): string =>
  DOMPurify.sanitize(marked.parse(content) as string, {
    ALLOWED_TAGS: PLAN_ALLOWED_TAGS,
    ALLOWED_ATTR: PLAN_ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  });

/** The preview text of one option, or "" when it has none (blank counts as none). */
const optionPreview = (option: { preview?: string }): string =>
  typeof option.preview === "string" ? option.preview : "";

/**
 * 预览态「只写了备注、一个选项都没选」时答案位置上的哨兵值（与 CC 2.1.327 的
 * `"(notes only)"` 同形）。备注本身就算一份有效答案，这里给模型一个明确的
 * 「未选选项」标记，而不是空串 —— 空串读起来像「答了但内容为空」
 * （spec `ask-user-tool.md`「选项预览与备注」场景 9 / 10）。
 */
const NOTES_ONLY_ANSWER = "(notes only)";

/**
 * Whether this question switches to the preview layout: single-select only, and
 * only when at least one option carries a non-blank preview. A question whose
 * previews are all empty/whitespace stays a plain list (spec
 * `ask-user-tool.md`「选项预览与备注」场景 1 / 12).
 */
const questionHasPreview = (
  q: AskUserQuestionInput["questions"][number],
): boolean =>
  !q.multiSelect && q.options.some((o) => optionPreview(o).trim() !== "");

/**
 * 预览面板的高度上限折成行数：取**该题所有选项里最长那条 preview** 的行数 +1
 * （给末行留一格），最少 3 行。CSS 变量 `--preview-lines` 由它写入，CSS 再折算成
 * 高度（`行数 × 1.5em + 1.7em`）。取最大值而不是当前项的行数，是为了换选项时
 * 面板高度不变 —— 否则长 → 短预览一换，整张卡片会跟着突然变矮（spec
 * `ask-user-tool.md`「选项预览与备注」场景 2）。同一算法见 CC VS Code 的
 * `--preview-lines`（`index.js` 里 `Math.max(3, ...options.map(...))`）。
 */
const previewPanelLines = (
  q: AskUserQuestionInput["questions"][number],
): number =>
  Math.max(
    3,
    ...q.options.map(
      (o) => optionPreview(o).replace(/\n+$/, "").split("\n").length + 1,
    ),
  );

// Selector for the dialog's focusable elements. Used by the modal focus trap:
// Tab/Shift+Tab cycle within the dialog so focus never leaks into the message
// list behind it. Elements with an explicit tabIndex="-1" (the hidden radio /
// checkbox inputs inside option labels) are excluded, as are disabled buttons.
const DIALOG_FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getDialogFocusables(dialog: HTMLElement): HTMLElement[] {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR),
  ).filter((el) => el.tabIndex !== -1);
}

/** Last path segment of a directory path (handles both `/` and `\` separators). */
function lastPathSegment(dirPath: string): string {
  const segments = dirPath.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? dirPath;
}

/**
 * Desktop indicator per the 2026-10-23 skill contract
 * (`references/common-components.md` §Choice controls → Desktop Radio and
 * Checkbox): 16×16 box, solid `--cc-action-primary` selected surface with an
 * `--cc-action-primary-text` mark, unselected outline 1px
 * `--cc-text-secondary` (dark: `--cc-text-placeholder`), checkbox outer radius
 * ≈4px (path `rx 3.5`) and a mark thickness that differs by theme (check 1.7 /
 * 2.1). Colors and thickness live in host-desktop.css so both themes resolve at
 * paint time instead of re-rendering on a theme switch.
 */
const DesktopOptionIndicator: React.FC<{
  multiSelect: boolean;
  checked: boolean;
}> = ({ multiSelect, checked }) => (
  <svg
    className="option-indicator-icon"
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
  >
    {multiSelect ? (
      <>
        <rect
          className={checked ? "choice-surface" : "choice-outline"}
          x="0.5"
          y="0.5"
          width="15"
          height="15"
          rx="3.5"
        />
        {checked && (
          <path
            className="choice-mark"
            d="M4 8L6.75 10.75L12 5.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </>
    ) : (
      <>
        <circle
          className={checked ? "choice-surface" : "choice-outline"}
          cx="8"
          cy="8"
          r="7.5"
        />
        {checked && <circle className="choice-dot" cx="8" cy="8" r="3" />}
      </>
    )}
  </svg>
);

/**
 * Radio / Checkbox indicator that matches the Figma design (16×16).
 * - Radio unchecked: hollow ring; checked: accent ring + center dot.
 * - Checkbox (plugin hosts only): filled square + check mark; the 2026-09-22
 *   hollow variant stayed scoped to the desktop surface. Desktop now follows
 *   the 2026-10-23 contract above.
 * Colors use VS Code theme variables so it adapts to light/dark themes.
 */
const OptionIndicator: React.FC<{ multiSelect: boolean; checked: boolean }> = ({
  multiSelect,
  checked,
}) => {
  if (isDesktopHost()) {
    return (
      <DesktopOptionIndicator multiSelect={multiSelect} checked={checked} />
    );
  }
  if (multiSelect) {
    return (
      <svg
        className="option-indicator-icon"
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <rect
          x="0.5"
          y="0.5"
          width="15"
          height="15"
          rx="2.5"
          fill="var(--vscode-checkbox-background)"
          stroke="var(--vscode-checkbox-border)"
        />
        {checked && (
          <path
            d="M4.25 8.1L6.35 9.55L11.25 4.35"
            stroke="var(--vscode-checkbox-foreground)"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    );
  }
  return (
    <svg
      className="option-indicator-icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="8"
        cy="8"
        r="7.5"
        stroke={
          checked
            ? "var(--vscode-focusBorder)"
            : "var(--vscode-checkbox-border)"
        }
      />
      {checked && (
        <circle cx="8" cy="8" r="3" fill="var(--vscode-focusBorder)" />
      )}
    </svg>
  );
};

const ConfirmationDialogImpl: React.FC<ConfirmationDialogProps> = ({
  confirmation,
  onConfirm,
  onReject,
}) => {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [otherInputs, setOtherInputs] = useState<Record<string, string>>({});
  // Multi-select only: whether the "Other" option is checked (the input box
  // appears only after it is checked; typing keeps the check).
  const [otherSelected, setOtherSelected] = useState<Record<string, boolean>>(
    {},
  );
  // 预览态（见 ask-user-tool.md「选项预览与备注」）：右侧预览面板跟着**焦点**
  // 走而不是跟着选中走 —— 用户要在没定下来之前就来回比较。切题时重置为该题
  // 默认聚焦项。
  const [previewFocusIndex, setPreviewFocusIndex] = useState(0);
  // 预览态下「其他」被一行备注取代，按题干存（与 otherInputs 同构，切题不丢）。
  const [notesInputs, setNotesInputs] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState("");
  const [showFeedbackInput, setShowFeedbackInput] = useState(false);
  const [isComposing, setIsComposing] = useState(false);

  // ---- Modal focus management ----
  const dialogRef = useRef<HTMLDivElement>(null);
  const questionsListRef = useRef<HTMLDivElement>(null);

  // 选项列表是否真的溢出 —— 决定它那条 16px 滚动条列要不要让出来
  // （见 ConfirmationDialog.css 的 .question-item.is-list-scrollable）。
  // 纯 CSS 表达不了「按需预留」：scrollbar-gutter 恒留会让不滚的短题目右缘
  // 空出 16px，不预留则题头 / 进度条比卡片窄 16px。设计师要求两者右缘对齐
  // （0923 评论），所以这里量一次 scrollHeight。
  const [questionsListScrollable, setQuestionsListScrollable] = useState(false);

  const measureQuestionsList = useCallback(() => {
    const el = questionsListRef.current;
    if (!el) return;
    setQuestionsListScrollable(el.scrollHeight > el.clientHeight);
  }, []);

  // 每次渲染后量一次：切题、选中态变化、其他输入框长高都会改内容高度。
  // 值没变时 React 会忽略这次 setState，不会多渲染一轮。
  useLayoutEffect(measureQuestionsList);

  // 只改盒子（窗口 / 面板宽度）不改内容的场景不触发渲染，另挂观察者补量。
  useEffect(() => {
    const el = questionsListRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measureQuestionsList);
    observer.observe(el);
    return () => observer.disconnect();
  }, [confirmation.toolName, measureQuestionsList]);

  // ---- 选项区折叠（仅 AskUserQuestion，见 ask-user-tool.md「提问弹窗选项区可折叠」）----
  // 收起的是选项交互区：题干 chip、进度条与底部三按钮留在原位，作答前必须展开。
  // 折叠态随本组件实例生灭——ChatApp 用 confirmationId 作 key 重挂载，队列里的
  // 下一个确认因此自动回到展开态。
  const [optionsCollapsed, setOptionsCollapsed] = useState(false);
  // display:none 会丢掉列表的滚动位置（浏览器不保留被折叠元素的滚动状态），
  // 折叠时记下、展开后回填（场景 3「折叠前选项区的滚动位置不丢失」）。预览面板
  // 与选项列各滚各的，两栏位置都要留（ask-user-tool.md 边界「两栏滚动位置保持」）。
  const optionsScrollTopRef = useRef(0);
  const previewScrollTopRef = useRef(0);
  const previewRef = useRef<HTMLDivElement>(null);

  const toggleOptionsCollapsed = useCallback(() => {
    if (!optionsCollapsed) {
      const el = questionsListRef.current;
      if (el) optionsScrollTopRef.current = el.scrollTop;
      const previewEl = previewRef.current;
      if (previewEl) previewScrollTopRef.current = previewEl.scrollTop;
    }
    setOptionsCollapsed((prev) => !prev);
  }, [optionsCollapsed]);

  useLayoutEffect(() => {
    if (optionsCollapsed) return;
    const el = questionsListRef.current;
    if (el) el.scrollTop = optionsScrollTopRef.current;
    const previewEl = previewRef.current;
    if (previewEl) previewEl.scrollTop = previewScrollTopRef.current;
  }, [optionsCollapsed]);

  // The element focused before the dialog took focus; restored on dismiss.
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Which option to focus when the dialog opens or the question switches:
  // the currently selected option (or "Other" when it is selected), else the
  // first one. options.length addresses the "Other" item.
  const getDefaultOptionFocus = useCallback(
    (q: AskUserQuestionInput["questions"][number]): number => {
      const answer = answers[q.question];
      if (q.multiSelect) return 0;
      if (answer === "__other__") return q.options.length;
      if (typeof answer === "string") {
        const idx = q.options.findIndex((o) => o.label === answer);
        if (idx >= 0) return idx;
      }
      return 0;
    },
    [answers],
  );

  const restoreFocus = useCallback(() => {
    // 关闭的这一刻输入区还是隐藏的（有待确认弹窗时整块 `display:none`，见
    // ChatApp 的 `input-area-container`），此刻 `focus()` 会被浏览器直接忽略
    // ——真机上焦点就停在 <body> 上再也回不来。等 React 把弹窗摘掉、输入区
    // 重新可见之后再还焦点（spec「确认弹窗焦点圈」场景 4）。
    requestAnimationFrame(() => {
      // 队列里紧接着又来了一个确认：焦点归新弹窗管，不去抢。
      if (dialogRef.current) return;
      const prev = previousFocusRef.current;
      if (prev && document.contains(prev)) {
        prev.focus();
        return;
      }
      document
        .querySelector<HTMLElement>(
          '[data-testid="message-input"], .message-input textarea',
        )
        ?.focus();
    });
  }, []);

  // On mount / when a new confirmation replaces the current one: remember the
  // previously focused element so it can be restored on dismiss. Focus is
  // deliberately NOT moved into the dialog — it may pop up while the user is
  // typing (same pane, a sibling pane, or another window) and must not
  // interrupt (spec「确认弹窗焦点圈」场景 1：焦点保持原位). Keyboard users
  // reach it with Tab — the focus trap pulls the first Tab into the dialog —
  // or with a click.
  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  }, [confirmation.confirmationId]);

  const handleReject = useCallback(() => {
    restoreFocus();
    if (confirmation.toolName === ENTER_PLAN_MODE_TOOL_NAME) {
      onConfirm(confirmation.confirmationId, {
        behavior: "deny",
        message: "不，现在开始实现",
      });
    } else {
      onReject(confirmation.confirmationId);
    }
  }, [
    restoreFocus,
    onReject,
    onConfirm,
    confirmation.confirmationId,
    confirmation.toolName,
  ]);

  const handleOptionChange = useCallback(
    (
      questionText: string,
      optionLabel: string,
      multiSelect: boolean,
      isChecked: boolean,
    ) => {
      setAnswers((prev) => {
        const current = prev[questionText];
        if (multiSelect) {
          const currentArray = Array.isArray(current)
            ? (current as string[])
            : [];
          const exists = currentArray.includes(optionLabel);
          if (isChecked && !exists) {
            return { ...prev, [questionText]: [...currentArray, optionLabel] };
          } else if (!isChecked && exists) {
            return {
              ...prev,
              [questionText]: currentArray.filter((o) => o !== optionLabel),
            };
          }
          return prev;
        } else {
          if (prev[questionText] === optionLabel) return prev;
          return { ...prev, [questionText]: optionLabel };
        }
      });
    },
    [],
  );

  const handleOtherInputChange = useCallback(
    (questionText: string, value: string) => {
      setOtherInputs((prev) => ({ ...prev, [questionText]: value }));
    },
    [],
  );

  // Auto-focus the "Other" textarea when the user selects "Other" (keyboard
  // Space or mouse click). Only focus on an explicit unselected → selected
  // transition, never when navigating between questions.
  //
  // Auto-growing is purely CSS (`field-sizing: content` on .other-text-input),
  // so this ref does nothing but hand the node to the focus effect. A plain ref
  // object is stable across renders — an inline callback ref would get a new
  // identity every render and make React detach/re-attach the node each time.
  const otherInputRef = useRef<HTMLTextAreaElement | null>(null);
  const wasOtherSelectedRef = useRef(false);
  const prevQuestionIndexRef = useRef(currentQuestionIndex);

  useEffect(() => {
    const questions = (
      confirmation.toolInput as unknown as AskUserQuestionInput
    )?.questions;
    const q = questions?.[currentQuestionIndex];
    if (!q) {
      wasOtherSelectedRef.current = false;
      return;
    }
    const isOtherChecked = q.multiSelect
      ? !!otherSelected[q.question]
      : answers[q.question] === "__other__";

    if (prevQuestionIndexRef.current !== currentQuestionIndex) {
      // Question switched: record the new question's state and move focus to
      // its first option (or the currently selected one) so the user can keep
      // answering with the keyboard. (The nav button they just used becomes
      // disabled on the unanswered next question; leaving focus on it would
      // drop to body as browsers remove focus from a disabled element.)
      prevQuestionIndexRef.current = currentQuestionIndex;
      wasOtherSelectedRef.current = isOtherChecked;
      const focusIndex = getDefaultOptionFocus(q);
      setPreviewFocusIndex(focusIndex);
      questionsListRef.current
        ?.querySelector<HTMLElement>(
          `[data-option-index="${
            focusIndex === q.options.length ? "other" : focusIndex
          }"]`,
        )
        ?.focus();
      return;
    }

    if (isOtherChecked && !wasOtherSelectedRef.current) {
      otherInputRef.current?.focus();
    }
    wasOtherSelectedRef.current = isOtherChecked;
  }, [
    currentQuestionIndex,
    answers,
    otherSelected,
    confirmation.toolInput,
    getDefaultOptionFocus,
  ]);

  const handleCompositionStart = useCallback(() => {
    setIsComposing(true);
  }, []);

  const handleCompositionEnd = useCallback(() => {
    setIsComposing(false);
  }, []);

  useEffect(() => {
    // Add keyboard listener for confirmation dialog
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleReject();
        return;
      }

      // Carousel navigation: ← / → cycle questions (AskUserQuestion with more
      // than one question). Option labels and the "Other" textarea stop their
      // own keys (the textarea stopPropagation's text-editing keys), so an
      // arrow pressed while browsing questions rotates the carousel; when the
      // focus is in the textarea the key never reaches here.
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (confirmation.toolName === ASK_USER_QUESTION_TOOL_NAME) {
          const questions = (
            confirmation.toolInput as unknown as AskUserQuestionInput
          )?.questions;
          if (questions && questions.length > 1) {
            e.preventDefault();
            setCurrentQuestionIndex((prev) =>
              e.key === "ArrowRight"
                ? prev >= questions.length - 1
                  ? 0
                  : prev + 1
                : prev <= 0
                  ? questions.length - 1
                  : prev - 1,
            );
            return;
          }
        }
      }

      // Modal focus trap: Tab/Shift+Tab cycle within the dialog so focus never
      // leaks into the message list / input behind it. When focus is somehow
      // outside the dialog (e.g. a queued confirmation replaced the current
      // one), the next Tab pulls it back in.
      if (e.key === "Tab") {
        const dialog = dialogRef.current;
        if (dialog) {
          const focusables = getDialogFocusables(dialog);
          if (focusables.length > 0) {
            const active = document.activeElement;
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (e.shiftKey) {
              if (active === first || !dialog.contains(active)) {
                e.preventDefault();
                last.focus();
              }
            } else if (active === last || !dialog.contains(active)) {
              e.preventDefault();
              first.focus();
            }
          }
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleReject, confirmation.toolName, confirmation.toolInput]);

  const handleConfirm = useCallback(() => {
    restoreFocus();
    if (confirmation.toolName === ENTER_PLAN_MODE_TOOL_NAME) {
      onConfirm(confirmation.confirmationId, {
        behavior: "allow",
        newPermissionMode: "plan",
      });
    } else if (
      confirmation.toolName === EXIT_PLAN_MODE_TOOL_NAME ||
      isShellToolName(confirmation.toolName) ||
      [EDIT_TOOL_NAME, WRITE_TOOL_NAME].includes(confirmation.toolName)
    ) {
      if (showFeedbackInput) {
        onConfirm(confirmation.confirmationId, {
          behavior: "deny",
          message: feedback,
        });
      } else {
        onConfirm(confirmation.confirmationId, {
          behavior: "allow",
          newPermissionMode:
            confirmation.toolName === EXIT_PLAN_MODE_TOOL_NAME
              ? "default"
              : undefined,
        });
      }
    } else if (confirmation.toolName.startsWith("mcp__")) {
      if (showFeedbackInput) {
        onConfirm(confirmation.confirmationId, {
          behavior: "deny",
          message: feedback,
        });
      } else {
        onConfirm(confirmation.confirmationId, {
          behavior: "allow",
        });
      }
    } else if (confirmation.toolName === ASK_USER_QUESTION_TOOL_NAME) {
      // Combine selected options and "Other" inputs
      const finalAnswers: Record<string, string | string[]> = { ...answers };
      const annotations: Record<string, { preview?: string; notes?: string }> =
        {};
      const questions = (
        confirmation.toolInput as unknown as AskUserQuestionInput
      ).questions;

      questions.forEach((q) => {
        const qKey = q.question;
        const otherVal = otherInputs[qKey];

        if (q.multiSelect) {
          const current = (finalAnswers[qKey] as string[]) || [];
          if (
            otherSelected[qKey] &&
            otherVal &&
            otherVal.trim() &&
            !current.includes(otherVal)
          ) {
            finalAnswers[qKey] = [...current, otherVal];
          }
          // 一个都没勾 = 没答：整条省略，别把空数组当答案交给模型。
          const merged = (finalAnswers[qKey] as string[]) || [];
          if (merged.length === 0) delete finalAnswers[qKey];
        } else if (finalAnswers[qKey] === "__other__") {
          // 「其他」被选中却一个字都没填 = 没答：整个 key 删掉（不是写空串），
          // 模型才分得清「没选」与「没答」（ask-user-tool.md「多问题循环轮播」
          // 场景 8）。
          if (otherVal && otherVal.trim()) {
            finalAnswers[qKey] = otherVal;
          } else {
            delete finalAnswers[qKey];
          }
        }

        // 预览态：把选中项的预览全文与备注随答案一起回传，模型拿到的不是一个
        // 光秃秃的标签（ask-user-tool.md「选项预览与备注」场景 9 / 10）。空预览 /
        // 空备注不进 annotations，避免给模型塞无内容的骨架。
        if (!questionHasPreview(q)) return;
        const notes = (notesInputs[qKey] || "").trim();
        const answer = finalAnswers[qKey];
        const label = typeof answer === "string" ? answer : "";
        const selected = q.options.find((o) => o.label === label);
        // 备注本身就是一种有效答案：没选选项、只写了备注时答案位置写哨兵值，
        // 备注进 annotations。
        if (!selected && !label && notes) {
          finalAnswers[qKey] = NOTES_ONLY_ANSWER;
          annotations[qKey] = { notes };
          return;
        }
        const preview = selected ? optionPreview(selected) : "";
        if (preview.trim() || notes) {
          annotations[qKey] = {
            ...(preview.trim() ? { preview } : {}),
            ...(notes ? { notes } : {}),
          };
        }
      });

      onConfirm(confirmation.confirmationId, {
        behavior: "allow",
        message: JSON.stringify({
          answers: finalAnswers,
          ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
        }),
      });
    } else {
      onConfirm(confirmation.confirmationId);
    }
  }, [
    confirmation,
    onConfirm,
    showFeedbackInput,
    feedback,
    answers,
    otherInputs,
    otherSelected,
    notesInputs,
    restoreFocus,
  ]);

  const handleAutoConfirm = useCallback(() => {
    restoreFocus();
    let decision: unknown;
    if (isShellToolName(confirmation.toolName)) {
      const rule = confirmation.suggestedPrefix
        ? `${confirmation.toolName}(${confirmation.suggestedPrefix})`
        : `${confirmation.toolName}(${confirmation.toolInput?.command})`;
      decision = {
        behavior: "allow",
        newPermissionRule: rule,
      };
    } else if (confirmation.toolName === EXIT_PLAN_MODE_TOOL_NAME) {
      decision = {
        behavior: "allow",
        newPermissionMode: "acceptEdits",
      };
    } else if (confirmation.toolName.startsWith("mcp__")) {
      decision = {
        behavior: "allow",
        newPermissionRule: confirmation.toolName,
      };
    } else {
      decision = {
        behavior: "allow",
        newPermissionMode: "acceptEdits",
      };
    }
    onConfirm(confirmation.confirmationId, decision as ConfirmationDecision);
  }, [confirmation, onConfirm, restoreFocus]);

  const handleBypassConfirm = useCallback(() => {
    restoreFocus();
    onConfirm(confirmation.confirmationId, {
      behavior: "allow",
      newPermissionMode: "bypassPermissions",
    });
  }, [onConfirm, confirmation.confirmationId, restoreFocus]);

  // Approve this operation and add the out-of-Safe-Zone target directory to the
  // session Safe Zone — in-memory only (the user can persist it via /add-dir
  // --remember). The SDK also registers session-level Edit/Write rules for that
  // directory, so later edits there are not prompted again. Only offered when
  // the host reports such a directory.
  const handleAddDirConfirm = useCallback(() => {
    restoreFocus();
    onConfirm(confirmation.confirmationId, {
      behavior: "allow",
      newAdditionalDirectory: confirmation.outsideSafeZoneDirectory,
    });
  }, [
    confirmation.confirmationId,
    confirmation.outsideSafeZoneDirectory,
    onConfirm,
    restoreFocus,
  ]);

  const getAutoOptionText = () => {
    if (isShellToolName(confirmation.toolName)) {
      if (confirmation.suggestedPrefix) {
        return `是，且不再询问：${confirmation.suggestedPrefix}`;
      }
      return "是，且在此工作目录下不再询问此命令";
    }
    if (confirmation.toolName === EXIT_PLAN_MODE_TOOL_NAME) {
      return "批准并自动接受后续修改";
    }
    if (confirmation.toolName.startsWith("mcp__")) {
      return `是，且不再询问：${confirmation.toolName}`;
    }
    return "是，且自动接受修改";
  };

  /**
   * The plan full text, rendered inside the dialog.
   *
   * Which host that happens on is decided upstream, not here: every host with an
   * editor column or a pane routes the plan there and strips it from the dialog
   * (`ChatApp` `showConfirmation`), while the remote-control Web page keeps it —
   * a phone has neither, and the plan is the only basis for approving it
   * (spec `core/plan-mode.md` 场景 13 / `remote/remote-web.md` 场景 19). So this
   * renders whenever a plan arrived, and the strip is the single policy point.
   */
  const renderPlanContent = () => {
    const planContent = confirmation.planContent;
    if (
      confirmation.toolName !== EXIT_PLAN_MODE_TOOL_NAME ||
      typeof planContent !== "string" ||
      planContent.trim() === ""
    ) {
      return null;
    }

    return (
      <div className="plan-content-preview" data-testid="plan-content-preview">
        <h3>计划内容：</h3>
        <div
          className="markdown-content"
          // Sanitised in renderMarkdownHtml (DOMPurify allowlist shared with
          // option previews).
          dangerouslySetInnerHTML={{ __html: renderMarkdownHtml(planContent) }}
        />
      </div>
    );
  };

  const renderQuestions = () => {
    if (
      confirmation.toolName !== ASK_USER_QUESTION_TOOL_NAME ||
      !confirmation.toolInput?.questions
    ) {
      return null;
    }

    const questions = (
      confirmation.toolInput as unknown as AskUserQuestionInput
    ).questions;
    const q = questions[currentQuestionIndex];
    if (!q) return null;

    // 预览态：单选 + 至少一个选项带非空白 preview。多选题目一律忽略 preview
    // （ask-user-tool.md「选项预览与备注」场景 1）。
    const isPreviewQuestion = questionHasPreview(q);
    // 预览跟焦点走 —— 用户还没选定就要能来回比较（场景 6）。
    const activePreview = isPreviewQuestion
      ? optionPreview(q.options[previewFocusIndex] ?? q.options[0])
      : "";
    // 面板高度上限按整题最长预览算（同一题内换选项不高不矮），见 previewPanelLines。
    const previewLines = isPreviewQuestion ? previewPanelLines(q) : 0;

    return (
      <div className="ask-user-questions">
        <div
          className={`question-item${
            questionsListScrollable ? " is-list-scrollable" : ""
          }`}
        >
          {questions.length > 1 && (
            <div
              className="question-progress-bar"
              data-testid="question-progress-bar"
              aria-label={`共 ${questions.length} 个问题`}
            >
              {questions.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  tabIndex={-1}
                  className={`question-progress-seg ${
                    isQuestionAnswered(i) ? "done" : "todo"
                  }`}
                  aria-label={`定位到第 ${i + 1} 题`}
                  title={`第 ${i + 1} 题`}
                  onClick={() => setCurrentQuestionIndex(i)}
                />
              ))}
            </div>
          )}
          <div className="question-header-row">
            {/* key 让换题时换节点：题干是滚动容器，复用节点会把上一题的滚动
                位置带到新题目上（ask-user-tool.md「题干超长时在题干区域内滚动」
                场景 4）。 */}
            <span key={currentQuestionIndex} className="question-header-chip">
              {q.question}
            </span>
          </div>
          <div
            className={`question-body${isPreviewQuestion ? " is-preview" : ""}`}
          >
            <div className="options-list" ref={questionsListRef}>
              {q.options.map((opt, oIndex) => (
                <label
                  key={oIndex}
                  data-option-index={oIndex}
                  className={`option-item ${
                    (
                      q.multiSelect
                        ? ((answers[q.question] as string[]) || []).includes(
                            opt.label,
                          )
                        : answers[q.question] === opt.label
                    )
                      ? "selected"
                      : ""
                  }`}
                  tabIndex={optionsCollapsed ? -1 : 0}
                  // 焦点或**悬停**决定右侧预览显示哪一个（对齐 CC 桌面端：它的
                  // onFocus 与 onMouseEnter 是同一个处理函数；鼠标移出只清悬停态，
                  // 不改预览）。两者都不改选中状态。
                  onFocus={
                    isPreviewQuestion
                      ? () => setPreviewFocusIndex(oIndex)
                      : undefined
                  }
                  onMouseEnter={
                    isPreviewQuestion
                      ? () => setPreviewFocusIndex(oIndex)
                      : undefined
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      // Enter 与「提交回答」等价（按钮恒可点，未答完也提交，
                      // 未答的题整条省略），但不改变选中状态（不把 Enter 当作
                      // 选中键）。
                      e.preventDefault();
                      if (!isConfirmDisabled()) {
                        handleConfirm();
                      }
                    } else if (e.key === " ") {
                      e.preventDefault();
                      handleOptionChange(
                        q.question,
                        opt.label,
                        !!q.multiSelect,
                        q.multiSelect
                          ? !((answers[q.question] as string[]) || []).includes(
                              opt.label,
                            )
                          : true,
                      );
                    }
                  }}
                >
                  <input
                    type={q.multiSelect ? "checkbox" : "radio"}
                    name={`question-${currentQuestionIndex}`}
                    className="option-input-hidden"
                    tabIndex={-1}
                    checked={
                      q.multiSelect
                        ? ((answers[q.question] as string[]) || []).includes(
                            opt.label,
                          )
                        : answers[q.question] === opt.label
                    }
                    onChange={(e) =>
                      handleOptionChange(
                        q.question,
                        opt.label,
                        !!q.multiSelect,
                        e.target.checked,
                      )
                    }
                  />
                  <div className="option-row">
                    <div className="option-indicator">
                      <OptionIndicator
                        multiSelect={!!q.multiSelect}
                        checked={
                          q.multiSelect
                            ? (
                                (answers[q.question] as string[]) || []
                              ).includes(opt.label)
                            : answers[q.question] === opt.label
                        }
                      />
                    </div>
                    <div className="option-label">{opt.label}</div>
                  </div>
                  {opt.description && (
                    <div className="option-description">{opt.description}</div>
                  )}
                </label>
              ))}
              {!isPreviewQuestion &&
                (() => {
                  const isOtherChecked = q.multiSelect
                    ? !!otherSelected[q.question]
                    : answers[q.question] === "__other__";
                  return (
                    <label
                      data-option-index="other"
                      className={`option-item other-option ${
                        isOtherChecked ? "selected" : ""
                      }`}
                      tabIndex={optionsCollapsed ? -1 : 0}
                      onKeyDown={(e) => {
                        // The Other textarea stopPropagation's its own keys, so
                        // keydown here always originates from the label itself.
                        if (e.key === "Enter") {
                          // Enter 与「提交回答」等价（与普通选项一致，未答完也
                          // 提交），不负责选中「其他」。
                          e.preventDefault();
                          if (!isConfirmDisabled()) {
                            handleConfirm();
                          }
                        } else if (e.key === " ") {
                          e.preventDefault();
                          if (q.multiSelect) {
                            setOtherSelected((prev) => ({
                              ...prev,
                              [q.question]: !prev[q.question],
                            }));
                          } else {
                            setAnswers((prev) => ({
                              ...prev,
                              [q.question]: "__other__",
                            }));
                          }
                        }
                      }}
                    >
                      <input
                        type={q.multiSelect ? "checkbox" : "radio"}
                        name={`question-${currentQuestionIndex}`}
                        className="option-input-hidden"
                        tabIndex={-1}
                        checked={isOtherChecked}
                        onChange={(e) => {
                          if (q.multiSelect) {
                            setOtherSelected((prev) => ({
                              ...prev,
                              [q.question]: e.target.checked,
                            }));
                          } else {
                            setAnswers((prev) => ({
                              ...prev,
                              [q.question]: "__other__",
                            }));
                          }
                        }}
                      />
                      <div className="option-row">
                        <div className="option-indicator">
                          <OptionIndicator
                            multiSelect={!!q.multiSelect}
                            checked={isOtherChecked}
                          />
                        </div>
                        <div className="option-label">其他</div>
                      </div>
                      {isOtherChecked ? (
                        <div className="option-other-body">
                          <textarea
                            className="other-text-input"
                            placeholder="输入自定义回答..."
                            value={otherInputs[q.question] || ""}
                            ref={otherInputRef}
                            onChange={(e) => {
                              handleOtherInputChange(
                                q.question,
                                e.target.value,
                              );
                            }}
                            onKeyDown={(e) => {
                              // Inside the textarea every key is text editing;
                              // keep it from reaching dialog-level shortcuts
                              // (matches Claude's IDE/desktop AskUserQuestion).
                              if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
                              if (e.key === "Enter" && !e.shiftKey) {
                                if (e.nativeEvent.isComposing) return;
                                e.preventDefault();
                                // Enter 与「提交回答」等价：未答的题不阻塞提交
                                // （整条省略），它也从不让输入框跳到下一题（见
                                //「多问题循环轮播」spec）。
                                const applyBtn =
                                  dialogRef.current?.querySelector<HTMLButtonElement>(
                                    ".confirmation-btn-apply",
                                  );
                                if (applyBtn && !applyBtn.disabled) {
                                  applyBtn.click();
                                }
                              }
                            }}
                            onCompositionStart={handleCompositionStart}
                            onCompositionEnd={handleCompositionEnd}
                          />
                        </div>
                      ) : (
                        <div className="option-description">
                          输入自定义回答...
                        </div>
                      )}
                    </label>
                  );
                })()}
            </div>
            {isPreviewQuestion && (
              <div
                className="option-preview"
                role="region"
                aria-label="选项预览"
                data-testid="option-preview"
                ref={previewRef}
                style={
                  {
                    "--preview-lines": previewLines,
                  } as React.CSSProperties
                }
              >
                {activePreview.trim() ? (
                  <div
                    className="markdown-content option-preview-body"
                    // 预览是模型写的 markdown，按文本渲染（白名单同计划正文），
                    // 不执行其中任何内容、也不让它改写弹窗自身样式。
                    dangerouslySetInnerHTML={{
                      __html: renderMarkdownHtml(activePreview),
                    }}
                  />
                ) : (
                  <div className="option-preview-empty">这个选项没有预览</div>
                )}
              </div>
            )}
          </div>
          {isPreviewQuestion && (
            <div className="option-notes">
              <div className="option-notes-label">备注</div>
              <textarea
                className="other-text-input"
                placeholder="可选，补充说明..."
                aria-label="备注"
                value={notesInputs[q.question] || ""}
                onChange={(e) =>
                  setNotesInputs((prev) => ({
                    ...prev,
                    [q.question]: e.target.value,
                  }))
                }
                onKeyDown={(e) => {
                  // 与「其他」输入框同一套按键语义：内部按键不冒泡到弹窗级
                  // 快捷键，Enter 与「提交回答」等价（未答的题不阻塞提交）。
                  if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
                  if (e.key === "Enter" && !e.shiftKey) {
                    if (e.nativeEvent.isComposing) return;
                    e.preventDefault();
                    const applyBtn =
                      dialogRef.current?.querySelector<HTMLButtonElement>(
                        ".confirmation-btn-apply",
                      );
                    if (applyBtn && !applyBtn.disabled) {
                      applyBtn.click();
                    }
                  }
                }}
              />
            </div>
          )}
        </div>
      </div>
    );
  };

  // Bottom action bar for AskUserQuestion: a fixed three-button carousel
  // ([上一个] [下一个] [提交回答]) when multiple questions, submit-only for a
  // single question. DOM order matches the visual left-to-right order, so
  // the Tab cycle runs 上一个 → 下一个 → 提交回答 with the primary action
  // last (aligned with Claude's confirm UIs).
  const renderQuestionNavigation = () => {
    if (confirmation.toolName !== ASK_USER_QUESTION_TOOL_NAME) return null;
    const questions = (
      confirmation.toolInput as unknown as AskUserQuestionInput
    ).questions;
    if (!questions || questions.length === 0) return null;
    const multi = questions.length > 1;
    // 未答不再禁用主按钮，改由按钮旁这行提示表达（场景 7）。
    const unanswered = unansweredCount();
    return (
      <div className="question-navigation">
        {multi && (
          <button
            type="button"
            className="confirmation-btn confirmation-btn-secondary"
            aria-label="上一个"
            onClick={() =>
              setCurrentQuestionIndex((prev) =>
                prev <= 0 ? questions.length - 1 : prev - 1,
              )
            }
          >
            <span className="btn-text">上一个</span>
          </button>
        )}
        {multi && (
          <button
            type="button"
            className="confirmation-btn confirmation-btn-secondary"
            aria-label="下一个"
            onClick={() =>
              setCurrentQuestionIndex((prev) =>
                prev >= questions.length - 1 ? 0 : prev + 1,
              )
            }
          >
            <span className="btn-text">下一个</span>
          </button>
        )}
        <button
          type="button"
          className="confirmation-btn confirmation-btn-apply"
          onClick={handleConfirm}
          disabled={isConfirmDisabled()}
        >
          <span className="btn-text">
            提交回答
            <span className="btn-enter-hint">⏎</span>
          </span>
        </button>
        {/* 排在按钮簇之后：三按钮保持等宽相邻，提示只是贴在主按钮右侧的旁注
            （不可聚焦，不影响 Tab 顺序）。 */}
        {unanswered > 0 && (
          <span
            className="question-navigation-hint"
            data-testid="question-navigation-hint"
          >
            还有 {unanswered} 题未答
          </span>
        )}
      </div>
    );
  };

  const isQuestionAnswered = useCallback(
    (index: number): boolean => {
      if (confirmation.toolName !== ASK_USER_QUESTION_TOOL_NAME) return true;
      const questions = (
        confirmation.toolInput as unknown as AskUserQuestionInput
      ).questions;
      const q = questions[index];
      if (!q) return true;
      const answer = answers[q.question];
      const other = otherInputs[q.question];
      if (q.multiSelect) {
        return (
          (Array.isArray(answer) && answer.length > 0) ||
          (otherSelected[q.question] && !!other && !!other.trim())
        );
      }
      // 预览态下备注也是一份有效答案：只写备注、没选选项同样算答过
      // （ask-user-tool.md「选项预览与备注」场景 9）。
      if (questionHasPreview(q) && !!notesInputs[q.question]?.trim()) {
        return true;
      }
      return (
        !!(answer && answer !== "__other__") ||
        (answer === "__other__" && !!other && !!other.trim())
      );
    },
    [confirmation, answers, otherInputs, otherSelected, notesInputs],
  );

  /** 未答题数：底部「还有 N 题未答」提示用，口径与进度条 / 提交完全一致。 */
  const unansweredCount = useCallback((): number => {
    if (confirmation.toolName !== ASK_USER_QUESTION_TOOL_NAME) return 0;
    const questions = (
      confirmation.toolInput as unknown as AskUserQuestionInput
    ).questions;
    return questions.filter((_, i) => !isQuestionAnswered(i)).length;
  }, [confirmation, isQuestionAnswered]);

  const isConfirmDisabled = useCallback(() => {
    // 提问卡不再因未答而禁用提交：未答只给「还有 N 题未答」提示，提交时把
    // 未答的题整条省略（ask-user-tool.md「多问题循环轮播」场景 7 / 8，与 CLI
    // 「未答不阻塞回车提交」同一语义）。
    if (confirmation.toolName === ASK_USER_QUESTION_TOOL_NAME) return false;
    const isPlanModeTool =
      confirmation.toolName === EXIT_PLAN_MODE_TOOL_NAME ||
      confirmation.toolName === ENTER_PLAN_MODE_TOOL_NAME;
    if (
      (isPlanModeTool ||
        isShellToolName(confirmation.toolName) ||
        [EDIT_TOOL_NAME, WRITE_TOOL_NAME].includes(confirmation.toolName) ||
        confirmation.toolName.startsWith("mcp__")) &&
      showFeedbackInput
    ) {
      return !feedback.trim();
    }
    return false;
  }, [confirmation, showFeedbackInput, feedback]);

  return (
    <div
      ref={dialogRef}
      className={`confirmation-dialog${
        optionsCollapsed ? " is-options-collapsed" : ""
      }`}
      tabIndex={-1}
    >
      {/* is-ask-user：问句卡不限高（高度跟内容走），其余确认类型保留
          min(70vh, 560px) 封顶 —— 见 ConfirmationDialog.css。 */}
      <div
        className={`confirmation-dialog-inner${
          confirmation.toolName === ASK_USER_QUESTION_TOOL_NAME
            ? " is-ask-user"
            : ""
        }`}
      >
        <div className="confirmation-body">
          <div className="confirmation-header">
            <div className="confirmation-header-top">
              <div className="confirmation-title">
                {confirmation.confirmationType}
              </div>
            </div>
            {isShellToolName(confirmation.toolName) &&
              !!confirmation.toolInput?.command && (
                <div className="confirmation-command">
                  {String(confirmation.toolInput.command)}
                </div>
              )}
            {confirmation.toolName.startsWith("mcp__") &&
              confirmation.toolInput && (
                <div className="confirmation-mcp-params">
                  <pre>{JSON.stringify(confirmation.toolInput, null, 2)}</pre>
                </div>
              )}
            {[WRITE_TOOL_NAME, EDIT_TOOL_NAME].includes(
              confirmation.toolName,
            ) &&
              !!confirmation.toolInput?.file_path && (
                <div className="confirmation-file-path">
                  <strong>文件:</strong>{" "}
                  {String(confirmation.toolInput.file_path)}
                </div>
              )}
            {confirmation.warning && (
              <div className="confirmation-warning">
                ⚠ {confirmation.warning}
              </div>
            )}
          </div>

          {renderPlanContent()}

          {renderQuestions()}

          {[WRITE_TOOL_NAME, EDIT_TOOL_NAME].includes(
            confirmation.toolName,
          ) && (
            <div className="confirmation-diff-viewer">
              <DiffViewer
                toolName={confirmation.toolName}
                parameters={confirmation.toolInput}
              />
            </div>
          )}
        </div>

        {renderQuestionNavigation()}

        {confirmation.toolName !== ASK_USER_QUESTION_TOOL_NAME && (
          <div className="confirmation-actions">
            {!showFeedbackInput ? (
              <>
                {(confirmation.toolName === EXIT_PLAN_MODE_TOOL_NAME ||
                  isShellToolName(confirmation.toolName) ||
                  [EDIT_TOOL_NAME, WRITE_TOOL_NAME].includes(
                    confirmation.toolName,
                  ) ||
                  confirmation.toolName.startsWith("mcp__")) && (
                  <button
                    className="confirmation-btn confirmation-btn-feedback"
                    onClick={() => setShowFeedbackInput(true)}
                  >
                    <span className="btn-text">提供反馈</span>
                  </button>
                )}

                {(confirmation.toolName === EXIT_PLAN_MODE_TOOL_NAME ||
                  (isShellToolName(confirmation.toolName) &&
                    confirmation.permissionMode !== "plan")) && (
                  <button
                    className="confirmation-btn confirmation-btn-auto"
                    onClick={handleBypassConfirm}
                  >
                    <span className="btn-text">是，并跳过权限确认</span>
                  </button>
                )}

                {[EDIT_TOOL_NAME, WRITE_TOOL_NAME].includes(
                  confirmation.toolName,
                ) &&
                  !!confirmation.outsideSafeZoneDirectory && (
                    <button
                      className="confirmation-btn confirmation-btn-auto"
                      onClick={handleAddDirConfirm}
                    >
                      <span className="btn-text">
                        {`是，且允许本会话编辑 ${lastPathSegment(
                          confirmation.outsideSafeZoneDirectory,
                        )}/`}
                      </span>
                    </button>
                  )}

                {confirmation.toolName !== ASK_USER_QUESTION_TOOL_NAME &&
                  confirmation.toolName !== EXIT_PLAN_MODE_TOOL_NAME &&
                  confirmation.toolName !== ENTER_PLAN_MODE_TOOL_NAME &&
                  !showFeedbackInput &&
                  !confirmation.hidePersistentOption && (
                    <button
                      className="confirmation-btn confirmation-btn-auto"
                      onClick={handleAutoConfirm}
                    >
                      <span className="btn-text">{getAutoOptionText()}</span>
                    </button>
                  )}

                {confirmation.toolName === EXIT_PLAN_MODE_TOOL_NAME && (
                  <button
                    className="confirmation-btn confirmation-btn-auto"
                    onClick={handleAutoConfirm}
                  >
                    <span className="btn-text">批准并自动接受后续修改</span>
                  </button>
                )}

                {confirmation.toolName === ENTER_PLAN_MODE_TOOL_NAME && (
                  <button
                    className="confirmation-btn confirmation-btn-reject"
                    onClick={handleReject}
                  >
                    <span className="btn-text">不，现在开始实现</span>
                  </button>
                )}

                <button
                  className="confirmation-btn confirmation-btn-apply"
                  onClick={handleConfirm}
                  disabled={isConfirmDisabled()}
                >
                  <span className="btn-text">
                    {confirmation.toolName === EXIT_PLAN_MODE_TOOL_NAME ||
                    confirmation.toolName === ENTER_PLAN_MODE_TOOL_NAME ||
                    isShellToolName(confirmation.toolName) ||
                    [EDIT_TOOL_NAME, WRITE_TOOL_NAME].includes(
                      confirmation.toolName,
                    ) ||
                    confirmation.toolName.startsWith("mcp__")
                      ? "批准并继续"
                      : "是"}
                  </span>
                </button>
              </>
            ) : (
              <div className="feedback-flow">
                <input
                  type="text"
                  className="feedback-textarea"
                  placeholder="输入您的反馈或修改建议..."
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !isComposing) {
                      handleConfirm();
                    }
                  }}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  autoFocus
                />
                <div className="feedback-actions">
                  <button
                    className="confirmation-btn confirmation-btn-reject"
                    onClick={() => setShowFeedbackInput(false)}
                  >
                    取消
                  </button>
                  <button
                    className="confirmation-btn confirmation-btn-apply"
                    onClick={handleConfirm}
                    disabled={!feedback.trim()}
                  >
                    发送反馈
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="confirmation-header-actions">
          {confirmation.toolName === ASK_USER_QUESTION_TOOL_NAME && (
            <button
              type="button"
              className="confirmation-collapse-btn"
              data-testid="confirmation-collapse-toggle"
              onClick={toggleOptionsCollapsed}
              aria-expanded={!optionsCollapsed}
              aria-label={optionsCollapsed ? "展开选项" : "折叠选项"}
              title={optionsCollapsed ? "展开选项" : "折叠选项"}
            >
              <QueueChevronIcon
                className={`confirmation-collapse-chevron${
                  optionsCollapsed ? "" : " expanded"
                }`}
              />
            </button>
          )}
          <button
            type="button"
            className="confirmation-close-btn"
            onClick={handleReject}
            aria-label="关闭"
            title="关闭"
          >
            {/* 桌面端与 pane 头部关闭同一官方矢量（用户 0916：「toast 关闭 /
                确认弹层关闭应该是和 pane 头部关闭用同一个图标」）；插件端
                保持原 CloseIcon 不变 */}
            {isDesktopHost() ? (
              <ConversationCloseIcon className="confirmation-close-btn-icon" />
            ) : (
              <CloseIcon className="confirmation-close-btn-icon" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// Memoized: ChatApp re-renders on every state update (host messages, streaming
// chunks, toasts); the dialog has no reason to re-render unless its own
// confirmation changes. Its props (confirmation object + the two useCallback
// handlers) are referentially stable across those updates.
export const ConfirmationDialog = React.memo(ConfirmationDialogImpl);
