/**
 * Tool parameter types for edit and write operations
 */

/**
 * Input types for AskUserQuestion tool
 */
export interface AskUserQuestionOption {
  label: string;
  description?: string;
}

export interface AskUserQuestion {
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect?: boolean;
}

export interface AskUserQuestionInput {
  questions: AskUserQuestion[];
  answers?: Record<string, string>;
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
 * Parameters for a single edit operation in the Edit tool
 */
export interface EditOperation {
  old_string: string;
  new_string: string;
  replace_all?: boolean;
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

/**
 * Parameters for the MultiEdit tool
 */
export interface MultiEditToolParameters {
  file_path: string;
  edits: EditOperation[];
}
