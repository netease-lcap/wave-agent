import { describe, it, expect, vi, afterEach } from "vitest";
import { Agent } from "@/agent.js";
import { createMockToolManager } from "../helpers/mockFactories.js";
import { authService } from "@/services/authService.js";
import { remoteSettingsService } from "@/services/remoteSettingsService.js";
import { SkillManager } from "@/managers/skillManager.js";

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

// Mock tool registry so the auth callback's container lookup resolves here
const { instance: mockToolManagerInstance } = createMockToolManager();

vi.mock("@/managers/toolManager", () => ({
  ToolManager: vi.fn().mockImplementation(function () {
    return mockToolManagerInstance;
  }),
}));

describe("auth change re-evaluation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("re-evaluates feature-gated tools and skills on login and logout", async () => {
    const reloadTools = vi.fn();
    (
      mockToolManagerInstance as unknown as Record<string, unknown>
    ).reloadFeatureGatedTools = reloadTools;
    const reloadSkills = vi
      .spyOn(SkillManager.prototype, "reloadFeatureGatedSkills")
      .mockResolvedValue(undefined);

    let onAuthChange:
      | ((event: "login" | "logout") => void | Promise<void>)
      | undefined;
    vi.spyOn(authService, "onAuthChange").mockImplementation((callback) => {
      onAuthChange = callback;
      return () => {};
    });
    const refresh = vi
      .spyOn(remoteSettingsService, "refresh")
      .mockResolvedValue({
        success: true,
        settings: null,
      } as unknown as Awaited<
        ReturnType<typeof remoteSettingsService.refresh>
      >);
    const clear = vi
      .spyOn(remoteSettingsService, "clear")
      .mockImplementation(() => {});

    const agent = await Agent.create({
      apiKey: "test-key",
      workdir: "/tmp/test-auth-change-reload",
    });

    try {
      // Setup itself may already have reloaded once (initial config load), so
      // count from the baseline rather than assuming zero.
      const reloadedTools = reloadTools.mock.calls.length;
      const reloadedSkills = reloadSkills.mock.calls.length;

      // Artifact's code default follows the account, so a first-run user who
      // logs in from inside the session must get the tool without a restart.
      await onAuthChange?.("login");
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(reloadTools.mock.calls.length).toBe(reloadedTools + 1);
      expect(reloadSkills.mock.calls.length).toBe(reloadedSkills + 1);

      // ...and logging out must take it away again.
      await onAuthChange?.("logout");
      expect(clear).toHaveBeenCalledTimes(1);
      expect(reloadTools.mock.calls.length).toBe(reloadedTools + 2);
      expect(reloadSkills.mock.calls.length).toBe(reloadedSkills + 2);
    } finally {
      await agent.destroy();
    }
  });
});
