import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PermissionManager } from "../../src/managers/permissionManager.js";
import type { ToolPermissionContext } from "../../src/types/permissions.js";
import type { Logger } from "../../src/types/index.js";

describe("PermissionManager Safe Zone", () => {
  let permissionManager: PermissionManager;
  let mockLogger: Logger;
  const workdir = "/home/user/project";
  const additionalDir = "/home/user/other";

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    permissionManager = new PermissionManager({
      logger: mockLogger,
      additionalDirectories: [additionalDir],
      workdir,
    });

    // Mock fs.realpathSync for path safety checks
    vi.spyOn(fs, "realpathSync").mockImplementation((p) => {
      const pathStr = p.toString();
      if (pathStr.startsWith(workdir)) return pathStr;
      if (pathStr.startsWith(additionalDir)) return pathStr;
      if (pathStr.startsWith("/tmp")) return pathStr;
      return pathStr;
    });
  });

  describe("checkPermission with Safe Zone", () => {
    const fileTools = ["Write", "Edit", "MultiEdit", "Delete"];

    for (const toolName of fileTools) {
      describe(`${toolName} tool`, () => {
        it("should allow operation inside workdir when acceptEdits is ON", async () => {
          const filePath = path.join(workdir, "test.txt");
          const context: ToolPermissionContext = {
            toolName,
            permissionMode: "acceptEdits",
            toolInput:
              toolName === "Delete"
                ? { target_file: filePath }
                : { file_path: filePath },
          };

          const result = await permissionManager.checkPermission(context);
          expect(result.behavior).toBe("allow");
        });

        it("should allow operation inside additionalDirectories when acceptEdits is ON", async () => {
          const filePath = path.join(additionalDir, "test.txt");
          const context: ToolPermissionContext = {
            toolName,
            permissionMode: "acceptEdits",
            toolInput:
              toolName === "Delete"
                ? { target_file: filePath }
                : { file_path: filePath },
          };

          const result = await permissionManager.checkPermission(context);
          expect(result.behavior).toBe("allow");
        });

        it("should NOT auto-allow operation outside Safe Zone even if acceptEdits is ON", async () => {
          const filePath = "/tmp/test.txt";
          const context: ToolPermissionContext = {
            toolName,
            permissionMode: "acceptEdits",
            toolInput:
              toolName === "Delete"
                ? { target_file: filePath }
                : { file_path: filePath },
          };

          const result = await permissionManager.checkPermission(context);
          // It should fall through to default behavior which is deny without callback
          expect(result.behavior).toBe("deny");
          expect(result.message).toContain("requires permission approval");
        });

        it("should deny operation inside Safe Zone if acceptEdits is OFF", async () => {
          const filePath = path.join(workdir, "test.txt");
          const context: ToolPermissionContext = {
            toolName,
            permissionMode: "default",
            toolInput:
              toolName === "Delete"
                ? { target_file: filePath }
                : { file_path: filePath },
          };

          const result = await permissionManager.checkPermission(context);
          expect(result.behavior).toBe("deny");
        });
      });
    }

    it("should handle relative paths correctly", async () => {
      const context: ToolPermissionContext = {
        toolName: "Write",
        permissionMode: "acceptEdits",
        toolInput: { file_path: "src/index.ts", workdir },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("allow");
    });

    it("should handle symlinks correctly", async () => {
      const symlinkPath = path.join(workdir, "link.txt");
      const realPath = "/tmp/real.txt";

      vi.spyOn(fs, "realpathSync").mockImplementation((p) => {
        if (p.toString() === symlinkPath) return realPath;
        return p.toString();
      });

      const context: ToolPermissionContext = {
        toolName: "Write",
        permissionMode: "acceptEdits",
        toolInput: { file_path: symlinkPath },
      };

      const result = await permissionManager.checkPermission(context);
      expect(result.behavior).toBe("deny");
      expect(result.message).toContain("requires permission approval");
    });
  });

  describe("Bash out-of-bounds with Safe Zone", () => {
    it("should allow 'ls' in additionalDirectory", () => {
      const context = permissionManager.createContext(
        "Bash",
        "default",
        undefined,
        {
          command: `ls ${additionalDir}`,
          workdir,
        },
      );

      expect(context.hidePersistentOption).toBeFalsy();
    });

    it("should set hidePersistentOption for 'ls' outside Safe Zone", () => {
      const context = permissionManager.createContext(
        "Bash",
        "default",
        undefined,
        {
          command: "ls /tmp",
          workdir,
        },
      );

      expect(context.hidePersistentOption).toBe(true);
    });

    it("should allow 'cd' into additionalDirectory", () => {
      const context = permissionManager.createContext(
        "Bash",
        "default",
        undefined,
        {
          command: `cd ${additionalDir}`,
          workdir,
        },
      );

      expect(context.hidePersistentOption).toBeFalsy();
    });

    it("should set hidePersistentOption for 'cd' outside Safe Zone", () => {
      const context = permissionManager.createContext(
        "Bash",
        "default",
        undefined,
        {
          command: "cd /tmp",
          workdir,
        },
      );

      expect(context.hidePersistentOption).toBe(true);
    });
    it("should set hidePersistentOption for file operations outside Safe Zone", () => {
      const context = permissionManager.createContext(
        "Write",
        "acceptEdits",
        undefined,
        {
          file_path: "/tmp/test.txt",
          workdir,
        },
      );

      expect(context.hidePersistentOption).toBe(true);
    });

    it("should NOT set hidePersistentOption for file operations inside Safe Zone", () => {
      const context = permissionManager.createContext(
        "Write",
        "acceptEdits",
        undefined,
        {
          file_path: path.join(workdir, "test.txt"),
          workdir,
        },
      );

      expect(context.hidePersistentOption).toBeFalsy();
    });
  });
});
