import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolManager } from "@/managers/toolManager.js";
import { McpManager } from "@/managers/mcpManager.js";
import { Container } from "@/utils/container.js";
import type { ToolContext, ToolPlugin, ToolResult } from "@/tools/types.js";

const { mockReportToolCrash, mockReportToolFailure } = vi.hoisted(() => ({
  mockReportToolCrash: vi.fn(),
  mockReportToolFailure: vi.fn(),
}));

vi.mock("@/telemetry/failureEvents.js", () => ({
  reportToolCrash: mockReportToolCrash,
  reportToolFailure: mockReportToolFailure,
}));

vi.mock("@/services/artifactAvailability.js", () => ({
  isArtifactEnabled: vi.fn().mockReturnValue(false),
}));

const SESSION_ID = "session-1";

function createContainer(): Container {
  const container = new Container();
  container.register("SessionWorkdir", "/work");
  container.register("MessageManager", {
    getSessionId: () => SESSION_ID,
  });
  container.register("PermissionManager", {
    isToolDenied: vi.fn().mockReturnValue(false),
    getCurrentEffectiveMode: vi.fn().mockReturnValue("default"),
  });
  container.register("TaskManager", {});
  container.register("ReversionManager", {});
  container.register("BackgroundTaskManager", {});
  container.register("LspManager", {});
  container.register("McpManager", {
    isMcpTool: vi.fn().mockReturnValue(false),
    executeMcpToolByRegistry: vi.fn(),
    getAllConnectedTools: vi.fn().mockReturnValue([]),
    getMcpToolsConfig: vi.fn().mockReturnValue([]),
    getMcpToolOutputSchemas: vi.fn().mockReturnValue(new Map()),
    getMcpToolPlugins: vi.fn().mockReturnValue([]),
  } as unknown as McpManager);
  return container;
}

function createTool(name: string, execute: ToolPlugin["execute"]): ToolPlugin {
  return {
    name,
    config: {
      type: "function",
      function: { name, description: name, parameters: {} },
    },
    execute,
  };
}

const CONTEXT = {
  workdir: "/work",
  originalWorkdir: "/work",
  sessionId: SESSION_ID,
  taskManager: {},
} as unknown as ToolContext;

function createManager(...tools: ToolPlugin[]): ToolManager {
  const manager = new ToolManager({ container: createContainer() });
  for (const tool of tools) manager.register(tool);
  return manager;
}

beforeEach(() => {
  mockReportToolCrash.mockReset();
  mockReportToolFailure.mockReset();
  mockReportToolCrash.mockResolvedValue(undefined);
  mockReportToolFailure.mockResolvedValue(undefined);
});

describe("tool failure telemetry", () => {
  it("files a tool that threw as a crash, not as a reported failure", async () => {
    const manager = createManager(
      createTool("Explode", async () => {
        throw new Error("plugin blew up");
      }),
    );

    const result = await manager.execute("Explode", {}, CONTEXT);

    expect(result.success).toBe(false);
    expect(mockReportToolCrash).toHaveBeenCalledTimes(1);
    expect(mockReportToolCrash.mock.calls[0][0]).toMatchObject({
      toolName: "Explode",
      sessionId: SESSION_ID,
      isMcp: false,
    });
    // The same failure must not also become a WARN tool_error.
    expect(mockReportToolFailure).not.toHaveBeenCalled();
  });

  it("files a missing tool as a crash", async () => {
    const manager = createManager();

    const result = await manager.execute("NoSuchTool", {}, CONTEXT);

    expect(result.success).toBe(false);
    expect(mockReportToolCrash).toHaveBeenCalledTimes(1);
    expect(mockReportToolCrash.mock.calls[0][0]).toMatchObject({
      toolName: "NoSuchTool",
    });
    expect(mockReportToolCrash.mock.calls[0][0].error).toBeInstanceOf(Error);
    expect(mockReportToolFailure).not.toHaveBeenCalled();
  });

  it("files a tool that reported failure as WARN tool_error", async () => {
    const manager = createManager(
      createTool("Grep", async () => ({
        success: false,
        content: "",
        error: "exit code 1",
      })),
    );

    const result = await manager.execute("Grep", {}, CONTEXT);

    expect(result.success).toBe(false);
    expect(mockReportToolFailure).toHaveBeenCalledTimes(1);
    expect(mockReportToolFailure.mock.calls[0][0]).toMatchObject({
      toolName: "Grep",
      sessionId: SESSION_ID,
      message: "exit code 1",
    });
    expect(mockReportToolCrash).not.toHaveBeenCalled();
  });

  it("attributes the failure to the calling session", async () => {
    const manager = createManager(
      createTool("Nested", async () => ({
        success: false,
        content: "",
        error: "nope",
      })),
    );

    await manager.execute("Nested", {}, {
      ...CONTEXT,
      sessionId: "nested-session",
    } as ToolContext);

    expect(mockReportToolFailure.mock.calls[0][0]).toMatchObject({
      sessionId: "nested-session",
    });
  });

  it("stays quiet when the tool succeeds", async () => {
    const manager = createManager(
      createTool("Fine", async () => ({ success: true, content: "ok" })),
    );

    const result: ToolResult = await manager.execute("Fine", {}, CONTEXT);

    expect(result.success).toBe(true);
    expect(mockReportToolCrash).not.toHaveBeenCalled();
    expect(mockReportToolFailure).not.toHaveBeenCalled();
  });

  it("stays quiet when the failure cannot be attributed to a session", async () => {
    const container = createContainer();
    container.register("MessageManager", { getSessionId: () => undefined });
    const manager = new ToolManager({ container });
    manager.register(
      createTool("Grep", async () => ({
        success: false,
        content: "",
        error: "exit code 1",
      })),
    );

    await manager.execute("Grep", {}, { workdir: "/work" } as ToolContext);

    expect(mockReportToolFailure).not.toHaveBeenCalled();
  });
});
