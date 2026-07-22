import React, { useRef, useEffect, useState, useCallback } from 'react';
import { 
  ASK_USER_QUESTION_TOOL_NAME, 
  BASH_TOOL_NAME, 
  ENTER_PLAN_MODE_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME, 
  EDIT_TOOL_NAME, 
  WRITE_TOOL_NAME 
} from 'wave-agent-sdk/dist/constants/tools.js';
import type { ConfirmationDialogProps, ConfirmationDecision, AskUserQuestionInput } from '../types';
import '../styles/ConfirmationDialog.css';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { DiffViewer } from './DiffViewer';

/**
 * Radio / Checkbox indicator that matches the Figma design (16×16).
 * - Radio unchecked: hollow ring; checked: accent ring + center dot.
 * - Checkbox unchecked: rounded square; checked: same square with a check mark.
 * Colors use VS Code theme variables so it adapts to light/dark themes.
 */
const OptionIndicator: React.FC<{ multiSelect: boolean; checked: boolean }> = ({ multiSelect, checked }) => {
  if (multiSelect) {
    return (
      <svg className="option-indicator-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
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
    <svg className="option-indicator-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle
        cx="8"
        cy="8"
        r="7.5"
        stroke={checked ? 'var(--vscode-focusBorder)' : 'var(--vscode-checkbox-border)'}
      />
      {checked && <circle cx="8" cy="8" r="3" fill="var(--vscode-focusBorder)" />}
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
  const [feedback, setFeedback] = useState('');
  const [showFeedbackInput, setShowFeedbackInput] = useState(false);
  const [isComposing, setIsComposing] = useState(false);

  const applyButtonRef = useRef<HTMLButtonElement>(null);
  const autoButtonRef = useRef<HTMLButtonElement>(null);
  const planContentRef = useRef<HTMLDivElement>(null);

  const handleReject = useCallback(() => {
    if (confirmation.toolName === ENTER_PLAN_MODE_TOOL_NAME) {
      onConfirm(confirmation.confirmationId, {
        behavior: 'deny',
        message: '不，现在开始实现'
      });
    } else {
      onReject(confirmation.confirmationId);
    }
  }, [onReject, onConfirm, confirmation.confirmationId, confirmation.toolName]);

  const handleOptionChange = useCallback((questionText: string, optionLabel: string, multiSelect: boolean, isChecked: boolean) => {
    setAnswers(prev => {
      const current = prev[questionText];
      if (multiSelect) {
        const currentArray = Array.isArray(current) ? (current as string[]) : [];
        const exists = currentArray.includes(optionLabel);
        if (isChecked && !exists) {
          return { ...prev, [questionText]: [...currentArray, optionLabel] };
        } else if (!isChecked && exists) {
          return { ...prev, [questionText]: currentArray.filter(o => o !== optionLabel) };
        }
        return prev;
      } else {
        if (prev[questionText] === optionLabel) return prev;
        return { ...prev, [questionText]: optionLabel };
      }
    });
  }, []);

  const handleOtherInputChange = useCallback((questionText: string, value: string) => {
    setOtherInputs(prev => ({ ...prev, [questionText]: value }));
  }, []);

  // Auto-grow the "other" textarea to fit its content (capped by CSS max-height).
  const autoGrow = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  // Size the textarea once when it mounts (e.g. when reopening with prior content).
  const autoGrowTextarea = useCallback((el: HTMLTextAreaElement | null) => {
    if (el) autoGrow(el);
  }, [autoGrow]);

  const confirmationRef = useRef(confirmation);

  useEffect(() => {
    confirmationRef.current = confirmation;
  }, [confirmation]);

  useEffect(() => {
    if (confirmation.toolName === EXIT_PLAN_MODE_TOOL_NAME && (confirmation.planContent || confirmation.toolInput?.plan_content)) {
      planContentRef.current?.focus();
    } else {
      // Focus on the first available button
      const initialButtons = [applyButtonRef, autoButtonRef];
      for (const ref of initialButtons) {
        if (ref.current && !ref.current.disabled) {
          ref.current.focus();
          break;
        }
      }
    }
  }, [confirmation.confirmationId, currentQuestionIndex, confirmation.toolName, confirmation.planContent, confirmation.toolInput?.plan_content]);

  const handleCompositionStart = useCallback(() => {
    setIsComposing(true);
  }, []);

  const handleCompositionEnd = useCallback(() => {
    setIsComposing(false);
  }, []);

  useEffect(() => {
    // Add keyboard listener for confirmation dialog
    const handleKeyDown = (e: KeyboardEvent) => {
      const currentConfirmation = confirmationRef.current;

      if (e.key === 'Escape') {
        handleReject();
        return;
      }

      const isAskUser = currentConfirmation.toolName === ASK_USER_QUESTION_TOOL_NAME;

      if (e.key === 'Enter' && !e.shiftKey && isAskUser && !isComposing) {
        const activeElement = document.activeElement;
        const isOptionFocused = activeElement?.classList.contains('option-item') || 
                                activeElement?.closest('.option-item');
        const isInputFocused = activeElement?.classList.contains('other-text-input');
        
        if (isOptionFocused || isInputFocused) {
          const applyBtn = document.querySelector('.confirmation-dialog .confirmation-btn-apply') as HTMLButtonElement;
          if (applyBtn && !applyBtn.disabled) {
            e.preventDefault();
            applyBtn.click();
            return;
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleReject, isComposing]);

  const handleConfirm = useCallback(() => {
    if (confirmation.toolName === ENTER_PLAN_MODE_TOOL_NAME) {
      onConfirm(confirmation.confirmationId, {
        behavior: 'allow',
        newPermissionMode: 'plan'
      });
    } else if (confirmation.toolName === EXIT_PLAN_MODE_TOOL_NAME || confirmation.toolName === BASH_TOOL_NAME || [EDIT_TOOL_NAME, WRITE_TOOL_NAME].includes(confirmation.toolName)) {
      if (showFeedbackInput) {
        onConfirm(confirmation.confirmationId, {
          behavior: 'deny',
          message: feedback
        });
      } else {
        onConfirm(confirmation.confirmationId, {
          behavior: 'allow',
          newPermissionMode: confirmation.toolName === EXIT_PLAN_MODE_TOOL_NAME ? 'default' : undefined
        });
      }
    } else if (confirmation.toolName.startsWith('mcp__')) {
      if (showFeedbackInput) {
        onConfirm(confirmation.confirmationId, {
          behavior: 'deny',
          message: feedback
        });
      } else {
        onConfirm(confirmation.confirmationId, {
          behavior: 'allow'
        });
      }
    } else if (confirmation.toolName === ASK_USER_QUESTION_TOOL_NAME) {
      // Combine selected options and "Other" inputs
      const finalAnswers: Record<string, string | string[]> = { ...answers };
      const questions = (confirmation.toolInput as unknown as AskUserQuestionInput).questions;
      
      questions.forEach((q, _index) => {
        const qKey = q.question;
        const otherVal = otherInputs[qKey];
        
        if (q.multiSelect) {
          const current = (finalAnswers[qKey] as string[]) || [];
          if (otherVal && otherVal.trim() && !current.includes(otherVal)) {
            finalAnswers[qKey] = [...current, otherVal];
          }
        } else if (finalAnswers[qKey] === '__other__') {
          finalAnswers[qKey] = otherVal || '';
        }
      });
      
      onConfirm(confirmation.confirmationId, {
        behavior: 'allow',
        message: JSON.stringify(finalAnswers)
      });
    } else {
      onConfirm(confirmation.confirmationId);
    }
  }, [confirmation, onConfirm, showFeedbackInput, feedback, answers, otherInputs]);

  const handleAutoConfirm = useCallback(() => {
    let decision: unknown;
    if (confirmation.toolName === BASH_TOOL_NAME) {
      const rule = confirmation.suggestedPrefix
        ? `Bash(${confirmation.suggestedPrefix})`
        : `Bash(${confirmation.toolInput?.command})`;
      decision = {
        behavior: 'allow',
        newPermissionRule: rule,
      };
    } else if (confirmation.toolName === EXIT_PLAN_MODE_TOOL_NAME) {
      decision = {
        behavior: 'allow',
        newPermissionMode: 'acceptEdits',
      };
    } else if (confirmation.toolName.startsWith('mcp__')) {
      decision = {
        behavior: 'allow',
        newPermissionRule: confirmation.toolName,
      };
    } else {
      decision = {
        behavior: 'allow',
        newPermissionMode: 'acceptEdits',
      };
    }
    onConfirm(confirmation.confirmationId, decision as ConfirmationDecision);
  }, [confirmation, onConfirm]);

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
    if (confirmation.toolName.startsWith('mcp__')) {
      return `是，且不再询问：${confirmation.toolName}`;
    }
    return "是，且自动接受修改";
  };

  const renderPlanContent = () => {
    const planContent = confirmation.planContent || confirmation.toolInput?.plan_content;
    if (confirmation.toolName !== EXIT_PLAN_MODE_TOOL_NAME || !planContent) {
      return null;
    }

    const html = DOMPurify.sanitize(marked.parse(String(planContent)) as string);
    return (
      <div className="plan-content-preview" ref={planContentRef} tabIndex={0}>
        <h3>计划内容：</h3>
        <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    );
  };

  const renderQuestions = () => {
    if (confirmation.toolName !== ASK_USER_QUESTION_TOOL_NAME || !confirmation.toolInput?.questions) {
      return null;
    }

    const questions = (confirmation.toolInput as unknown as AskUserQuestionInput).questions;
    const q = questions[currentQuestionIndex];
    if (!q) return null;

    const isLastQuestion = currentQuestionIndex === questions.length - 1;

    return (
      <div className="ask-user-questions">
        <div className="question-item">
          <div className="question-header-row">
            <span className="question-header-chip">{q.question}</span>
            {questions.length > 1 && (
              <div className="question-progress">
                <button
                  type="button"
                  className="question-progress-nav"
                  aria-label="上一题"
                  disabled={currentQuestionIndex === 0}
                  onClick={() => setCurrentQuestionIndex(prev => Math.max(0, prev - 1))}
                >
                  <i className="codicon codicon-chevron-left"></i>
                </button>
                <span className="question-progress-text">
                  {currentQuestionIndex + 1} / {questions.length}
                </span>
                <button
                  type="button"
                  className="question-progress-nav"
                  aria-label="下一题"
                  disabled={isLastQuestion || !isCurrentQuestionAnswered()}
                  onClick={() => setCurrentQuestionIndex(prev => Math.min(questions.length - 1, prev + 1))}
                >
                  <i className="codicon codicon-chevron-right"></i>
                </button>
              </div>
            )}
          </div>
          <div className="options-list">
            {q.options.map((opt, oIndex) => (
              <label 
                key={oIndex} 
                data-option-index={oIndex}
                className={`option-item ${
                  (q.multiSelect 
                    ? (answers[q.question] as string[] || []).includes(opt.label)
                    : answers[q.question] === opt.label) ? 'selected' : ''
                }`}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === ' ') {
                    e.preventDefault();
                    handleOptionChange(q.question, opt.label, !!q.multiSelect, 
                      q.multiSelect ? !(answers[q.question] as string[] || []).includes(opt.label) : true
                    );
                  }
                }}
              >
                <input
                  type={q.multiSelect ? "checkbox" : "radio"}
                  name={`question-${currentQuestionIndex}`}
                  className="option-input-hidden"
                  tabIndex={-1}
                  checked={q.multiSelect 
                    ? (answers[q.question] as string[] || []).includes(opt.label)
                    : answers[q.question] === opt.label
                  }
                  onChange={(e) => handleOptionChange(q.question, opt.label, !!q.multiSelect, e.target.checked)}
                />
                <div className="option-row">
                  <div className="option-indicator">
                    <OptionIndicator
                      multiSelect={!!q.multiSelect}
                      checked={q.multiSelect
                        ? (answers[q.question] as string[] || []).includes(opt.label)
                        : answers[q.question] === opt.label}
                    />
                  </div>
                  <div className="option-label">
                    {opt.label}
                  </div>
                </div>
                {opt.description && <div className="option-description">{opt.description}</div>}
              </label>
            ))}
            <label 
              data-option-index="other"
              className={`option-item other-option ${
                (q.multiSelect 
                  ? !!otherInputs[q.question]
                  : answers[q.question] === '__other__') ? 'selected' : ''
              }`}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === ' ') {
                  if (e.target === e.currentTarget) {
                    e.preventDefault();
                    if (!q.multiSelect) {
                      setAnswers(prev => ({ ...prev, [q.question]: '__other__' }));
                    }
                    // Focus the input
                    const input = (e.currentTarget as HTMLElement).querySelector('.other-text-input') as HTMLInputElement;
                    input?.focus();
                  }
                }
              }}
            >
              <input
                type={q.multiSelect ? "checkbox" : "radio"}
                name={`question-${currentQuestionIndex}`}
                className="option-input-hidden"
                tabIndex={-1}
                checked={q.multiSelect 
                  ? !!otherInputs[q.question]
                  : answers[q.question] === '__other__'
                }
                onChange={(e) => {
                  if (!q.multiSelect) {
                    setAnswers(prev => ({ ...prev, [q.question]: '__other__' }));
                  } else if (!e.target.checked) {
                    setOtherInputs(prev => ({ ...prev, [q.question]: '' }));
                  }
                }}
              />
              <div className="option-row">
                <div className="option-indicator">
                  <OptionIndicator
                    multiSelect={!!q.multiSelect}
                    checked={q.multiSelect
                      ? !!otherInputs[q.question]
                      : answers[q.question] === '__other__'}
                  />
                </div>
                <div className="option-label">其他</div>
              </div>
              <div className="option-other-body">
                <textarea
                  className="other-text-input"
                  placeholder="输入自定义回答..."
                  value={otherInputs[q.question] || ''}
                  ref={autoGrowTextarea}
                  onFocus={() => {
                    if (!q.multiSelect) {
                      setAnswers(prev => ({ ...prev, [q.question]: '__other__' }));
                    }
                  }}
                  onChange={(e) => {
                    autoGrow(e.currentTarget);
                    handleOtherInputChange(q.question, e.target.value);
                  }}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                />
              </div>
            </label>
          </div>
        </div>
        
        <div className="question-navigation">
          {!isLastQuestion && (
            <button
              className="confirmation-btn confirmation-btn-secondary"
              disabled={!isCurrentQuestionAnswered()}
              onClick={() => setCurrentQuestionIndex(prev => prev + 1)}
            >
              下一个
            </button>
          )}
          <button
            ref={applyButtonRef}
            className="confirmation-btn confirmation-btn-apply"
            onClick={handleConfirm}
            disabled={isConfirmDisabled()}
          >
            提交回答
          </button>
        </div>
      </div>
    );
  };

  const isCurrentQuestionAnswered = () => {
    if (confirmation.toolName !== ASK_USER_QUESTION_TOOL_NAME) return true;
    const questions = (confirmation.toolInput as unknown as AskUserQuestionInput).questions;
    const q = questions[currentQuestionIndex];
    if (!q) return true;
    
    const answer = answers[q.question];
    const other = otherInputs[q.question];
    if (q.multiSelect) {
      return (Array.isArray(answer) && answer.length > 0) || (other && other.trim());
    }
    return (answer && answer !== '__other__') || (answer === '__other__' && other && other.trim());
  };

  const isConfirmDisabled = () => {
    if (confirmation.toolName === ASK_USER_QUESTION_TOOL_NAME) {
      const questions = (confirmation.toolInput as unknown as AskUserQuestionInput).questions;
      return !questions.every(q => {
        const answer = answers[q.question];
        const other = otherInputs[q.question];
        if (q.multiSelect) {
          return (Array.isArray(answer) && answer.length > 0) || (other && other.trim());
        }
        return (answer && answer !== '__other__') || (answer === '__other__' && other && other.trim());
      });
    }
    const isPlanModeTool = confirmation.toolName === EXIT_PLAN_MODE_TOOL_NAME || confirmation.toolName === ENTER_PLAN_MODE_TOOL_NAME;
    if ((isPlanModeTool || confirmation.toolName === BASH_TOOL_NAME || [EDIT_TOOL_NAME, WRITE_TOOL_NAME].includes(confirmation.toolName) || confirmation.toolName.startsWith('mcp__')) && showFeedbackInput) {
      return !feedback.trim();
    }
    return false;
  };

  return (
    <div className="confirmation-dialog">
      <div className="confirmation-dialog-inner">
        <div className="confirmation-header">
          <div className="confirmation-header-top">
            <div className="confirmation-title">
              {confirmation.confirmationType}
            </div>
            <button
              type="button"
              className="confirmation-close-btn"
              onClick={handleReject}
              aria-label="关闭"
              title="关闭"
            >
              <i className="codicon codicon-close"></i>
            </button>
          </div>
          {confirmation.toolName === BASH_TOOL_NAME && !!confirmation.toolInput?.command && (
            <div className="confirmation-command">
              {String(confirmation.toolInput.command)}
            </div>
          )}
          {confirmation.toolName.startsWith('mcp__') && confirmation.toolInput && (
            <div className="confirmation-mcp-params">
              <pre>{JSON.stringify(confirmation.toolInput, null, 2)}</pre>
            </div>
          )}
          <div className="confirmation-details">
            <strong>工具:</strong> {confirmation.toolName}
          </div>
          {[WRITE_TOOL_NAME, EDIT_TOOL_NAME].includes(confirmation.toolName) && !!confirmation.toolInput?.file_path && (
            <div className="confirmation-file-path">
              <strong>文件:</strong> {String(confirmation.toolInput.file_path)}
            </div>
          )}
        </div>

        {renderPlanContent()}
        {renderQuestions()}

        {[WRITE_TOOL_NAME, EDIT_TOOL_NAME].includes(confirmation.toolName) && (
          <div className="confirmation-diff-viewer">
            <DiffViewer 
              toolName={confirmation.toolName} 
              parameters={confirmation.toolInput} 
            />
          </div>
        )}


        {confirmation.toolName !== ASK_USER_QUESTION_TOOL_NAME && (
          <div className="confirmation-actions">
            {!showFeedbackInput ? (
              <>
                <button
                  ref={applyButtonRef}
                  className="confirmation-btn confirmation-btn-apply"
                  onClick={handleConfirm}
                  disabled={isConfirmDisabled()}
                >
                  <span className="btn-text">
                    {(confirmation.toolName === EXIT_PLAN_MODE_TOOL_NAME || confirmation.toolName === ENTER_PLAN_MODE_TOOL_NAME || confirmation.toolName === BASH_TOOL_NAME || [EDIT_TOOL_NAME, WRITE_TOOL_NAME].includes(confirmation.toolName) || confirmation.toolName.startsWith('mcp__'))
                      ? '批准并继续'
                      : '是'}
                  </span>
                </button>

                {confirmation.toolName === ENTER_PLAN_MODE_TOOL_NAME && (
                  <button
                    className="confirmation-btn confirmation-btn-reject"
                    onClick={handleReject}
                  >
                    <span className="btn-text">不，现在开始实现</span>
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

                {confirmation.toolName !== ASK_USER_QUESTION_TOOL_NAME && confirmation.toolName !== EXIT_PLAN_MODE_TOOL_NAME && confirmation.toolName !== ENTER_PLAN_MODE_TOOL_NAME && !showFeedbackInput && !confirmation.hidePersistentOption && (
                  <button
                    ref={autoButtonRef}
                    className="confirmation-btn confirmation-btn-auto"
                    onClick={handleAutoConfirm}
                  >
                    <span className="btn-text">{getAutoOptionText()}</span>
                  </button>
                )}

                {(confirmation.toolName === EXIT_PLAN_MODE_TOOL_NAME || confirmation.toolName === BASH_TOOL_NAME || [EDIT_TOOL_NAME, WRITE_TOOL_NAME].includes(confirmation.toolName) || confirmation.toolName.startsWith('mcp__')) && (
                  <button
                    className="confirmation-btn confirmation-btn-feedback"
                    onClick={() => setShowFeedbackInput(true)}
                  >
                    <span className="btn-text">提供反馈</span>
                  </button>
                )}
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
                    if (e.key === 'Enter' && !isComposing) {
                      handleConfirm();
                    }
                  }}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  autoFocus
                />
                <div className="feedback-actions">
                  <button
                    className="confirmation-btn confirmation-btn-apply"
                    onClick={handleConfirm}
                    disabled={!feedback.trim()}
                  >
                    发送反馈
                  </button>
                  <button
                    className="confirmation-btn confirmation-btn-reject"
                    onClick={() => setShowFeedbackInput(false)}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
