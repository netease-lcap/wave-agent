import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
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

describe("PermissionManager - instance additional directories", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe("constructor injection", () => {
    it("should resolve relative instance additional directories against the workdir", () => {
      const container = createContainer("/a");
      const manager = new PermissionManager(container, {
        instanceAdditionalDirectories: ["./config", "./data"],
      });

      // Source resolves via path.resolve(workdir, dir); mirror in assertion.
      expect(manager.getInstanceAdditionalDirectories()).toContain(
        path.resolve("/a", "config"),
      );
      expect(manager.getInstanceAdditionalDirectories()).toContain(
        path.resolve("/a", "data"),
      );
    });

    it("should keep absolute instance additional directories unchanged", () => {
      const container = createContainer("/a");
      const manager = new PermissionManager(container, {
        instanceAdditionalDirectories: ["/b/absolute"],
      });

      expect(manager.getInstanceAdditionalDirectories()).toContain(
        path.resolve("/b/absolute"),
      );
    });
  });

  describe("getEffectiveAdditionalDirectories", () => {
    it("should return the union of config and instance directories, deduplicated", () => {
      const container = createContainer("/a");
      const manager = new PermissionManager(container, {
        additionalDirectories: ["./shared", "./config"],
        instanceAdditionalDirectories: ["./config", "./session"],
      });

      const effective = manager.getEffectiveAdditionalDirectories();
      expect(effective).toEqual([
        path.resolve("/a", "shared"),
        path.resolve("/a", "config"),
        path.resolve("/a", "session"),
      ]);
    });

    it("should not mutate either source array", () => {
      const container = createContainer("/a");
      const manager = new PermissionManager(container, {
        additionalDirectories: ["./config"],
        instanceAdditionalDirectories: ["./session"],
      });

      manager.getEffectiveAdditionalDirectories();
      expect(manager.getAdditionalDirectories()).toEqual([
        path.resolve("/a", "config"),
      ]);
      expect(manager.getInstanceAdditionalDirectories()).toEqual([
        path.resolve("/a", "session"),
      ]);
    });
  });

  describe("addInstanceAdditionalDirectory", () => {
    it("should resolve relative paths against the workdir at call time", () => {
      const container = createContainer("/a");
      const manager = new PermissionManager(container);

      manager.addInstanceAdditionalDirectory("./later-added");
      expect(manager.getInstanceAdditionalDirectories()).toContain(
        path.resolve("/a", "later-added"),
      );
    });

    it("should deduplicate repeated additions", () => {
      const container = createContainer("/a");
      const manager = new PermissionManager(container);

      manager.addInstanceAdditionalDirectory("./shared");
      manager.addInstanceAdditionalDirectory(path.resolve("/a", "shared"));

      expect(manager.getInstanceAdditionalDirectories()).toEqual([
        path.resolve("/a", "shared"),
      ]);
    });
  });

  describe("instance directories in Safe Zone checks", () => {
    it("should allow files inside an instance additional directory", async () => {
      const container = createContainer("/a");
      const manager = new PermissionManager(container, {
        instanceAdditionalDirectories: ["./shared"],
      });

      const context: ToolPermissionContext = {
        toolName: "Write",
        permissionMode: "acceptEdits",
        toolInput: { file_path: "/a/shared/config.json" },
      };

      const result = await manager.checkPermission(context);
      expect(result.behavior).toBe("allow");
    });

    it("should keep instance additional directories safe after workdir changes", async () => {
      const container = createContainer("/a");
      const manager = new PermissionManager(container, {
        instanceAdditionalDirectories: ["./shared"],
      });

      // Simulate cd to subdirectory
      container.register("Workdir", "/a/frontend");

      const context: ToolPermissionContext = {
        toolName: "Write",
        permissionMode: "acceptEdits",
        toolInput: { file_path: "/a/shared/config.json" },
      };

      const result = await manager.checkPermission(context);
      expect(result.behavior).toBe("allow");
    });

    it("should deny files outside all additional directories", async () => {
      const container = createContainer("/a");
      const manager = new PermissionManager(container, {
        instanceAdditionalDirectories: ["./shared"],
      });

      const context: ToolPermissionContext = {
        toolName: "Write",
        permissionMode: "acceptEdits",
        toolInput: { file_path: "/b/outside.txt" },
      };

      const result = await manager.checkPermission(context);
      expect(result.behavior).not.toBe("allow");
    });
  });
});
