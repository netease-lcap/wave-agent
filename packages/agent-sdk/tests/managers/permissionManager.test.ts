import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PermissionManager } from "../../src/managers/permissionManager.js";
import { RESTRICTED_TOOLS } from "../../src/types/permissions.js";
import type {
  PermissionDecision,
  ToolPermissionContext,
  PermissionCallback,
  PermissionMode,
} from "../../src/types/permissions.js";
import { Container } from "../../src/utils/container.js";
import { logger } from "../../src/utils/globalLogger.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("PermissionManager", () => {
  let permissionManager: PermissionManager;
  const container = new Container();

  beforeEach(() => {
    vi.clearAllMocks();
    // Create mock Logger

    const container = new Container();

    // Create PermissionManager instance
    permissionManager = new PermissionManager(container);
  });

  describe("Constructor and Initialization", () => {
    it("should create instance", () => {
      const manager = new PermissionManager(container);
      expect(manager).toBeInstanceOf(PermissionManager);
    });
  });

  describe("checkPermission method", () => {
    describe("Bash Heredoc Write Interception", () => {
      it("should deny bash commands with heredoc write redirections and provide a reminder", async () => {
        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "cat <<EOF > test.txt\ncontent\nEOF" },
        };

        const result = await permissionManager.checkPermission(context);
        expect(result.behavior).toBe("deny");
        expect(result.message).toContain(
          "Bash-based file writing operations using heredocs",
        );
        expect(result.message).toContain(
          "Please use the dedicated 'Write' or 'Edit' tools",
        );
      });

      it("should deny bash commands with heredoc append redirections", async () => {
        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "cat <<EOF >> test.txt\ncontent\nEOF" },
        };

        const result = await permissionManager.checkPermission(context);
        expect(result.behavior).toBe("deny");
      });

      it("should allow bash commands with simple write redirections (not heredoc)", async () => {
        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "echo 'test' > test.txt" },
        };

        // Should fall through to normal permission check (which is deny for Bash without callback)
        const result = await permissionManager.checkPermission(context);
        expect(result.behavior).toBe("deny");
        expect(result.message).not.toContain(
          "Bash-based file writing operations using heredocs",
        );
        expect(result.message).toContain("requires permission approval");
      });

      it("should allow bash commands with heredoc but no write redirection", async () => {
        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "cat <<EOF\ncontent\nEOF" },
        };

        // cat is allowed by default rules
        const result = await permissionManager.checkPermission(context);
        expect(result.behavior).toBe("allow");
      });

      it("should allow bash commands with stream redirections (e.g., 2>&1)", async () => {
        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "ls non_existent 2>&1" },
        };

        // ls is allowed by default rules
        // Note: 2>&1 is now ignored by hasWriteRedirections
        const result = await permissionManager.checkPermission(context);
        expect(result.behavior).toBe("allow");
      });

      it("should deny bash heredoc write redirections even in bypassPermissions mode", async () => {
        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "bypassPermissions",
          toolInput: { command: "cat <<EOF > test.txt\ncontent\nEOF" },
        };

        const result = await permissionManager.checkPermission(context);
        expect(result.behavior).toBe("deny");
      });
    });

    describe("find command", () => {
      it("should allow safe find commands by default", async () => {
        const contexts = [
          {
            toolName: "Bash",
            permissionMode: "default",
            toolInput: { command: "find ." },
          },
          {
            toolName: "Bash",
            permissionMode: "default",
            toolInput: { command: "find . -name '*.ts'" },
          },
          {
            toolName: "Bash",
            permissionMode: "default",
            toolInput: { command: "find src -type f" },
          },
        ];

        for (const context of contexts) {
          const result = await permissionManager.checkPermission(
            context as ToolPermissionContext,
          );
          expect(result.behavior).toBe("allow");
        }
      });

      it("should deny dangerous find flags by default", async () => {
        const contexts = [
          {
            toolName: "Bash",
            permissionMode: "default",
            toolInput: { command: "find . -delete" },
          },
          {
            toolName: "Bash",
            permissionMode: "default",
            toolInput: { command: "find . -exec rm {} \\;" },
          },
          {
            toolName: "Bash",
            permissionMode: "default",
            toolInput: { command: "find . -execdir ls {} \\;" },
          },
          {
            toolName: "Bash",
            permissionMode: "default",
            toolInput: { command: "find . -ok rm {} \\;" },
          },
          {
            toolName: "Bash",
            permissionMode: "default",
            toolInput: { command: "find . -okdir ls {} \\;" },
          },
          {
            toolName: "Bash",
            permissionMode: "default",
            toolInput: { command: "find . -fprint output.txt" },
          },
          {
            toolName: "Bash",
            permissionMode: "default",
            toolInput: { command: "find . -fprint0 output.txt" },
          },
          {
            toolName: "Bash",
            permissionMode: "default",
            toolInput: { command: "find . -fprintf output.txt '%p\\n'" },
          },
        ];

        for (const context of contexts) {
          const result = await permissionManager.checkPermission(
            context as ToolPermissionContext,
          );
          expect(result.behavior).toBe("deny");
          expect(result.message).toContain("requires permission approval");
        }
      });

      it("should allow dangerous find flags if explicitly allowed by rule", async () => {
        permissionManager.updateAllowedRules(["Bash(find . -delete)"]);

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "find . -delete" },
        };

        const result = await permissionManager.checkPermission(context);
        expect(result.behavior).toBe("allow");
      });

      it("should not expand dangerous find commands into persistent rules", async () => {
        const workdir = "/home/user/project";
        const rules = permissionManager.expandBashRule(
          "find . -delete",
          workdir,
        );
        expect(rules).toEqual([]);
      });

      it("should expand safe find commands into smart prefix rules", async () => {
        const workdir = "/home/user/project";
        // find doesn't have a smart prefix rule in TOOL_RULES yet, so it will return null from getSmartPrefix
        // and expand to the full command (processed).
        const rules = permissionManager.expandBashRule(
          "find . -name test",
          workdir,
        );
        // find is a safe command, so expandBashRule should return an empty array if it's considered "safe"
        // because safe commands don't need explicit rules.
        expect(rules).toEqual([]);
      });
    });

    describe("Safe Zone and Auto-Memory", () => {
      it("should allow file operations in auto-memory directory (Safe Zone)", async () => {
        const workdir = "/home/user/project";
        const autoMemoryDir = "/home/user/.wave/projects/encoded/memory";
        const container = new Container();
        const manager = new PermissionManager(container, {
          workdir,
          additionalDirectories: [autoMemoryDir],
        });

        const contextAcceptEdits: ToolPermissionContext = {
          toolName: "Write",
          permissionMode: "acceptEdits",
          toolInput: { file_path: path.join(autoMemoryDir, "MEMORY.md") },
        };

        const result = await manager.checkPermission(contextAcceptEdits);
        expect(result.behavior).toBe("allow");
      });

      it("should allow file operations in system additional directories", async () => {
        const workdir = "/home/user/project";
        const systemDir = "/home/user/system-safe";
        const container = new Container();
        const manager = new PermissionManager(container, {
          workdir,
        });

        manager.addSystemAdditionalDirectory(systemDir);

        const contextAcceptEdits: ToolPermissionContext = {
          toolName: "Write",
          permissionMode: "acceptEdits",
          toolInput: { file_path: path.join(systemDir, "test.txt") },
        };

        const result = await manager.checkPermission(contextAcceptEdits);
        expect(result.behavior).toBe("allow");
      });

      it("should deny file operations outside Safe Zone in acceptEdits mode", async () => {
        const workdir = "/home/user/project";
        const container = new Container();
        const manager = new PermissionManager(container, {
          workdir,
        });

        const context: ToolPermissionContext = {
          toolName: "Write",
          permissionMode: "acceptEdits",
          toolInput: { file_path: "/etc/passwd" },
        };

        const result = await manager.checkPermission(context);
        // Should fall through to manual confirmation (deny without callback)
        expect(result.behavior).toBe("deny");
      });
    });

    describe("instance-specific rules (allowedTools and disallowedTools)", () => {
      it("should deny tool if it is in instanceDeniedRules", async () => {
        const manager = new PermissionManager(container, {
          instanceDeniedRules: ["Bash"],
        });

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "ls" },
        };

        const result = await manager.checkPermission(context);

        expect(result.behavior).toBe("deny");
        expect(result.message).toContain(
          "explicitly denied by instance rule: Bash",
        );
      });

      it("should allow tool if it is in instanceAllowedRules", async () => {
        const manager = new PermissionManager(container, {
          instanceAllowedRules: ["Bash(ls)"],
        });

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "ls" },
        };

        const result = await manager.checkPermission(context);

        expect(result.behavior).toBe("allow");
      });

      it("should give precedence to instanceDeniedRules over instanceAllowedRules", async () => {
        const manager = new PermissionManager(container, {
          instanceAllowedRules: ["Bash"],
          instanceDeniedRules: ["Bash(rm *)"],
        });

        const contextAllow: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "ls" },
        };
        const contextDeny: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "rm -rf /" },
        };

        expect((await manager.checkPermission(contextAllow)).behavior).toBe(
          "allow",
        );
        expect((await manager.checkPermission(contextDeny)).behavior).toBe(
          "deny",
        );
      });

      it("should give precedence to instanceAllowedRules over global allowedRules", async () => {
        // Global allowedRules usually require confirmation if not matched,
        // but here we test that instanceAllowedRules auto-approve.
        const manager = new PermissionManager(container, {
          instanceAllowedRules: ["Bash(ls)"],
          allowedRules: [], // No global rules
        });

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "ls" },
        };

        const result = await manager.checkPermission(context);
        expect(result.behavior).toBe("allow");
      });

      it("should give precedence to instanceDeniedRules over global allowedRules", async () => {
        const manager = new PermissionManager(container, {
          instanceDeniedRules: ["Bash"],
          allowedRules: ["Bash"],
        });

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "ls" },
        };

        const result = await manager.checkPermission(context);
        expect(result.behavior).toBe("deny");
      });
    });

    describe("explicit denial (permissions.deny)", () => {
      it("should deny tool if it is in deniedRules", async () => {
        permissionManager.updateDeniedRules(["Bash"]);

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "ls" },
        };

        const result = await permissionManager.checkPermission(context);

        expect(result.behavior).toBe("deny");
        expect(result.message).toContain("explicitly denied by rule: Bash");
      });

      it("should deny unrestricted tool if it is in deniedRules", async () => {
        permissionManager.updateDeniedRules(["Read"]);

        const context: ToolPermissionContext = {
          toolName: "Read",
          permissionMode: "default",
          toolInput: { file_path: "test.txt" },
        };

        const result = await permissionManager.checkPermission(context);

        expect(result.behavior).toBe("deny");
        expect(result.message).toContain("explicitly denied by rule: Read");
      });

      it("should deny Bash command if it matches a denied rule", async () => {
        permissionManager.updateDeniedRules(["Bash(rm *)"]);

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "rm -rf /" },
        };

        const result = await permissionManager.checkPermission(context);

        expect(result.behavior).toBe("deny");
        expect(result.message).toContain(
          "explicitly denied by rule: Bash(rm *)",
        );
      });

      it("should deny path-based access if it matches a denied rule", async () => {
        permissionManager.updateDeniedRules(["Read(**/*.env)"]);

        const context: ToolPermissionContext = {
          toolName: "Read",
          permissionMode: "default",
          toolInput: { file_path: "src/.env" },
        };

        const result = await permissionManager.checkPermission(context);

        expect(result.behavior).toBe("deny");
        expect(result.message).toContain(
          "explicitly denied by rule: Read(**/*.env)",
        );
      });

      it("should allow tool if it does not match any denied rule", async () => {
        permissionManager.updateDeniedRules(["Bash(rm *)"]);

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "mkdir" },
        };

        const result = await permissionManager.checkPermission(context);

        // Should fall through to default behavior (which is deny for Bash without callback)
        expect(result.behavior).toBe("deny");
        expect(result.message).toContain("requires permission approval");
      });
    });

    describe("relative path matching", () => {
      const workdir = "/home/user/project";

      it("should match absolute path against relative pattern if inside workdir", async () => {
        const manager = new PermissionManager(container, { workdir });
        manager.updateDeniedRules(["Read(src/**)"]);

        const context: ToolPermissionContext = {
          toolName: "Read",
          permissionMode: "default",
          toolInput: { file_path: "/home/user/project/src/main.ts" },
        };

        const result = await manager.checkPermission(context);
        expect(result.behavior).toBe("deny");
        expect(result.message).toContain(
          "explicitly denied by rule: Read(src/**)",
        );
      });

      it("should NOT match absolute path against relative pattern if outside workdir", async () => {
        const manager = new PermissionManager(container, { workdir });
        manager.updateDeniedRules(["Read(src/**)"]);

        const context: ToolPermissionContext = {
          toolName: "Read",
          permissionMode: "default",
          toolInput: { file_path: "/home/user/other/src/main.ts" },
        };

        const result = await manager.checkPermission(context);
        // Read is unrestricted, so it should be allowed if not denied
        expect(result.behavior).toBe("allow");
      });

      it("should still match absolute pattern against absolute path", async () => {
        const manager = new PermissionManager(container, { workdir });
        const absolutePattern = "/home/user/project/src/**";
        manager.updateDeniedRules([`Read(${absolutePattern})`]);

        const context: ToolPermissionContext = {
          toolName: "Read",
          permissionMode: "default",
          toolInput: { file_path: "/home/user/project/src/main.ts" },
        };

        const result = await manager.checkPermission(context);
        expect(result.behavior).toBe("deny");
        expect(result.message).toContain(
          `explicitly denied by rule: Read(${absolutePattern})`,
        );
      });

      it("should match relative path against relative pattern", async () => {
        const manager = new PermissionManager(container, { workdir });
        manager.updateDeniedRules(["Read(src/**)"]);

        const context: ToolPermissionContext = {
          toolName: "Read",
          permissionMode: "default",
          toolInput: { file_path: "src/main.ts" },
        };

        const result = await manager.checkPermission(context);
        expect(result.behavior).toBe("deny");
      });
    });

    describe("precedence of deny over allow", () => {
      it("should deny if tool is in both allow and deny rules", async () => {
        permissionManager.updateAllowedRules(["Bash"]);
        permissionManager.updateDeniedRules(["Bash"]);

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "ls" },
        };

        const result = await permissionManager.checkPermission(context);

        expect(result.behavior).toBe("deny");
        expect(result.message).toContain("explicitly denied by rule: Bash");
      });

      it("should deny even in bypassPermissions mode", async () => {
        permissionManager.updateDeniedRules(["Bash"]);

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "bypassPermissions",
          toolInput: { command: "ls" },
        };

        const result = await permissionManager.checkPermission(context);

        expect(result.behavior).toBe("deny");
        expect(result.message).toContain("explicitly denied by rule: Bash");
      });

      it("should deny even in acceptEdits mode", async () => {
        permissionManager.updateDeniedRules(["Write(/etc/**)"]);

        const context: ToolPermissionContext = {
          toolName: "Write",
          permissionMode: "acceptEdits",
          toolInput: { file_path: "/etc/passwd" },
        };

        const result = await permissionManager.checkPermission(context);

        expect(result.behavior).toBe("deny");
        expect(result.message).toContain(
          "explicitly denied by rule: Write(/etc/**)",
        );
      });
    });

    describe("bypassPermissions mode", () => {
      it("should allow all tools in bypassPermissions mode", async () => {
        const context: ToolPermissionContext = {
          toolName: "Edit",
          permissionMode: "bypassPermissions",
        };

        const result = await permissionManager.checkPermission(context);

        expect(result).toEqual({ behavior: "allow" });
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

      it("should allow mkdir in bypassPermissions mode", async () => {
        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "bypassPermissions",
          toolInput: { command: "mkdir /etc/new_dir" },
        };

        const result = await permissionManager.checkPermission(context);
        expect(result.behavior).toBe("allow");
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
      it("should allow file tools in acceptEdits mode inside Safe Zone", async () => {
        const fileTools = ["Edit", "Write"];
        const workdir = "/home/user/project";
        const container = new Container();
        const manager = new PermissionManager(container, {
          workdir,
        });

        for (const toolName of fileTools) {
          const context: ToolPermissionContext = {
            toolName,
            permissionMode: "acceptEdits",
            toolInput: { file_path: "/home/user/project/test.txt" },
          };

          const result = await manager.checkPermission(context);

          expect(result).toEqual({ behavior: "allow" });
        }
      });

      it("should still require permission for Bash in acceptEdits mode", async () => {
        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "acceptEdits",
          toolInput: { command: "rm -rf /" },
        };

        const result = await permissionManager.checkPermission(context);

        expect(result.behavior).toBe("deny");
        expect(result.message).toContain("requires permission approval");
      });

      it("should allow mkdir in acceptEdits mode inside Safe Zone", async () => {
        const workdir = "/home/user/project";
        const container = new Container();
        const manager = new PermissionManager(container, {
          workdir,
        });

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "acceptEdits",
          toolInput: { command: "mkdir new_dir", workdir },
        };

        const result = await manager.checkPermission(context);
        expect(result.behavior).toBe("allow");
      });

      it("should allow mkdir with multiple paths in acceptEdits mode inside Safe Zone", async () => {
        const workdir = "/home/user/project";
        const container = new Container();
        const manager = new PermissionManager(container, {
          workdir,
        });

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "acceptEdits",
          toolInput: { command: "mkdir dir1 dir2 'dir 3'", workdir },
        };

        const result = await manager.checkPermission(context);
        expect(result.behavior).toBe("allow");
      });

      it("should allow mkdir -p in acceptEdits mode inside Safe Zone", async () => {
        const workdir = "/home/user/project";
        const container = new Container();
        const manager = new PermissionManager(container, {
          workdir,
        });

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "acceptEdits",
          toolInput: { command: "mkdir -p nested/dir", workdir },
        };

        const result = await manager.checkPermission(context);
        expect(result.behavior).toBe("allow");
      });

      it("should allow mkdir --parents in acceptEdits mode inside Safe Zone", async () => {
        const workdir = "/home/user/project";
        const container = new Container();
        const manager = new PermissionManager(container, {
          workdir,
        });

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "acceptEdits",
          toolInput: { command: "mkdir --parents nested/dir", workdir },
        };

        const result = await manager.checkPermission(context);
        expect(result.behavior).toBe("allow");
      });

      it("should allow mkdir with multiple flags in acceptEdits mode inside Safe Zone", async () => {
        const workdir = "/home/user/project";
        const container = new Container();
        const manager = new PermissionManager(container, {
          workdir,
        });

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "acceptEdits",
          toolInput: { command: "mkdir -p -v dir1 dir2", workdir },
        };

        const result = await manager.checkPermission(context);
        expect(result.behavior).toBe("allow");
      });

      it("should allow mkdir with quoted paths in acceptEdits mode inside Safe Zone", async () => {
        const workdir = "/home/user/project";
        const container = new Container();
        const manager = new PermissionManager(container, {
          workdir,
        });

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "acceptEdits",
          toolInput: {
            command: "mkdir \"dir with spaces\" 'another dir'",
            workdir,
          },
        };

        const result = await manager.checkPermission(context);
        expect(result.behavior).toBe("allow");
      });

      it("should allow mkdir with mixed quoted and unquoted paths in acceptEdits mode inside Safe Zone", async () => {
        const workdir = "/home/user/project";
        const container = new Container();
        const manager = new PermissionManager(container, {
          workdir,
        });

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "acceptEdits",
          toolInput: { command: 'mkdir dir1 "dir 2" dir3', workdir },
        };

        const result = await manager.checkPermission(context);
        expect(result.behavior).toBe("allow");
      });

      it("should allow mkdir with flags and mixed quoted/unquoted paths in acceptEdits mode inside Safe Zone", async () => {
        const workdir = "/home/user/project";
        const container = new Container();
        const manager = new PermissionManager(container, {
          workdir,
        });

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "acceptEdits",
          toolInput: { command: "mkdir -p -v \"dir 1\" dir2 'dir 3'", workdir },
        };

        const result = await manager.checkPermission(context);
        expect(result.behavior).toBe("allow");
      });

      it("should allow mkdir with flags, quoted paths and .. in acceptEdits mode inside Safe Zone", async () => {
        const workdir = "/home/user/project";
        const container = new Container();
        const manager = new PermissionManager(container, {
          workdir,
        });

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "acceptEdits",
          toolInput: { command: "mkdir -p \"src/../dir 1\" 'dir 2'", workdir },
        };

        const result = await manager.checkPermission(context);
        expect(result.behavior).toBe("allow");
      });

      it("should deny mkdir in acceptEdits mode outside Safe Zone", async () => {
        const workdir = "/home/user/project";
        const container = new Container();
        const manager = new PermissionManager(container, {
          workdir,
        });

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "acceptEdits",
          toolInput: { command: "mkdir /etc/new_dir", workdir },
        };

        const result = await manager.checkPermission(context);
        expect(result.behavior).toBe("deny");
      });

      it("should allow mkdir in acceptEdits mode inside additionalDirectories", async () => {
        const workdir = "/home/user/project";
        const additionalDir = "/home/user/additional";
        const container = new Container();
        const manager = new PermissionManager(container, {
          workdir,
          additionalDirectories: [additionalDir],
        });

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "acceptEdits",
          toolInput: { command: `mkdir ${additionalDir}/new_dir`, workdir },
        };

        const result = await manager.checkPermission(context);
        expect(result.behavior).toBe("allow");
      });

      it("should allow mkdir in acceptEdits mode inside systemAdditionalDirectories", async () => {
        const workdir = "/home/user/project";
        const systemDir = "/home/user/system";
        const container = new Container();
        const manager = new PermissionManager(container, {
          workdir,
        });
        manager.addSystemAdditionalDirectory(systemDir);

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "acceptEdits",
          toolInput: { command: `mkdir ${systemDir}/new_dir`, workdir },
        };

        const result = await manager.checkPermission(context);
        expect(result.behavior).toBe("allow");
      });

      it("should allow mkdir in acceptEdits mode inside autoMemoryDir", async () => {
        const workdir = "/home/user/project";
        const autoMemoryDir = "/home/user/.wave/projects/encoded/memory";
        const container = new Container();
        const manager = new PermissionManager(container, {
          workdir,
          additionalDirectories: [autoMemoryDir],
        });

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "acceptEdits",
          toolInput: { command: `mkdir ${autoMemoryDir}/new_dir`, workdir },
        };

        const result = await manager.checkPermission(context);
        expect(result.behavior).toBe("allow");
      });

      it("should allow mkdir in acceptEdits mode inside workdir", async () => {
        const workdir = "/home/user/project";
        const container = new Container();
        const manager = new PermissionManager(container, {
          workdir,
        });

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "acceptEdits",
          toolInput: { command: `mkdir ${workdir}/new_dir`, workdir },
        };

        const result = await manager.checkPermission(context);
        expect(result.behavior).toBe("allow");
      });

      it("should allow mkdir in acceptEdits mode inside workdir with relative path", async () => {
        const workdir = "/home/user/project";
        const container = new Container();
        const manager = new PermissionManager(container, {
          workdir,
        });

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "acceptEdits",
          toolInput: { command: "mkdir new_dir", workdir },
        };

        const result = await manager.checkPermission(context);
        expect(result.behavior).toBe("allow");
      });

      it("should allow mkdir in acceptEdits mode inside workdir with .. path", async () => {
        const workdir = "/home/user/project";
        const container = new Container();
        const manager = new PermissionManager(container, {
          workdir,
        });

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "acceptEdits",
          toolInput: { command: "mkdir src/../new_dir", workdir },
        };

        const result = await manager.checkPermission(context);
        expect(result.behavior).toBe("allow");
      });

      it("should deny mkdir in acceptEdits mode outside workdir with .. path", async () => {
        const workdir = "/home/user/project";
        const container = new Container();
        const manager = new PermissionManager(container, {
          workdir,
        });

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "acceptEdits",
          toolInput: { command: "mkdir ../new_dir", workdir },
        };

        const result = await manager.checkPermission(context);
        expect(result.behavior).toBe("deny");
      });

      it("should deny mkdir in acceptEdits mode if any path is outside Safe Zone", async () => {
        const workdir = "/home/user/project";
        const container = new Container();
        const manager = new PermissionManager(container, {
          workdir,
        });

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "acceptEdits",
          toolInput: { command: "mkdir safe_dir /etc/unsafe_dir", workdir },
        };

        const result = await manager.checkPermission(context);
        expect(result.behavior).toBe("deny");
      });
    });

    describe("dontAsk mode", () => {
      it("should allow restricted tools if they match an allowed rule", async () => {
        permissionManager.updateAllowedRules(["Bash(ls)"]);

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "dontAsk",
          toolInput: { command: "ls" },
        };

        const result = await permissionManager.checkPermission(context);
        expect(result.behavior).toBe("allow");
      });

      it("should allow restricted tools if they match a temporary rule", async () => {
        permissionManager.addTemporaryRules(["Edit"]);

        const context: ToolPermissionContext = {
          toolName: "Edit",
          permissionMode: "dontAsk",
        };

        const result = await permissionManager.checkPermission(context);
        expect(result.behavior).toBe("allow");
      });

      it("should auto-deny restricted tools if they do NOT match any rule", async () => {
        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "dontAsk",
          toolInput: { command: "rm -rf /" },
        };

        const result = await permissionManager.checkPermission(context);
        expect(result.behavior).toBe("deny");
        expect(result.message).toContain("automatically denied");
        expect(result.message).toContain("dontAsk");
      });

      it("should allow unrestricted tools in dontAsk mode", async () => {
        const context: ToolPermissionContext = {
          toolName: "Read",
          permissionMode: "dontAsk",
          toolInput: { file_path: "test.txt" },
        };

        const result = await permissionManager.checkPermission(context);
        expect(result.behavior).toBe("allow");
      });

      it("should NOT call the permission callback in dontAsk mode for unapproved tools", async () => {
        const mockCallback = vi.fn().mockResolvedValue({ behavior: "allow" });

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "dontAsk",
          toolInput: { command: "rm -rf /" },
          canUseToolCallback: mockCallback,
        };

        const result = await permissionManager.checkPermission(context);
        expect(result.behavior).toBe("deny");
        expect(mockCallback).not.toHaveBeenCalled();
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

      it("should allow Bash command with glob match", async () => {
        permissionManager.updateAllowedRules(["Bash(git commit *)"]);

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

      it("should allow Bash command with wildcard in the middle", async () => {
        permissionManager.updateAllowedRules(["Bash(git * main)"]);

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "git push origin main" },
        };

        expect(
          (await permissionManager.checkPermission(context)).behavior,
        ).toBe("allow");
      });

      it("should allow Bash command with wildcard at the beginning", async () => {
        permissionManager.updateAllowedRules(["Bash(* --version)"]);

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "node --version" },
        };

        expect(
          (await permissionManager.checkPermission(context)).behavior,
        ).toBe("allow");
      });

      it("should deny Bash command if glob does not match", async () => {
        permissionManager.updateAllowedRules(["Bash(git commit *)"]);

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "git push" },
        };

        const result = await permissionManager.checkPermission(context);
        expect(result.behavior).toBe("deny");
      });

      it("should deny mkdir in default mode without rule", async () => {
        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "mkdir new_dir" },
        };

        const result = await permissionManager.checkPermission(context);
        expect(result.behavior).toBe("deny");
      });

      it("should allow mkdir in default mode with rule", async () => {
        permissionManager.updateAllowedRules(["Bash(mkdir *)"]);

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "mkdir new_dir" },
        };

        const result = await permissionManager.checkPermission(context);
        expect(result.behavior).toBe("allow");
      });

      it("should no longer support :* as a special suffix", async () => {
        permissionManager.updateAllowedRules(["Bash(git commit:*)"]);

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "git commit -m 'test'" },
        };

        const result = await permissionManager.checkPermission(context);
        expect(result.behavior).toBe("deny");
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
          toolName: "Bash",
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
        const unrestrictedTools = ["Read", "Grep", "LS", "Glob", "TaskCreate"];

        for (const toolName of unrestrictedTools) {
          const context: ToolPermissionContext = {
            toolName,
            permissionMode: "default",
          };

          const result = await permissionManager.checkPermission(context);

          expect(result).toEqual({ behavior: "allow" });
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
      });

      it("should call callback and return deny decision with message", async () => {
        const mockCallback: PermissionCallback = vi.fn().mockResolvedValue({
          behavior: "deny",
          message: "User denied permission",
        });

        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          canUseToolCallback: mockCallback,
        };

        const result = await permissionManager.checkPermission(context);

        expect(result).toEqual({
          behavior: "deny",
          message: "User denied permission",
        });
        expect(mockCallback).toHaveBeenCalledWith({
          toolName: "Bash",
          permissionMode: "default",
          canUseToolCallback: mockCallback,
        });
        expect(logger.debug).toHaveBeenCalledWith(
          "Custom callback returned decision",
          {
            toolName: "Bash",
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
        expect(logger.error).toHaveBeenCalledWith(
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
        expect(logger.error).toHaveBeenCalledWith(
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

      it("should handle clearContext in decision", async () => {
        const mockCallback: PermissionCallback = vi.fn().mockResolvedValue({
          behavior: "allow",
          clearContext: true,
        });

        const context: ToolPermissionContext = {
          toolName: "ExitPlanMode",
          permissionMode: "default",
          canUseToolCallback: mockCallback,
        };

        const result = await permissionManager.checkPermission(context);

        expect(result.behavior).toBe("allow");
        expect(result.clearContext).toBe(true);
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
        expect(logger.warn).toHaveBeenCalledWith(
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
  });

  describe("isRestrictedTool method", () => {
    describe("Bash Rule Matching (Regex-based)", () => {
      it("should match commands with slashes using *", async () => {
        permissionManager.updateAllowedRules(["Bash(npm run test*)"]);
        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: {
            command: "npm run test:demo -- tests/demo/plugins-ui.demo.ts",
          },
        };
        expect(
          (await permissionManager.checkPermission(context)).behavior,
        ).toBe("allow");
      });

      it("should match commands with multiple wildcards", async () => {
        permissionManager.updateAllowedRules(["Bash(git * commit * -m *)"]);
        // The command "git commit -a -m 'feat: something'" matches "git * commit * -m *"
        // Wait, "git commit" starts with "git ", then "commit" ...
        // Actually "git * commit" expects something between "git" and "commit".
        // Let's use a pattern that definitely matches or fix the command.
        const context2: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: {
            command: "git --no-pager commit -a -m 'feat: something'",
          },
        };
        expect(
          (await permissionManager.checkPermission(context2)).behavior,
        ).toBe("allow");
      });

      it("should escape regex special characters in the pattern", async () => {
        permissionManager.updateAllowedRules(["Bash(node ./script.js +x)"]);
        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "node ./script.js +x" },
        };
        expect(
          (await permissionManager.checkPermission(context)).behavior,
        ).toBe("allow");
      });

      it("should treat question marks as literal characters", async () => {
        permissionManager.updateAllowedRules(["Bash(mkdir file?.txt)"]);
        const context1: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "mkdir fileA.txt" },
        };
        const context2: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "mkdir file?.txt" },
        };
        expect(
          (await permissionManager.checkPermission(context1)).behavior,
        ).toBe("deny");
        expect(
          (await permissionManager.checkPermission(context2)).behavior,
        ).toBe("allow");
      });

      it("should match exactly from start to end", async () => {
        permissionManager.updateAllowedRules(["Bash(ls *)"]);
        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: { command: "sudo ls /" },
        };
        expect(
          (await permissionManager.checkPermission(context)).behavior,
        ).toBe("deny");
      });

      it("should match multi-line commands with *", async () => {
        permissionManager.updateAllowedRules(["Bash(git commit*)"]);
        const context: ToolPermissionContext = {
          toolName: "Bash",
          permissionMode: "default",
          toolInput: {
            command: 'git commit -m "line1\nline2"',
          },
        };
        expect(
          (await permissionManager.checkPermission(context)).behavior,
        ).toBe("allow");
      });
    });

    it("should return true for restricted tools", () => {
      for (const toolName of RESTRICTED_TOOLS) {
        const result = permissionManager.isRestrictedTool(toolName);
        expect(result).toBe(true);
      }
    });

    it("should return false for unrestricted tools", () => {
      const unrestrictedTools = ["Read", "Grep", "Glob", "TaskCreate", "Skill"];

      for (const toolName of unrestrictedTools) {
        const result = permissionManager.isRestrictedTool(toolName);
        expect(result).toBe(false);
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
    });

    it("should create context with callback", () => {
      const mockCallback: PermissionCallback = vi.fn().mockResolvedValue({
        behavior: "allow",
      });

      const context = permissionManager.createContext(
        "Write",
        "bypassPermissions",
        mockCallback,
      );

      expect(context).toEqual({
        toolName: "Write",
        permissionMode: "bypassPermissions",
        canUseToolCallback: mockCallback,
      });
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

      it("should NOT set hidePersistentOption for out-of-bounds ls", () => {
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

        expect(context.hidePersistentOption).toBeFalsy();
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

      it("should NOT set hidePersistentOption for non-Bash tools inside Safe Zone", () => {
        const context = permissionManager.createContext(
          "Edit",
          "default",
          undefined,
          {
            file_path: "src/index.ts",
            workdir,
          },
        );

        expect(context.hidePersistentOption).toBeFalsy();
      });
    });
  });

  describe("Logger Integration", () => {
    it("should work without logger", async () => {
      const containerWithoutLogger = new Container();
      const managerWithoutLogger = new PermissionManager(
        containerWithoutLogger,
      );

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

      expect(logger.warn).toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
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

      expect(logger.error).toHaveBeenCalledWith(
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
        "Bash",
        "Write",
        "EnterPlanMode",
        "ExitPlanMode",
        "AskUserQuestion",
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

    it("should strip env vars and read redirections before checking rules", async () => {
      permissionManager.updateAllowedRules(["Bash(ls)", "Bash(echo hello)"]);

      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: {
          command: "VAR=val ls < in.txt && echo hello",
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

    it("should deny if a part with glob match doesn't match", async () => {
      permissionManager.updateAllowedRules(["Bash(ls)", "Bash(git commit *)"]);

      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "ls && git push" },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("deny");
    });

    it("should allow if all parts match glob rules", async () => {
      permissionManager.updateAllowedRules(["Bash(ls *)", "Bash(git *)"]);

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

    it("should allow 'ls /etc' even if it is outside workdir because of default allowed rule", async () => {
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
      expect(result.behavior).toBe("allow");
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

    it("should allow 'grep pattern file' by default", async () => {
      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "grep pattern file" },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("allow");
    });

    it("should allow 'rg pattern' by default", async () => {
      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "rg pattern" },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("allow");
    });

    it("should allow 'cat file' by default", async () => {
      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "cat file" },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("allow");
    });

    it("should allow 'head file' by default", async () => {
      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "head file" },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("allow");
    });

    it("should allow 'tail file' by default", async () => {
      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "tail file" },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("allow");
    });

    it("should allow 'wc file' by default", async () => {
      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "wc file" },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("allow");
    });

    it("should allow 'sleep 1' by default", async () => {
      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "sleep 1" },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("allow");
    });

    it("should allow 'sleep 5s' by default", async () => {
      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "sleep 5s" },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("allow");
    });

    it("should allow 'sleep 1 && ls' by default", async () => {
      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "sleep 1 && ls" },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("allow");
    });

    it("should deny 'grep pattern file > output' by default", async () => {
      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "grep pattern file > output" },
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
      const command = "npm install | sed 's/a/b/'";
      const rules = permissionManager.expandBashRule(command, workdir);
      expect(rules).toEqual(["Bash(npm install*)", "Bash(sed 's/a/b/')"]);
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

    it("should strip env vars and preserve redirections in rules", () => {
      const command = "VAR=val npm install > out.txt";
      const rules = permissionManager.expandBashRule(command, workdir);
      expect(rules).toEqual(["Bash(npm install > out.txt)"]);
    });

    it("should identify unsafe paths in cd as non-safe and filter them out", () => {
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

    it("should not return broad glob rules for unknown subcommands", () => {
      const command = "npm list";
      const rules = permissionManager.expandBashRule(command, workdir);
      expect(rules).toContain("Bash(npm list*)");
      expect(rules).not.toContain("Bash(npm*)");
    });

    it("should still return glob rules for known safe subcommands", () => {
      const command = "npm install lodash";
      const rules = permissionManager.expandBashRule(command, workdir);
      expect(rules).toEqual(["Bash(npm install*)"]);
    });
  });

  describe("Bash Write Redirections", () => {
    const workdir = "/home/user/project";

    it("should NOT allow echo with write redirection by default (even if echo* is allowed)", async () => {
      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "echo hi > file.txt", workdir },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("deny");
    });

    it("should set hidePersistentOption for commands with write redirections", () => {
      const context = permissionManager.createContext(
        "Bash",
        "default",
        undefined,
        { command: "echo hi > file.txt", workdir },
      );

      expect(context.hidePersistentOption).toBe(true);
    });

    it("should NOT treat ls with write redirection as a safe command", async () => {
      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "ls > file.txt", workdir },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("deny");
    });

    it("should allow write redirection if explicitly allowed by a rule with redirection", async () => {
      permissionManager.updateAllowedRules(["Bash(echo * > *)"]);

      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "echo hi > file.txt", workdir },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("allow");
    });

    it("should NOT allow write redirection if rule does NOT have redirection", async () => {
      permissionManager.updateAllowedRules(["Bash(echo *)"]);

      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "echo hi > file.txt", workdir },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("deny");
    });

    it("should preserve redirection in expandBashRule", () => {
      const command = "echo hi > file.txt";
      const rules = permissionManager.expandBashRule(command, workdir);
      expect(rules).toEqual(["Bash(echo hi > file.txt)"]);
    });
  });

  describe("Default Allowed Rules", () => {
    it("should allow 'wc -l *' by default", async () => {
      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "wc -l *" },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("allow");
    });

    it("should allow 'wc -l file.txt' by default", async () => {
      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "wc -l file.txt" },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("allow");
    });
  });

  describe("sort command", () => {
    it("should allow 'sort' by default", async () => {
      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "sort" },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("allow");
    });

    it("should allow 'sort -n file.txt' by default", async () => {
      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "sort -n file.txt" },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("allow");
    });

    it("should allow 'sort file.txt | head' by default", async () => {
      const context: ToolPermissionContext = {
        toolName: "Bash",
        permissionMode: "default",
        toolInput: { command: "sort file.txt | head" },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("allow");
    });

    it("should expand 'sort' to empty rules (safe command)", () => {
      const workdir = "/home/user/project";
      const rules = permissionManager.expandBashRule("sort file.txt", workdir);
      expect(rules).toEqual([]);
    });
  });
});
