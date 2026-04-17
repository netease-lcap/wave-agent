import { describe, it, expect, vi, beforeEach } from "vitest";
import { PermissionManager } from "../../src/managers/permissionManager.js";
import { Container } from "../../src/utils/container.js";
import type { ToolPermissionContext } from "../../src/types/permissions.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function createContainer(workdir?: string): Container {
  const c = new Container();
  if (workdir) {
    c.register("Workdir", workdir);
  }
  return c;
}

describe("PermissionManager - Safe Zone anchored to original workdir", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe("isInsideSafeZone after workdir changes", () => {
    it("should keep files in original workdir inside safe zone after cd to subdirectory", async () => {
      const container = createContainer("/a");
      const manager = new PermissionManager(container);

      // Simulate cd to subdirectory
      container.register("Workdir", "/a/frontend");

      // File in original workdir should still be safe
      const context: ToolPermissionContext = {
        toolName: "Write",
        permissionMode: "acceptEdits",
        toolInput: { file_path: "/a/README.md" },
      };

      const result = await manager.checkPermission(context);
      expect(result.behavior).toBe("allow");
    });

    it("should keep sibling directories of original workdir inside safe zone after cd", async () => {
      const container = createContainer("/a");
      const manager = new PermissionManager(container);

      // Simulate cd to subdirectory
      container.register("Workdir", "/a/frontend");

      // File in sibling directory should still be safe
      const context: ToolPermissionContext = {
        toolName: "Write",
        permissionMode: "acceptEdits",
        toolInput: { file_path: "/a/backend/server.ts" },
      };

      const result = await manager.checkPermission(context);
      expect(result.behavior).toBe("allow");
    });

    it("should deny files outside original workdir even if inside current workdir", async () => {
      const container = createContainer("/a");
      const manager = new PermissionManager(container);

      // Simulate cd to subdirectory
      container.register("Workdir", "/a/frontend");

      // File outside original workdir should be denied (falls back to manual confirmation)
      const context: ToolPermissionContext = {
        toolName: "Write",
        permissionMode: "acceptEdits",
        toolInput: { file_path: "/b/outside.txt" },
      };

      const result = await manager.checkPermission(context);
      // Should not be auto-allowed since it's outside the safe zone
      expect(result.behavior).not.toBe("allow");
    });
  });

  describe("additionalDirectories resolved against original workdir", () => {
    it("should resolve relative additional directories against original workdir after workdir changes", () => {
      const container = createContainer("/a");
      const manager = new PermissionManager(container);

      manager.updateAdditionalDirectories(["./config", "./data"]);

      expect(manager.getAdditionalDirectories()).toContain("/a/config");
      expect(manager.getAdditionalDirectories()).toContain("/a/data");

      // Change workdir
      container.register("Workdir", "/a/frontend");

      // Update additional directories - should still resolve against /a
      manager.updateAdditionalDirectories(["./shared"]);
      expect(manager.getAdditionalDirectories()).toContain("/a/shared");
    });

    it("should consider files in additional directories as safe after workdir changes", async () => {
      const container = createContainer("/a");
      const manager = new PermissionManager(container);

      manager.updateAdditionalDirectories(["./shared"]);

      // Change workdir
      container.register("Workdir", "/a/frontend");

      // File in additional directory should still be safe
      const context: ToolPermissionContext = {
        toolName: "Write",
        permissionMode: "acceptEdits",
        toolInput: { file_path: "/a/shared/config.json" },
      };

      const result = await manager.checkPermission(context);
      expect(result.behavior).toBe("allow");
    });
  });

  describe("systemAdditionalDirectories resolved against original workdir", () => {
    it("should resolve relative system additional directories against original workdir after workdir changes", () => {
      const container = createContainer("/a");
      const manager = new PermissionManager(container);

      manager.addSystemAdditionalDirectory("./system-config");

      // Change workdir
      container.register("Workdir", "/a/frontend");

      manager.addSystemAdditionalDirectory("./system-data");

      const dirs = manager.getSystemAdditionalDirectories();
      expect(dirs).toContain("/a/system-config");
      expect(dirs).toContain("/a/system-data");
    });
  });
});
