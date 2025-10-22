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
export { HookMatcher, hookMatcher } from "./matcher.js";

// Command execution functionality
export type { IHookExecutor } from "./executor.js";
export { HookExecutor, hookExecutor } from "./executor.js";

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

// Import the exports for internal use
import { HookManager } from "./manager.js";
import { HookMatcher, hookMatcher } from "./matcher.js";
import { HookExecutor, hookExecutor } from "./executor.js";

// Convenience re-exports for common usage patterns
export const hooks = {
  // Singleton instances for simple usage
  matcher: hookMatcher,
  executor: hookExecutor,

  // Factory functions for custom instances
  createManager: (workdir: string) => new HookManager(workdir),
  createMatcher: () => new HookMatcher(),
  createExecutor: () => new HookExecutor(),
} as const;
