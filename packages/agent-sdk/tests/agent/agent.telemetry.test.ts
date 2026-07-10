import { describe, it, expect, vi, afterEach } from "vitest";
import { Agent } from "@/agent.js";
import { createMockToolManager } from "../helpers/mockFactories.js";

// Use vi.hoisted for mock functions referenced in vi.mock factories
const { initTelemetryMock, logOTelEventMock } = vi.hoisted(() => ({
  initTelemetryMock: vi.fn(),
  logOTelEventMock: vi.fn().mockResolvedValue(undefined),
}));

// Mock AI Service
vi.mock("@/services/aiService");

// Mock telemetry modules — top-level, referencing hoisted mocks
vi.mock("@/telemetry/instrumentation.js", () => ({
  initializeTelemetry: initTelemetryMock,
  shutdownTelemetry: vi.fn().mockResolvedValue(undefined),
  getCurrentConfig: vi.fn().mockReturnValue(undefined),
  getOTELApi: vi.fn().mockReturnValue(undefined),
  isInitialized: vi.fn().mockReturnValue(false),
  JsonlSpanExporter: class {},
  JsonlLogExporter: class {},
}));

vi.mock("@/telemetry/events.js", () => ({
  logOTelEvent: logOTelEventMock,
}));

// Mock tool registry
const { instance: mockToolManagerInstance } = createMockToolManager();

vi.mock("@/managers/toolManager", () => ({
  ToolManager: vi.fn().mockImplementation(function () {
    return mockToolManagerInstance;
  }),
}));

describe("Agent - Telemetry Initialization", () => {
  afterEach(() => {
    initTelemetryMock.mockReset();
    logOTelEventMock.mockReset();
    logOTelEventMock.mockResolvedValue(undefined);
  });

  it("initializeTelemetry is awaited before Agent.create resolves", async () => {
    // Create a deferred promise for initializeTelemetry
    let resolveInit!: (value: unknown) => void;
    const initPromise = new Promise((resolve) => {
      resolveInit = resolve;
    });
    initTelemetryMock.mockReturnValue(initPromise);
    logOTelEventMock.mockResolvedValue(undefined);

    // Start Agent.create — should not resolve until initPromise resolves
    const agentPromise = Agent.create({
      apiKey: "test-key",
      workdir: "/tmp/test-telemetry-await",
      callbacks: {
        onMessagesChange: vi.fn(),
        onLoadingChange: vi.fn(),
      },
    });

    // Wait for initializeTelemetry to be called (Agent.create has async setup before it)
    await vi.waitFor(() => {
      expect(initTelemetryMock).toHaveBeenCalledTimes(1);
    });

    // Agent.create should still be pending — verify it hasn't resolved
    let resolved = false;
    agentPromise.then(() => {
      resolved = true;
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(resolved).toBe(false);

    // Resolve the deferred telemetry init
    resolveInit(undefined);

    // Now Agent.create should resolve
    const agent = await agentPromise;
    expect(agent).toBeDefined();
    expect(agent).toBeInstanceOf(Agent);
  });

  it("initializeTelemetry failure doesn't crash Agent.create", async () => {
    initTelemetryMock.mockRejectedValue(new Error("OTEL init failed"));
    logOTelEventMock.mockResolvedValue(undefined);

    const agent = await Agent.create({
      apiKey: "test-key",
      workdir: "/tmp/test-telemetry-fail",
      callbacks: {
        onMessagesChange: vi.fn(),
        onLoadingChange: vi.fn(),
      },
    });

    // Agent.create should still succeed despite telemetry failure
    expect(agent).toBeDefined();
    expect(agent).toBeInstanceOf(Agent);
    expect(initTelemetryMock).toHaveBeenCalled();
  });

  it("logOTelEvent session_start called after initializeTelemetry resolves", async () => {
    initTelemetryMock.mockResolvedValue(undefined);
    logOTelEventMock.mockResolvedValue(undefined);

    const agent = await Agent.create({
      apiKey: "test-key",
      workdir: "/tmp/test-telemetry-order",
      callbacks: {
        onMessagesChange: vi.fn(),
        onLoadingChange: vi.fn(),
      },
    });

    // Give any pending microtasks a chance
    await new Promise((r) => setTimeout(r, 10));

    expect(agent).toBeDefined();
    expect(initTelemetryMock).toHaveBeenCalledBefore(logOTelEventMock);

    // session_start should have been called with correct metadata
    const sessionStartCall = logOTelEventMock.mock.calls.find(
      (c: unknown[]) => c[0] === "session_start",
    );
    expect(sessionStartCall).toBeDefined();
    expect(sessionStartCall![1]).toEqual(
      expect.objectContaining({
        sessionId: expect.any(String),
        model: expect.any(String),
        workdir: "/tmp/test-telemetry-order",
      }),
    );
  });
});
