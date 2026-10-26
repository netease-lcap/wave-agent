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

import { knowledgeBaseTools } from "@/tools/knowledgeBase/index.js";

const KB_TOOL_NAMES = ["kb_search", "kb_get_doc", "kb_suggest"];

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
  // The gate reads the session's opening directory, never the `cd`-tracking one.
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

function kbToolNames(toolManager: ToolManager): string[] {
  return toolManager
    .list()
    .map((tool) => tool.name)
    .filter((name) => name.startsWith("kb_"));
}

describe("knowledge base tool gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers no kb_* tool while enableKnowledgeBase is unset", () => {
    gate.enabled = false;
    const toolManager = toolManagerFor("/test/workdir");
    expect(kbToolNames(toolManager)).toEqual([]);
    // The rest of the tool set is untouched by the closed gate.
    const names = toolManager.list().map((tool) => tool.name);
    expect(names).toContain("Bash");
    expect(names).toContain("Read");
  });

  it("registers all three once enableKnowledgeBase is on", () => {
    gate.enabled = true;
    expect(kbToolNames(toolManagerFor("/test/workdir"))).toEqual(KB_TOOL_NAMES);
  });

  it("declares the three tools in the order they are used", () => {
    expect(knowledgeBaseTools.map((tool) => tool.name)).toEqual(KB_TOOL_NAMES);
  });

  it("adds the tools on reload without a new session", () => {
    gate.enabled = false;
    const toolManager = toolManagerFor("/test/workdir");
    expect(kbToolNames(toolManager)).toEqual([]);

    // The settings switch is saved: the live-config reload re-evaluates the gate.
    gate.enabled = true;
    toolManager.reloadFeatureGatedTools();
    expect(kbToolNames(toolManager)).toEqual(KB_TOOL_NAMES);
  });

  it("removes the tools on reload once the switch is turned off", () => {
    gate.enabled = true;
    const toolManager = toolManagerFor("/test/workdir");
    expect(kbToolNames(toolManager)).toEqual(KB_TOOL_NAMES);

    gate.enabled = false;
    toolManager.reloadFeatureGatedTools();
    expect(kbToolNames(toolManager)).toEqual([]);
  });
});
