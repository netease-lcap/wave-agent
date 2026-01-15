import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
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

    describe("acceptEdits mode", () => {
      it("should allow file tools in acceptEdits mode", async () => {
        const fileTools = ["Edit", "MultiEdit", "Delete", "Write"];

        for (const toolName of fileTools) {
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

      it("should still require permission for Bash in acceptEdits mode", async () => {
        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "acceptEdits",
        };

        const result = await permissionManager.checkPermission(context);

        expect(result.behavior).toBe("deny");
        expect(result.message).toContain("requires permission approval");
      });
    });

    describe("persistent rules (permissions.allow)", () => {
      it("should allow Bash command if it matches an allowed rule", async () => {
        permissionManager.updateAllowedRules(["Bash(ls -la)"]);

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "ls -la" },
        };

        const result = await permissionManager.checkPermission(context);

        expect(result).toEqual({ behavior: "allow" });
        expect(mockLogger.debug).toHaveBeenCalledWith(
          "Permission allowed by persistent rule",
          { toolName: "Bash" },
        );
      });

      it("should deny Bash command if it does not match any allowed rule", async () => {
        permissionManager.updateAllowedRules(["Bash(ls -la)"]);

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "rm -rf /" },
        };

        const result = await permissionManager.checkPermission(context);

        expect(result.behavior).toBe("deny");
      });

      it("should handle missing toolInput or command gracefully", async () => {
        permissionManager.updateAllowedRules(["Bash(ls -la)"]);

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
        };

        const result = await permissionManager.checkPermission(context);

        expect(result.behavior).toBe("deny");
      });

      it("should support multiple allowed rules", async () => {
        permissionManager.updateAllowedRules(["Bash(ls)", "Bash(pwd)"]);

        const context1: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "ls" },
        };
        const context2: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "pwd" },
        };

        expect(
          (await permissionManager.checkPermission(context1)).behavior,
        ).toBe("allow");
        expect(
          (await permissionManager.checkPermission(context2)).behavior,
        ).toBe("allow");
      });

      it("should allow Bash command with prefix match using :*", async () => {
        permissionManager.updateAllowedRules(["Bash(git commit:*)"]);

        const context1: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: 'git commit -m "feat: add prefix matching"' },
        };

        const context2: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "git commit --amend" },
        };

        expect(
          (await permissionManager.checkPermission(context1)).behavior,
        ).toBe("allow");
        expect(
          (await permissionManager.checkPermission(context2)).behavior,
        ).toBe("allow");
      });

      it("should deny Bash command if prefix does not match", async () => {
        permissionManager.updateAllowedRules(["Bash(git commit:*)"]);

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "git push" },
        };

        const result = await permissionManager.checkPermission(context);
        expect(result.behavior).toBe("deny");
      });

      it("should treat :* as literal if not at the end", async () => {
        permissionManager.updateAllowedRules(["Bash(echo :* test)"]);

        const context1: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "echo hello test" },
        };

        const context2: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "echo :* test" },
        };

        expect(
          (await permissionManager.checkPermission(context1)).behavior,
        ).toBe("deny");
        expect(
          (await permissionManager.checkPermission(context2)).behavior,
        ).toBe("allow");
      });

      it("should handle empty prefix with :*", async () => {
        permissionManager.updateAllowedRules(["Bash(:*)"]);

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "any command" },
        };

        const result = await permissionManager.checkPermission(context);
        expect(result.behavior).toBe("allow");
      });
    });

    describe("temporary rules (addTemporaryRules)", () => {
      it("should allow a restricted tool if it is in temporary rules", async () => {
        permissionManager.addTemporaryRules(["Edit"]);

        const context: ToolPermissionContext = {
          toolName: "Edit",
          permissionMode: "default",
        };

        const result = await permissionManager.checkPermission(context);

        expect(result).toEqual({ behavior: "allow" });
      });

      it("should allow Bash if it is in temporary rules", async () => {
        permissionManager.addTemporaryRules(["Bash"]);

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "rm -rf /" }, // Even dangerous commands are allowed if tool is in temporary rules
        };

        const result = await permissionManager.checkPermission(context);

        expect(result).toEqual({ behavior: "allow" });
      });

      it("should not affect other tools not in the list", async () => {
        permissionManager.addTemporaryRules(["Edit"]);

        const context: ToolPermissionContext = {
          toolName: "Delete",
          permissionMode: "default",
        };

        const result = await permissionManager.checkPermission(context);

        expect(result.behavior).toBe("deny");
      });

      it("should clear temporary rules", async () => {
        permissionManager.addTemporaryRules(["Edit"]);
        permissionManager.clearTemporaryRules();

        const context: ToolPermissionContext = {
          toolName: "Edit",
          permissionMode: "default",
        };

        const result = await permissionManager.checkPermission(context);

        expect(result.behavior).toBe("deny");
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
        expect(mockCallback).toHaveBeenCalledWith({
          toolName: "Edit",
          permissionMode: "default",
          canUseToolCallback: mockCallback,
        });
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
        expect(mockCallback).toHaveBeenCalledWith({
          toolName: "Delete",
          permissionMode: "default",
          canUseToolCallback: mockCallback,
        });
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
        expect(mockCallback).toHaveBeenCalledWith({
          toolName: "Write",
          permissionMode: "default",
          canUseToolCallback: mockCallback,
        });
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
          expect(mockCallback).toHaveBeenCalledWith({
            toolName,
            permissionMode: "default",
            canUseToolCallback: mockCallback,
          });
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
        "Skill",
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
          hasToolInput: false,
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
          hasToolInput: false,
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

    describe("hidePersistentOption logic", () => {
      const workdir = "/home/user/project";

      it("should set hidePersistentOption for dangerous commands", () => {
        const context = permissionManager.createContext(
          "Bash",
          "default",
          undefined,
          {
            command: "rm -rf /",
            workdir,
          },
        );

        expect(context.hidePersistentOption).toBe(true);
      });

      it("should set hidePersistentOption for out-of-bounds cd", () => {
        vi.spyOn(fs, "realpathSync").mockImplementation((p) => {
          if (p.toString() === "/home/user") return "/home/user";
          return "/home/user/project";
        });

        const context = permissionManager.createContext(
          "Bash",
          "default",
          undefined,
          {
            command: "cd ..",
            workdir,
          },
        );

        expect(context.hidePersistentOption).toBe(true);
      });

      it("should set hidePersistentOption for out-of-bounds ls", () => {
        vi.spyOn(fs, "realpathSync").mockImplementation((p) => {
          if (p.toString() === "/etc") return "/etc";
          return "/home/user/project";
        });

        const context = permissionManager.createContext(
          "Bash",
          "default",
          undefined,
          {
            command: "ls /etc",
            workdir,
          },
        );

        expect(context.hidePersistentOption).toBe(true);
      });

      it("should NOT set hidePersistentOption for safe commands", () => {
        vi.spyOn(fs, "realpathSync").mockImplementation(
          () => "/home/user/project/src",
        );

        const context = permissionManager.createContext(
          "Bash",
          "default",
          undefined,
          {
            command: "ls src",
            workdir,
          },
        );

        expect(context.hidePersistentOption).toBeFalsy();
      });

      it("should NOT set hidePersistentOption for non-Bash tools", () => {
        const context = permissionManager.createContext(
          "Edit",
          "default",
          undefined,
          {
            file_path: "src/index.ts",
          },
        );

        expect(context.hidePersistentOption).toBeFalsy();
      });
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

  describe("Complex Bash Commands", () => {
    it("should allow complex command if all parts are allowed", async () => {
      permissionManager.updateAllowedRules(["Bash(ls)", "Bash(pwd)"]);

      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "ls && pwd" },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("allow");
    });

    it("should deny complex command if any part is not allowed", async () => {
      permissionManager.updateAllowedRules(["Bash(ls)"]);

      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "ls && rm -rf /" },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("deny");
    });

    it("should strip env vars and redirections before checking rules", async () => {
      permissionManager.updateAllowedRules(["Bash(ls)", "Bash(echo hello)"]);

      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: {
          command: "VAR=val ls > out.txt && echo hello 2> /dev/null",
        },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("allow");
    });

    it("should handle complex operators like || and ;", async () => {
      permissionManager.updateAllowedRules([
        "Bash(ls)",
        "Bash(pwd)",
        "Bash(echo done)",
      ]);

      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "ls || pwd; echo done" },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("allow");
    });

    it("should deny if a part with prefix match doesn't match", async () => {
      permissionManager.updateAllowedRules(["Bash(ls)", "Bash(git commit:*)"]);

      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "ls && git push" },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("deny");
    });

    it("should allow if all parts match prefix rules", async () => {
      permissionManager.updateAllowedRules(["Bash(ls:*)", "Bash(git:*)"]);

      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "ls -la && git status" },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("allow");
    });

    it("should handle piped commands", async () => {
      permissionManager.updateAllowedRules(["Bash(ls)", "Bash(grep pattern)"]);

      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "ls | grep pattern" },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("allow");
    });

    it("should call callback if any part is not allowed", async () => {
      permissionManager.updateAllowedRules(["Bash(ls)"]);
      const mockCallback: PermissionCallback = vi.fn().mockResolvedValue({
        behavior: "allow",
      });

      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "ls && mkdir test" },
        canUseToolCallback: mockCallback,
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("allow");
      expect(mockCallback).toHaveBeenCalled();
    });
  });

  describe("Safe Commands", () => {
    const workdir = "/home/user/project";

    it("should allow 'cd src' if src is inside workdir", async () => {
      // Mock fs.realpathSync to return paths that are inside workdir
      vi.spyOn(fs, "realpathSync").mockImplementation((p) => {
        if (p.toString().includes("src")) return "/home/user/project/src";
        return "/home/user/project";
      });

      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "cd src", workdir },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("allow");
    });

    it("should deny 'cd ..' if it goes outside workdir", async () => {
      vi.spyOn(fs, "realpathSync").mockImplementation((p) => {
        const pathStr = p.toString();
        if (pathStr === "/home/user") return "/home/user";
        return "/home/user/project";
      });

      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "cd ..", workdir },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("deny");
    });

    it("should deny 'ls /etc' if it is outside workdir", async () => {
      vi.spyOn(fs, "realpathSync").mockImplementation((p) => {
        const pathStr = p.toString();
        if (pathStr === "/etc") return "/etc";
        return "/home/user/project";
      });

      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "ls /etc", workdir },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("deny");
    });

    it("should allow 'cd src && ls' if both are safe", async () => {
      vi.spyOn(fs, "realpathSync").mockImplementation((p) => {
        if (p.toString().includes("src")) return "/home/user/project/src";
        return "/home/user/project";
      });

      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "cd src && ls", workdir },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("allow");
    });

    it("should deny 'cd src && rm -rf /' because rm is not safe", async () => {
      vi.spyOn(fs, "realpathSync").mockImplementation((p) => {
        if (p.toString().includes("src")) return "/home/user/project/src";
        return "/home/user/project";
      });

      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "cd src && rm -rf /", workdir },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("deny");
    });
  });

  describe("expandBashRule method", () => {
    const workdir = "/home/user/project";

    beforeEach(() => {
      vi.spyOn(fs, "realpathSync").mockImplementation((p) => {
        const pathStr = p.toString();
        if (pathStr.includes("src")) return "/home/user/project/src";
        if (pathStr.includes("..") || pathStr === "/home/user")
          return "/home/user";
        if (pathStr === "/etc") return "/etc";
        return "/home/user/project";
      });
    });

    it("should split chained commands and filter safe ones", () => {
      const command = "mkdir test && cd test";
      const rules = permissionManager.expandBashRule(command, workdir);
      expect(rules).toEqual(["Bash(mkdir test)"]);
    });

    it("should handle multiple non-safe commands", () => {
      const command = "npm install | grep error";
      const rules = permissionManager.expandBashRule(command, workdir);
      expect(rules).toEqual(["Bash(npm install:*)", "Bash(grep error)"]);
    });

    it("should return empty array for only safe commands", () => {
      const command = "cd src && ls";
      const rules = permissionManager.expandBashRule(command, workdir);
      expect(rules).toEqual([]);
    });

    it("should handle subshells", () => {
      const command = "(mkdir test && cd test) || ls";
      const rules = permissionManager.expandBashRule(command, workdir);
      expect(rules).toEqual(["Bash(mkdir test)"]);
    });

    it("should strip env vars and redirections from rules", () => {
      const command = "VAR=val npm install > out.txt";
      const rules = permissionManager.expandBashRule(command, workdir);
      expect(rules).toEqual(["Bash(npm install:*)"]);
    });

    it("should identify unsafe paths in cd/ls as non-safe and filter them out", () => {
      const command = "cd /etc && ls ..";
      const rules = permissionManager.expandBashRule(command, workdir);
      expect(rules).toEqual([]);
    });

    it("should handle pwd as safe", () => {
      const command = "pwd && echo hello";
      const rules = permissionManager.expandBashRule(command, workdir);
      expect(rules).toEqual(["Bash(echo hello)"]);
    });

    it("should handle true and false as safe", () => {
      const command = "ls || true && false";
      const rules = permissionManager.expandBashRule(command, workdir);
      expect(rules).toEqual([]);
    });

    it("should refuse to expand dangerous commands", () => {
      const command = "rm -rf / && ls";
      const rules = permissionManager.expandBashRule(command, workdir);
      expect(rules).toEqual([]); // rm is dangerous, ls is safe
    });

    it("should refuse to expand out-of-bounds commands", () => {
      const command = "cd /etc && ls";
      const rules = permissionManager.expandBashRule(command, workdir);
      expect(rules).toEqual([]); // cd /etc is out-of-bounds, ls is safe
    });

    it("should not return broad prefix rules for unknown subcommands", () => {
      const command = "npm list";
      const rules = permissionManager.expandBashRule(command, workdir);
      expect(rules).toContain("Bash(npm list)");
      expect(rules).not.toContain("Bash(npm:*)");
    });

    it("should still return prefix rules for known safe subcommands", () => {
      const command = "npm install lodash";
      const rules = permissionManager.expandBashRule(command, workdir);
      expect(rules).toEqual(["Bash(npm install:*)"]);
    });
  });
});
