import React, { useRef, useEffect, useState, useCallback } from "react";
import {
  ASK_USER_QUESTION_TOOL_NAME,
  BASH_TOOL_NAME,
  ENTER_PLAN_MODE_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  EDIT_TOOL_NAME,
  WRITE_TOOL_NAME,
} from "wave-agent-sdk/dist/constants/tools.js";
import { CloseIcon } from "./HeaderIcons";
import type {
  ConfirmationDialogProps,
  ConfirmationDecision,
  AskUserQuestionInput,
} from "../types";
import "../styles/ConfirmationDialog.css";
import { DiffViewer } from "./DiffViewer";

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

/**
 * Radio / Checkbox indicator that matches the Figma design (16×16).
 * - Radio unchecked: hollow ring; checked: accent ring + center dot.
 * - Checkbox unchecked: rounded square; checked: same square with a check mark.
 * Colors use VS Code theme variables so it adapts to light/dark themes.
 */
const OptionIndicator: React.FC<{ multiSelect: boolean; checked: boolean }> = ({
  multiSelect,
  checked,
}) => {
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

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
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
  const [feedback, setFeedback] = useState("");
  const [showFeedbackInput, setShowFeedbackInput] = useState(false);
  const [isComposing, setIsComposing] = useState(false);

  // ---- Modal focus management ----
  const dialogRef = useRef<HTMLDivElement>(null);
  const questionsListRef = useRef<HTMLDivElement>(null);
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
    const prev = previousFocusRef.current;
    if (prev && document.contains(prev) && !dialogRef.current?.contains(prev)) {
      prev.focus();
    } else {
      document
        .querySelector<HTMLElement>(
          'textarea[data-testid="message-input"], .message-input textarea',
        )
        ?.focus();
    }
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

  // Auto-grow the "other" textarea to fit its content (capped by CSS max-height).
  const autoGrow = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  // Size the textarea once when it mounts (e.g. when reopening with prior content).
  const autoGrowTextarea = useCallback(
    (el: HTMLTextAreaElement | null) => {
      if (el) autoGrow(el);
    },
    [autoGrow],
  );

  // Auto-focus the "Other" textarea when the user selects "Other" (keyboard
  // Space or mouse click). Only focus on an explicit unselected → selected
  // transition, never when navigating between questions.
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
      confirmation.toolName === BASH_TOOL_NAME ||
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
        } else if (finalAnswers[qKey] === "__other__") {
          finalAnswers[qKey] = otherVal || "";
        }
      });

      onConfirm(confirmation.confirmationId, {
        behavior: "allow",
        message: JSON.stringify(finalAnswers),
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
    restoreFocus,
  ]);

  const handleAutoConfirm = useCallback(() => {
    restoreFocus();
    let decision: unknown;
    if (confirmation.toolName === BASH_TOOL_NAME) {
      const rule = confirmation.suggestedPrefix
        ? `Bash(${confirmation.suggestedPrefix})`
        : `Bash(${confirmation.toolInput?.command})`;
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

  const getAutoOptionText = () => {
    if (confirmation.toolName === BASH_TOOL_NAME) {
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

    return (
      <div className="ask-user-questions">
        <div className="question-item">
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
            <span className="question-header-chip">{q.question}</span>
          </div>
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
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    // Enter 仅用于提交：全部题目已答完时提交，未答完时
                    // 无动作，不改变选中状态（不把 Enter 当作选中键）。
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
                          ? ((answers[q.question] as string[]) || []).includes(
                              opt.label,
                            )
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
            {(() => {
              const isOtherChecked = q.multiSelect
                ? !!otherSelected[q.question]
                : answers[q.question] === "__other__";
              return (
                <label
                  data-option-index="other"
                  className={`option-item other-option ${
                    isOtherChecked ? "selected" : ""
                  }`}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    // The Other textarea stopPropagation's its own keys, so
                    // keydown here always originates from the label itself.
                    if (e.key === "Enter") {
                      // Enter 仅用于提交（与普通选项一致）：答完提交、未答
                      // 完无动作，不负责选中「其他」。
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
                        ref={(el) => {
                          autoGrowTextarea(el);
                          otherInputRef.current = el;
                        }}
                        onChange={(e) => {
                          autoGrow(e.currentTarget);
                          handleOtherInputChange(q.question, e.target.value);
                        }}
                        onKeyDown={(e) => {
                          // Inside the textarea every key is text editing;
                          // keep it from reaching dialog-level shortcuts
                          // (matches Claude's IDE/desktop AskUserQuestion).
                          if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
                          if (e.key === "Enter" && !e.shiftKey) {
                            if (e.nativeEvent.isComposing) return;
                            e.preventDefault();
                            // Enter submits only when every question has a
                            // valid answer; it never advances to the next
                            // question (see "多问题循环轮播" spec).
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
                    <div className="option-description">输入自定义回答...</div>
                  )}
                </label>
              );
            })()}
          </div>
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
    const canSubmit = !isConfirmDisabled();
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
          disabled={!canSubmit}
        >
          <span className="btn-text">
            提交回答
            {canSubmit && <span className="btn-enter-hint">⏎</span>}
          </span>
        </button>
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
      return (
        !!(answer && answer !== "__other__") ||
        (answer === "__other__" && !!other && !!other.trim())
      );
    },
    [confirmation, answers, otherInputs, otherSelected],
  );

  const isConfirmDisabled = useCallback(() => {
    if (confirmation.toolName === ASK_USER_QUESTION_TOOL_NAME) {
      const questions = (
        confirmation.toolInput as unknown as AskUserQuestionInput
      ).questions;
      return !questions.every((q, i) => isQuestionAnswered(i));
    }
    const isPlanModeTool =
      confirmation.toolName === EXIT_PLAN_MODE_TOOL_NAME ||
      confirmation.toolName === ENTER_PLAN_MODE_TOOL_NAME;
    if (
      (isPlanModeTool ||
        confirmation.toolName === BASH_TOOL_NAME ||
        [EDIT_TOOL_NAME, WRITE_TOOL_NAME].includes(confirmation.toolName) ||
        confirmation.toolName.startsWith("mcp__")) &&
      showFeedbackInput
    ) {
      return !feedback.trim();
    }
    return false;
  }, [confirmation, showFeedbackInput, feedback, isQuestionAnswered]);

  return (
    <div ref={dialogRef} className="confirmation-dialog" tabIndex={-1}>
      <div className="confirmation-dialog-inner">
        <div className="confirmation-body">
          <div className="confirmation-header">
            <div className="confirmation-header-top">
              <div className="confirmation-title">
                {confirmation.confirmationType}
              </div>
            </div>
            {confirmation.toolName === BASH_TOOL_NAME &&
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
                  confirmation.toolName === BASH_TOOL_NAME ||
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
                  (confirmation.toolName === BASH_TOOL_NAME &&
                    confirmation.permissionMode !== "plan")) && (
                  <button
                    className="confirmation-btn confirmation-btn-auto"
                    onClick={handleBypassConfirm}
                  >
                    <span className="btn-text">是，并跳过权限确认</span>
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
                    confirmation.toolName === BASH_TOOL_NAME ||
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

        <button
          type="button"
          className="confirmation-close-btn"
          onClick={handleReject}
          aria-label="关闭"
          title="关闭"
        >
          <CloseIcon className="confirmation-close-btn-icon" />
        </button>
      </div>
    </div>
  );
};
