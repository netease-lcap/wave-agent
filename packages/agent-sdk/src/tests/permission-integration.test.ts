import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIManager } from "../managers/aiManager.js";
import { MessageManager } from "../managers/messageManager.js";
import { ToolManager } from "../managers/toolManager.js";
import { HookManager } from "../managers/hookManager.js";
import type { PermissionDecision } from "../types/hooks.js";
import type { Logger } from "../types/core.js";

// Mock dependencies
vi.mock("../services/aiService.js");
vi.mock("../services/memory.js");
vi.mock("../utils/messageOperations.js");
vi.mock("../utils/convertMessagesForAPI.js");

describe("AIManager Permission Integration", () => {
  let aiManager: AIManager;
  let messageManager: MessageManager;
  let toolManager: ToolManager;
  let hookManager: HookManager;
  let mockLogger: Logger;

  beforeEach(() => {
    // Mock logger
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    // Mock message manager
    messageManager = {
      getSessionId: vi.fn().mockReturnValue("test-session"),
      getTranscriptPath: vi.fn().mockReturnValue("/test/transcript.json"),
      processHookOutput: vi.fn(),
      updateToolBlock: vi.fn(),
      addDiffBlock: vi.fn(),
      saveSession: vi.fn(),
    } as any;

    // Mock tool manager
    toolManager = {
      getToolsConfig: vi.fn().mockReturnValue([]),
      list: vi.fn().mockReturnValue([]),
      execute: vi.fn(),
    } as any;

    // Mock hook manager
    hookManager = {
      executeHooks: vi.fn(),
    } as any;

    // Create AIManager instance
    aiManager = new AIManager({
      messageManager,
      toolManager,
      hookManager,
      logger: mockLogger,
      workdir: "/test/workdir",
      gatewayConfig: { url: "test" } as any,
      modelConfig: { agentModel: "test", fastModel: "test" } as any,
      tokenLimit: 1000,
    });
  });

  describe("Permission Request Creation", () => {
    it("should create permission request when hook returns 'ask' decision", async () => {
      // Mock hook execution result with 'ask' permission
      const hookResult = {
        success: true,
        exitCode: 0,
        stdout: JSON.stringify({
          continue: false,
          permissionDecision: "ask",
          permissionDecisionReason: "Need user approval for file deletion",
          updatedInput: { file: "/safe/path" }
        }),
        stderr: "",
        duration: 100,
        timedOut: false,
      };

      hookManager.executeHooks = vi.fn().mockResolvedValue([hookResult]);

      // Execute preToolUse hooks
      const result = await (aiManager as any).executePreToolUseHooks(
        "Delete", 
        { file: "/dangerous/path" },
        "tool123",
        { file: "/dangerous/path" },
        "Delete file"
      );

      // Should not proceed and should have permission ID
      expect(result.shouldProceed).toBe(false);
      expect(result.permissionId).toBeDefined();
      expect(result.updatedInput).toEqual({ file: "/safe/path" });

      // Should have pending permission
      expect(aiManager.isAwaitingPermission()).toBe(true);
      expect(aiManager.getPendingPermissions()).toHaveLength(1);

      const pendingPermissions = aiManager.getPendingPermissions();
      expect(pendingPermissions[0].toolName).toBe("Delete");
      expect(pendingPermissions[0].reason).toBe("Need user approval for file deletion");
    });

    it("should proceed normally when hook returns 'allow' decision", async () => {
      // Mock hook execution result with 'allow' permission
      const hookResult = {
        success: true,
        exitCode: 0,
        stdout: JSON.stringify({
          continue: true,
          permissionDecision: "allow",
          updatedInput: { file: "/safe/path" }
        }),
        stderr: "",
        duration: 100,
        timedOut: false,
      };

      hookManager.executeHooks = vi.fn().mockResolvedValue([hookResult]);

      // Execute preToolUse hooks
      const result = await (aiManager as any).executePreToolUseHooks(
        "Delete", 
        { file: "/dangerous/path" },
        "tool123",
        { file: "/dangerous/path" },
        "Delete file"
      );

      // Should proceed with updated input
      expect(result.shouldProceed).toBe(true);
      expect(result.permissionId).toBeUndefined();
      expect(result.updatedInput).toEqual({ file: "/safe/path" });

      // Should not have pending permissions
      expect(aiManager.isAwaitingPermission()).toBe(false);
    });

    it("should block when hook returns 'deny' decision", async () => {
      // Mock hook execution result with 'deny' permission
      const hookResult = {
        success: true,
        exitCode: 0,
        stdout: JSON.stringify({
          continue: false,
          permissionDecision: "deny",
          permissionDecisionReason: "File deletion not allowed"
        }),
        stderr: "",
        duration: 100,
        timedOut: false,
      };

      hookManager.executeHooks = vi.fn().mockResolvedValue([hookResult]);

      // Execute preToolUse hooks
      const result = await (aiManager as any).executePreToolUseHooks(
        "Delete", 
        { file: "/dangerous/path" },
        "tool123",
        { file: "/dangerous/path" },
        "Delete file"
      );

      // Should not proceed and should not have permission ID
      expect(result.shouldProceed).toBe(false);
      expect(result.permissionId).toBeUndefined();

      // Should not have pending permissions
      expect(aiManager.isAwaitingPermission()).toBe(false);
    });
  });

  describe("Permission Resolution", () => {
    it("should resolve permission request with allow decision", async () => {
      // First create a permission request
      const hookResult = {
        success: true,
        exitCode: 0,
        stdout: JSON.stringify({
          continue: false,
          permissionDecision: "ask",
          permissionDecisionReason: "Need approval",
          updatedInput: { safe: true }
        }),
        stderr: "",
        duration: 100,
        timedOut: false,
      };

      hookManager.executeHooks = vi.fn().mockResolvedValue([hookResult]);
      toolManager.execute = vi.fn().mockResolvedValue({
        success: true,
        content: "Tool executed successfully",
      });

      // Create permission request
      const result = await (aiManager as any).executePreToolUseHooks(
        "TestTool", 
        { test: true },
        "tool123",
        { test: true },
        "Test"
      );

      expect(result.permissionId).toBeDefined();
      const permissionId = result.permissionId!;

      // Resolve with allow
      const decision: PermissionDecision = {
        decision: "allow",
        shouldContinueRecursion: true,
      };

      const resolved = await aiManager.resolvePermissionRequest(permissionId, decision);
      expect(resolved).toBe(true);

      // Should no longer be awaiting permission
      expect(aiManager.isAwaitingPermission()).toBe(false);

      // Tool execution should have been called
      expect(toolManager.execute).toHaveBeenCalledWith(
        "TestTool",
        { safe: true }, // Should use updated input
        expect.any(Object)
      );
    });

    it("should resolve permission request with deny decision", async () => {
      // First create a permission request
      const hookResult = {
        success: true,
        exitCode: 0,
        stdout: JSON.stringify({
          continue: false,
          permissionDecision: "ask",
          permissionDecisionReason: "Need approval"
        }),
        stderr: "",
        duration: 100,
        timedOut: false,
      };

      hookManager.executeHooks = vi.fn().mockResolvedValue([hookResult]);

      // Create permission request
      const result = await (aiManager as any).executePreToolUseHooks(
        "TestTool", 
        { test: true },
        "tool123",
        { test: true },
        "Test"
      );

      expect(result.permissionId).toBeDefined();
      const permissionId = result.permissionId!;

      // Resolve with deny
      const decision: PermissionDecision = {
        decision: "deny",
        shouldContinueRecursion: false,
        reason: "User denied permission"
      };

      const resolved = await aiManager.resolvePermissionRequest(permissionId, decision);
      expect(resolved).toBe(true);

      // Should no longer be awaiting permission
      expect(aiManager.isAwaitingPermission()).toBe(false);

      // Should update tool block with error
      expect(messageManager.updateToolBlock).toHaveBeenCalledWith({
        toolId: "tool123",
        isRunning: false,
        error: "Tool execution denied: User denied permission",
      });
    });

    it("should return false for non-existent permission ID", async () => {
      const decision: PermissionDecision = {
        decision: "allow",
        shouldContinueRecursion: true,
      };

      const resolved = await aiManager.resolvePermissionRequest("nonexistent", decision);
      expect(resolved).toBe(false);
    });
  });

  describe("Permission Management", () => {
    it("should clear all pending permissions", async () => {
      // Create a permission request first
      const hookResult = {
        success: true,
        exitCode: 0,
        stdout: JSON.stringify({
          continue: false,
          permissionDecision: "ask",
          permissionDecisionReason: "Test"
        }),
        stderr: "",
        duration: 100,
        timedOut: false,
      };

      hookManager.executeHooks = vi.fn().mockResolvedValue([hookResult]);

      await (aiManager as any).executePreToolUseHooks(
        "TestTool", 
        { test: true },
        "tool123",
        { test: true },
        "Test"
      );

      expect(aiManager.isAwaitingPermission()).toBe(true);

      // Clear permissions
      aiManager.clearPendingPermissions();

      expect(aiManager.isAwaitingPermission()).toBe(false);
      expect(aiManager.getPendingPermissions()).toHaveLength(0);
    });

    it("should track multiple pending permissions", async () => {
      // Create multiple permission requests
      const hookResult = {
        success: true,
        exitCode: 0,
        stdout: JSON.stringify({
          continue: false,
          permissionDecision: "ask",
          permissionDecisionReason: "Test"
        }),
        stderr: "",
        duration: 100,
        timedOut: false,
      };

      hookManager.executeHooks = vi.fn().mockResolvedValue([hookResult]);

      // Create first permission
      await (aiManager as any).executePreToolUseHooks(
        "Tool1", 
        { test: 1 },
        "tool1",
        { test: 1 },
        "Test1"
      );

      // Create second permission
      await (aiManager as any).executePreToolUseHooks(
        "Tool2", 
        { test: 2 },
        "tool2",
        { test: 2 },
        "Test2"
      );

      expect(aiManager.isAwaitingPermission()).toBe(true);
      expect(aiManager.getPendingPermissions()).toHaveLength(2);

      const permissions = aiManager.getPendingPermissions();
      expect(permissions.map(p => p.toolName)).toEqual(["Tool1", "Tool2"]);
    });
  });
});