import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolManager } from "@/managers/toolManager.js";
import { McpManager } from "@/managers/mcpManager.js";
import { Container } from "@/utils/container.js";

/**
 * The 404 verdict the server gives when the deployment has web search switched
 * off. Registration reads it (`services/webSearchAvailability.ts`), so the gate is
 * mocked here and the real memo is exercised in its own test.
 */
const gate = { available: true, enabledBySettings: true };

vi.mock("@/services/webSearchAvailability.js", () => ({
  isWebSearchAvailable: () => gate.available,
  isWebSearchEnabledBySettings: () => gate.enabledBySettings,
  markWebSearchUnsupported: () => {
    gate.available = false;
  },
}));

vi.mock("@/services/knowledgeBaseAvailability.js", () => ({
  isKnowledgeBaseEnabled: () => false,
}));

vi.mock("@/services/artifactAvailability.js", () => ({
  isArtifactEnabled: () => false,
}));

const mockMcpManager = {
  isMcpTool: vi.fn().mockReturnValue(false),
  executeMcpToolByRegistry: vi.fn(),
  getAllConnectedTools: vi.fn().mockReturnValue([]),
  getMcpToolsConfig: vi.fn().mockReturnValue([]),
  getMcpToolOutputSchemas: vi.fn().mockReturnValue(new Map()),
  getMcpToolPlugins: vi.fn().mockReturnValue([]),
} as unknown as McpManager;

function createContainer(workdir = "/test/workdir"): Container {
  const container = new Container();
  container.register("PermissionManager", {
    isToolDenied: vi.fn().mockReturnValue(false),
    getCurrentEffectiveMode: vi.fn().mockReturnValue("default"),
  });
  container.register("TaskManager", {});
  container.register("ReversionManager", {});
  container.register("BackgroundTaskManager", {});
  container.register("ForegroundTaskManager", {});
  container.register("LspManager", {});
  container.register("McpManager", mockMcpManager);
  container.register("CurrentWorkdir", workdir);
  container.register("SessionWorkdir", workdir);
  return container;
}

/** A session's tool manager, with the tool set registered as containerSetup does. */
function toolManagerFor(workdir: string): ToolManager {
  const toolManager = new ToolManager({ container: createContainer(workdir) });
  toolManager.initializeBuiltInTools();
  return toolManager;
}

/** Declared names plus the REPL pool's — the tool is deferred, so it lives in the pool. */
function reachableNames(toolManager: ToolManager): string[] {
  return [
    ...toolManager.list().map((tool) => tool.name),
    ...(toolManager.getOnDemandToolNames() ?? []),
  ];
}

describe("WebSearch gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gate.available = true;
    gate.enabledBySettings = true;
  });

  it("registers WebSearch while the server has not said 404", () => {
    expect(reachableNames(toolManagerFor("/test/workdir"))).toContain(
      "WebSearch",
    );
  });

  it("does not register it once this process was told the capability is missing", () => {
    gate.available = false;
    const toolManager = toolManagerFor("/test/workdir");
    expect(reachableNames(toolManager)).not.toContain("WebSearch");
    expect(toolManager.hasTool("WebSearch")).toBe(false);
  });

  it("stays gone across a live-config reload after the 404 verdict", () => {
    gate.available = true;
    const toolManager = toolManagerFor("/test/workdir");
    expect(reachableNames(toolManager)).toContain("WebSearch");

    // The tool itself records the verdict when it meets the 404, which also
    // unregisters it; a settings reload must not resurrect it.
    gate.available = false;
    toolManager.reloadFeatureGatedTools();
    expect(reachableNames(toolManager)).not.toContain("WebSearch");
  });

  it("does not register it while the enableWebSearch switch is off", () => {
    // A configured `false` hides the tool without probing the server at all.
    gate.enabledBySettings = false;
    const toolManager = toolManagerFor("/test/workdir");
    expect(reachableNames(toolManager)).not.toContain("WebSearch");
    expect(toolManager.hasTool("WebSearch")).toBe(false);
  });

  it("follows the switch across a live-config reload, both ways", () => {
    const toolManager = toolManagerFor("/test/workdir");
    expect(reachableNames(toolManager)).toContain("WebSearch");

    gate.enabledBySettings = false;
    toolManager.reloadFeatureGatedTools();
    expect(reachableNames(toolManager)).not.toContain("WebSearch");

    gate.enabledBySettings = true;
    toolManager.reloadFeatureGatedTools();
    expect(reachableNames(toolManager)).toContain("WebSearch");
  });

  it("stays gone while either gate is closed (the two stack)", () => {
    gate.enabledBySettings = true;
    gate.available = false;
    const toolManager = toolManagerFor("/test/workdir");
    expect(reachableNames(toolManager)).not.toContain("WebSearch");

    gate.enabledBySettings = false;
    gate.available = true;
    toolManager.reloadFeatureGatedTools();
    expect(reachableNames(toolManager)).not.toContain("WebSearch");
  });

  it("comes back when the verdict no longer applies (another server)", () => {
    gate.available = false;
    const toolManager = toolManagerFor("/test/workdir");
    expect(reachableNames(toolManager)).not.toContain("WebSearch");

    gate.available = true;
    toolManager.reloadFeatureGatedTools();
    expect(reachableNames(toolManager)).toContain("WebSearch");
  });
});
