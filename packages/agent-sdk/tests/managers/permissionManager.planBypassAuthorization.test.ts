import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import {
  PermissionManager,
  type PermissionManagerOptions,
} from "../../src/managers/permissionManager.js";
import type { PermissionMode } from "../../src/types/permissions.js";
import { Container } from "../../src/utils/container.js";

const workdir = "/home/user/project";
const planFilePath = "/home/user/.wave/plans/gentle-breeze.md";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function createManager(
  options: PermissionManagerOptions = {},
  sessionMode?: PermissionMode,
): PermissionManager {
  const container = new Container();
  container.register("Workdir", workdir);
  if (sessionMode) {
    container.register("PermissionMode", sessionMode);
  }
  return new PermissionManager(container, { planFilePath, ...options });
}

describe("PermissionManager plan-mode bypass authorization", () => {
  describe("capturing the authorization at session start", () => {
    it("authorizes a session that starts in bypassPermissions", () => {
      const manager = createManager({}, "bypassPermissions");
      manager.captureBypassAuthorization();
      expect(manager.getBypassAuthorization()).toBe(true);
    });

    it("authorizes a session whose configured default mode is bypassPermissions", () => {
      const manager = createManager({
        configuredPermissionMode: "bypassPermissions",
      });
      manager.captureBypassAuthorization();
      expect(manager.getBypassAuthorization()).toBe(true);
    });

    it.each(["default", "acceptEdits", "plan", "dontAsk"] as const)(
      "does not authorize a session that starts in %s",
      (mode) => {
        const manager = createManager({}, mode);
        manager.captureBypassAuthorization();
        expect(manager.getBypassAuthorization()).toBe(false);
      },
    );

    it("does not authorize when no mode is configured", () => {
      const manager = createManager();
      manager.captureBypassAuthorization();
      expect(manager.getBypassAuthorization()).toBe(false);
    });

    it("does not grant the authorization when the session switches to bypassPermissions later", () => {
      const container = new Container();
      container.register("Workdir", workdir);
      container.register("PermissionMode", "plan");
      const manager = new PermissionManager(container, { planFilePath });
      manager.captureBypassAuthorization();

      container.register("PermissionMode", "bypassPermissions");
      manager.captureBypassAuthorization();

      expect(manager.getBypassAuthorization()).toBe(false);
    });

    it("prefers the session mode over the configured default mode", () => {
      const manager = createManager(
        { configuredPermissionMode: "bypassPermissions" },
        "plan",
      );
      manager.captureBypassAuthorization();
      expect(manager.getBypassAuthorization()).toBe(false);
    });

    it("keeps an explicitly provided value instead of re-deriving it", () => {
      const manager = createManager({ bypassAuthorization: true }, "plan");
      manager.captureBypassAuthorization();
      expect(manager.getBypassAuthorization()).toBe(true);
    });
  });

  describe("plan mode permission checks", () => {
    const outOfZoneRead = "cat /home/user/other/notes.md";

    it("allows a Bash command matching no rule when authorized", async () => {
      const manager = createManager({}, "bypassPermissions");
      manager.captureBypassAuthorization();
      const context = manager.createContext("Bash", "plan", undefined, {
        command: outOfZoneRead,
      });

      const decision = await manager.checkPermission(context);
      expect(decision.behavior).toBe("allow");
    });

    it("still requires approval for the same command when not authorized", async () => {
      const manager = createManager({}, "default");
      manager.captureBypassAuthorization();
      const context = manager.createContext("Bash", "plan", undefined, {
        command: outOfZoneRead,
      });

      const decision = await manager.checkPermission(context);
      expect(decision.behavior).toBe("deny");
      expect(decision.message).toContain("requires permission approval");
    });

    it("allows editing a file outside the plan file when authorized", async () => {
      const manager = createManager({}, "bypassPermissions");
      manager.captureBypassAuthorization();
      const context = manager.createContext("Edit", "plan", undefined, {
        file_path: path.join(workdir, "src/index.ts"),
      });

      const decision = await manager.checkPermission(context);
      expect(decision.behavior).toBe("allow");
    });

    it("still denies when a deny rule matches", async () => {
      const manager = createManager(
        { instanceDeniedRules: ["Bash"] },
        "bypassPermissions",
      );
      manager.captureBypassAuthorization();
      const context = manager.createContext("Bash", "plan", undefined, {
        command: outOfZoneRead,
      });

      const decision = await manager.checkPermission(context);
      expect(decision.behavior).toBe("deny");
      expect(decision.message).toContain("explicitly denied");
    });

    it("still prompts for AskUserQuestion", async () => {
      const manager = createManager({}, "bypassPermissions");
      manager.captureBypassAuthorization();
      const callback = vi
        .fn()
        .mockResolvedValue({ behavior: "allow" as const });
      const context = manager.createContext(
        "AskUserQuestion",
        "plan",
        callback,
        {
          questions: [],
        },
      );

      const decision = await manager.checkPermission(context);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(decision.behavior).toBe("allow");
    });

    it("still prompts for ExitPlanMode", async () => {
      const manager = createManager({}, "bypassPermissions");
      manager.captureBypassAuthorization();
      const callback = vi
        .fn()
        .mockResolvedValue({ behavior: "allow" as const });
      const context = manager.createContext(
        "ExitPlanMode",
        "plan",
        callback,
        {},
        undefined,
        "My plan",
      );

      const decision = await manager.checkPermission(context);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(decision.behavior).toBe("allow");
    });

    it("still denies restricted tools in dontAsk mode", async () => {
      const manager = createManager({}, "bypassPermissions");
      manager.captureBypassAuthorization();
      const context = manager.createContext("Bash", "dontAsk", undefined, {
        command: outOfZoneRead,
      });

      const decision = await manager.checkPermission(context);
      expect(decision.behavior).toBe("deny");
      expect(decision.message).toContain("dontAsk");
    });

    it("does not bypass checks outside plan mode", async () => {
      const manager = createManager({}, "bypassPermissions");
      manager.captureBypassAuthorization();
      const context = manager.createContext("Bash", "default", undefined, {
        command: outOfZoneRead,
      });

      const decision = await manager.checkPermission(context);
      expect(decision.behavior).toBe("deny");
      expect(decision.message).toContain("requires permission approval");
    });

    it("still denies editing the main repository from a worktree session", async () => {
      const container = new Container();
      container.register("Workdir", "/home/user/project/worktrees/feat-1");
      container.register("WorktreeName", "feat-1");
      container.register("MainRepoRoot", workdir);
      container.register("WorktreeSession", null);
      container.register("PermissionMode", "bypassPermissions");
      const manager = new PermissionManager(container, { planFilePath });
      manager.captureBypassAuthorization();

      const context = manager.createContext("Write", "plan", undefined, {
        file_path: path.join(workdir, "main-file.txt"),
      });

      const decision = await manager.checkPermission(context);
      expect(decision.behavior).toBe("deny");
      expect(decision.message).toContain("worktree session");
    });
  });
});
