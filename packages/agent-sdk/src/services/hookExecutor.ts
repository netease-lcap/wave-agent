/**
 * Hook Executor Service
 * 
 * Extends hook execution with advanced output processing capabilities including
 * exit code interpretation, JSON output parsing, and Promise-based permission handling.
 */

import { executeCommand } from "./hook.js";
import { parseHookOutput } from "../utils/hookOutputParser.js";
import type {
  HookOutputResult,
  ParsedHookOutput,
  HookExecutionContext,
  ExtendedHookExecutionContext,
  HookExecutionResult,
  HookExecutionOptions,
  HookEventName,
  PermissionRequest,
  PermissionDecision,
  PendingPermission,
  PreToolUseResult,
  HookPermissionResult
} from "../types/hooks.js";

/**
 * Enhanced hook executor with output processing
 */
export class HookExecutor {
  private pendingPermissions: Map<string, PendingPermission> = new Map();

  /**
   * Execute a hook with full output processing (exit codes and JSON)
   */
  async executeHookWithOutput(
    command: string,
    context: HookExecutionContext | ExtendedHookExecutionContext,
    hookEvent: HookEventName,
    options?: HookExecutionOptions
  ): Promise<{ executionResult: HookExecutionResult; parsedOutput: ParsedHookOutput }> {
    // Execute the hook command
    const executionResult = await executeCommand(command, context, options);
    
    // Create hook output result for parsing
    const hookOutputResult: HookOutputResult = {
      exitCode: executionResult.exitCode ?? 0,
      stdout: executionResult.stdout ?? "",
      stderr: executionResult.stderr ?? "",
      executionTime: executionResult.duration,
      hookEvent
    };

    // Parse the hook output
    const parsedOutput = parseHookOutput(hookOutputResult);

    return { executionResult, parsedOutput };
  }

  /**
   * Execute multiple hooks with output processing
   */
  async executeHooksWithOutput(
    commands: string[],
    context: HookExecutionContext | ExtendedHookExecutionContext,
    hookEvent: HookEventName,
    options?: HookExecutionOptions
  ): Promise<Array<{ executionResult: HookExecutionResult; parsedOutput: ParsedHookOutput }>> {
    const results: Array<{ executionResult: HookExecutionResult; parsedOutput: ParsedHookOutput }> = [];

    for (const command of commands) {
      const result = await this.executeHookWithOutput(command, context, hookEvent, options);
      results.push(result);

      // Stop on first failure unless continueOnFailure is set
      if (!result.executionResult.success && !options?.continueOnFailure) {
        break;
      }

      // Stop if hook output indicates to stop
      if (!result.parsedOutput.continue) {
        break;
      }
    }

    return results;
  }

  /**
   * Execute PreToolUse hook with Promise-based permission handling
   */
  async executePreToolUseWithPermissions(
    command: string,
    context: ExtendedHookExecutionContext,
    toolName: string,
    toolInput: Record<string, unknown>,
    permissionCallback?: (request: PermissionRequest) => void
  ): Promise<PreToolUseResult> {
    const { parsedOutput } = await this.executeHookWithOutput(
      command, 
      context, 
      "PreToolUse"
    );

    // If hook failed or says not to continue, block the tool
    if (!parsedOutput.continue) {
      return {
        shouldProceed: false,
        requiresUserPermission: false,
        blockReason: parsedOutput.stopReason || "Hook blocked tool execution"
      };
    }

    // Check if we have PreToolUse-specific output
    if (parsedOutput.hookSpecificData?.hookEventName === "PreToolUse") {
      const preToolData = parsedOutput.hookSpecificData;
      
      switch (preToolData.permissionDecision) {
        case "allow":
          return {
            shouldProceed: true,
            requiresUserPermission: false,
            updatedInput: preToolData.updatedInput || toolInput
          };

        case "deny":
          return {
            shouldProceed: false,
            requiresUserPermission: false,
            blockReason: preToolData.permissionDecisionReason
          };

        case "ask": {
          // Create permission request for user confirmation
          const permissionRequest = this.createPermissionRequest(
            toolName,
            preToolData.permissionDecisionReason,
            toolInput,
            preToolData.updatedInput
          );

          // Notify callback if provided
          if (permissionCallback) {
            permissionCallback(permissionRequest);
          }

          return {
            shouldProceed: false, // Will be resolved by permission Promise
            requiresUserPermission: true,
            permissionRequest: {
              id: permissionRequest.id,
              toolName,
              reason: preToolData.permissionDecisionReason,
              originalInput: toolInput,
              updatedInput: preToolData.updatedInput,
              onResolve: (decision: PermissionDecision) => {
                this.resolvePermissionRequest(permissionRequest.id, decision);
              },
              timestamp: Date.now(),
              pauseAIRecursion: () => {
                // Implementation depends on AI Manager integration
              },
              resumeAIRecursion: (shouldContinue: boolean) => {
                // Implementation depends on AI Manager integration
                // Parameter shouldContinue will be used when implemented
                void shouldContinue;
              }
            }
          };
        }

        default:
          // Unknown permission decision, default to allow
          return {
            shouldProceed: true,
            requiresUserPermission: false,
            updatedInput: preToolData.updatedInput || toolInput
          };
      }
    }

    // No hook-specific data, use basic continue/stop logic
    return {
      shouldProceed: parsedOutput.continue,
      requiresUserPermission: false,
      blockReason: parsedOutput.stopReason
    };
  }

