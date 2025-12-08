import { describe, it, expect, vi, beforeEach } from "vitest";
import { PermissionManager } from "../../src/managers/permissionManager.js";
import { RESTRICTED_TOOLS } from "../../src/types/permissions.js";
import type {
  PermissionDecision,
  ToolPermissionContext,
  PermissionCallback,
  PermissionMode,
} from "../../src/types/permissions.js";
import type { Logger } from "../../src/types/index.js";

describe("PermissionManager", () => {
  let permissionManager: PermissionManager;
  let mockLogger: Logger;

  beforeEach(() => {
    // Create mock Logger
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    // Create PermissionManager instance with logger
    permissionManager = new PermissionManager({
      logger: mockLogger,
    });
  });

  describe("Constructor and Initialization", () => {
    it("should create instance with logger", () => {
      const manager = new PermissionManager({ logger: mockLogger });
      expect(manager).toBeInstanceOf(PermissionManager);
    });

    it("should create instance without logger", () => {
      const manager = new PermissionManager();
      expect(manager).toBeInstanceOf(PermissionManager);
    });

    it("should create instance with empty options", () => {
      const manager = new PermissionManager({});
      expect(manager).toBeInstanceOf(PermissionManager);
    });
  });

  describe("checkPermission method", () => {
    describe("bypassPermissions mode", () => {
      it("should allow all tools in bypassPermissions mode", async () => {
        const context: ToolPermissionContext = {
          toolName: "Edit",
          permissionMode: "bypassPermissions",
        };

        const result = await permissionManager.checkPermission(context);

        expect(result).toEqual({ behavior: "allow" });
        expect(mockLogger.debug).toHaveBeenCalledWith(
          "Checking permission for tool",
          {
            toolName: "Edit",
            permissionMode: "bypassPermissions",
            hasCallback: false,
          },
        );
        expect(mockLogger.debug).toHaveBeenCalledWith(
          "Permission bypassed for tool",
          { toolName: "Edit" },
        );
      });

      it("should allow restricted tools in bypassPermissions mode", async () => {
        for (const toolName of RESTRICTED_TOOLS) {
          const context: ToolPermissionContext = {
            toolName,
            permissionMode: "bypassPermissions",
          };

          const result = await permissionManager.checkPermission(context);

          expect(result).toEqual({ behavior: "allow" });
        }
      });

      it("should allow unrestricted tools in bypassPermissions mode", async () => {
        const unrestrictedTools = ["Read", "Grep", "LS", "Glob"];

        for (const toolName of unrestrictedTools) {
          const context: ToolPermissionContext = {
            toolName,
            permissionMode: "bypassPermissions",
          };

          const result = await permissionManager.checkPermission(context);

          expect(result).toEqual({ behavior: "allow" });
        }
      });
    });

    describe("default mode with unrestricted tools", () => {
      it("should allow unrestricted tools without callback", async () => {
        const unrestrictedTools = ["Read", "Grep", "LS", "Glob", "TodoWrite"];

        for (const toolName of unrestrictedTools) {
          const context: ToolPermissionContext = {
            toolName,
            permissionMode: "default",
          };

          const result = await permissionManager.checkPermission(context);

          expect(result).toEqual({ behavior: "allow" });
          expect(mockLogger.debug).toHaveBeenCalledWith(
            "Tool is not restricted, allowing",
            { toolName },
          );
        }
      });

      it("should allow unrestricted tools with callback present", async () => {
        const mockCallback: PermissionCallback = vi.fn().mockResolvedValue({
          behavior: "deny",
          message: "Should not be called for unrestricted tools",
        });

        const context: ToolPermissionContext = {
          toolName: "Read",
          permissionMode: "default",
          canUseToolCallback: mockCallback,
        };

        const result = await permissionManager.checkPermission(context);

        expect(result).toEqual({ behavior: "allow" });
        expect(mockCallback).not.toHaveBeenCalled();
        expect(mockLogger.debug).toHaveBeenCalledWith(
          "Tool is not restricted, allowing",
          { toolName: "Read" },
        );
      });
    });

    describe("default mode with restricted tools and callback", () => {
      it("should call callback and return allow decision", async () => {
        const mockCallback: PermissionCallback = vi.fn().mockResolvedValue({
          behavior: "allow",
        });

        const context: ToolPermissionContext = {
          toolName: "Edit",
          permissionMode: "default",
          canUseToolCallback: mockCallback,
        };

        const result = await permissionManager.checkPermission(context);

        expect(result).toEqual({ behavior: "allow" });
        expect(mockCallback).toHaveBeenCalledWith("Edit");
        expect(mockLogger.debug).toHaveBeenCalledWith(
          "Calling custom permission callback for tool",
          { toolName: "Edit" },
        );
        expect(mockLogger.debug).toHaveBeenCalledWith(
          "Custom callback returned decision",
          { toolName: "Edit", decision: { behavior: "allow" } },
        );
      });

      it("should call callback and return deny decision with message", async () => {
        const mockCallback: PermissionCallback = vi.fn().mockResolvedValue({
          behavior: "deny",
          message: "User denied permission",
        });

        const context: ToolPermissionContext = {
          toolName: "Delete",
          permissionMode: "default",
          canUseToolCallback: mockCallback,
        };

        const result = await permissionManager.checkPermission(context);

        expect(result).toEqual({
          behavior: "deny",
          message: "User denied permission",
        });
        expect(mockCallback).toHaveBeenCalledWith("Delete");
        expect(mockLogger.debug).toHaveBeenCalledWith(
          "Custom callback returned decision",
          {
            toolName: "Delete",
            decision: { behavior: "deny", message: "User denied permission" },
          },
        );
      });

      it("should handle callback exceptions and return deny", async () => {
        const mockCallback: PermissionCallback = vi
          .fn()
          .mockRejectedValue(new Error("Callback failed"));

        const context: ToolPermissionContext = {
          toolName: "Write",
          permissionMode: "default",
          canUseToolCallback: mockCallback,
        };

        const result = await permissionManager.checkPermission(context);

        expect(result).toEqual({
          behavior: "deny",
          message: "Error in permission callback",
        });
        expect(mockCallback).toHaveBeenCalledWith("Write");
        expect(mockLogger.error).toHaveBeenCalledWith(
          "Error in permission callback",
          { toolName: "Write", error: "Callback failed" },
        );
      });

      it("should handle non-Error exceptions in callback", async () => {
        const mockCallback: PermissionCallback = vi
          .fn()
          .mockRejectedValue("String error");

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          canUseToolCallback: mockCallback,
        };

        const result = await permissionManager.checkPermission(context);

        expect(result).toEqual({
          behavior: "deny",
          message: "Error in permission callback",
        });
        expect(mockLogger.error).toHaveBeenCalledWith(
          "Error in permission callback",
          { toolName: "Bash", error: "String error" },
        );
      });

      it("should test all restricted tools with successful callback", async () => {
        for (const toolName of RESTRICTED_TOOLS) {
          const mockCallback: PermissionCallback = vi.fn().mockResolvedValue({
            behavior: "allow",
          });

          const context: ToolPermissionContext = {
            toolName,
            permissionMode: "default",
            canUseToolCallback: mockCallback,
          };

          const result = await permissionManager.checkPermission(context);

          expect(result).toEqual({ behavior: "allow" });
          expect(mockCallback).toHaveBeenCalledWith(toolName);
        }
      });
    });

    describe("default mode with restricted tools without callback", () => {
      it("should deny restricted tools without callback", async () => {
        const context: ToolPermissionContext = {
          toolName: "Edit",
          permissionMode: "default",
        };

        const result = await permissionManager.checkPermission(context);

        expect(result).toEqual({
          behavior: "deny",
          message:
            "Tool 'Edit' requires permission approval. No permission callback configured.",
        });
        expect(mockLogger.warn).toHaveBeenCalledWith(
          "No permission callback provided for restricted tool in default mode",
          { toolName: "Edit" },
        );
      });

      it("should deny all restricted tools without callback", async () => {
        for (const toolName of RESTRICTED_TOOLS) {
          const context: ToolPermissionContext = {
            toolName,
            permissionMode: "default",
          };

          const result = await permissionManager.checkPermission(context);

          expect(result).toEqual({
            behavior: "deny",
            message: `Tool '${toolName}' requires permission approval. No permission callback configured.`,
          });
        }
      });
    });

    describe("logging behavior", () => {
      it("should log initial permission check with hasCallback=true", async () => {
        const mockCallback: PermissionCallback = vi.fn().mockResolvedValue({
          behavior: "allow",
        });

        const context: ToolPermissionContext = {
          toolName: "MultiEdit",
          permissionMode: "default",
          canUseToolCallback: mockCallback,
        };

        await permissionManager.checkPermission(context);

        expect(mockLogger.debug).toHaveBeenCalledWith(
          "Checking permission for tool",
          {
            toolName: "MultiEdit",
            permissionMode: "default",
            hasCallback: true,
          },
        );
      });

      it("should log initial permission check with hasCallback=false", async () => {
        const context: ToolPermissionContext = {
          toolName: "Read",
          permissionMode: "default",
        };

        await permissionManager.checkPermission(context);

        expect(mockLogger.debug).toHaveBeenCalledWith(
          "Checking permission for tool",
          {
            toolName: "Read",
            permissionMode: "default",
            hasCallback: false,
          },
        );
      });
    });
  });

  describe("isRestrictedTool method", () => {
    it("should return true for restricted tools", () => {
      for (const toolName of RESTRICTED_TOOLS) {
        const result = permissionManager.isRestrictedTool(toolName);
        expect(result).toBe(true);
        expect(mockLogger.debug).toHaveBeenCalledWith(
          "Checking if tool is restricted",
          { toolName, isRestricted: true },
        );
      }
    });

    it("should return false for unrestricted tools", () => {
      const unrestrictedTools = [
        "Read",
        "Grep",
        "LS",
        "Glob",
        "TodoWrite",
        "skill",
      ];

      for (const toolName of unrestrictedTools) {
        const result = permissionManager.isRestrictedTool(toolName);
        expect(result).toBe(false);
        expect(mockLogger.debug).toHaveBeenCalledWith(
          "Checking if tool is restricted",
          { toolName, isRestricted: false },
        );
      }
    });

    it("should return false for unknown tools", () => {
      const unknownTools = ["UnknownTool", "CustomTool", ""];

      for (const toolName of unknownTools) {
        const result = permissionManager.isRestrictedTool(toolName);
        expect(result).toBe(false);
      }
    });

    it("should handle case sensitivity correctly", () => {
      // Test that tool names are case-sensitive
      expect(permissionManager.isRestrictedTool("edit")).toBe(false);
      expect(permissionManager.isRestrictedTool("EDIT")).toBe(false);
      expect(permissionManager.isRestrictedTool("Edit")).toBe(true);
    });
  });

  describe("createContext method", () => {
    it("should create context without callback", () => {
      const context = permissionManager.createContext("Edit", "default");

      expect(context).toEqual({
        toolName: "Edit",
        permissionMode: "default",
        canUseToolCallback: undefined,
      });
      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Created permission context",
        {
          toolName: "Edit",
          permissionMode: "default",
          hasCallback: false,
        },
      );
    });

    it("should create context with callback", () => {
      const mockCallback: PermissionCallback = vi.fn().mockResolvedValue({
        behavior: "allow",
      });

      const context = permissionManager.createContext(
        "Delete",
        "bypassPermissions",
        mockCallback,
      );

      expect(context).toEqual({
        toolName: "Delete",
        permissionMode: "bypassPermissions",
        canUseToolCallback: mockCallback,
      });
      expect(mockLogger.debug).toHaveBeenCalledWith(
        "Created permission context",
        {
          toolName: "Delete",
          permissionMode: "bypassPermissions",
          hasCallback: true,
        },
      );
    });

    it("should create context for all permission modes", () => {
      const modes: PermissionMode[] = ["default", "bypassPermissions"];

      for (const mode of modes) {
        const context = permissionManager.createContext("Write", mode);

        expect(context.permissionMode).toBe(mode);
        expect(context.toolName).toBe("Write");
        expect(context.canUseToolCallback).toBeUndefined();
      }
    });

    it("should create context for all restricted tools", () => {
      for (const toolName of RESTRICTED_TOOLS) {
        const context = permissionManager.createContext(toolName, "default");

        expect(context.toolName).toBe(toolName);
        expect(context.permissionMode).toBe("default");
      }
    });
  });

  describe("Logger Integration", () => {
    it("should work without logger", async () => {
      const managerWithoutLogger = new PermissionManager();

      const context: ToolPermissionContext = {
        toolName: "Read",
        permissionMode: "default",
      };

      const result = await managerWithoutLogger.checkPermission(context);

      expect(result).toEqual({ behavior: "allow" });
      // Should not throw any errors when logger is undefined
    });

    it("should log at appropriate levels", async () => {
      // Test debug level logging
      const context: ToolPermissionContext = {
        toolName: "Edit",
        permissionMode: "default",
      };

      await permissionManager.checkPermission(context);

      expect(mockLogger.debug).toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalled();
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it("should log error for callback exceptions", async () => {
      const mockCallback: PermissionCallback = vi
        .fn()
        .mockRejectedValue(new Error("Test error"));

      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        canUseToolCallback: mockCallback,
      };

      await permissionManager.checkPermission(context);

      expect(mockLogger.error).toHaveBeenCalledWith(
        "Error in permission callback",
        { toolName: "Bash", error: "Test error" },
      );
    });
  });

  describe("Contract Compliance", () => {
    it("should implement IPermissionManager interface methods", () => {
      // Verify all required methods exist
      expect(typeof permissionManager.checkPermission).toBe("function");
      expect(typeof permissionManager.isRestrictedTool).toBe("function");
      expect(typeof permissionManager.createContext).toBe("function");
    });

    it("should handle all permission modes correctly", async () => {
      const modes: PermissionMode[] = ["default", "bypassPermissions"];

      for (const mode of modes) {
        const context: ToolPermissionContext = {
          toolName: "Edit",
          permissionMode: mode,
        };

        const result = await permissionManager.checkPermission(context);

        // Should return a valid PermissionDecision
        expect(result).toHaveProperty("behavior");
        expect(["allow", "deny"]).toContain(result.behavior);

        if (result.behavior === "deny") {
          expect(result).toHaveProperty("message");
          expect(typeof result.message).toBe("string");
        }
      }
    });

    it("should handle ToolPermissionContext correctly", () => {
      const context = permissionManager.createContext("Write", "default");

      // Verify context has required properties
      expect(context).toHaveProperty("toolName");
      expect(context).toHaveProperty("permissionMode");
      expect(typeof context.toolName).toBe("string");
      expect(["default", "bypassPermissions"]).toContain(
        context.permissionMode,
      );
    });

    it("should validate RESTRICTED_TOOLS constant usage", () => {
      // Verify each tool in RESTRICTED_TOOLS is recognized as restricted
      for (const toolName of RESTRICTED_TOOLS) {
        expect(permissionManager.isRestrictedTool(toolName)).toBe(true);
      }

      // Verify the exact list matches expected tools
      expect(RESTRICTED_TOOLS).toEqual([
        "Edit",
        "MultiEdit",
        "Delete",
        "Bash",
        "Write",
      ]);
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle empty tool names", () => {
      const result = permissionManager.isRestrictedTool("");
      expect(result).toBe(false);
    });

    it("should handle undefined callback gracefully", async () => {
      const context: ToolPermissionContext = {
        toolName: "Edit",
        permissionMode: "default",
        canUseToolCallback: undefined,
      };

      const result = await permissionManager.checkPermission(context);

      expect(result.behavior).toBe("deny");
      expect(result.message).toContain("No permission callback configured");
    });

    it("should handle callback that returns partial decision", async () => {
      const mockCallback: PermissionCallback = vi.fn().mockResolvedValue({
        behavior: "allow",
        // No message property
      } as PermissionDecision);

      const context: ToolPermissionContext = {
        toolName: "Write",
        permissionMode: "default",
        canUseToolCallback: mockCallback,
      };

      const result = await permissionManager.checkPermission(context);

      expect(result.behavior).toBe("allow");
      expect(result.message).toBeUndefined();
    });
  });
});
