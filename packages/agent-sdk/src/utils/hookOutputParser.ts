/**
 * Hook Output Parser Utility
 * 
 * Provides parsing and validation logic for hook execution results,
 * handling both exit code interpretation and JSON output processing.
 * 
 * Implements User Story 2: Advanced JSON Output Control (T014 & T015)
 * - T014: JSON parsing with comprehensive error handling and fallback
 * - T015: JSON schema validation for common fields and hook-specific output
 * 
 * Key Features:
 * - JSON output takes precedence over exit codes when valid JSON is present
 * - Comprehensive validation of common fields (continue, stopReason, systemMessage)
 * - Hook-specific validation for PreToolUse, PostToolUse, UserPromptSubmit, and Stop events
 * - Graceful fallback to exit code interpretation when JSON is invalid
 * - Error collection without throwing exceptions for better error handling
 * - Enhanced diagnostics with warnings and suggestions
 */

import type {
  HookOutputResult,
  ParsedHookOutput,
  BaseHookJsonOutput,
  HookValidationResult,
  ValidationError,
  ValidationWarning,
  HookEventName
} from "../types/hooks.js";

/**
 * Main hook output parser class
 */
export class HookOutputParser {
  /**
   * Parse hook execution result, trying JSON first, falling back to exit code
   * This implements the core T014 requirement: JSON precedence over exit codes
   */
  parseHookOutput(result: HookOutputResult): ParsedHookOutput {
    // Try to parse JSON from stdout first (T014: JSON parsing with proper error handling)
    const jsonResult = this.tryParseJson(result);
    if (jsonResult) {
      return jsonResult;
    }

    // Fall back to exit code interpretation
    return this.parseExitCode(result);
  }

  /**
   * Diagnostic method to get detailed parsing information
   * Useful for debugging hook output parsing issues
   */
  getDiagnostics(result: HookOutputResult): {
    hasStdout: boolean;
    hasStderr: boolean;
    stdoutLooksLikeJson: boolean;
    jsonExtractable: boolean;
    jsonValid: boolean;
    validationSummary?: string;
  } {
    const diagnostics = {
      hasStdout: Boolean(result.stdout?.trim()),
      hasStderr: Boolean(result.stderr?.trim()),
      stdoutLooksLikeJson: false,
      jsonExtractable: false,
      jsonValid: false,
      validationSummary: undefined as string | undefined
    };

    if (diagnostics.hasStdout) {
      diagnostics.stdoutLooksLikeJson = this.looksLikeJson(result.stdout.trim());
      
      const extractedJson = this.extractJsonFromOutput(result.stdout.trim());
      diagnostics.jsonExtractable = Boolean(extractedJson);
      
      if (extractedJson) {
        try {
          const json = JSON.parse(extractedJson);
          diagnostics.jsonValid = true;
          
          const validation = this.validateJsonOutput(json, result.hookEvent);
          diagnostics.validationSummary = getValidationSummary(validation);
        } catch {
          diagnostics.jsonValid = false;
        }
      }
    }

    return diagnostics;
  }

  /**
   * Attempt to parse JSON output from hook stdout
   * Enhanced implementation for T014: JSON parsing with comprehensive error handling
   */
  private tryParseJson(result: HookOutputResult): ParsedHookOutput | null {
    const stdout = result.stdout?.trim();
    
    // No stdout content - fall back to exit code
    if (!stdout) {
      return null;
    }

    // Try to extract JSON from stdout (may contain other text)
    const jsonContent = this.extractJsonFromOutput(stdout);
    if (!jsonContent) {
      return null;
    }

    try {
      const json = JSON.parse(jsonContent);
      const validation = this.validateJsonOutput(json, result.hookEvent);
      
      // JSON is structurally valid - parse it even if validation has errors
      // Validation errors will be collected in the result, but JSON takes precedence over exit code
      return this.parseValidJson(json, result.hookEvent, validation);
    } catch {
      // JSON parsing failed - fall back to exit code interpretation
      // This is expected behavior, not an error to throw
      return null;
    }
  }