  /**
   * Create a Promise-based permission request
   */
  private createPermissionRequest(
    toolName: string,
    reason: string,
    toolInput?: Record<string, unknown>,
    updatedInput?: Record<string, unknown>
  ): PermissionRequest {
    const id = `perm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const request: PermissionRequest = {
      id,
      toolName,
      reason,
      toolInput,
      resolve: (allowed: boolean) => {
        // Parameter allowed will be used when implementation is complete
        void allowed;
        this.pendingPermissions.delete(id);
      },
      reject: (errorReason: string) => {
        // Parameter errorReason will be used when implementation is complete
        void errorReason;
        this.pendingPermissions.delete(id);
      }
    };

    // Store the pending permission
    const pendingPermission: PendingPermission = {
      id,
      toolName,
      reason,
      originalInput: toolInput || {},
      updatedInput,
      onResolve: (decision: PermissionDecision) => {
        if (decision.shouldContinueRecursion) {
          request.resolve(decision.decision === "allow");
        } else {
          request.reject(decision.reason || "Permission denied");
        }
      },
      timestamp: Date.now(),
      pauseAIRecursion: () => {
        // Will be implemented when integrating with AI Manager
      },
      resumeAIRecursion: (shouldContinue: boolean) => {
        // Will be implemented when integrating with AI Manager
        // Parameter shouldContinue will be used when implemented
        void shouldContinue;
      }
    };

    this.pendingPermissions.set(id, pendingPermission);
    return request;
  }

  /**
   * Resolve a permission request with user's decision
   */
  resolvePermissionRequest(permissionId: string, decision: PermissionDecision): void {
    const pendingPermission = this.pendingPermissions.get(permissionId);
    if (pendingPermission) {
      pendingPermission.onResolve(decision);
      this.pendingPermissions.delete(permissionId);
    }
  }

  /**
   * Get all pending permission requests
   */
  getPendingPermissions(): PendingPermission[] {
    return Array.from(this.pendingPermissions.values());
  }

  /**
   * Check if there are any pending permissions
   */
  isAwaitingPermission(): boolean {
    return this.pendingPermissions.size > 0;
  }

  /**
   * Clear all pending permissions (useful for cleanup)
   */
  clearPendingPermissions(): void {
    this.pendingPermissions.clear();
  }

  /**
   * Process hook output for general usage (not PreToolUse specific)
   */
  async processHookOutput(
    command: string,
    context: HookExecutionContext | ExtendedHookExecutionContext,
    hookEvent: HookEventName,
    toolName?: string,
    toolInput?: Record<string, unknown>
  ): Promise<HookPermissionResult> {
    const { parsedOutput } = await this.executeHookWithOutput(
      command,
      context,
      hookEvent
    );

    // Basic result structure
    const result: HookPermissionResult = {
      shouldContinue: parsedOutput.continue,
      permissionRequired: false
    };

    // Add block reason if stopping
    if (!parsedOutput.continue) {
      result.blockReason = parsedOutput.stopReason;
    }

    // Handle PreToolUse permission logic
    if (hookEvent === "PreToolUse" && parsedOutput.hookSpecificData?.hookEventName === "PreToolUse") {
      const preToolData = parsedOutput.hookSpecificData;
      
      if (preToolData.permissionDecision === "ask" && toolName) {
        const permissionRequest = this.createPermissionRequest(
          toolName,
          preToolData.permissionDecisionReason,
          toolInput,
          preToolData.updatedInput
        );

        // Create a Promise that resolves when the permission request is resolved
        const permissionPromise = new Promise<boolean>((resolve, reject) => {
          const originalResolve = permissionRequest.resolve;
          const originalReject = permissionRequest.reject;
          
          permissionRequest.resolve = (allowed: boolean) => {
            originalResolve(allowed);
            resolve(allowed);
          };
          
          permissionRequest.reject = (reason: string) => {
            originalReject(reason);
            reject(new Error(reason));
          };
        });

        result.permissionRequired = true;
        result.permissionPromise = permissionPromise;
        result.updatedInput = preToolData.updatedInput;
      } else if (preToolData.permissionDecision === "deny") {
        result.shouldContinue = false;
        result.blockReason = preToolData.permissionDecisionReason;
      } else if (preToolData.updatedInput) {
        result.updatedInput = preToolData.updatedInput;
      }
    }

    return result;
  }
}

/**
 * Default singleton instance
 */
export const hookExecutor = new HookExecutor();

/**
 * Convenience functions for common use cases
 */
export async function executeHookWithOutput(
  command: string,
  context: HookExecutionContext | ExtendedHookExecutionContext,
  hookEvent: HookEventName,
  options?: HookExecutionOptions
): Promise<{ executionResult: HookExecutionResult; parsedOutput: ParsedHookOutput }> {
  return hookExecutor.executeHookWithOutput(command, context, hookEvent, options);
}

export async function executePreToolUseWithPermissions(
  command: string,
  context: ExtendedHookExecutionContext,
  toolName: string,
  toolInput: Record<string, unknown>,
  permissionCallback?: (request: PermissionRequest) => void
): Promise<PreToolUseResult> {
  return hookExecutor.executePreToolUseWithPermissions(
    command,
    context,
    toolName,
    toolInput,
    permissionCallback
  );
}

export async function processHookOutput(
  command: string,
  context: HookExecutionContext | ExtendedHookExecutionContext,
  hookEvent: HookEventName,
  toolName?: string,
  toolInput?: Record<string, unknown>
): Promise<HookPermissionResult> {
  return hookExecutor.processHookOutput(command, context, hookEvent, toolName, toolInput);
}