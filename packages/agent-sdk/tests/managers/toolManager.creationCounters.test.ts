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

const { recordLinesChanged, recordToolActivity, recordActiveTime } = vi.hoisted(
  () => ({
    recordLinesChanged: vi.fn(),
    recordToolActivity: vi.fn(),
    recordActiveTime: vi.fn(),
  }),
);

vi.mock("@/telemetry/metrics.js", () => ({
  recordLinesChanged,
  recordToolActivity,
  recordActiveTime,
}));

const baseContext = {
  sessionId: "session-1",
  workdir: "/repo/worktree",
  taskManager: {} as unknown as TaskManager,
} as ToolContext;

/** The standard-attribute context every record carries for this base context. */
const baseRecordContext = { sessionId: "session-1", workdir: "/repo/worktree" };

/** A manager with one tool that returns whatever result the test hands it. */
function buildManager(name: string, result: ToolResult): ToolManager {
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
    name,
    config: {
      type: "function",
      function: {
        name,
        description: "Runs something",
        parameters: { type: "object", properties: {} },
      },
    },
    execute: async () => result,
  };
  manager.register(tool);
  return manager;
}

const ok: ToolResult = { success: true, content: "done" };

describe("ToolManager creation counters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records the commit a successful Bash call created", async () => {
    const manager = buildManager("Bash", ok);

    await manager.execute(
      "Bash",
      { command: 'git add -A && git commit -m "feat: x"' },
      baseContext,
    );

    expect(recordToolActivity).toHaveBeenCalledWith(
      { commits: true, pullRequests: false },
      baseRecordContext,
    );
  });

  it("records the pull request a successful Bash call created", async () => {
    const manager = buildManager("Bash", ok);

    await manager.execute("Bash", { command: "glab mr create" }, baseContext);

    expect(recordToolActivity).toHaveBeenCalledWith(
      { commits: false, pullRequests: true },
      baseRecordContext,
    );
  });

  it("records nothing for a successful call that created neither", async () => {
    const manager = buildManager("Bash", ok);

    await manager.execute("Bash", { command: "npm test" }, baseContext);

    expect(recordToolActivity).toHaveBeenCalledWith(
      { commits: false, pullRequests: false },
      baseRecordContext,
    );
    expect(recordLinesChanged).not.toHaveBeenCalled();
  });

  it("stays silent when the commit command failed", async () => {
    const manager = buildManager("Bash", {
      success: false,
      content: "",
      error: "nothing to commit",
    });

    await manager.execute("Bash", { command: "git commit -m x" }, baseContext);

    expect(recordToolActivity).not.toHaveBeenCalled();
  });

  it("stays silent for a non-Bash tool that happens to take a command", async () => {
    const manager = buildManager("Edit", ok);

    await manager.execute("Edit", { command: "git commit -m x" }, baseContext);

    expect(recordToolActivity).not.toHaveBeenCalled();
  });
});
