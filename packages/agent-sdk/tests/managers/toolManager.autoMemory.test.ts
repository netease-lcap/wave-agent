import { describe, it, expect } from "vitest";
import { ToolManager } from "@/managers/toolManager.js";
import { Container } from "@/utils/container.js";
import type { ToolContext, ToolPlugin } from "@/tools/types.js";
import type { McpManager } from "@/managers/mcpManager.js";
import type { PermissionManager } from "@/managers/permissionManager.js";
import type { TaskManager } from "@/services/taskManager.js";
import type { ReversionManager } from "@/managers/reversionManager.js";
import type { BackgroundTaskManager } from "@/managers/backgroundTaskManager.js";
import type { IForegroundTaskManager } from "@/types/processes.js";
import type { ILspManager } from "@/types/index.js";
import type { ConfigurationService } from "@/services/configurationService.js";
import type { MemoryService } from "@/services/memory.js";

/**
 * The Read tool reads `context.autoMemoryDir` to decide whether to prepend a
 * staleness note to the file it returns. The value is resolved by ToolManager,
 * and "unset" is what turns the note off — so both the resolved path and the
 * disabled case are pinned here.
 */
function buildManager(options: { autoMemoryEnabled: boolean }): {
  manager: ToolManager;
  seen: ToolContext[];
} {
  const container = new Container();
  container.register("McpManager", {
    isMcpTool: () => false,
  } as unknown as McpManager);
  container.register("PermissionManager", {
    isToolDenied: () => false,
    getCurrentEffectiveMode: () => "default",
  } as unknown as PermissionManager);
  container.register("TaskManager", {} as unknown as TaskManager);
  container.register("ReversionManager", {} as unknown as ReversionManager);
  container.register(
    "BackgroundTaskManager",
    {} as unknown as BackgroundTaskManager,
  );
  container.register(
    "ForegroundTaskManager",
    {} as unknown as IForegroundTaskManager,
  );
  container.register("LspManager", {} as unknown as ILspManager);
  container.register("ConfigurationService", {
    resolveAutoMemoryEnabled: () => options.autoMemoryEnabled,
    getMergedEnv: () => ({}),
  } as unknown as ConfigurationService);
  container.register("MemoryService", {
    getAutoMemoryDirectory: (workdir: string) => `${workdir}/memory`,
  } as unknown as MemoryService);

  const manager = new ToolManager({ container });
  const seen: ToolContext[] = [];
  const probe: ToolPlugin = {
    name: "Probe",
    config: {
      type: "function",
      function: {
        name: "Probe",
        description: "Captures the context it is executed with",
        parameters: { type: "object", properties: {} },
      },
    },
    execute: async (_args, context) => {
      seen.push(context);
      return { success: true, content: "" };
    },
  };
  manager.register(probe);

  return { manager, seen };
}

const baseContext = {
  workdir: "/repo/worktree",
  taskManager: {} as unknown as TaskManager,
};

describe("ToolManager auto-memory context", () => {
  it("resolves the auto-memory directory for the session workdir", async () => {
    const { manager, seen } = buildManager({ autoMemoryEnabled: true });

    await manager.execute("Probe", {}, baseContext);

    expect(seen[0].autoMemoryDir).toBe("/repo/worktree/memory");
  });

  it("leaves it unset when auto-memory is off", async () => {
    const { manager, seen } = buildManager({ autoMemoryEnabled: false });

    await manager.execute("Probe", {}, baseContext);

    expect(seen[0].autoMemoryDir).toBeUndefined();
  });
});
