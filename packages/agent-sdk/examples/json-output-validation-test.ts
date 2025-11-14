#!/usr/bin/env node
/**
 * JSON Output Validation Test
 * 
 * Tests the enhanced hookOutputParser implementation for User Story 2:
 * - T014: JSON parsing with proper error handling
 * - T015: JSON schema validation for common fields
 * 
 * This demonstrates the comprehensive JSON parsing and validation capabilities.
 */

import { 
  parseHookOutput, 
  validateHookJsonOutput,
  hasValidJsonOutput,
  getValidationSummary,
  formatValidationErrors,
  hookOutputParser
} from '../src/utils/hookOutputParser.js';
import type { HookOutputResult } from '../src/types/hooks.js';

console.log('🧪 JSON Output Validation Test Suite');
console.log('=====================================\n');

// Test 1: Valid JSON with common fields
console.log('Test 1: Valid JSON with common fields');
const validJsonResult: HookOutputResult = {
  exitCode: 0,
  stdout: JSON.stringify({
    continue: false,
    stopReason: 'Test validation failed',
    systemMessage: 'This is a test system message'
  }),
  stderr: '',
  executionTime: 100,
  hookEvent: 'PostToolUse'
};

const parsedValid = parseHookOutput(validJsonResult);
console.log('Parsed Result:', parsedValid);
console.log('Source:', parsedValid.source);
console.log('Continue:', parsedValid.continue);
console.log('Stop Reason:', parsedValid.stopReason);
console.log('System Message:', parsedValid.systemMessage);
console.log('Error Messages:', parsedValid.errorMessages);
console.log();

// Test 2: JSON with validation errors
console.log('Test 2: JSON with validation errors');
const invalidJsonResult: HookOutputResult = {
  exitCode: 0,
  stdout: JSON.stringify({
    continue: 'invalid', // Should be boolean
    stopReason: '', // Empty when continue is false (after fixing)
    systemMessage: 123, // Should be string
    unknownField: 'value' // Unknown field
  }),
  stderr: '',
  executionTime: 100,
  hookEvent: 'UserPromptSubmit'
};

const parsedInvalid = parseHookOutput(invalidJsonResult);
console.log('Parsed Result:', parsedInvalid);
console.log('Source:', parsedInvalid.source);
console.log('Error Messages:', parsedInvalid.errorMessages);
console.log();

// Test 3: PreToolUse specific validation
console.log('Test 3: PreToolUse specific validation');
const preToolUseJson = {
  continue: true,
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'ask',
    permissionDecisionReason: 'This tool requires user approval',
    updatedInput: { modified: true }
  }
};

const validation = validateHookJsonOutput(preToolUseJson, 'PreToolUse');
console.log('Validation Result:', validation);
console.log('Valid:', validation.valid);
console.log('Summary:', getValidationSummary(validation));
if (!validation.valid || validation.warnings.length > 0) {
  console.log('Messages:', formatValidationErrors(validation));
}
console.log();

// Test 4: Mixed output (JSON + other text)
console.log('Test 4: Mixed output with JSON extraction');
const mixedOutputResult: HookOutputResult = {
  exitCode: 0,
  stdout: `Hook starting...
Processing tool use...
{
  "continue": true,
  "systemMessage": "Tool processed successfully"
}
Hook completed.`,
  stderr: '',
  executionTime: 200,
  hookEvent: 'PostToolUse'
};

const parsedMixed = parseHookOutput(mixedOutputResult);
console.log('Parsed Mixed Output:', parsedMixed);
console.log('Source:', parsedMixed.source);
console.log();

// Test 5: Fallback to exit code
console.log('Test 5: Fallback to exit code (no JSON)');
const exitCodeResult: HookOutputResult = {
  exitCode: 2,
  stdout: 'This is not JSON output',
  stderr: 'Some error occurred',
  executionTime: 50,
  hookEvent: 'Stop'
};

const parsedExitCode = parseHookOutput(exitCodeResult);
console.log('Parsed Exit Code Result:', parsedExitCode);
console.log('Source:', parsedExitCode.source);
console.log('Continue:', parsedExitCode.continue);
console.log('Stop Reason:', parsedExitCode.stopReason);
console.log();

// Test 6: Diagnostics
console.log('Test 6: Diagnostic information');
const diagnostics = hookOutputParser.getDiagnostics(mixedOutputResult);
console.log('Diagnostics for mixed output:', diagnostics);
console.log();

const diagnostics2 = hookOutputParser.getDiagnostics(exitCodeResult);
console.log('Diagnostics for exit code only:', diagnostics2);
console.log();

// Test 7: Utility functions
console.log('Test 7: Utility functions');
console.log('Has valid JSON (mixed):', hasValidJsonOutput(mixedOutputResult.stdout));
console.log('Has valid JSON (exit code):', hasValidJsonOutput(exitCodeResult.stdout));
console.log('Has valid JSON (empty):', hasValidJsonOutput(''));

console.log('\n✅ JSON Output Validation Test Suite Complete');
console.log('=====================================');
console.log('All tests demonstrate the enhanced JSON parsing and validation capabilities');
console.log('implementing User Story 2 requirements T014 and T015.');