/**
 * Hooks System Entry Point
 *
 * Exports all public APIs for the Wave Code hooks system.
 * This module provides a clean interface for integrating hooks
 * into AI workflows and CLI applications.
 */

// Core types and interfaces
export type {
  HookEvent,
  HookCommand,
  HookEventConfig,
  HookConfiguration,
  HookExecutionContext,
  HookExecutionResult,
  HookExecutionOptions,
  ValidationResult,
  HookEnvironment,
} from "./types.js";

// Type guards and utility functions
export {
  isValidHookEvent,
  isValidHookCommand,
  isValidHookEventConfig,
  HookExecutionError,
  HookConfigurationError,
} from "./types.js";

// Pattern matching functionality
export type { IHookMatcher } from "./matcher.js";
export { HookMatcher } from "./matcher.js";

// Command execution functionality
export type { IHookExecutor } from "./executor.js";
export { HookExecutor } from "./executor.js";

// Hook management and orchestration
export type { IHookManager } from "./manager.js";
export { HookManager } from "./manager.js";

// Settings and configuration loading
export {
  getUserHooksConfigPath,
  getProjectHooksConfigPath,
  loadUserHooksConfig,
  loadProjectHooksConfig,
  loadMergedHooksConfig,
  hasHooksConfiguration,
  getHooksConfigurationInfo,
} from "./settings.js";