  /**
   * Extract JSON content from potentially mixed output
   * Handles cases where hooks output non-JSON text along with JSON
   * Made public for utility function usage
   */
  extractJsonFromOutput(output: string): string | null {
    // Try to find JSON object boundaries
    const lines = output.split('\n');
    let jsonStart = -1;
    let jsonEnd = -1;
    let braceCount = 0;
    
    // Find the start of a JSON object
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('{')) {
        jsonStart = i;
        break;
      }
    }
    
    if (jsonStart === -1) {
      // Try parsing the entire output as JSON
      try {
        JSON.parse(output);
        return output;
      } catch {
        return null;
      }
    }
    
    // Find the end of the JSON object by counting braces
    for (let i = jsonStart; i < lines.length; i++) {
      const line = lines[i];
      for (const char of line) {
        if (char === '{') braceCount++;
        if (char === '}') braceCount--;
        if (braceCount === 0 && char === '}') {
          jsonEnd = i;
          break;
        }
      }
      if (jsonEnd !== -1) break;
    }
    
    if (jsonEnd === -1) {
      // JSON object is incomplete, try parsing what we have
      const partial = lines.slice(jsonStart).join('\n');
      try {
        JSON.parse(partial);
        return partial;
      } catch {
        return null;
      }
    }
    
    const jsonContent = lines.slice(jsonStart, jsonEnd + 1).join('\n');
    
    // Validate the extracted JSON
    try {
      JSON.parse(jsonContent);
      return jsonContent;
    } catch {
      return null;
    }
  }

  /**
   * Parse valid JSON output into structured result
   * Enhanced for T014: JSON parsing with better data extraction and type safety
   */
  private parseValidJson(
    json: BaseHookJsonOutput, 
    hookEvent: HookEventName,
    validation: HookValidationResult
  ): ParsedHookOutput {
    // Safely extract continue field with type coercion
    let continueValue = true; // Default value
    if ('continue' in json) {
      if (typeof json.continue === 'boolean') {
        continueValue = json.continue;
      } else {
        // Try to coerce invalid types to boolean
        if (json.continue === 'false' || json.continue === false || json.continue === 0) {
          continueValue = false;
        } else if (json.continue === 'true' || json.continue === true || json.continue === 1) {
          continueValue = true;
        }
        // For other invalid values, keep the default (true) and let validation errors handle it
      }
    }

    // Safely extract stopReason
    let stopReason = json.stopReason;
    if (stopReason !== undefined && typeof stopReason !== 'string') {
      stopReason = String(stopReason); // Coerce to string
    }

    // Safely extract systemMessage
    let systemMessage = json.systemMessage;
    if (systemMessage !== undefined && typeof systemMessage !== 'string') {
      systemMessage = String(systemMessage); // Coerce to string
    }

    const result: ParsedHookOutput = {
      source: "json",
      continue: continueValue,
      stopReason: stopReason,
      systemMessage: systemMessage,
      hookSpecificData: json.hookSpecificOutput,
      errorMessages: []
    };

    // Collect validation errors without throwing
    if (validation.errors.length > 0) {
      result.errorMessages = validation.errors.map(e => `${e.field}: ${e.message}`);
    }

    // Collect validation warnings as informational messages
    if (validation.warnings.length > 0) {
      const warningMessages = validation.warnings.map(w => `Warning - ${w.field}: ${w.message}`);
      result.errorMessages = [...result.errorMessages, ...warningMessages];
    }

    // Ensure logical consistency for continue/stopReason
    if (result.continue === false && !result.stopReason) {
      result.stopReason = "Hook requested to stop execution without providing a reason";
    }

    return result;
  }

  /**
   * Parse exit code into structured result
   * Enhanced for better integration with JSON precedence
   */
  private parseExitCode(result: HookOutputResult): ParsedHookOutput {
    const { exitCode, stderr, stdout } = result;
    const errorMessages: string[] = [];

    if (stderr.trim()) {
      errorMessages.push(stderr.trim());
    }

    // Check if stdout contains non-JSON content that should be preserved
    const stdout_content = stdout?.trim();
    if (stdout_content && !this.looksLikeJson(stdout_content)) {
      // Add stdout as informational message if it's not JSON
      errorMessages.push(`Hook output: ${stdout_content}`);
    }

    switch (exitCode) {
      case 0:
        return {
          source: "exitcode",
          continue: true,
          errorMessages
        };

      case 2:
        return {
          source: "exitcode", 
          continue: false,
          stopReason: "Hook requested to block execution (exit code 2)",
          errorMessages
        };

      default:
        return {
          source: "exitcode",
          continue: true, // Non-blocking error - continue execution
          systemMessage: `Hook completed with non-zero exit code ${exitCode}`,
          errorMessages: [
            `Non-blocking error: exit code ${exitCode}`,
            ...errorMessages
          ]
        };
    }
  }

  /**
   * Quick check if a string looks like JSON
   */
  private looksLikeJson(content: string): boolean {
    const trimmed = content.trim();
    return (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
           (trimmed.startsWith('[') && trimmed.endsWith(']'));
  }

  /**
   * Validate JSON output structure and content
   * Enhanced implementation for T015: comprehensive JSON schema validation
   */
  validateJsonOutput(json: unknown, hookEvent: HookEventName): HookValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Basic structure validation
    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
      errors.push({
        field: 'root',
        message: 'Hook output must be a JSON object (not null, array, or primitive)',
        code: 'INVALID_TYPE'
      });
      return { valid: false, errors, warnings };
    }

    const jsonObj = json as Record<string, unknown>;

    // Check if the JSON object is empty
    if (Object.keys(jsonObj).length === 0) {
      warnings.push({
        field: 'root',
        message: 'Empty JSON object provided',
        suggestion: 'Consider providing explicit continue: true if no action is needed'
      });
    }

    // Validate common fields (T015 requirement)
    this.validateCommonFields(jsonObj, errors, warnings);

    // Validate hook-specific fields if present
    if (jsonObj.hookSpecificOutput) {
      if (typeof jsonObj.hookSpecificOutput === 'object' && jsonObj.hookSpecificOutput !== null) {
        this.validateHookSpecificOutput(jsonObj.hookSpecificOutput, hookEvent, errors, warnings);
      }
    } else {
      // Hook-specific output is optional but can provide warnings about missing fields
      this.validateMissingHookSpecificOutput(hookEvent, warnings);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Provide warnings about missing hook-specific output that might be useful
   */
  private validateMissingHookSpecificOutput(
    hookEvent: HookEventName,
    warnings: ValidationWarning[]
  ): void {
    switch (hookEvent) {
      case 'PreToolUse':
        warnings.push({
          field: 'hookSpecificOutput',
          message: 'PreToolUse hook missing permission decision',
          suggestion: 'Consider providing permissionDecision (allow/deny/ask) and permissionDecisionReason'
        });
        break;
      
      case 'PostToolUse':
      case 'UserPromptSubmit':
      case 'Stop':
        // These are optional, no warning needed
        break;
    }
  }

  /**
   * Validate common JSON fields present in all hook types
   * Enhanced implementation for T015: JSON schema validation for common fields
   */
  private validateCommonFields(
    json: Record<string, unknown>, 
    errors: ValidationError[], 
    warnings: ValidationWarning[]
  ): void {
    // Validate continue field (T015 requirement)
    if ('continue' in json) {
      if (typeof json.continue !== 'boolean') {
        errors.push({
          field: 'continue',
          message: 'continue field must be a boolean (true or false)',
          code: 'INVALID_TYPE'
        });
      }
    } else {
      // continue defaults to true when not specified
      warnings.push({
        field: 'continue',
        message: 'continue field not specified, defaulting to true',
        suggestion: 'Consider explicitly setting continue: true or continue: false'
      });
    }

    // Validate stopReason requirement when continue is false (T015 requirement)
    if (json.continue === false) {
      if (!json.stopReason) {
        errors.push({
          field: 'stopReason',
          message: 'stopReason is required when continue is false',
          code: 'REQUIRED_FIELD'
        });
      } else if (typeof json.stopReason !== 'string') {
        errors.push({
          field: 'stopReason',
          message: 'stopReason must be a non-empty string when provided',
          code: 'INVALID_TYPE'
        });
      } else if (json.stopReason.trim().length === 0) {
        errors.push({
          field: 'stopReason',
          message: 'stopReason cannot be empty when continue is false',
          code: 'EMPTY_REQUIRED_FIELD'
        });
      }
    } else if (json.stopReason !== undefined) {
      // stopReason provided when continue is true
      warnings.push({
        field: 'stopReason',
        message: 'stopReason provided when continue is true, it will be ignored',
        suggestion: 'Remove stopReason when continue is true'
      });
    }

    // Validate systemMessage if present (T015 requirement)
    if ('systemMessage' in json) {
      if (typeof json.systemMessage !== 'string') {
        errors.push({
          field: 'systemMessage',
          message: 'systemMessage must be a string',
          code: 'INVALID_TYPE'
        });
      } else if (json.systemMessage.length === 0) {
        warnings.push({
          field: 'systemMessage',
          message: 'systemMessage is empty',
          suggestion: 'Consider providing a meaningful message or removing the field'
        });
      } else if (json.systemMessage.length > 1000) {
        warnings.push({
          field: 'systemMessage',
          message: 'systemMessage is very long (>1000 characters)',
          suggestion: 'Consider keeping system messages concise for better UX'
        });
      }
    }

    // Validate hookSpecificOutput structure if present
    if ('hookSpecificOutput' in json) {
      if (json.hookSpecificOutput !== null && typeof json.hookSpecificOutput !== 'object') {
        errors.push({
          field: 'hookSpecificOutput',
          message: 'hookSpecificOutput must be an object or null',
          code: 'INVALID_TYPE'
        });
      }
    }

    // Check for unknown/unexpected fields
    const validCommonFields = ['continue', 'stopReason', 'systemMessage', 'hookSpecificOutput'];
    const providedFields = Object.keys(json);
    const unknownFields = providedFields.filter(field => !validCommonFields.includes(field));
    
    if (unknownFields.length > 0) {
      warnings.push({
        field: 'root',
        message: `Unknown fields detected: ${unknownFields.join(', ')}`,
        suggestion: `Valid common fields are: ${validCommonFields.join(', ')}`
      });
    }
  }

  /**
   * Validate hook-specific output based on hook event type
   */
  private validateHookSpecificOutput(
    hookOutput: unknown,
    expectedEvent: HookEventName,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    if (typeof hookOutput !== 'object' || hookOutput === null) {
      errors.push({
        field: 'hookSpecificOutput',
        message: 'hookSpecificOutput must be an object',
        code: 'INVALID_TYPE'
      });
      return;
    }

    const output = hookOutput as Record<string, unknown>;

    // Validate hookEventName matches actual event
    if (output.hookEventName !== expectedEvent) {
      errors.push({
        field: 'hookSpecificOutput.hookEventName',
        message: `hookEventName must be "${expectedEvent}", got "${output.hookEventName}"`,
        code: 'EVENT_MISMATCH'
      });
    }

    // Validate based on specific hook type
    switch (expectedEvent) {
      case 'PreToolUse':
        this.validatePreToolUseOutput(output, errors, warnings);
        break;
      case 'PostToolUse':
        this.validatePostToolUseOutput(output, errors, warnings);
        break;
      case 'UserPromptSubmit':
        this.validateUserPromptSubmitOutput(output, errors, warnings);
        break;
      case 'Stop':
        this.validateStopOutput(output, errors, warnings);
        break;
    }
  }

  /**
   * Validate PreToolUse-specific output fields
   * Enhanced validation for T015: comprehensive field validation
   */
  private validatePreToolUseOutput(
    output: Record<string, unknown>,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    // Validate required hookEventName field
    if (!output.hookEventName || output.hookEventName !== 'PreToolUse') {
      errors.push({
        field: 'hookSpecificOutput.hookEventName',
        message: 'hookEventName must be "PreToolUse" for PreToolUse hooks',
        code: 'EVENT_MISMATCH'
      });
    }
    
    // Validate required permissionDecision field
    const validDecisions = ['allow', 'deny', 'ask'];
    if (!output.permissionDecision) {
      errors.push({
        field: 'hookSpecificOutput.permissionDecision',
        message: 'permissionDecision is required for PreToolUse hooks',
        code: 'REQUIRED_FIELD'
      });
    } else if (!validDecisions.includes(output.permissionDecision as string)) {
      errors.push({
        field: 'hookSpecificOutput.permissionDecision',
        message: `permissionDecision must be one of: ${validDecisions.join(', ')}`,
        code: 'INVALID_VALUE'
      });
    }

    // Validate required permissionDecisionReason field
    if (!output.permissionDecisionReason) {
      errors.push({
        field: 'hookSpecificOutput.permissionDecisionReason',
        message: 'permissionDecisionReason is required for PreToolUse hooks',
        code: 'REQUIRED_FIELD'
      });
    } else if (typeof output.permissionDecisionReason !== 'string') {
      errors.push({
        field: 'hookSpecificOutput.permissionDecisionReason',
        message: 'permissionDecisionReason must be a string',
        code: 'INVALID_TYPE'
      });
    } else if ((output.permissionDecisionReason as string).trim().length === 0) {
      errors.push({
        field: 'hookSpecificOutput.permissionDecisionReason',
        message: 'permissionDecisionReason cannot be empty',
        code: 'EMPTY_REQUIRED_FIELD'
      });
    }

    // Validate optional updatedInput field
    if ('updatedInput' in output) {
      if (output.updatedInput !== null && (typeof output.updatedInput !== 'object' || Array.isArray(output.updatedInput))) {
        errors.push({
          field: 'hookSpecificOutput.updatedInput',
          message: 'updatedInput must be an object or null',
          code: 'INVALID_TYPE'
        });
      } else if (output.permissionDecision === 'deny' && output.updatedInput !== undefined) {
        warnings.push({
          field: 'hookSpecificOutput.updatedInput',
          message: 'updatedInput provided when permission is denied, it will be ignored',
          suggestion: 'Remove updatedInput when denying permission'
        });
      }
    }

    // Validate logical consistency
    if (output.permissionDecision === 'ask' && !output.permissionDecisionReason) {
      warnings.push({
        field: 'hookSpecificOutput.permissionDecisionReason',
        message: 'Asking for permission without a clear reason may confuse users',
        suggestion: 'Provide a clear reason why permission is needed'
      });
    }

    // Check for unknown fields in PreToolUse output
    const validFields = ['hookEventName', 'permissionDecision', 'permissionDecisionReason', 'updatedInput'];
    const providedFields = Object.keys(output);
    const unknownFields = providedFields.filter(field => !validFields.includes(field));
    
    if (unknownFields.length > 0) {
      warnings.push({
        field: 'hookSpecificOutput',
        message: `Unknown PreToolUse fields detected: ${unknownFields.join(', ')}`,
        suggestion: `Valid PreToolUse fields are: ${validFields.join(', ')}`
      });
    }
  }

  /**
   * Validate PostToolUse-specific output fields
   * Enhanced validation for T015: comprehensive field validation
   */
  private validatePostToolUseOutput(
    output: Record<string, unknown>,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    // Validate required hookEventName field
    if (!output.hookEventName || output.hookEventName !== 'PostToolUse') {
      errors.push({
        field: 'hookSpecificOutput.hookEventName',
        message: 'hookEventName must be "PostToolUse" for PostToolUse hooks',
        code: 'EVENT_MISMATCH'
      });
    }
    
    // Validate optional decision field
    if ('decision' in output) {
      if (output.decision !== 'block') {
        errors.push({
          field: 'hookSpecificOutput.decision',
          message: 'decision must be "block" if specified (or omit field to allow)',
          code: 'INVALID_VALUE'
        });
      }
    }

    // Validate reason requirement when decision is block
    if (output.decision === 'block') {
      if (!output.reason) {
        errors.push({
          field: 'hookSpecificOutput.reason',
          message: 'reason is required when decision is "block"',
          code: 'REQUIRED_FIELD'
        });
      } else if (typeof output.reason !== 'string') {
        errors.push({
          field: 'hookSpecificOutput.reason',
          message: 'reason must be a string when decision is "block"',
          code: 'INVALID_TYPE'
        });
      } else if ((output.reason as string).trim().length === 0) {
        errors.push({
          field: 'hookSpecificOutput.reason',
          message: 'reason cannot be empty when decision is "block"',
          code: 'EMPTY_REQUIRED_FIELD'
        });
      }
    } else if (output.reason !== undefined) {
      warnings.push({
        field: 'hookSpecificOutput.reason',
        message: 'reason provided without blocking decision, it will be ignored',
        suggestion: 'Remove reason field or set decision to "block"'
      });
    }

    // Validate optional additionalContext field
    if ('additionalContext' in output) {
      if (typeof output.additionalContext !== 'string') {
        errors.push({
          field: 'hookSpecificOutput.additionalContext',
          message: 'additionalContext must be a string',
          code: 'INVALID_TYPE'
        });
      } else if ((output.additionalContext as string).length === 0) {
        warnings.push({
          field: 'hookSpecificOutput.additionalContext',
          message: 'additionalContext is empty',
          suggestion: 'Consider providing meaningful context or removing the field'
        });
      }
    }

    // Check for unknown fields in PostToolUse output
    const validFields = ['hookEventName', 'decision', 'reason', 'additionalContext'];
    const providedFields = Object.keys(output);
    const unknownFields = providedFields.filter(field => !validFields.includes(field));
    
    if (unknownFields.length > 0) {
      warnings.push({
        field: 'hookSpecificOutput',
        message: `Unknown PostToolUse fields detected: ${unknownFields.join(', ')}`,
        suggestion: `Valid PostToolUse fields are: ${validFields.join(', ')}`
      });
    }
  }

  /**
   * Validate UserPromptSubmit-specific output fields
   * Enhanced validation for T015: comprehensive field validation
   */
  private validateUserPromptSubmitOutput(
    output: Record<string, unknown>,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    // Validate required hookEventName field
    if (!output.hookEventName || output.hookEventName !== 'UserPromptSubmit') {
      errors.push({
        field: 'hookSpecificOutput.hookEventName',
        message: 'hookEventName must be "UserPromptSubmit" for UserPromptSubmit hooks',
        code: 'EVENT_MISMATCH'
      });
    }

    // UserPromptSubmit has the same validation as PostToolUse for decision fields
    this.validatePostToolUseOutput({
      ...output,
      hookEventName: 'PostToolUse' // Temporarily change for shared validation
    }, errors, warnings);

    // Fix the hookEventName error message for UserPromptSubmit context
    const hookEventError = errors.find(e => e.field === 'hookSpecificOutput.hookEventName');
    if (hookEventError) {
      hookEventError.message = 'hookEventName must be "UserPromptSubmit" for UserPromptSubmit hooks';
    }

    // Check for unknown fields in UserPromptSubmit output
    const validFields = ['hookEventName', 'decision', 'reason', 'additionalContext'];
    const providedFields = Object.keys(output);
    const unknownFields = providedFields.filter(field => !validFields.includes(field));
    
    if (unknownFields.length > 0) {
      // Remove any duplicate warning from PostToolUse validation
      const existingWarningIndex = warnings.findIndex(w => 
        w.field === 'hookSpecificOutput' && w.message.includes('Unknown PostToolUse fields')
      );
      if (existingWarningIndex !== -1) {
        warnings.splice(existingWarningIndex, 1);
      }
      
      warnings.push({
        field: 'hookSpecificOutput',
        message: `Unknown UserPromptSubmit fields detected: ${unknownFields.join(', ')}`,
        suggestion: `Valid UserPromptSubmit fields are: ${validFields.join(', ')}`
      });
    }
  }

  /**
   * Validate Stop-specific output fields
   * Enhanced validation for T015: comprehensive field validation
   */
  private validateStopOutput(
    output: Record<string, unknown>,
    errors: ValidationError[],
    warnings: ValidationWarning[]
  ): void {
    // Validate required hookEventName field
    if (!output.hookEventName || output.hookEventName !== 'Stop') {
      errors.push({
        field: 'hookSpecificOutput.hookEventName',
        message: 'hookEventName must be "Stop" for Stop hooks',
        code: 'EVENT_MISMATCH'
      });
    }
    
    // Validate optional decision field
    if ('decision' in output) {
      if (output.decision !== 'block') {
        errors.push({
          field: 'hookSpecificOutput.decision',
          message: 'decision must be "block" if specified (or omit field to allow)',
          code: 'INVALID_VALUE'
        });
      }
    }

    // Validate reason requirement when decision is block
    if (output.decision === 'block') {
      if (!output.reason) {
        errors.push({
          field: 'hookSpecificOutput.reason',
          message: 'reason is required when decision is "block"',
          code: 'REQUIRED_FIELD'
        });
      } else if (typeof output.reason !== 'string') {
        errors.push({
          field: 'hookSpecificOutput.reason',
          message: 'reason must be a string when decision is "block"',
          code: 'INVALID_TYPE'
        });
      } else if ((output.reason as string).trim().length === 0) {
        errors.push({
          field: 'hookSpecificOutput.reason',
          message: 'reason cannot be empty when decision is "block"',
          code: 'EMPTY_REQUIRED_FIELD'
        });
      }
    } else if (output.reason !== undefined) {
      warnings.push({
        field: 'hookSpecificOutput.reason',
        message: 'reason provided without blocking decision, it will be ignored',
        suggestion: 'Remove reason field or set decision to "block"'
      });
    }

    // Check for unknown fields in Stop output
    const validFields = ['hookEventName', 'decision', 'reason'];
    const providedFields = Object.keys(output);
    const unknownFields = providedFields.filter(field => !validFields.includes(field));
    
    if (unknownFields.length > 0) {
      warnings.push({
        field: 'hookSpecificOutput',
        message: `Unknown Stop fields detected: ${unknownFields.join(', ')}`,
        suggestion: `Valid Stop fields are: ${validFields.join(', ')}`
      });
    }
  }
}

