import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolManager } from "@/managers/toolManager.js";
import { Container } from "@/utils/container.js";
import type { ToolContext, ToolPlugin, ToolResult } from "@/tools/types.js";
import type { McpManager } from "@/managers/mcpManager.js";
import type { PermissionManager } from "@/managers/permissionManager.js";
import type { TaskManager } from "@/services/taskManager.js";
import type { ReversionManager } from "@/managers/reversionManager.js";
import type { BackgroundTaskManager } from "@/managers/backgroundTaskManager.js";
import type { IForegroundTaskManager } from "@/types/processes.js";
import type { ILspManager } from "@/types/index.js";

const { recordLinesChanged } = vi.hoisted(() => ({
  recordLinesChanged: vi.fn(),
}));

vi.mock("@/telemetry/metrics.js", () => ({ recordLinesChanged }));

const baseContext = {
  sessionId: "session-1",
  workdir: "/repo/worktree",
  taskManager: {} as unknown as TaskManager,
} as ToolContext;

/** The standard-attribute context every record carries for this base context. */
const baseRecordContext = { sessionId: "session-1", workdir: "/repo/worktree" };

/** A manager with one tool that returns whatever result the test hands it. */
function buildManager(result: ToolResult): ToolManager {
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

  const manager = new ToolManager({ container });
  const tool: ToolPlugin = {
    name: "Edit",
    config: {
      type: "function",
      function: {
        name: "Edit",
        description: "Edits a file",
        parameters: { type: "object", properties: {} },
      },
    },
    execute: async () => result,
  };
  manager.register(tool);
  return manager;
}

describe("ToolManager line-delta metric", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records the line delta a successful edit reports", async () => {
    const manager = buildManager({
      success: true,
      content: "Edited",
      metadata: { linesAdded: 12, linesRemoved: 3 },
    });

    await manager.execute("Edit", {}, baseContext);

    expect(recordLinesChanged).toHaveBeenCalledWith(
      { added: 12, removed: 3 },
      baseRecordContext,
    );
  });

  it("stays silent for a tool that reports no line delta", async () => {
    const manager = buildManager({ success: true, content: "Read a file" });

    await manager.execute("Edit", {}, baseContext);

    expect(recordLinesChanged).not.toHaveBeenCalled();
  });

  it("stays silent when the tool failed, even with a delta attached", async () => {
    const manager = buildManager({
      success: false,
      content: "",
      error: "boom",
      metadata: { linesAdded: 5, linesRemoved: 5 },
    });

    await manager.execute("Edit", {}, baseContext);

    expect(recordLinesChanged).not.toHaveBeenCalled();
  });
});
