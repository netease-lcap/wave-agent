import { describe, it, expect, vi, beforeEach } from "vitest";
import { PermissionManager } from "../../src/managers/permissionManager.js";
import type {
  ToolPermissionContext,
  PermissionCallback,
} from "../../src/types/permissions.js";
import type { Logger } from "../../src/types/index.js";

describe("PermissionManager - acceptEdits mode", () => {
  let permissionManager: PermissionManager;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    permissionManager = new PermissionManager({
      logger: mockLogger,
    });
  });

  describe("checkPermission with acceptEdits mode", () => {
    it("should automatically allow 'Edit', 'MultiEdit', 'Delete', 'Write' tools", async () => {
      const autoAcceptedTools = ["Edit", "MultiEdit", "Delete", "Write"];

      for (const toolName of autoAcceptedTools) {
        const context: ToolPermissionContext = {
          toolName,
          permissionMode: "acceptEdits",
        };

        const result = await permissionManager.checkPermission(context);

        expect(result).toEqual({ behavior: "allow" });
        expect(mockLogger.debug).toHaveBeenCalledWith(
          "Permission automatically accepted for tool in acceptEdits mode",
          { toolName },
        );
      }
    });

    it("should still require permission for 'Bash' tool in acceptEdits mode", async () => {
      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "acceptEdits",
      };

      // Without callback, it should deny
      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("deny");
      expect(result.message).toContain("requires permission approval");

      // With callback, it should call the callback
      const mockCallback: PermissionCallback = vi.fn().mockResolvedValue({
        behavior: "allow",
      });
      const contextWithCallback: ToolPermissionContext = {
        ...context,
        canUseToolCallback: mockCallback,
      };

      const resultWithCallback =
        await permissionManager.checkPermission(contextWithCallback);
      expect(resultWithCallback).toEqual({ behavior: "allow" });
      expect(mockCallback).toHaveBeenCalled();
    });

    it("should allow unrestricted tools in acceptEdits mode", async () => {
      const context: ToolPermissionContext = {
        toolName: "Read",
        permissionMode: "acceptEdits",
      };

      const result = await permissionManager.checkPermission(context);
      expect(result).toEqual({ behavior: "allow" });
    });
  });

  describe("resolveEffectivePermissionMode with acceptEdits", () => {
    it("should correctly resolve effective mode when acceptEdits is set as configured default", () => {
      const manager = new PermissionManager({
        configuredDefaultMode: "acceptEdits",
      });

      expect(manager.resolveEffectivePermissionMode()).toBe("acceptEdits");
      expect(manager.getCurrentEffectiveMode()).toBe("acceptEdits");
    });

    it("should correctly resolve effective mode when acceptEdits is set as CLI override", () => {
      const manager = new PermissionManager({
        configuredDefaultMode: "default",
      });

      expect(manager.resolveEffectivePermissionMode("acceptEdits")).toBe(
        "acceptEdits",
      );
      expect(manager.getCurrentEffectiveMode("acceptEdits")).toBe(
        "acceptEdits",
      );
    });

    it("should prioritize CLI override over configured default acceptEdits", () => {
      const manager = new PermissionManager({
        configuredDefaultMode: "acceptEdits",
      });

      expect(manager.resolveEffectivePermissionMode("bypassPermissions")).toBe(
        "bypassPermissions",
      );
      expect(manager.resolveEffectivePermissionMode("default")).toBe("default");
    });
  });
});
