import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { MessageManager } from "../../src/managers/messageManager.js";
import { PlanManager } from "../../src/managers/planManager.js";
import { PermissionManager } from "../../src/managers/permissionManager.js";
import { TaskManager } from "../../src/services/taskManager.js";
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: vi.fn().mockReturnValue("/home/user"),
    platform: vi.fn().mockReturnValue("linux"),
  };
});

describe("PlanManager Session Clearing", () => {
  let container: Container;
  let messageManager: MessageManager;
  let planManager: PlanManager;
  let permissionManager: PermissionManager;

  beforeEach(() => {
    vi.clearAllMocks();

    container = new Container();

    // Mock TaskManager
    const mockTaskManager = {
      syncWithSession: vi.fn().mockResolvedValue(undefined),
    };
    container.register(
      "TaskManager",
      mockTaskManager as unknown as TaskManager,
    );

    permissionManager = new PermissionManager(container, {
      workdir: "/test/workdir",
    });
    container.register("PermissionManager", permissionManager);

    planManager = new PlanManager(container);
    container.register("PlanManager", planManager);

    permissionManager.setOnConfiguredDefaultModeChange((mode) => {
      planManager.handlePlanModeTransition(mode);
    });

    messageManager = new MessageManager(container, {
      workdir: "/test/workdir",
      callbacks: {
        onSessionIdChange: () => {
          const tm = container.get<TaskManager>("TaskManager");
          if (tm) {
            tm.syncWithSession();
          }
          const pm = container.get<PlanManager>("PlanManager");
          if (pm) {
            pm.syncWithSession();
          }
        },
      },
    });
    container.register("MessageManager", messageManager);
  });

  it("should update planFilePath when clearMessages is called in plan mode", async () => {
    // Set to plan mode
    permissionManager.updateConfiguredDefaultMode("plan");
    expect(permissionManager.getCurrentEffectiveMode()).toBe("plan");

    // Initial plan file path should be set (handlePlanModeTransition is called by PermissionManager)
    // Wait for the promise in handlePlanModeTransition to resolve
    await vi.waitFor(() =>
      expect(permissionManager.getPlanFilePath()).toBeDefined(),
    );
    const initialPlanPath = permissionManager.getPlanFilePath();
    const initialSessionId = messageManager.getRootSessionId();

    // Clear messages
    messageManager.clearMessages();

    const newSessionId = messageManager.getRootSessionId();
    expect(newSessionId).not.toBe(initialSessionId);

    // Plan file path should be updated
    await vi.waitFor(() => {
      const newPlanPath = permissionManager.getPlanFilePath();
      expect(newPlanPath).toBeDefined();
      expect(newPlanPath).not.toBe(initialPlanPath);
    });
  });

  it("should NOT set planFilePath when clearMessages is called in default mode", async () => {
    // Set to default mode
    permissionManager.updateConfiguredDefaultMode("default");
    expect(permissionManager.getCurrentEffectiveMode()).toBe("default");
    expect(permissionManager.getPlanFilePath()).toBeUndefined();

    // Clear messages
    messageManager.clearMessages();

    // Plan file path should still be undefined
    expect(permissionManager.getPlanFilePath()).toBeUndefined();
  });
});
