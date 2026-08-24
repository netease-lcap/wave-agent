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
  shutdownTelemetry: vi.fn().mockResolvedValue(undefined),
  getCurrentConfig: vi.fn().mockReturnValue(undefined),
  getOTELApi: vi.fn().mockReturnValue(undefined),
  isInitialized: vi.fn().mockReturnValue(false),
  JsonlSpanExporter: class {},
  JsonlLogExporter: class {},
}));

vi.mock("@/telemetry/events.js", () => ({
  logOTelEvent: vi.fn().mockResolvedValue(undefined),
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
