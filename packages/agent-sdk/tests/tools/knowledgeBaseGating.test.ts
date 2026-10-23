import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolManager } from "@/managers/toolManager.js";
import { McpManager } from "@/managers/mcpManager.js";
import { Container } from "@/utils/container.js";

const gate = { enabled: false };

vi.mock("@/services/knowledgeBaseAvailability.js", () => ({
  isKnowledgeBaseEnabled: () => gate.enabled,
}));

vi.mock("@/services/artifactAvailability.js", () => ({
  isArtifactEnabled: () => false,
}));

import { featureGatedKnowledgeBaseTools } from "@/tools/knowledgeBase/index.js";

const KB_TOOL_NAMES = ["kb_search", "kb_get_doc", "kb_suggest"];

const mockMcpManager = {
  isMcpTool: vi.fn().mockReturnValue(false),
  executeMcpToolByRegistry: vi.fn(),
  getAllConnectedTools: vi.fn().mockReturnValue([]),
  getMcpToolsConfig: vi.fn().mockReturnValue([]),
  getMcpToolOutputSchemas: vi.fn().mockReturnValue(new Map()),
  getMcpToolPlugins: vi.fn().mockReturnValue([]),
} as unknown as McpManager;

function createContainer(): Container {
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
  return container;
}

/** The agent's tool list for a session, with `customTools` assembled as containerSetup does. */
function registeredToolNames(workdir: string): string[] {
  const toolManager = new ToolManager({
    container: createContainer(),
    customTools: featureGatedKnowledgeBaseTools(workdir),
  });
  toolManager.initializeBuiltInTools();
  return toolManager.list().map((tool) => tool.name);
}

describe("knowledge base tool gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers no kb_* tool while enableKnowledgeBase is unset", () => {
    gate.enabled = false;
    const names = registeredToolNames("/test/workdir");
    expect(names.filter((name) => name.startsWith("kb_"))).toEqual([]);
    // The rest of the tool set is untouched by the closed gate.
    expect(names).toContain("Bash");
    expect(names).toContain("Read");
  });

  it("registers all three once enableKnowledgeBase is on", () => {
    gate.enabled = true;
    const names = registeredToolNames("/test/workdir");
    for (const name of KB_TOOL_NAMES) {
      expect(names).toContain(name);
    }
  });

  it("returns the three tools in the order they are used", () => {
    gate.enabled = true;
    expect(
      featureGatedKnowledgeBaseTools("/test/workdir").map((tool) => tool.name),
    ).toEqual(KB_TOOL_NAMES);
  });

  it("returns nothing to attach when the gate is closed", () => {
    gate.enabled = false;
    expect(featureGatedKnowledgeBaseTools("/test/workdir")).toEqual([]);
  });
});
