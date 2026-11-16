/**
 * Tool parameter types for edit and write operations
 */

/**
 * Input types for AskUserQuestion tool
 */
export interface AskUserQuestionOption {
  label: string;
  description?: string;
  /**
   * Markdown preview of this option, rendered next to the option list so the
   * user can compare concrete artifacts (layout sketches, code snippets,
   * config samples) instead of reading a one-line label.
   *
   * Single-select only: on a `multiSelect` question every `preview` is ignored
   * and the question keeps the plain list.
   */
  preview?: string;
}

export interface AskUserQuestion {
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect?: boolean;
}

/**
 * Extra information attached to one answer: the full preview of the option the
 * user settled on, plus any free-text note they typed alongside it. Both are
 * optional — an answer may carry no annotation at all.
 */
export interface AskUserQuestionAnnotation {
  preview?: string;
  notes?: string;
}

export interface AskUserQuestionInput {
  questions: AskUserQuestion[];
  answers?: Record<string, string>;
  annotations?: Record<string, AskUserQuestionAnnotation>;
  metadata?: {
    source?: string;
  };
}

/**
 * Parameters for the Write tool
 */
export interface WriteToolParameters {
  file_path: string;
  content: string;
}

/**
 * Parameters for the Edit tool
 */
export interface EditToolParameters {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}