/**
 * Singleton instance for easy access
 */
export const hookOutputParser = new HookOutputParser();

/**
 * Convenience function for parsing hook output
 */
export function parseHookOutput(result: HookOutputResult): ParsedHookOutput {
  return hookOutputParser.parseHookOutput(result);
}

/**
 * Convenience function for validating JSON output
 */
export function validateHookJsonOutput(json: unknown, hookEvent: HookEventName): HookValidationResult {
  return hookOutputParser.validateJsonOutput(json, hookEvent);
}

/**
 * Utility function to check if hook output contains valid JSON
 * Useful for preliminary checks before full parsing
 */
export function hasValidJsonOutput(stdout: string): boolean {
  if (!stdout?.trim()) {
    return false;
  }

  try {
    const extractedJson = hookOutputParser.extractJsonFromOutput(stdout.trim());
    if (!extractedJson) {
      return false;
    }
    
    JSON.parse(extractedJson);
    return true;
  } catch {
    return false;
  }
}

/**
 * Utility function to get validation summary
 * Useful for logging and debugging
 */
export function getValidationSummary(validation: HookValidationResult): string {
  const parts: string[] = [];
  
  if (validation.valid) {
    parts.push('✅ Validation passed');
  } else {
    parts.push(`❌ Validation failed with ${validation.errors.length} error(s)`);
  }
  
  if (validation.warnings.length > 0) {
    parts.push(`⚠️  ${validation.warnings.length} warning(s)`);
  }
  
  return parts.join(', ');
}

/**
 * Utility function to format validation errors for display
 */
export function formatValidationErrors(validation: HookValidationResult): string[] {
  const messages: string[] = [];
  
  for (const error of validation.errors) {
    messages.push(`Error in ${error.field}: ${error.message} (${error.code})`);
  }
  
  for (const warning of validation.warnings) {
    const suggestion = warning.suggestion ? ` - ${warning.suggestion}` : '';
    messages.push(`Warning in ${warning.field}: ${warning.message}${suggestion}`);
  }
  
  return messages;
}