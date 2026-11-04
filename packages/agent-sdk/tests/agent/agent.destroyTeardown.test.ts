import { describe, it, expect, vi, afterEach } from "vitest";
import { Agent } from "@/agent.js";
import { createMockToolManager } from "../helpers/mockFactories.js";
import { remoteSettingsService } from "@/services/remoteSettingsService.js";
import { authService } from "@/services/authService.js";
import type { Container } from "@/utils/container.js";

// Mock AI Service
vi.mock("@/services/aiService");

// Mock telemetry modules so Agent.create/destroy don't touch real OTEL
vi.mock("@/telemetry/instrumentation.js", () => ({
  initializeTelemetry: vi.fn().mockResolvedValue(undefined),
  flushTelemetry: vi.fn().mockResolvedValue(undefined),
  getCurrentConfig: vi.fn().mockReturnValue(undefined),
  isInitialized: vi.fn().mockReturnValue(false),
}));

vi.mock("@/telemetry/events.js", () => ({
  logOTelEvent: vi.fn().mockResolvedValue(undefined),
  logRequestContentEvents: vi.fn().mockResolvedValue(undefined),
  resetContentEventState: vi.fn(),
}));

// Mock tool registry
const { instance: mockToolManagerInstance } = createMockToolManager();

vi.mock("@/managers/toolManager", () => ({
  ToolManager: vi.fn().mockImplementation(function () {
    return mockToolManagerInstance;
  }),
}));

describe("Agent destroy teardown", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("destroy() unsubscribes module-level listeners registered during setup", async () => {
    const unsubSettings = vi.fn();
    const unsubAuth = vi.fn();
    vi.spyOn(remoteSettingsService, "onSettingsUpdate").mockReturnValue(
      unsubSettings,
    );
    vi.spyOn(authService, "onAuthChange").mockReturnValue(unsubAuth);

    const agent = await Agent.create({
      apiKey: "test-key",
      workdir: "/tmp/test-destroy-teardown",
    });

    // Setup registered one listener per module-level structure
    expect(remoteSettingsService.onSettingsUpdate).toHaveBeenCalledTimes(1);
    expect(authService.onAuthChange).toHaveBeenCalledTimes(1);
    expect(unsubSettings).not.toHaveBeenCalled();
    expect(unsubAuth).not.toHaveBeenCalled();

    await agent.destroy();

    // destroy() must unregister both, otherwise the module-level callback
    // arrays pin the agent's object graph forever
    expect(unsubSettings).toHaveBeenCalledTimes(1);
    expect(unsubAuth).toHaveBeenCalledTimes(1);
  });

  // Issue #2758: hosts drop their own reference to the Agent before/as they
  // call destroy(), so a teardown that aborts early leaves an unreachable Agent
  // holding a live MCP process tree. A failed transcript flush must therefore
  // only warn — never skip the resource cleanup (spec ecosystem/mcp.md 边界情况
  // 「销毁必须先于引用丢弃、且回收不得被前置失败阻断」).
  it("destroy() still tears down MCP when the transcript flush throws", async () => {
    const agent = await Agent.create({
      apiKey: "test-key",
      workdir: "/tmp/test-destroy-flush-failure",
    });
    const internals = agent as unknown as {
      messageManager: { saveSession: () => Promise<void> };
      mcpManager: { cleanup: () => Promise<void> };
    };
    vi.spyOn(internals.messageManager, "saveSession").mockRejectedValue(
      new Error("transcript write failed"),
    );
    const cleanup = vi.spyOn(internals.mcpManager, "cleanup");

    await expect(agent.destroy()).resolves.toBeUndefined();

    expect(internals.messageManager.saveSession).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("destroy() clears the DI container so per-agent services are released", async () => {
    const agent = await Agent.create({
      apiKey: "test-key",
      workdir: "/tmp/test-destroy-container",
    });
    const container = (agent as unknown as { container: Container }).container;
    expect(container.has("ToolManager")).toBe(true);

    await agent.destroy();

    expect(container.has("ToolManager")).toBe(false);
    expect(container.has("MessageManager")).toBe(false);
  });
});
