/**
 * HookExecutor Service Unit Tests
 *
 * Comprehensive tests for the HookExecutor class covering:
 * - Hook execution with output processing (exit codes and JSON)
 * - Permission request system for PreToolUse hooks
 * - Batch hook execution functionality
 * - Promise-based permission handling
 * - Error handling and timeout scenarios
 * - Hook-specific data processing
 * - Integration with the hook output parser
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type MockedFunction,
} from "vitest";

import { HookExecutor } from "../../src/services/hookExecutor.js";
import { executeCommand } from "../../src/services/hook.js";
import { parseHookOutput } from "../../src/utils/hookOutputParser.js";
import type {
  HookExecutionContext,
  ExtendedHookExecutionContext,
  HookExecutionResult,
  HookExecutionOptions,
  ParsedHookOutput,
  HookOutputResult,
  PermissionDecision,
  HookPermissionResult,
  PostToolUseOutput,
  HookEvent,
} from "../../src/types/hooks.js";

// Mock dependencies
vi.mock("../../src/services/hook.js", () => ({
  executeCommand: vi.fn(),
}));

vi.mock("../../src/utils/hookOutputParser.js", () => ({
  parseHookOutput: vi.fn(),
}));

const mockExecuteCommand = executeCommand as MockedFunction<
  typeof executeCommand
>;
const mockParseHookOutput = parseHookOutput as MockedFunction<
  typeof parseHookOutput
>;

describe("HookExecutor", () => {
  let hookExecutor: HookExecutor;
  let mockContext: ExtendedHookExecutionContext;
  let mockBasicContext: HookExecutionContext;

  beforeEach(() => {
    hookExecutor = new HookExecutor();

    mockContext = {
      event: "PreToolUse",
      toolName: "testTool",
      projectDir: "/test/project",
      timestamp: new Date(),
      sessionId: "test-session-123",
      transcriptPath: "/test/transcript.json",
      cwd: "/test/cwd",
      toolInput: { param1: "value1" },
    };

    mockBasicContext = {
      event: "PreToolUse",
      toolName: "testTool",
      projectDir: "/test/project",
      timestamp: new Date(),
    };

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    hookExecutor.clearPendingPermissions();
  });

  describe("executeHookWithOutput", () => {
    it("should execute hook and parse output successfully", async () => {
      const mockExecutionResult: HookExecutionResult = {
        success: true,
        exitCode: 0,
        stdout: '{"continue": true, "systemMessage": "Hook executed"}',
        stderr: "",
        duration: 100,
        timedOut: false,
      };

      const mockParsedOutput: ParsedHookOutput = {
        source: "json",
        continue: true,
        systemMessage: "Hook executed",
        errorMessages: [],
      };

      mockExecuteCommand.mockResolvedValue(mockExecutionResult);
      mockParseHookOutput.mockReturnValue(mockParsedOutput);

      const result = await hookExecutor.executeHookWithOutput(
        "test-command",
        mockContext,
        "PreToolUse",
      );

      expect(result).toEqual({
        executionResult: mockExecutionResult,
        parsedOutput: mockParsedOutput,
      });

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        "test-command",
        mockContext,
        undefined,
      );

      expect(mockParseHookOutput).toHaveBeenCalledWith({
        exitCode: 0,
        stdout: '{"continue": true, "systemMessage": "Hook executed"}',
        stderr: "",
        executionTime: 100,
        hookEvent: "PreToolUse",
      });
    });

    it("should handle execution with options", async () => {
      const options: HookExecutionOptions = {
        timeout: 5000,
        cwd: "/custom/dir",
        continueOnFailure: true,
      };

      const mockExecutionResult: HookExecutionResult = {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        duration: 50,
        timedOut: false,
      };

      const mockParsedOutput: ParsedHookOutput = {
        source: "exitcode",
        continue: true,
        errorMessages: [],
      };

      mockExecuteCommand.mockResolvedValue(mockExecutionResult);
      mockParseHookOutput.mockReturnValue(mockParsedOutput);

      await hookExecutor.executeHookWithOutput(
        "test-command",
        mockContext,
        "PostToolUse",
        options,
      );

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        "test-command",
        mockContext,
        options,
      );
    });

    it("should handle missing execution result fields", async () => {
      const mockExecutionResult: HookExecutionResult = {
        success: false,
        duration: 200,
        timedOut: true,
      };

      const mockParsedOutput: ParsedHookOutput = {
        source: "exitcode",
        continue: false,
        stopReason: "Process timed out",
        errorMessages: [],
      };

      mockExecuteCommand.mockResolvedValue(mockExecutionResult);
      mockParseHookOutput.mockReturnValue(mockParsedOutput);

      const result = await hookExecutor.executeHookWithOutput(
        "timeout-command",
        mockContext,
        "UserPromptSubmit",
      );

      expect(mockParseHookOutput).toHaveBeenCalledWith({
        exitCode: 0, // Default value when undefined
        stdout: "", // Default value when undefined
        stderr: "", // Default value when undefined
        executionTime: 200,
        hookEvent: "UserPromptSubmit",
      });

      expect(result.parsedOutput.continue).toBe(false);
    });

    it("should work with basic HookExecutionContext", async () => {
      const mockExecutionResult: HookExecutionResult = {
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        duration: 75,
        timedOut: false,
      };

      const mockParsedOutput: ParsedHookOutput = {
        source: "exitcode",
        continue: true,
        errorMessages: [],
      };

      mockExecuteCommand.mockResolvedValue(mockExecutionResult);
      mockParseHookOutput.mockReturnValue(mockParsedOutput);

      await hookExecutor.executeHookWithOutput(
        "basic-command",
        mockBasicContext,
        "Stop",
      );

      expect(mockExecuteCommand).toHaveBeenCalledWith(
        "basic-command",
        mockBasicContext,
        undefined,
      );
    });
  });

  describe("executePreToolUseWithPermissions", () => {
    it("should allow tool execution when hook returns 'allow'", async () => {
      const mockParsedOutput: ParsedHookOutput = {
        source: "json",
        continue: true,
        hookSpecificData: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: "Tool is safe",
          updatedInput: { param1: "updated" },
        },
        errorMessages: [],
      };

      mockExecuteCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        duration: 50,
        timedOut: false,
      });
      mockParseHookOutput.mockReturnValue(mockParsedOutput);

      const result = await hookExecutor.executePreToolUseWithPermissions(
        "allow-command",
        mockContext,
        "testTool",
        { param1: "value1" },
      );

      expect(result).toEqual({
        shouldProceed: true,
        requiresUserPermission: false,
        updatedInput: { param1: "updated" },
      });
    });

    it("should deny tool execution when hook returns 'deny'", async () => {
      const mockParsedOutput: ParsedHookOutput = {
        source: "json",
        continue: true,
        hookSpecificData: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "Tool is dangerous",
        },
        errorMessages: [],
      };

      mockExecuteCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        duration: 50,
        timedOut: false,
      });
      mockParseHookOutput.mockReturnValue(mockParsedOutput);

      const result = await hookExecutor.executePreToolUseWithPermissions(
        "deny-command",
        mockContext,
        "testTool",
        { param1: "value1" },
      );

      expect(result).toEqual({
        shouldProceed: false,
        requiresUserPermission: false,
        blockReason: "Tool is dangerous",
      });
    });

    it("should request user permission when hook returns 'ask'", async () => {
      const mockParsedOutput: ParsedHookOutput = {
        source: "json",
        continue: true,
        hookSpecificData: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason: "Need user confirmation",
          updatedInput: { param1: "modified" },
        },
        errorMessages: [],
      };

      mockExecuteCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        duration: 50,
        timedOut: false,
      });
      mockParseHookOutput.mockReturnValue(mockParsedOutput);

      const permissionCallback = vi.fn();

      const result = await hookExecutor.executePreToolUseWithPermissions(
        "ask-command",
        mockContext,
        "testTool",
        { param1: "value1" },
        permissionCallback,
      );

      expect(result.shouldProceed).toBe(false);
      expect(result.requiresUserPermission).toBe(true);
      expect(result.permissionRequest).toBeDefined();
      expect(result.permissionRequest?.toolName).toBe("testTool");
      expect(result.permissionRequest?.reason).toBe("Need user confirmation");
      expect(result.permissionRequest?.originalInput).toEqual({
        param1: "value1",
      });
      expect(result.permissionRequest?.updatedInput).toEqual({
        param1: "modified",
      });

      // Verify permission callback was called
      expect(permissionCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          toolName: "testTool",
          reason: "Need user confirmation",
          toolInput: { param1: "value1" },
        }),
      );

      // Verify permission is pending
      expect(hookExecutor.isAwaitingPermission()).toBe(true);
      expect(hookExecutor.getPendingPermissions()).toHaveLength(1);
    });

    it("should block tool when hook says not to continue", async () => {
      const mockParsedOutput: ParsedHookOutput = {
        source: "json",
        continue: false,
        stopReason: "Hook blocked execution",
        errorMessages: [],
      };

      mockExecuteCommand.mockResolvedValue({
        success: true,
        exitCode: 1,
        stdout: "",
        stderr: "",
        duration: 50,
        timedOut: false,
      });
      mockParseHookOutput.mockReturnValue(mockParsedOutput);

      const result = await hookExecutor.executePreToolUseWithPermissions(
        "block-command",
        mockContext,
        "testTool",
        { param1: "value1" },
      );

      expect(result).toEqual({
        shouldProceed: false,
        requiresUserPermission: false,
        blockReason: "Hook blocked execution",
      });
    });

    it("should handle missing hook-specific data", async () => {
      const mockParsedOutput: ParsedHookOutput = {
        source: "exitcode",
        continue: true,
        errorMessages: [],
      };

      mockExecuteCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        duration: 50,
        timedOut: false,
      });
      mockParseHookOutput.mockReturnValue(mockParsedOutput);

      const result = await hookExecutor.executePreToolUseWithPermissions(
        "basic-command",
        mockContext,
        "testTool",
        { param1: "value1" },
      );

      expect(result).toEqual({
        shouldProceed: true,
        requiresUserPermission: false,
        blockReason: undefined,
      });
    });

    it("should handle unknown permission decision", async () => {
      const mockParsedOutput: ParsedHookOutput = {
        source: "json",
        continue: true,
        hookSpecificData: {
          hookEventName: "PreToolUse",
          permissionDecision: "unknown" as "allow" | "deny" | "ask",
          permissionDecisionReason: "Unknown decision",
        },
        errorMessages: [],
      };

      mockExecuteCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        duration: 50,
        timedOut: false,
      });
      mockParseHookOutput.mockReturnValue(mockParsedOutput);

      const result = await hookExecutor.executePreToolUseWithPermissions(
        "unknown-command",
        mockContext,
        "testTool",
        { param1: "value1" },
      );

      expect(result.shouldProceed).toBe(true);
      expect(result.requiresUserPermission).toBe(false);
    });
  });

  describe("executeHooksWithOutput", () => {
    it("should execute multiple hooks successfully", async () => {
      const commands = ["command1", "command2", "command3"];

      const mockResults = [
        {
          executionResult: {
            success: true,
            exitCode: 0,
            stdout: "",
            stderr: "",
            duration: 50,
            timedOut: false,
          },
          parsedOutput: {
            source: "exitcode" as const,
            continue: true,
            errorMessages: [],
          },
        },
        {
          executionResult: {
            success: true,
            exitCode: 0,
            stdout: '{"continue": true}',
            stderr: "",
            duration: 75,
            timedOut: false,
          },
          parsedOutput: {
            source: "json" as const,
            continue: true,
            errorMessages: [],
          },
        },
        {
          executionResult: {
            success: true,
            exitCode: 0,
            stdout: "",
            stderr: "",
            duration: 100,
            timedOut: false,
          },
          parsedOutput: {
            source: "exitcode" as const,
            continue: true,
            errorMessages: [],
          },
        },
      ];

      // Mock the executeHookWithOutput method to return our test results
      vi.spyOn(hookExecutor, "executeHookWithOutput")
        .mockResolvedValueOnce(mockResults[0])
        .mockResolvedValueOnce(mockResults[1])
        .mockResolvedValueOnce(mockResults[2]);

      const results = await hookExecutor.executeHooksWithOutput(
        commands,
        mockContext,
        "PostToolUse",
      );

      expect(results).toEqual(mockResults);
      expect(hookExecutor.executeHookWithOutput).toHaveBeenCalledTimes(3);
      expect(hookExecutor.executeHookWithOutput).toHaveBeenNthCalledWith(
        1,
        "command1",
        mockContext,
        "PostToolUse",
        undefined,
      );
    });

    it("should stop on first failure when continueOnFailure is false", async () => {
      const commands = ["command1", "command2", "command3"];

      const mockResults = [
        {
          executionResult: {
            success: true,
            exitCode: 0,
            stdout: "",
            stderr: "",
            duration: 50,
            timedOut: false,
          },
          parsedOutput: {
            source: "exitcode" as const,
            continue: true,
            errorMessages: [],
          },
        },
        {
          executionResult: {
            success: false, // This should stop execution
            exitCode: 1,
            stdout: "",
            stderr: "Command failed",
            duration: 75,
            timedOut: false,
          },
          parsedOutput: {
            source: "exitcode" as const,
            continue: false,
            stopReason: "Command failed",
            errorMessages: [],
          },
        },
      ];

      vi.spyOn(hookExecutor, "executeHookWithOutput")
        .mockResolvedValueOnce(mockResults[0])
        .mockResolvedValueOnce(mockResults[1]);

      const results = await hookExecutor.executeHooksWithOutput(
        commands,
        mockContext,
        "PostToolUse",
      );

      expect(results).toEqual([mockResults[0], mockResults[1]]);
      expect(hookExecutor.executeHookWithOutput).toHaveBeenCalledTimes(2);
    });

    it("should continue on failure when continueOnFailure is true", async () => {
      const commands = ["command1", "command2", "command3"];
      const options: HookExecutionOptions = { continueOnFailure: true };

      const mockResults = [
        {
          executionResult: {
            success: true,
            exitCode: 0,
            stdout: "",
            stderr: "",
            duration: 50,
            timedOut: false,
          },
          parsedOutput: {
            source: "exitcode" as const,
            continue: true,
            errorMessages: [],
          },
        },
        {
          executionResult: {
            success: false, // This should NOT stop execution due to continueOnFailure
            exitCode: 1,
            stdout: "",
            stderr: "Command failed",
            duration: 75,
            timedOut: false,
          },
          parsedOutput: {
            source: "exitcode" as const,
            continue: true, // Hook continues despite execution failure
            errorMessages: [],
          },
        },
        {
          executionResult: {
            success: true,
            exitCode: 0,
            stdout: "",
            stderr: "",
            duration: 100,
            timedOut: false,
          },
          parsedOutput: {
            source: "exitcode" as const,
            continue: true,
            errorMessages: [],
          },
        },
      ];

      vi.spyOn(hookExecutor, "executeHookWithOutput")
        .mockResolvedValueOnce(mockResults[0])
        .mockResolvedValueOnce(mockResults[1])
        .mockResolvedValueOnce(mockResults[2]);

      const results = await hookExecutor.executeHooksWithOutput(
        commands,
        mockContext,
        "PostToolUse",
        options,
      );

      expect(results).toEqual(mockResults);
      expect(hookExecutor.executeHookWithOutput).toHaveBeenCalledTimes(3);
    });

    it("should stop when hook output indicates to stop", async () => {
      const commands = ["command1", "command2", "command3"];

      const mockResults = [
        {
          executionResult: {
            success: true,
            exitCode: 0,
            stdout: "",
            stderr: "",
            duration: 50,
            timedOut: false,
          },
          parsedOutput: {
            source: "exitcode" as const,
            continue: true,
            errorMessages: [],
          },
        },
        {
          executionResult: {
            success: true, // Execution successful
            exitCode: 0,
            stdout: '{"continue": false}',
            stderr: "",
            duration: 75,
            timedOut: false,
          },
          parsedOutput: {
            source: "json" as const,
            continue: false, // But hook says to stop
            stopReason: "Hook requested stop",
            errorMessages: [],
          },
        },
      ];

      vi.spyOn(hookExecutor, "executeHookWithOutput")
        .mockResolvedValueOnce(mockResults[0])
        .mockResolvedValueOnce(mockResults[1]);

      const results = await hookExecutor.executeHooksWithOutput(
        commands,
        mockContext,
        "UserPromptSubmit",
      );

      expect(results).toEqual([mockResults[0], mockResults[1]]);
      expect(hookExecutor.executeHookWithOutput).toHaveBeenCalledTimes(2);
    });

    it("should handle empty command list", async () => {
      // Spy on the method to ensure it's not called
      const executeSpy = vi.spyOn(hookExecutor, "executeHookWithOutput");

      const results = await hookExecutor.executeHooksWithOutput(
        [],
        mockContext,
        "Stop",
      );

      expect(results).toEqual([]);
      expect(executeSpy).not.toHaveBeenCalled();

      executeSpy.mockRestore();
    });

    it("should pass options to each hook execution", async () => {
      const commands = ["command1"];
      const options: HookExecutionOptions = {
        timeout: 3000,
        cwd: "/custom/dir",
        continueOnFailure: true,
      };

      vi.spyOn(hookExecutor, "executeHookWithOutput").mockResolvedValueOnce({
        executionResult: {
          success: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          duration: 50,
          timedOut: false,
        },
        parsedOutput: {
          source: "exitcode" as const,
          continue: true,
          errorMessages: [],
        },
      });

      await hookExecutor.executeHooksWithOutput(
        commands,
        mockContext,
        "PostToolUse",
        options,
      );

      expect(hookExecutor.executeHookWithOutput).toHaveBeenCalledWith(
        "command1",
        mockContext,
        "PostToolUse",
        options,
      );
    });
  });

  describe("Permission Management", () => {
    describe("resolvePermissionRequest", () => {
      it("should resolve pending permission with allow decision", async () => {
        // Setup: Create a permission request through PreToolUse
        const mockParsedOutput: ParsedHookOutput = {
          source: "json",
          continue: true,
          hookSpecificData: {
            hookEventName: "PreToolUse",
            permissionDecision: "ask",
            permissionDecisionReason: "Need confirmation",
          },
          errorMessages: [],
        };

        mockExecuteCommand.mockResolvedValue({
          success: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          duration: 50,
          timedOut: false,
        });
        mockParseHookOutput.mockReturnValue(mockParsedOutput);

        const result = await hookExecutor.executePreToolUseWithPermissions(
          "ask-command",
          mockContext,
          "testTool",
          { param1: "value1" },
        );

        const permissionId = result.permissionRequest?.id;
        expect(permissionId).toBeDefined();

        // Test: Resolve with allow decision
        const decision: PermissionDecision = {
          decision: "allow",
          shouldContinueRecursion: true,
        };

        hookExecutor.resolvePermissionRequest(permissionId!, decision);

        // Verify: Permission should be removed from pending
        expect(hookExecutor.isAwaitingPermission()).toBe(false);
        expect(hookExecutor.getPendingPermissions()).toHaveLength(0);
      });

      it("should resolve pending permission with deny decision", async () => {
        // Setup: Create a permission request
        const mockParsedOutput: ParsedHookOutput = {
          source: "json",
          continue: true,
          hookSpecificData: {
            hookEventName: "PreToolUse",
            permissionDecision: "ask",
            permissionDecisionReason: "Need confirmation",
          },
          errorMessages: [],
        };

        mockExecuteCommand.mockResolvedValue({
          success: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          duration: 50,
          timedOut: false,
        });
        mockParseHookOutput.mockReturnValue(mockParsedOutput);

        const result = await hookExecutor.executePreToolUseWithPermissions(
          "ask-command",
          mockContext,
          "testTool",
          { param1: "value1" },
        );

        const permissionId = result.permissionRequest?.id;

        // Test: Resolve with deny decision
        const decision: PermissionDecision = {
          decision: "deny",
          shouldContinueRecursion: false,
          reason: "User denied permission",
        };

        hookExecutor.resolvePermissionRequest(permissionId!, decision);

        expect(hookExecutor.isAwaitingPermission()).toBe(false);
        expect(hookExecutor.getPendingPermissions()).toHaveLength(0);
      });

      it("should handle resolving non-existent permission", () => {
        // Test: Try to resolve a permission that doesn't exist
        const decision: PermissionDecision = {
          decision: "allow",
          shouldContinueRecursion: true,
        };

        // This should not throw an error
        expect(() => {
          hookExecutor.resolvePermissionRequest("non-existent-id", decision);
        }).not.toThrow();

        expect(hookExecutor.isAwaitingPermission()).toBe(false);
      });
    });

    describe("getPendingPermissions", () => {
      it("should return all pending permissions", async () => {
        // Setup: Create multiple permission requests
        const mockParsedOutput: ParsedHookOutput = {
          source: "json",
          continue: true,
          hookSpecificData: {
            hookEventName: "PreToolUse",
            permissionDecision: "ask",
            permissionDecisionReason: "Need confirmation",
          },
          errorMessages: [],
        };

        mockExecuteCommand.mockResolvedValue({
          success: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          duration: 50,
          timedOut: false,
        });
        mockParseHookOutput.mockReturnValue(mockParsedOutput);

        // Create first permission
        await hookExecutor.executePreToolUseWithPermissions(
          "ask-command-1",
          mockContext,
          "tool1",
          { param1: "value1" },
        );

        // Create second permission
        await hookExecutor.executePreToolUseWithPermissions(
          "ask-command-2",
          { ...mockContext, toolName: "tool2" },
          "tool2",
          { param2: "value2" },
        );

        const pendingPermissions = hookExecutor.getPendingPermissions();

        expect(pendingPermissions).toHaveLength(2);
        expect(pendingPermissions[0].toolName).toBe("tool1");
        expect(pendingPermissions[1].toolName).toBe("tool2");
        expect(pendingPermissions[0].reason).toBe("Need confirmation");
        expect(pendingPermissions[1].reason).toBe("Need confirmation");
      });

      it("should return empty array when no permissions pending", () => {
        const pendingPermissions = hookExecutor.getPendingPermissions();
        expect(pendingPermissions).toEqual([]);
      });
    });

    describe("isAwaitingPermission", () => {
      it("should return true when permissions are pending", async () => {
        expect(hookExecutor.isAwaitingPermission()).toBe(false);

        // Create a permission request
        const mockParsedOutput: ParsedHookOutput = {
          source: "json",
          continue: true,
          hookSpecificData: {
            hookEventName: "PreToolUse",
            permissionDecision: "ask",
            permissionDecisionReason: "Need confirmation",
          },
          errorMessages: [],
        };

        mockExecuteCommand.mockResolvedValue({
          success: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          duration: 50,
          timedOut: false,
        });
        mockParseHookOutput.mockReturnValue(mockParsedOutput);

        await hookExecutor.executePreToolUseWithPermissions(
          "ask-command",
          mockContext,
          "testTool",
          { param1: "value1" },
        );

        expect(hookExecutor.isAwaitingPermission()).toBe(true);
      });

      it("should return false when no permissions are pending", () => {
        expect(hookExecutor.isAwaitingPermission()).toBe(false);
      });
    });

    describe("clearPendingPermissions", () => {
      it("should clear all pending permissions", async () => {
        // Setup: Create permission requests
        const mockParsedOutput: ParsedHookOutput = {
          source: "json",
          continue: true,
          hookSpecificData: {
            hookEventName: "PreToolUse",
            permissionDecision: "ask",
            permissionDecisionReason: "Need confirmation",
          },
          errorMessages: [],
        };

        mockExecuteCommand.mockResolvedValue({
          success: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          duration: 50,
          timedOut: false,
        });
        mockParseHookOutput.mockReturnValue(mockParsedOutput);

        await hookExecutor.executePreToolUseWithPermissions(
          "ask-command",
          mockContext,
          "testTool",
          { param1: "value1" },
        );

        expect(hookExecutor.isAwaitingPermission()).toBe(true);

        // Test: Clear all permissions
        hookExecutor.clearPendingPermissions();

        expect(hookExecutor.isAwaitingPermission()).toBe(false);
        expect(hookExecutor.getPendingPermissions()).toHaveLength(0);
      });
    });
  });

  describe("Error Handling and Timeout Scenarios", () => {
    it("should handle hook execution errors", async () => {
      const error = new Error("Command execution failed");
      mockExecuteCommand.mockRejectedValue(error);

      await expect(
        hookExecutor.executeHookWithOutput(
          "failing-command",
          mockContext,
          "PreToolUse",
        ),
      ).rejects.toThrow("Command execution failed");

      expect(mockParseHookOutput).not.toHaveBeenCalled();
    });

    it("should handle timeout scenarios", async () => {
      const mockExecutionResult: HookExecutionResult = {
        success: false,
        exitCode: 124, // Typical timeout exit code
        stdout: "",
        stderr: "Command timed out",
        duration: 10000,
        timedOut: true,
      };

      const mockParsedOutput: ParsedHookOutput = {
        source: "exitcode",
        continue: false,
        stopReason: "Process timed out",
        errorMessages: ["Command execution timed out"],
      };

      mockExecuteCommand.mockResolvedValue(mockExecutionResult);
      mockParseHookOutput.mockReturnValue(mockParsedOutput);

      const result = await hookExecutor.executeHookWithOutput(
        "timeout-command",
        mockContext,
        "PostToolUse",
      );

      expect(result.executionResult.timedOut).toBe(true);
      expect(result.parsedOutput.continue).toBe(false);
      expect(result.parsedOutput.stopReason).toBe("Process timed out");
    });

    it("should handle parsing errors gracefully", async () => {
      const mockExecutionResult: HookExecutionResult = {
        success: true,
        exitCode: 0,
        stdout: "invalid json output",
        stderr: "",
        duration: 50,
        timedOut: false,
      };

      const mockParsedOutput: ParsedHookOutput = {
        source: "exitcode", // Fallback to exit code when JSON parsing fails
        continue: true,
        errorMessages: ["Failed to parse JSON output"],
      };

      mockExecuteCommand.mockResolvedValue(mockExecutionResult);
      mockParseHookOutput.mockReturnValue(mockParsedOutput);

      const result = await hookExecutor.executeHookWithOutput(
        "invalid-json-command",
        mockContext,
        "UserPromptSubmit",
      );

      expect(result.parsedOutput.source).toBe("exitcode");
      expect(result.parsedOutput.errorMessages).toContain(
        "Failed to parse JSON output",
      );
    });

    it("should handle batch execution with errors", async () => {
      const commands = ["command1", "command2", "command3"];

      const successResult = {
        executionResult: {
          success: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          duration: 50,
          timedOut: false,
        },
        parsedOutput: {
          source: "exitcode" as const,
          continue: true,
          errorMessages: [],
        },
      };

      const errorResult = {
        executionResult: {
          success: false,
          exitCode: 1,
          stdout: "",
          stderr: "Command failed",
          duration: 75,
          timedOut: false,
        },
        parsedOutput: {
          source: "exitcode" as const,
          continue: false,
          stopReason: "Command execution failed",
          errorMessages: ["Process exited with code 1"],
        },
      };

      vi.spyOn(hookExecutor, "executeHookWithOutput")
        .mockResolvedValueOnce(successResult)
        .mockResolvedValueOnce(errorResult);

      const results = await hookExecutor.executeHooksWithOutput(
        commands,
        mockContext,
        "PostToolUse",
      );

      expect(results).toEqual([successResult, errorResult]);
      expect(hookExecutor.executeHookWithOutput).toHaveBeenCalledTimes(2); // Should stop after error
    });

    it("should handle permission timeout in processHookOutput", async () => {
      const mockParsedOutput: ParsedHookOutput = {
        source: "json",
        continue: true,
        hookSpecificData: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason: "Need user confirmation",
        },
        errorMessages: [],
      };

      mockExecuteCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        duration: 50,
        timedOut: false,
      });
      mockParseHookOutput.mockReturnValue(mockParsedOutput);

      const result = await hookExecutor.processHookOutput(
        "ask-command",
        mockContext,
        "PreToolUse",
        "testTool",
        { param1: "value1" },
      );

      expect(result.permissionRequired).toBe(true);
      expect(result.permissionPromise).toBeInstanceOf(Promise);

      // Test timeout scenario by rejecting the permission
      const permissionId = hookExecutor.getPendingPermissions()[0].id;

      // Simulate timeout by rejecting the permission promise
      setTimeout(() => {
        const decision: PermissionDecision = {
          decision: "deny",
          shouldContinueRecursion: false,
          reason: "Permission request timed out",
        };
        hookExecutor.resolvePermissionRequest(permissionId, decision);
      }, 10);

      await expect(result.permissionPromise).rejects.toThrow(
        "Permission request timed out",
      );
    });

    it("should handle malformed hook output", async () => {
      const mockExecutionResult: HookExecutionResult = {
        success: true,
        exitCode: 0,
        stdout: '{"malformed": json', // Invalid JSON
        stderr: "",
        duration: 50,
        timedOut: false,
      };

      const mockParsedOutput: ParsedHookOutput = {
        source: "exitcode", // Parser should fallback to exit code
        continue: true,
        errorMessages: ["Invalid JSON format in hook output"],
      };

      mockExecuteCommand.mockResolvedValue(mockExecutionResult);
      mockParseHookOutput.mockReturnValue(mockParsedOutput);

      const result = await hookExecutor.executeHookWithOutput(
        "malformed-output-command",
        mockContext,
        "Stop",
      );

      expect(result.parsedOutput.source).toBe("exitcode");
      expect(result.parsedOutput.errorMessages).toContain(
        "Invalid JSON format in hook output",
      );
    });
  });

  describe("processHookOutput", () => {
    it("should process hook output for general usage", async () => {
      const mockParsedOutput: ParsedHookOutput = {
        source: "json",
        continue: true,
        systemMessage: "Hook processed successfully",
        errorMessages: [],
      };

      mockExecuteCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout:
          '{"continue": true, "systemMessage": "Hook processed successfully"}',
        stderr: "",
        duration: 50,
        timedOut: false,
      });
      mockParseHookOutput.mockReturnValue(mockParsedOutput);

      const result = await hookExecutor.processHookOutput(
        "general-command",
        mockContext,
        "PostToolUse",
      );

      expect(result).toEqual({
        shouldContinue: true,
        permissionRequired: false,
      });
    });

    it("should handle PreToolUse with 'ask' permission decision", async () => {
      const mockParsedOutput: ParsedHookOutput = {
        source: "json",
        continue: true,
        hookSpecificData: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason: "Need user confirmation",
          updatedInput: { param1: "modified" },
        },
        errorMessages: [],
      };

      mockExecuteCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        duration: 50,
        timedOut: false,
      });
      mockParseHookOutput.mockReturnValue(mockParsedOutput);

      const result = await hookExecutor.processHookOutput(
        "ask-command",
        mockContext,
        "PreToolUse",
        "testTool",
        { param1: "value1" },
      );

      expect(result.permissionRequired).toBe(true);
      expect(result.permissionPromise).toBeInstanceOf(Promise);
      expect(result.updatedInput).toEqual({ param1: "modified" });
      expect(hookExecutor.isAwaitingPermission()).toBe(true);
    });

    it("should handle PreToolUse with 'deny' permission decision", async () => {
      const mockParsedOutput: ParsedHookOutput = {
        source: "json",
        continue: true,
        hookSpecificData: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "Tool is not allowed",
        },
        errorMessages: [],
      };

      mockExecuteCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        duration: 50,
        timedOut: false,
      });
      mockParseHookOutput.mockReturnValue(mockParsedOutput);

      const result = await hookExecutor.processHookOutput(
        "deny-command",
        mockContext,
        "PreToolUse",
        "testTool",
        { param1: "value1" },
      );

      expect(result).toEqual({
        shouldContinue: false,
        permissionRequired: false,
        blockReason: "Tool is not allowed",
      });
    });

    it("should handle PreToolUse with 'allow' and updated input", async () => {
      const mockParsedOutput: ParsedHookOutput = {
        source: "json",
        continue: true,
        hookSpecificData: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: "Tool is safe",
          updatedInput: { param1: "sanitized", param2: "added" },
        },
        errorMessages: [],
      };

      mockExecuteCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        duration: 50,
        timedOut: false,
      });
      mockParseHookOutput.mockReturnValue(mockParsedOutput);

      const result = await hookExecutor.processHookOutput(
        "allow-command",
        mockContext,
        "PreToolUse",
        "testTool",
        { param1: "value1" },
      );

      expect(result).toEqual({
        shouldContinue: true,
        permissionRequired: false,
        updatedInput: { param1: "sanitized", param2: "added" },
      });
    });

    it("should handle non-PreToolUse events", async () => {
      const mockParsedOutput: ParsedHookOutput = {
        source: "json",
        continue: true,
        hookSpecificData: {
          hookEventName: "PostToolUse",
          decision: "block",
          reason: "Post-tool validation failed",
        } as PostToolUseOutput,
        errorMessages: [],
      };

      mockExecuteCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        duration: 50,
        timedOut: false,
      });
      mockParseHookOutput.mockReturnValue(mockParsedOutput);

      const result = await hookExecutor.processHookOutput(
        "post-tool-command",
        mockContext,
        "PostToolUse",
      );

      expect(result).toEqual({
        shouldContinue: true,
        permissionRequired: false,
      });
    });

    it("should handle hook output with stop reason", async () => {
      const mockParsedOutput: ParsedHookOutput = {
        source: "exitcode",
        continue: false,
        stopReason: "Hook blocked execution",
        errorMessages: [],
      };

      mockExecuteCommand.mockResolvedValue({
        success: false,
        exitCode: 1,
        stdout: "",
        stderr: "",
        duration: 50,
        timedOut: false,
      });
      mockParseHookOutput.mockReturnValue(mockParsedOutput);

      const result = await hookExecutor.processHookOutput(
        "block-command",
        mockContext,
        "UserPromptSubmit",
      );

      expect(result).toEqual({
        shouldContinue: false,
        permissionRequired: false,
        blockReason: "Hook blocked execution",
      });
    });

    it("should handle missing toolName for PreToolUse ask decision", async () => {
      const mockParsedOutput: ParsedHookOutput = {
        source: "json",
        continue: true,
        hookSpecificData: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason: "Need confirmation",
        },
        errorMessages: [],
      };

      mockExecuteCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: "",
        stderr: "",
        duration: 50,
        timedOut: false,
      });
      mockParseHookOutput.mockReturnValue(mockParsedOutput);

      // Call without toolName
      const result = await hookExecutor.processHookOutput(
        "ask-command",
        mockContext,
        "PreToolUse",
      );

      // Should not create permission request without toolName
      expect(result).toEqual({
        shouldContinue: true,
        permissionRequired: false,
      });
      expect(hookExecutor.isAwaitingPermission()).toBe(false);
    });
  });

  describe("Integration with Hook Output Parser", () => {
    it("should correctly pass HookOutputResult to parseHookOutput", async () => {
      const mockExecutionResult: HookExecutionResult = {
        success: true,
        exitCode: 5,
        stdout: '{"continue": false, "stopReason": "Custom stop"}',
        stderr: "Warning message",
        duration: 125,
        timedOut: false,
      };

      const expectedHookOutputResult: HookOutputResult = {
        exitCode: 5,
        stdout: '{"continue": false, "stopReason": "Custom stop"}',
        stderr: "Warning message",
        executionTime: 125,
        hookEvent: "UserPromptSubmit",
      };

      const mockParsedOutput: ParsedHookOutput = {
        source: "json",
        continue: false,
        stopReason: "Custom stop",
        errorMessages: [],
      };

      mockExecuteCommand.mockResolvedValue(mockExecutionResult);
      mockParseHookOutput.mockReturnValue(mockParsedOutput);

      await hookExecutor.executeHookWithOutput(
        "test-command",
        mockContext,
        "UserPromptSubmit",
      );

      expect(mockParseHookOutput).toHaveBeenCalledWith(
        expectedHookOutputResult,
      );
    });

    it("should handle different hook events correctly", async () => {
      const events: Array<{
        event: string;
        context: HookExecutionContext | ExtendedHookExecutionContext;
      }> = [
        {
          event: "PreToolUse",
          context: mockContext as ExtendedHookExecutionContext,
        },
        {
          event: "PostToolUse",
          context: mockContext as ExtendedHookExecutionContext,
        },
        {
          event: "UserPromptSubmit",
          context: mockBasicContext as HookExecutionContext,
        },
        { event: "Stop", context: mockBasicContext as HookExecutionContext },
      ];

      for (const { event, context } of events) {
        mockExecuteCommand.mockResolvedValue({
          success: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          duration: 50,
          timedOut: false,
        });

        mockParseHookOutput.mockReturnValue({
          source: "exitcode",
          continue: true,
          errorMessages: [],
        });

        await hookExecutor.executeHookWithOutput(
          `${event}-command`,
          context,
          event as HookEvent,
        );

        expect(mockParseHookOutput).toHaveBeenCalledWith(
          expect.objectContaining({
            hookEvent: event,
          }),
        );
      }
    });

    it("should preserve parser error messages", async () => {
      const mockParsedOutput: ParsedHookOutput = {
        source: "json",
        continue: true,
        errorMessages: [
          "Warning: Invalid field 'unknown' in JSON output",
          "Info: Using default value for missing 'continue' field",
        ],
      };

      mockExecuteCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout: '{"unknown": "field", "continue": true}',
        stderr: "",
        duration: 50,
        timedOut: false,
      });
      mockParseHookOutput.mockReturnValue(mockParsedOutput);

      const result = await hookExecutor.executeHookWithOutput(
        "warning-command",
        mockContext,
        "PostToolUse",
      );

      expect(result.parsedOutput.errorMessages).toHaveLength(2);
      expect(result.parsedOutput.errorMessages).toContain(
        "Warning: Invalid field 'unknown' in JSON output",
      );
      expect(result.parsedOutput.errorMessages).toContain(
        "Info: Using default value for missing 'continue' field",
      );
    });

    it("should handle hook-specific validation results", async () => {
      const mockParsedOutput: ParsedHookOutput = {
        source: "json",
        continue: true,
        hookSpecificData: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: "Tool validated successfully",
          updatedInput: { sanitized: true },
        },
        errorMessages: ["Info: Input was sanitized"],
      };

      mockExecuteCommand.mockResolvedValue({
        success: true,
        exitCode: 0,
        stdout:
          '{"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow"}}',
        stderr: "",
        duration: 50,
        timedOut: false,
      });
      mockParseHookOutput.mockReturnValue(mockParsedOutput);

      const result = await hookExecutor.executeHookWithOutput(
        "validation-command",
        mockContext,
        "PreToolUse",
      );

      expect(result.parsedOutput.hookSpecificData).toEqual({
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason: "Tool validated successfully",
        updatedInput: { sanitized: true },
      });
    });
  });

  describe("Convenience Functions", () => {
    // Reset all mocks before testing convenience functions
    beforeEach(() => {
      vi.clearAllMocks();
      vi.resetModules();
    });

    describe("executeHookWithOutput function", () => {
      it("should delegate to default hookExecutor instance", async () => {
        const mockResult = {
          executionResult: {
            success: true,
            exitCode: 0,
            stdout: "",
            stderr: "",
            duration: 50,
            timedOut: false,
          },
          parsedOutput: {
            source: "exitcode" as const,
            continue: true,
            errorMessages: [],
          },
        };

        // Set up fresh mocks for the convenience function test
        mockExecuteCommand.mockResolvedValue(mockResult.executionResult);
        mockParseHookOutput.mockReturnValue(mockResult.parsedOutput);

        // Import the convenience function
        const { executeHookWithOutput: convenienceFunction } = await import(
          "../../src/services/hookExecutor.js"
        );

        const result = await convenienceFunction(
          "test-command",
          mockContext,
          "PostToolUse",
        );

        expect(result).toEqual(mockResult);
      });
    });

    describe("executePreToolUseWithPermissions function", () => {
      it("should delegate to default hookExecutor instance", async () => {
        /* const mockResult: PreToolUseResult = {
          shouldProceed: true,
          requiresUserPermission: false,
        }; */

        // Set up mocks to return a simple allow result
        const mockParsedOutput: ParsedHookOutput = {
          source: "json",
          continue: true,
          hookSpecificData: {
            hookEventName: "PreToolUse",
            permissionDecision: "allow",
            permissionDecisionReason: "Tool is safe",
          },
          errorMessages: [],
        };

        mockExecuteCommand.mockResolvedValue({
          success: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          duration: 50,
          timedOut: false,
        });
        mockParseHookOutput.mockReturnValue(mockParsedOutput);

        const { executePreToolUseWithPermissions: convenienceFunction } =
          await import("../../src/services/hookExecutor.js");

        const permissionCallback = vi.fn();
        const result = await convenienceFunction(
          "test-command",
          mockContext,
          "testTool",
          { param1: "value1" },
          permissionCallback,
        );

        expect(result.shouldProceed).toBe(true);
        expect(result.requiresUserPermission).toBe(false);
      });
    });

    describe("processHookOutput function", () => {
      it("should delegate to default hookExecutor instance", async () => {
        const mockResult: HookPermissionResult = {
          shouldContinue: true,
          permissionRequired: false,
        };

        // Set up simple mocks
        const mockParsedOutput: ParsedHookOutput = {
          source: "json",
          continue: true,
          errorMessages: [],
        };

        mockExecuteCommand.mockResolvedValue({
          success: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          duration: 50,
          timedOut: false,
        });
        mockParseHookOutput.mockReturnValue(mockParsedOutput);

        const { processHookOutput: convenienceFunction } = await import(
          "../../src/services/hookExecutor.js"
        );

        const result = await convenienceFunction(
          "test-command",
          mockContext,
          "PostToolUse", // Use PostToolUse to avoid PreToolUse-specific logic
          "testTool",
          { param1: "value1" },
        );

        expect(result).toEqual(mockResult);
      });
    });
  });
});
