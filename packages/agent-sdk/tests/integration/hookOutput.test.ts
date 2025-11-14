import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageManager } from "../../src/managers/messageManager.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import { HookManager } from "../../src/managers/hookManager.js";
import { HookExecutor } from "../../src/services/hookExecutor.js";
import { parseHookOutput } from "../../src/utils/hookOutputParser.js";
import type {
  HookEvent,
  HookExecutionContext,
  ExtendedHookExecutionContext,
  HookOutputResult,
  HookExecutionResult,
} from "../../src/types/hooks.js";

// Mock external dependencies
vi.mock("../../src/services/aiService.js");
vi.mock("../../src/services/memory.js");
vi.mock("../../src/utils/messageOperations.js");
vi.mock("../../src/utils/convertMessagesForAPI.js");

describe("Hook Output Processing Integration", () => {
  let messageManager: MessageManager;
  let toolManager: ToolManager;
  let hookManager: HookManager;
  let hookExecutor: HookExecutor;
  let testWorkdir: string;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    testWorkdir = "/test/workdir";

    // Mock message manager
    messageManager = {
      getSessionId: vi.fn().mockReturnValue("test-session-123"),
      getTranscriptPath: vi.fn().mockReturnValue("/test/path/transcript.json"),
      processHookOutput: vi.fn(),
      updateToolBlock: vi.fn(),
      addDiffBlock: vi.fn(),
      saveSession: vi.fn(),
      addMessage: vi.fn(),
      getLastMessage: vi.fn(),
      getAllMessages: vi.fn().mockReturnValue([]),
    } as unknown as MessageManager;

    // Mock tool manager
    toolManager = {
      getToolsConfig: vi.fn().mockReturnValue([
        {
          name: "test-tool",
          description: "Test tool",
          inputSchema: { type: "object", properties: {} },
        },
      ]),
      list: vi.fn().mockReturnValue(["test-tool"]),
      execute: vi.fn(),
    } as unknown as ToolManager;

    // Mock hook manager
    hookManager = {
      executeHooks: vi.fn(),
      hasHooks: vi.fn().mockReturnValue(true),
      loadConfiguration: vi.fn(),
      getConfiguration: vi.fn(),
      validateConfiguration: vi.fn(),
    } as unknown as HookManager;

    // Initialize hook executor
    hookExecutor = new HookExecutor();
  });

  describe("Text Output Processing", () => {
    it("should process text hook output and create message", async () => {
      const hookResult: HookExecutionResult = {
        success: true,
        exitCode: 0,
        stdout:
          '{"continue": true, "systemMessage": "This is a test message from hook"}',
        stderr: "",
        duration: 100,
        timedOut: false,
      };

      const context: HookExecutionContext = {
        event: "PreToolUse" as HookEvent,
        toolName: "test-tool",
        projectDir: testWorkdir,
        timestamp: new Date(),
      };

      // Mock hook execution
      vi.mocked(hookManager.executeHooks).mockResolvedValue([hookResult]);

      // Execute hooks through hook manager
      const results = await hookManager.executeHooks(
        "PreToolUse" as HookEvent,
        context,
      );

      // Create hook output results for parsing
      const hookOutputResults: HookOutputResult[] = results.map(
        (result: HookExecutionResult) => ({
          exitCode: result.exitCode ?? 0,
          stdout: result.stdout ?? "",
          stderr: result.stderr ?? "",
          executionTime: result.duration,
          hookEvent: "PreToolUse" as HookEvent,
        }),
      );

      // Parse hook outputs
      const parsedOutputs = hookOutputResults.map((result: HookOutputResult) =>
        parseHookOutput(result),
      );

      // Process messages
      for (const parsedOutput of parsedOutputs) {
        if (parsedOutput.systemMessage) {
          (messageManager.addMessage as unknown as (msg: unknown) => void)({
            role: "assistant",
            content: parsedOutput.systemMessage,
          });
        }
      }

      expect(vi.mocked(hookManager.executeHooks)).toHaveBeenCalledWith(
        "PreToolUse",
        context,
      );
      expect(
        messageManager.addMessage as unknown as (msg: unknown) => void,
      ).toHaveBeenCalledWith({
        role: "assistant",
        content: "This is a test message from hook",
      });
    });

    it("should handle multiple text outputs from different hooks", async () => {
      const hookResults: HookExecutionResult[] = [
        {
          success: true,
          exitCode: 0,
          stdout: '{"continue": true, "systemMessage": "First hook message"}',
          stderr: "",
          duration: 100,
          timedOut: false,
        },
        {
          success: true,
          exitCode: 0,
          stdout: '{"continue": true, "systemMessage": "Second hook message"}',
          stderr: "",
          duration: 150,
          timedOut: false,
        },
        {
          success: true,
          exitCode: 0,
          stdout: '{"continue": true, "systemMessage": "Third hook message"}',
          stderr: "",
          duration: 120,
          timedOut: false,
        },
      ];

      const context: HookExecutionContext = {
        event: "PostToolUse" as HookEvent,
        toolName: "test-tool",
        projectDir: testWorkdir,
        timestamp: new Date(),
      };

      vi.mocked(hookManager.executeHooks).mockResolvedValue(hookResults);

      const results = await vi.mocked(hookManager.executeHooks)(
        "PostToolUse" as HookEvent,
        context,
      );

      // Create hook output results for parsing
      const hookOutputResults = results.map((result: HookExecutionResult) => ({
        exitCode: result.exitCode ?? 0,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        executionTime: result.duration,
        hookEvent: "PostToolUse" as HookEvent,
      }));

      const parsedOutputs = hookOutputResults.map((result: HookOutputResult) =>
        parseHookOutput(result),
      );

      for (const parsedOutput of parsedOutputs) {
        if (parsedOutput.systemMessage) {
          (messageManager.addMessage as unknown as (msg: unknown) => void)({
            role: "assistant",
            content: parsedOutput.systemMessage,
          });
        }
      }

      expect(
        messageManager.addMessage as unknown as (msg: unknown) => void,
      ).toHaveBeenCalledTimes(3);
      expect(
        messageManager.addMessage as unknown as (msg: unknown) => void,
      ).toHaveBeenNthCalledWith(1, {
        role: "assistant",
        content: "First hook message",
      });
      expect(
        messageManager.addMessage as unknown as (msg: unknown) => void,
      ).toHaveBeenNthCalledWith(2, {
        role: "assistant",
        content: "Second hook message",
      });
      expect(
        messageManager.addMessage as unknown as (msg: unknown) => void,
      ).toHaveBeenNthCalledWith(3, {
        role: "assistant",
        content: "Third hook message",
      });
    });
  });

  describe("Permission Output Processing", () => {
    it("should process permission hook output with deny decision", async () => {
      const permissionOutput = JSON.stringify({
        continue: false,
        stopReason: "Security policy violation",
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "Security policy violation",
        },
      });

      const hookResult: HookExecutionResult = {
        success: true,
        exitCode: 0,
        stdout: permissionOutput,
        stderr: "",
        duration: 100,
        timedOut: false,
      };

      const context: HookExecutionContext = {
        event: "PreToolUse" as HookEvent,
        toolName: "bash",
        projectDir: testWorkdir,
        timestamp: new Date(),
      };

      vi.mocked(hookManager.executeHooks).mockResolvedValue([hookResult]);

      const results = await vi.mocked(hookManager.executeHooks)(
        "PreToolUse" as HookEvent,
        context,
      );

      const hookOutputResult = {
        exitCode: results[0].exitCode ?? 0,
        stdout: results[0].stdout ?? "",
        stderr: results[0].stderr ?? "",
        executionTime: results[0].duration,
        hookEvent: "PreToolUse" as HookEvent,
      };

      const parsedOutput = parseHookOutput(hookOutputResult);

      expect(parsedOutput.continue).toBe(false);
      expect(parsedOutput.stopReason).toBe("Security policy violation");
      expect(parsedOutput.hookSpecificData?.hookEventName).toBe("PreToolUse");
    });

    it("should handle permission allow decision and continue execution", async () => {
      const permissionOutput = JSON.stringify({
        continue: true,
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: "Safe operation approved",
        },
      });

      const hookResult: HookExecutionResult = {
        success: true,
        exitCode: 0,
        stdout: permissionOutput,
        stderr: "",
        duration: 100,
        timedOut: false,
      };

      const context: HookExecutionContext = {
        event: "PreToolUse" as HookEvent,
        toolName: "bash",
        projectDir: testWorkdir,
        timestamp: new Date(),
      };

      vi.mocked(hookManager.executeHooks).mockResolvedValue([hookResult]);
      vi.mocked(toolManager.execute).mockResolvedValue({
        success: true,
        content: "file1.txt\nfile2.txt",
      });

      const results = await vi.mocked(hookManager.executeHooks)(
        "PreToolUse" as HookEvent,
        context,
      );

      const hookOutputResult = {
        exitCode: results[0].exitCode ?? 0,
        stdout: results[0].stdout ?? "",
        stderr: results[0].stderr ?? "",
        executionTime: results[0].duration,
        hookEvent: "PreToolUse" as HookEvent,
      };

      const parsedOutput = parseHookOutput(hookOutputResult);

      expect(parsedOutput.continue).toBe(true);
      expect(parsedOutput.hookSpecificData?.hookEventName).toBe("PreToolUse");
    });

    it("should handle permission request decision for user confirmation", async () => {
      const permissionOutput = JSON.stringify({
        continue: false,
        stopReason: "Requires user confirmation for file modification",
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason:
            "Requires user confirmation for file modification",
        },
      });

      const hookResult: HookExecutionResult = {
        success: true,
        exitCode: 0,
        stdout: permissionOutput,
        stderr: "",
        duration: 100,
        timedOut: false,
      };

      const context: ExtendedHookExecutionContext = {
        event: "PreToolUse" as HookEvent,
        toolName: "edit",
        projectDir: testWorkdir,
        timestamp: new Date(),
        sessionId: "test-session-123",
        toolInput: { file: "config.json", content: "new config" },
      };

      vi.mocked(hookManager.executeHooks).mockResolvedValue([hookResult]);

      const results = await vi.mocked(hookManager.executeHooks)(
        "PreToolUse" as HookEvent,
        context,
      );

      const hookOutputResult = {
        exitCode: results[0].exitCode ?? 0,
        stdout: results[0].stdout ?? "",
        stderr: results[0].stderr ?? "",
        executionTime: results[0].duration,
        hookEvent: "PreToolUse" as HookEvent,
      };

      const parsedOutput = parseHookOutput(hookOutputResult);

      expect(parsedOutput.continue).toBe(false);
      expect(parsedOutput.stopReason).toBe(
        "Requires user confirmation for file modification",
      );
      expect(
        (parsedOutput.hookSpecificData as unknown as Record<string, unknown>)
          ?.permissionDecision,
      ).toBe("ask");
    });
  });

  describe("Hook Executor Integration", () => {
    it("should execute hook with output processing using HookExecutor", async () => {
      const command = "echo 'Hook executed successfully'";
      const context: ExtendedHookExecutionContext = {
        event: "PreToolUse" as HookEvent,
        toolName: "test-tool",
        projectDir: testWorkdir,
        timestamp: new Date(),
        sessionId: "test-session-123",
        transcriptPath: "/test/path/transcript.json",
        cwd: testWorkdir,
        toolInput: { param: "value" },
      };

      // Mock the executeCommand function that HookExecutor uses internally
      vi.doMock("../../src/services/hook.js", () => ({
        executeCommand: vi.fn().mockResolvedValue({
          success: true,
          exitCode: 0,
          stdout: "Hook executed successfully",
          stderr: "",
          duration: 100,
          timedOut: false,
        }),
      }));

      const result = await hookExecutor.executeHookWithOutput(
        command,
        context,
        "PreToolUse",
      );

      expect(result.executionResult.success).toBe(true);
      expect(result.parsedOutput.continue).toBe(true);
    });

    it("should process PreToolUse hook with permissions using HookExecutor", async () => {
      // Test the parseHookOutput function directly with the expected output
      const hookOutputResult: HookOutputResult = {
        exitCode: 0,
        stdout: JSON.stringify({
          continue: false,
          stopReason: "User confirmation required",
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "ask",
            permissionDecisionReason: "User confirmation required",
          },
        }),
        stderr: "",
        executionTime: 100,
        hookEvent: "PreToolUse" as HookEvent,
      };

      const parsedOutput = parseHookOutput(hookOutputResult);

      expect(parsedOutput.continue).toBe(false);
      expect(parsedOutput.stopReason).toBe("User confirmation required");
      expect(parsedOutput.hookSpecificData?.hookEventName).toBe("PreToolUse");
      expect(
        (parsedOutput.hookSpecificData as unknown as Record<string, unknown>)
          ?.permissionDecision,
      ).toBe("ask");
      expect(
        (parsedOutput.hookSpecificData as unknown as Record<string, unknown>)
          ?.permissionDecisionReason,
      ).toBe("User confirmation required");
    });

    it("should handle hook output processing with state updates", async () => {
      const command =
        'echo \'{"continue": true, "systemMessage": "State updated"}\'';
      const context: ExtendedHookExecutionContext = {
        event: "PostToolUse" as HookEvent,
        toolName: "test-tool",
        projectDir: testWorkdir,
        timestamp: new Date(),
        sessionId: "test-session-123",
        toolResponse: { result: "success" },
      };

      const result = await hookExecutor.processHookOutput(
        command,
        context,
        "PostToolUse",
        "test-tool",
        { param: "value" },
      );

      expect(result.shouldContinue).toBe(true);
      expect(result.permissionRequired).toBe(false);
    });
  });

  describe("Mixed Output Processing", () => {
    it("should process complex hook output with multiple data types", async () => {
      const complexOutput = JSON.stringify({
        continue: true,
        systemMessage: "Starting tool execution with permission check",
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: "Operation is safe",
          updatedInput: { safe: true },
        },
      });

      const hookResult: HookExecutionResult = {
        success: true,
        exitCode: 0,
        stdout: complexOutput,
        stderr: "",
        duration: 100,
        timedOut: false,
      };

      const context: ExtendedHookExecutionContext = {
        event: "PreToolUse" as HookEvent,
        toolName: "test-tool",
        projectDir: testWorkdir,
        timestamp: new Date(),
        sessionId: "test-session-123",
        toolInput: { safe: false },
      };

      vi.mocked(hookManager.executeHooks).mockResolvedValue([hookResult]);

      const results = await vi.mocked(hookManager.executeHooks)(
        "PreToolUse" as HookEvent,
        context,
      );

      const hookOutputResult = {
        exitCode: results[0].exitCode ?? 0,
        stdout: results[0].stdout ?? "",
        stderr: results[0].stderr ?? "",
        executionTime: results[0].duration,
        hookEvent: "PreToolUse" as HookEvent,
      };

      const parsedOutput = parseHookOutput(hookOutputResult);

      // Process the complex output
      if (parsedOutput.systemMessage) {
        (messageManager.addMessage as unknown as (msg: unknown) => void)({
          role: "assistant",
          content: parsedOutput.systemMessage,
        });
      }

      expect(parsedOutput.continue).toBe(true);
      expect(parsedOutput.systemMessage).toBe(
        "Starting tool execution with permission check",
      );
      expect(
        (parsedOutput.hookSpecificData as unknown as Record<string, unknown>)
          ?.permissionDecision,
      ).toBe("allow");
      expect(
        (parsedOutput.hookSpecificData as unknown as Record<string, unknown>)
          ?.updatedInput,
      ).toEqual({ safe: true });
      expect(
        messageManager.addMessage as unknown as (msg: unknown) => void,
      ).toHaveBeenCalledWith({
        role: "assistant",
        content: "Starting tool execution with permission check",
      });
    });
  });

  describe("Error Handling", () => {
    it("should handle hook execution errors gracefully", async () => {
      const context: HookExecutionContext = {
        event: "PreToolUse" as HookEvent,
        toolName: "test-tool",
        projectDir: testWorkdir,
        timestamp: new Date(),
      };

      const hookError = new Error("Hook execution failed");
      vi.mocked(hookManager.executeHooks).mockRejectedValue(hookError);

      await expect(
        vi.mocked(hookManager.executeHooks)("PreToolUse" as HookEvent, context),
      ).rejects.toThrow("Hook execution failed");
    });

    it("should handle invalid hook output gracefully", async () => {
      const invalidOutput: HookOutputResult = {
        exitCode: 0,
        stdout: "invalid json output {",
        stderr: "",
        executionTime: 100,
        hookEvent: "PreToolUse" as HookEvent,
      };

      // Should not throw but should fall back to exit code parsing
      const parsedOutput = parseHookOutput(invalidOutput);

      // With exit code 0, should default to continue: true
      expect(parsedOutput.continue).toBe(true);
    });

    it("should continue processing when hook output parsing has issues", async () => {
      const hookResults: HookExecutionResult[] = [
        {
          success: true,
          exitCode: 0,
          stdout: '{"continue": true, "systemMessage": "Valid message"}',
          stderr: "",
          duration: 100,
          timedOut: false,
        },
        {
          success: true,
          exitCode: 0,
          stdout: "invalid json {",
          stderr: "",
          duration: 100,
          timedOut: false,
        },
        {
          success: true,
          exitCode: 0,
          stdout:
            '{"continue": true, "systemMessage": "Another valid message"}',
          stderr: "",
          duration: 100,
          timedOut: false,
        },
      ];

      const context: HookExecutionContext = {
        event: "PostToolUse" as HookEvent,
        toolName: "test-tool",
        projectDir: testWorkdir,
        timestamp: new Date(),
      };

      vi.mocked(hookManager.executeHooks).mockResolvedValue(hookResults);

      const results = await vi.mocked(hookManager.executeHooks)(
        "PostToolUse" as HookEvent,
        context,
      );

      // Process all outputs, even if some fail to parse
      const hookOutputResults = results.map((result: HookExecutionResult) => ({
        exitCode: result.exitCode ?? 0,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        executionTime: result.duration,
        hookEvent: "PostToolUse" as HookEvent,
      }));

      const parsedOutputs = hookOutputResults
        .map((result: HookOutputResult) => {
          try {
            return parseHookOutput(result);
          } catch {
            // Handle parsing errors gracefully
            return null;
          }
        })
        .filter(Boolean);

      // Should have processed valid outputs
      expect(parsedOutputs.length).toBeGreaterThan(0);

      for (const parsedOutput of parsedOutputs) {
        if (parsedOutput?.systemMessage) {
          (messageManager.addMessage as unknown as (msg: unknown) => void)({
            role: "assistant",
            content: parsedOutput.systemMessage,
          });
        }
      }

      expect(
        messageManager.addMessage as unknown as (msg: unknown) => void,
      ).toHaveBeenCalledTimes(2);
    });
  });

  describe("End-to-End Flow Integration", () => {
    it("should complete full flow: hook execution -> parsing -> message processing", async () => {
      // Setup complete scenario
      /* const userMessage: Message = {
        role: "user",
        blocks: [
          {
            type: "text",
            content: "Please analyze this file and make recommendations",
          },
        ],
      }; */

      // Mock Pre-tool hook execution
      const preToolOutput = JSON.stringify({
        continue: true,
        systemMessage: "Starting file analysis...",
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: "File read operation is safe",
        },
      });

      // Mock Post-tool hook execution
      const postToolOutput = JSON.stringify({
        continue: true,
        systemMessage: "File analysis completed successfully",
      });

      const preContext: ExtendedHookExecutionContext = {
        event: "PreToolUse" as HookEvent,
        toolName: "read_file",
        projectDir: testWorkdir,
        timestamp: new Date(),
        sessionId: "test-session-123",
        toolInput: { path: "/test/file.txt" },
      };

      const postContext: ExtendedHookExecutionContext = {
        ...preContext,
        event: "PostToolUse" as HookEvent,
        toolResponse: "File contents here...",
      };

      // Mock tool execution
      vi.mocked(toolManager.execute).mockResolvedValue({
        success: true,
        content: "File contents here...",
      });

      // Mock hook executions
      vi.mocked(hookManager.executeHooks)
        .mockResolvedValueOnce([
          {
            success: true,
            exitCode: 0,
            stdout: preToolOutput,
            stderr: "",
            duration: 100,
            timedOut: false,
          },
        ])
        .mockResolvedValueOnce([
          {
            success: true,
            exitCode: 0,
            stdout: postToolOutput,
            stderr: "",
            duration: 120,
            timedOut: false,
          },
        ]);

      // Execute before hooks
      const beforeResults = await vi.mocked(hookManager.executeHooks)(
        "PreToolUse" as HookEvent,
        preContext,
      );

      // Parse and process before hook outputs
      const beforeHookResult = {
        exitCode: beforeResults[0].exitCode ?? 0,
        stdout: beforeResults[0].stdout ?? "",
        stderr: beforeResults[0].stderr ?? "",
        executionTime: beforeResults[0].duration,
        hookEvent: "PreToolUse" as HookEvent,
      };

      const beforeParsed = parseHookOutput(beforeHookResult);

      // const permissionAllowed = beforeParsed.continue;
      if (beforeParsed.systemMessage) {
        (messageManager.addMessage as unknown as (msg: unknown) => void)({
          role: "assistant",
          content: beforeParsed.systemMessage,
        });
      }

      // Execute tool if permission allowed
      const permissionAllowed = beforeParsed.continue;
      let toolResult = null;
      if (permissionAllowed) {
        toolResult = await vi.mocked(toolManager.execute)(
          "read_file",
          { path: "/test/file.txt" },
          { workdir: testWorkdir },
        );

        // Verify tool executed successfully
        expect(toolResult).toEqual({
          success: true,
          content: "File contents here...",
        });
      }

      // Execute after hooks
      const afterResults = await vi.mocked(hookManager.executeHooks)(
        "PostToolUse" as HookEvent,
        postContext,
      );

      // Parse and process after hook outputs
      const afterHookResult = {
        exitCode: afterResults[0].exitCode ?? 0,
        stdout: afterResults[0].stdout ?? "",
        stderr: afterResults[0].stderr ?? "",
        executionTime: afterResults[0].duration,
        hookEvent: "PostToolUse" as HookEvent,
      };

      const afterParsed = parseHookOutput(afterHookResult);
      if (afterParsed.systemMessage) {
        (messageManager.addMessage as unknown as (msg: unknown) => void)({
          role: "assistant",
          content: afterParsed.systemMessage,
        });
      }

      // Verify complete flow
      expect(vi.mocked(hookManager.executeHooks)).toHaveBeenCalledTimes(2);
      expect(vi.mocked(hookManager.executeHooks)).toHaveBeenNthCalledWith(
        1,
        "PreToolUse",
        preContext,
      );
      expect(vi.mocked(hookManager.executeHooks)).toHaveBeenNthCalledWith(
        2,
        "PostToolUse",
        postContext,
      );
      expect(vi.mocked(toolManager.execute)).toHaveBeenCalledWith(
        "read_file",
        { path: "/test/file.txt" },
        { workdir: testWorkdir },
      );
      expect(
        messageManager.addMessage as unknown as (msg: unknown) => void,
      ).toHaveBeenCalledTimes(2);
      expect(
        messageManager.addMessage as unknown as (msg: unknown) => void,
      ).toHaveBeenNthCalledWith(1, {
        role: "assistant",
        content: "Starting file analysis...",
      });
      expect(
        messageManager.addMessage as unknown as (msg: unknown) => void,
      ).toHaveBeenNthCalledWith(2, {
        role: "assistant",
        content: "File analysis completed successfully",
      });
    });

    it("should handle permission denial and stop execution", async () => {
      const context: ExtendedHookExecutionContext = {
        event: "PreToolUse" as HookEvent,
        toolName: "bash",
        projectDir: testWorkdir,
        timestamp: new Date(),
        sessionId: "test-session-123",
        toolInput: { command: "rm -rf /system" },
      };

      const denialOutput = JSON.stringify({
        continue: false,
        stopReason: "Dangerous system operation blocked",
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "Dangerous system operation blocked",
        },
      });

      vi.mocked(hookManager.executeHooks).mockResolvedValue([
        {
          success: true,
          exitCode: 1, // Non-zero exit code
          stdout: denialOutput,
          stderr: "",
          duration: 100,
          timedOut: false,
        },
      ]);

      const results = await vi.mocked(hookManager.executeHooks)(
        "PreToolUse" as HookEvent,
        context,
      );

      const hookOutputResult = {
        exitCode: results[0].exitCode ?? 0,
        stdout: results[0].stdout ?? "",
        stderr: results[0].stderr ?? "",
        executionTime: results[0].duration,
        hookEvent: "PreToolUse" as HookEvent,
      };

      const parsedOutput = parseHookOutput(hookOutputResult);

      // Permission denied - tool should not be executed
      expect(parsedOutput.continue).toBe(false);
      expect(
        (parsedOutput.hookSpecificData as unknown as Record<string, unknown>)
          ?.permissionDecision,
      ).toBe("deny");
      expect(vi.mocked(toolManager.execute)).not.toHaveBeenCalled();
    });

    it("should integrate with message manager for system message processing", async () => {
      const hookOutput = JSON.stringify({
        continue: true,
        systemMessage: "Hook processed successfully",
      });

      // Mock message manager's processHookOutput method
      messageManager.processHookOutput = vi.fn();

      const context: HookExecutionContext = {
        event: "UserPromptSubmit" as HookEvent,
        projectDir: testWorkdir,
        timestamp: new Date(),
      };

      vi.mocked(hookManager.executeHooks).mockResolvedValue([
        {
          success: true,
          exitCode: 0,
          stdout: hookOutput,
          stderr: "",
          duration: 100,
          timedOut: false,
        },
      ]);

      const results = await vi.mocked(hookManager.executeHooks)(
        "UserPromptSubmit" as HookEvent,
        context,
      );

      const hookOutputResult = {
        exitCode: results[0].exitCode ?? 0,
        stdout: results[0].stdout ?? "",
        stderr: results[0].stderr ?? "",
        executionTime: results[0].duration,
        hookEvent: "UserPromptSubmit" as HookEvent,
      };

      // Parse hook output
      /* const parsedOutput = parseHookOutput(hookOutputResult); */

      // Process through message manager if it has the method
      if (messageManager.processHookOutput) {
        messageManager.processHookOutput(hookOutputResult);
      }

      expect(messageManager.processHookOutput).toHaveBeenCalledWith(
        hookOutputResult,
      );
    });
  });

  describe("Performance and Reliability", () => {
    it("should handle large numbers of hook outputs efficiently", async () => {
      const largeOutputs: HookExecutionResult[] = Array.from(
        { length: 50 },
        (_, i) => ({
          success: true,
          exitCode: 0,
          stdout: JSON.stringify({
            continue: true,
            systemMessage: `Message ${i + 1}`,
          }),
          stderr: "",
          duration: 10,
          timedOut: false,
        }),
      );

      const context: HookExecutionContext = {
        event: "PostToolUse" as HookEvent,
        toolName: "bulk-tool",
        projectDir: testWorkdir,
        timestamp: new Date(),
      };

      vi.mocked(hookManager.executeHooks).mockResolvedValue(largeOutputs);

      const startTime = Date.now();
      const results = await vi.mocked(hookManager.executeHooks)(
        "PostToolUse" as HookEvent,
        context,
      );
      const executionTime = Date.now() - startTime;

      // Should complete within reasonable time
      expect(executionTime).toBeLessThan(1000); // 1 second
      expect(results).toHaveLength(50);

      // Process all outputs
      const hookOutputResults = results.map((result: HookExecutionResult) => ({
        exitCode: result.exitCode ?? 0,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        executionTime: result.duration,
        hookEvent: "PostToolUse" as HookEvent,
      }));

      const parsedOutputs = hookOutputResults.map((result: HookOutputResult) =>
        parseHookOutput(result),
      );

      for (const parsedOutput of parsedOutputs) {
        if (parsedOutput.systemMessage) {
          (messageManager.addMessage as unknown as (msg: unknown) => void)({
            role: "assistant",
            content: parsedOutput.systemMessage,
          });
        }
      }

      expect(
        messageManager.addMessage as unknown as (msg: unknown) => void,
      ).toHaveBeenCalledTimes(50);
    });

    it("should maintain session consistency across multiple hook executions", async () => {
      const hookEvents: HookEvent[] = [
        "PreToolUse",
        "PostToolUse",
        "UserPromptSubmit",
      ];
      let counter = 0;

      for (const event of hookEvents) {
        counter++;
        const output = JSON.stringify({
          continue: true,
          systemMessage: `Event ${event} - execution ${counter}`,
        });

        const context: HookExecutionContext = {
          event,
          toolName: event.includes("Tool") ? "test-tool" : undefined,
          projectDir: testWorkdir,
          timestamp: new Date(),
        };

        vi.mocked(hookManager.executeHooks).mockResolvedValueOnce([
          {
            success: true,
            exitCode: 0,
            stdout: output,
            stderr: "",
            duration: 100,
            timedOut: false,
          },
        ]);

        const results = await vi.mocked(hookManager.executeHooks)(
          event,
          context,
        );
        const hookOutputResult = {
          exitCode: results[0].exitCode ?? 0,
          stdout: results[0].stdout ?? "",
          stderr: results[0].stderr ?? "",
          executionTime: results[0].duration,
          hookEvent: event,
        };

        const parsedOutput = parseHookOutput(hookOutputResult);
        expect(parsedOutput.continue).toBe(true);
        expect(parsedOutput.systemMessage).toContain(`Event ${event}`);
      }

      expect(vi.mocked(hookManager.executeHooks)).toHaveBeenCalledTimes(3);
    });

    it("should handle concurrent hook executions gracefully", async () => {
      const contexts = Array.from({ length: 5 }, () => ({
        event: "UserPromptSubmit" as HookEvent,
        projectDir: testWorkdir,
        timestamp: new Date(),
      }));

      const outputs = contexts.map((_, i) =>
        JSON.stringify({
          continue: true,
          systemMessage: `Concurrent execution ${i + 1}`,
        }),
      );

      // Mock concurrent executions
      const promises = contexts.map((context, i) => {
        vi.mocked(hookManager.executeHooks).mockResolvedValueOnce([
          {
            success: true,
            exitCode: 0,
            stdout: outputs[i],
            stderr: "",
            duration: 100 + i * 10, // Varying duration
            timedOut: false,
          },
        ]);

        return vi.mocked(hookManager.executeHooks)(
          "UserPromptSubmit" as HookEvent,
          context,
        );
      });

      const results = await Promise.all(promises);

      // All executions should succeed
      expect(results).toHaveLength(5);
      results.forEach((result, i) => {
        expect(result[0].success).toBe(true);
        const hookOutputResult = {
          exitCode: result[0].exitCode ?? 0,
          stdout: result[0].stdout ?? "",
          stderr: result[0].stderr ?? "",
          executionTime: result[0].duration,
          hookEvent: "UserPromptSubmit" as HookEvent,
        };
        const parsed = parseHookOutput(hookOutputResult);
        expect(parsed.systemMessage).toBe(`Concurrent execution ${i + 1}`);
      });
    });
  });
});
