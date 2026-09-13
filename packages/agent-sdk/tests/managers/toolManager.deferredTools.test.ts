import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ToolManager } from "@/managers/toolManager.js";
import { PermissionManager } from "@/managers/permissionManager.js";
import { Container } from "@/utils/container.js";
import type { McpManager } from "@/managers/mcpManager.js";
import type { McpServerConfig } from "@/types/mcp.js";
import type { ToolPlugin, ToolContext } from "@/tools/types.js";
import { bashTool } from "@/tools/bashTool.js";
import { CATALOG_DEFAULT_BUDGET_TOKENS } from "@/utils/toolCatalog.js";
import {
  TOOL_INVOKE_TOOL_NAME,
  TOOL_SEARCH_TOOL_NAME,
} from "@/tools/deferredTools.js";
import { readDeferredToolsSettings } from "@/services/deferredToolsAvailability.js";

vi.mock("@/services/deferredToolsAvailability.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/services/deferredToolsAvailability.js")
    >();
  return {
    ...actual,
    readDeferredToolsSettings: vi.fn(() => ({
      enabled: undefined,
      tokenBudget: CATALOG_DEFAULT_BUDGET_TOKENS,
    })),
  };
});

const settings = vi.mocked(readDeferredToolsSettings);

type McpToolFixture = {
  server: string;
  tool: string;
  description?: string;
  parameters?: Record<string, unknown>;
};

/**
 * Fake MCP manager exposing the same surface `ToolManager` uses. Plugins are
 * real `ToolPlugin` objects so the declared configs and the dispatch wiring are
 * exercised for real; only the transport is replaced.
 */
function createMcpManager(options: {
  tools: McpToolFixture[];
  servers?: Record<string, McpServerConfig>;
}) {
  const plugins: ToolPlugin[] = options.tools.map((fixture) => {
    const name = `mcp__${fixture.server}__${fixture.tool}`;
    return {
      name,
      config: {
        type: "function",
        function: {
          name,
          description:
            fixture.description ?? `${fixture.tool} on ${fixture.server}`,
          parameters: fixture.parameters ?? {
            type: "object",
            properties: {},
            required: [],
          },
        },
      },
      execute: vi.fn(async () => ({ success: true, content: `ran ${name}` })),
    };
  });
  const servers = options.servers ?? {};
  return {
    isMcpTool: vi.fn((name: string) =>
      plugins.some((plugin) => plugin.name === name),
    ),
    getMcpToolPlugins: vi.fn(() => plugins),
    getMcpToolsConfig: vi.fn(() => plugins.map((plugin) => plugin.config)),
    getServer: vi.fn((name: string) =>
      servers[name]
        ? { name, status: "connected" as const, config: servers[name] }
        : undefined,
    ),
    executeMcpToolByRegistry: vi.fn(
      async (name: string, args: Record<string, unknown>) => ({
        success: true,
        content: `mcp ${name} ${JSON.stringify(args)}`,
      }),
    ),
  };
}

type FakeMcpManager = ReturnType<typeof createMcpManager>;

/**
 * A real existing directory is enough: only the leaf-execution test needs one,
 * and it never writes inside it.
 */
const workdir = process.cwd();

beforeEach(() => {
  settings.mockReturnValue({
    enabled: undefined,
    tokenBudget: CATALOG_DEFAULT_BUDGET_TOKENS,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

function createContainer(
  mcpManager: FakeMcpManager,
  permissionManager: unknown = {
    isToolDenied: vi.fn(() => false),
    getCurrentEffectiveMode: vi.fn(() => "default"),
  },
): Container {
  const container = new Container();
  container.register("Workdir", workdir);
  container.register("PermissionManager", permissionManager);
  container.register("McpManager", mcpManager as unknown as McpManager);
  container.register("TaskManager", {});
  container.register("ReversionManager", {});
  container.register("BackgroundTaskManager", {});
  container.register("ForegroundTaskManager", {
    // Only the real Bash leaf used in the permission fidelity tests looks at
    // this, and nothing there backgrounds anything.
    registerForegroundTask: vi.fn(),
    unregisterForegroundTask: vi.fn(),
  });
  container.register("LspManager", {});
  return container;
}

/** Built-in tool plugin with an explicit defer annotation. */
function deferredBuiltIn(
  name: string,
  description = `${name} desc`,
): ToolPlugin {
  return {
    name,
    defer: true,
    config: {
      type: "function",
      function: {
        name,
        description,
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    execute: vi.fn(async () => ({ success: true, content: `ran ${name}` })),
  };
}

/** The same plugin shape without the annotation — i.e. never deferred. */
function plainBuiltIn(name: string): ToolPlugin {
  const plugin = deferredBuiltIn(name);
  delete plugin.defer;
  return plugin;
}
const context = (): ToolContext => ({ workdir }) as ToolContext;

/** The MCP tools used by most tests: five deferrable leaves on one server. */
const FIVE_TOOLS: McpToolFixture[] = [
  { server: "github", tool: "create_issue" },
  { server: "github", tool: "list_issues" },
  { server: "github", tool: "close_issue" },
  { server: "github", tool: "comment_issue" },
  { server: "github", tool: "assign_issue" },
];

/** One more than the threshold, for tests that take one tool back out. */
const SIX_TOOLS: McpToolFixture[] = [
  ...FIVE_TOOLS,
  { server: "slack", tool: "post_message" },
];

function declaredNames(toolManager: ToolManager): string[] {
  return toolManager.getToolsConfig({ workdir }).map((t) => t.function.name);
}

function toolInvokeDescription(toolManager: ToolManager): string {
  const config = toolManager
    .getToolsConfig({ workdir })
    .find((t) => t.function.name === TOOL_INVOKE_TOOL_NAME);
  expect(config).toBeDefined();
  return config!.function.description ?? "";
}

describe("ToolManager deferred loading — gate", () => {
  it("leaves the declared tool list untouched while the gate is closed", () => {
    const mcp = createMcpManager({ tools: FIVE_TOOLS.slice(0, 4) });
    // 4 deferrable tools is below the threshold, so nothing is deferred.
    const container = createContainer(mcp);
    const toolManager = new ToolManager({ container });
    const flatBuiltIn = plainBuiltIn("EnterWorktree");
    toolManager.register(flatBuiltIn);

    const declared = toolManager.getToolsConfig({ workdir });
    const expected = [
      { ...flatBuiltIn.config, function: { ...flatBuiltIn.config.function } },
      ...mcp.getMcpToolsConfig(),
    ];
    expect(declared).toStrictEqual(expected);
    expect(declared.map((t) => t.function.name)).toEqual([
      "EnterWorktree",
      ...FIVE_TOOLS.slice(0, 4).map((f) => `mcp__${f.server}__${f.tool}`),
    ]);
    expect(declared.map((t) => t.function.name)).not.toContain(
      TOOL_INVOKE_TOOL_NAME,
    );
    expect(declared.map((t) => t.function.name)).not.toContain(
      TOOL_SEARCH_TOOL_NAME,
    );
    // Same result the pre-deferral code produced: the split never rewrites a
    // single declaration while the gate is closed.
    expect(JSON.stringify(declared)).toBe(JSON.stringify(expected));
  });

  it("returns the same array instance from applyDeferredTools while the gate is closed", () => {
    const mcp = createMcpManager({ tools: FIVE_TOOLS.slice(0, 4) });
    const toolManager = new ToolManager({
      container: createContainer(mcp),
    });
    const input = mcp.getMcpToolsConfig();
    expect(toolManager.applyDeferredTools(input, workdir)).toBe(input);
  });

  it("opens the gate at five deferrable tools and closes it at four", () => {
    const below = new ToolManager({
      container: createContainer(
        createMcpManager({ tools: FIVE_TOOLS.slice(0, 4) }),
      ),
    });
    const at = new ToolManager({
      container: createContainer(createMcpManager({ tools: FIVE_TOOLS })),
    });
    expect(below.getDeferredToolsPlan(workdir)).toBeNull();
    expect(at.getDeferredToolsPlan(workdir)).not.toBeNull();
  });

  it("lets an explicit setting override the threshold in both directions", () => {
    const one = new ToolManager({
      container: createContainer(
        createMcpManager({ tools: FIVE_TOOLS.slice(0, 1) }),
      ),
    });
    const many = new ToolManager({
      container: createContainer(createMcpManager({ tools: FIVE_TOOLS })),
    });

    settings.mockReturnValue({
      enabled: true,
      tokenBudget: CATALOG_DEFAULT_BUDGET_TOKENS,
    });
    expect(one.getDeferredToolsPlan(workdir)).not.toBeNull();

    settings.mockReturnValue({
      enabled: false,
      tokenBudget: CATALOG_DEFAULT_BUDGET_TOKENS,
    });
    expect(many.getDeferredToolsPlan(workdir)).toBeNull();
    expect(many.applyDeferredTools([], workdir)).toEqual([]);
  });

  it("stays closed when the mechanism tools are denied by permission rules", () => {
    const mcp = createMcpManager({ tools: FIVE_TOOLS });
    const container = createContainer(mcp, {
      isToolDenied: vi.fn((name: string) => name === TOOL_INVOKE_TOOL_NAME),
      getCurrentEffectiveMode: vi.fn(() => "default"),
    });
    const toolManager = new ToolManager({ container });
    expect(toolManager.getDeferredToolsPlan(workdir)).toBeNull();
    expect(declaredNames(toolManager)).not.toContain(TOOL_INVOKE_TOOL_NAME);
  });
});

describe("ToolManager deferred loading — catalog and declarations", () => {
  it("declares ToolInvoke + ToolSearch in place of the deferred tools", () => {
    const mcp = createMcpManager({ tools: FIVE_TOOLS });
    const toolManager = new ToolManager({
      container: createContainer(mcp),
    });
    toolManager.register(bashTool);

    const names = declaredNames(toolManager);
    expect(names).toEqual([
      "Bash",
      TOOL_INVOKE_TOOL_NAME,
      TOOL_SEARCH_TOOL_NAME,
    ]);
    const description = toolInvokeDescription(toolManager);
    for (const fixture of FIVE_TOOLS) {
      expect(description).toContain(`github.${fixture.tool}(`);
    }
    expect(description).toContain("COMPLETE — all 5 tools shown");
    expect(description).toContain("github: 5 tools");
  });

  it("addresses annotate built-in tools under the reserved namespace", () => {
    const mcp = createMcpManager({ tools: FIVE_TOOLS });
    const toolManager = new ToolManager({
      container: createContainer(mcp),
    });
    toolManager.register(deferredBuiltIn("EnterWorktree"));
    toolManager.register(bashTool);

    const names = declaredNames(toolManager);
    expect(names).toContain("Bash");
    expect(names).not.toContain("EnterWorktree");
    const description = toolInvokeDescription(toolManager);
    expect(description).toContain("builtin.EnterWorktree()");
    expect(description).toContain("builtin: 1 tools");
    expect(description).toContain("COMPLETE — all 6 tools shown");
  });

  it("keeps ToolInvoke's parameter declaration constant while its description changes", () => {
    const small = new ToolManager({
      container: createContainer(
        createMcpManager({
          tools: [
            { server: "github", tool: "create_issue" },
            { server: "github", tool: "list_issues" },
            { server: "github", tool: "close_issue" },
            { server: "github", tool: "comment_issue" },
            { server: "github", tool: "assign_issue" },
          ],
        }),
      ),
    });
    const large = new ToolManager({
      container: createContainer(
        createMcpManager({
          tools: [
            ...FIVE_TOOLS,
            { server: "slack", tool: "post_message" },
            { server: "slack", tool: "list_channels" },
          ],
        }),
      ),
    });

    const declaration = (manager: ToolManager) => {
      const config = manager
        .getToolsConfig({ workdir })
        .find((t) => t.function.name === TOOL_INVOKE_TOOL_NAME)!;
      return config.function.parameters;
    };
    expect(declaration(small)).toStrictEqual(declaration(large));
    expect(declaration(large)).toMatchObject({
      type: "object",
      required: ["namespace", "tool"],
      properties: {
        namespace: { type: "string" },
        tool: { type: "string" },
        args: { type: "object", additionalProperties: true },
      },
    });
    expect(toolInvokeDescription(small)).not.toBe(toolInvokeDescription(large));
    expect(toolInvokeDescription(large)).toContain("slack.post_message(");
  });

  it("renders the same tool declarations twice for an unchanged pool", () => {
    const toolManager = new ToolManager({
      container: createContainer(createMcpManager({ tools: FIVE_TOOLS })),
    });
    toolManager.register(deferredBuiltIn("Workflow"));
    expect(JSON.stringify(toolManager.getToolsConfig({ workdir }))).toBe(
      JSON.stringify(toolManager.getToolsConfig({ workdir })),
    );
  });

  it("honours the per-tool alwaysLoad escape hatch of one server", () => {
    const mcp = createMcpManager({
      tools: SIX_TOOLS,
      servers: { github: { alwaysLoadTools: ["create_issue"] } },
    });
    const toolManager = new ToolManager({
      container: createContainer(mcp),
    });

    const names = declaredNames(toolManager);
    expect(names).toContain("mcp__github__create_issue");
    expect(names).not.toContain("mcp__github__list_issues");
    const description = toolInvokeDescription(toolManager);
    expect(description).toContain("github.list_issues(");
    expect(description).not.toContain("github.create_issue(");
    // The opted-out tool is not counted as deferrable either.
    expect(description).toContain("COMPLETE — all 5 tools shown");
    expect(description).toContain("github: 4 tools");
  });

  it("degrades a server that collides with the reserved namespace without failing", () => {
    const mcp = createMcpManager({
      tools: [
        { server: "builtin", tool: "alpha" },
        { server: "builtin", tool: "beta" },
        ...FIVE_TOOLS,
      ],
    });
    const toolManager = new ToolManager({
      container: createContainer(mcp),
    });

    const names = declaredNames(toolManager);
    // The colliding server's tools stay individually declared...
    expect(names).toContain("mcp__builtin__alpha");
    expect(names).toContain("mcp__builtin__beta");
    // ...and the rest of the pool is still deferred normally.
    expect(names).toContain(TOOL_INVOKE_TOOL_NAME);
    const description = toolInvokeDescription(toolManager);
    expect(description).not.toContain("builtin.alpha(");
    expect(description).toContain("github.create_issue(");
    expect(description).toContain("COMPLETE — all 5 tools shown");
  });

  it("keeps explicitly listed tools flat (--tools)", () => {
    const mcp = createMcpManager({ tools: SIX_TOOLS });
    const toolManager = new ToolManager({
      container: createContainer(mcp),
      tools: ["bash", "mcp__github__create_issue", "enterworktree"],
    });
    toolManager.register(bashTool);
    toolManager.register(deferredBuiltIn("EnterWorktree"));

    const names = declaredNames(toolManager);
    expect(names).toContain("Bash");
    expect(names).toContain("EnterWorktree");
    expect(names).toContain("mcp__github__create_issue");
    const description = toolInvokeDescription(toolManager);
    expect(description).not.toContain("builtin.EnterWorktree(");
    expect(description).not.toContain("github.create_issue(");
    expect(description).toContain("COMPLETE — all 5 tools shown");
  });
});

describe("ToolManager deferred loading — ToolInvoke dispatch", () => {
  it("forwards an MCP leaf with the leaf name and the leaf's own args", async () => {
    const mcp = createMcpManager({ tools: FIVE_TOOLS });
    const toolManager = new ToolManager({
      container: createContainer(mcp),
    });

    const result = await toolManager.execute(
      TOOL_INVOKE_TOOL_NAME,
      {
        namespace: "github",
        tool: "create_issue",
        args: { owner: "acme", title: "hi" },
      },
      context(),
    );

    expect(result.success).toBe(true);
    expect(mcp.executeMcpToolByRegistry).toHaveBeenCalledWith(
      "mcp__github__create_issue",
      { owner: "acme", title: "hi" },
      expect.objectContaining({ workdir }),
    );
  });

  it("treats a missing, empty or null args as no arguments", async () => {
    const mcp = createMcpManager({ tools: FIVE_TOOLS });
    const toolManager = new ToolManager({
      container: createContainer(mcp),
    });
    const base = { namespace: "github", tool: "create_issue" };

    await toolManager.execute(TOOL_INVOKE_TOOL_NAME, { ...base }, context());
    await toolManager.execute(
      TOOL_INVOKE_TOOL_NAME,
      { ...base, args: {} },
      context(),
    );
    await toolManager.execute(
      TOOL_INVOKE_TOOL_NAME,
      { ...base, args: null },
      context(),
    );

    for (const call of mcp.executeMcpToolByRegistry.mock.calls) {
      expect(call[1]).toEqual({});
    }
    expect(mcp.executeMcpToolByRegistry).toHaveBeenCalledTimes(3);
  });

  it("refuses a target outside the catalog and names what is available", async () => {
    const mcp = createMcpManager({ tools: FIVE_TOOLS });
    const toolManager = new ToolManager({
      container: createContainer(mcp),
    });

    const unknownNamespace = await toolManager.execute(
      TOOL_INVOKE_TOOL_NAME,
      { namespace: "gitlab", tool: "create_issue", args: {} },
      context(),
    );
    expect(unknownNamespace.success).toBe(false);
    expect(unknownNamespace.error).toContain('Unknown namespace "gitlab"');
    expect(unknownNamespace.error).toContain("github: 5 tools");

    const unknownTool = await toolManager.execute(
      TOOL_INVOKE_TOOL_NAME,
      { namespace: "github", tool: "delete_repo", args: {} },
      context(),
    );
    expect(unknownTool.success).toBe(false);
    expect(unknownTool.error).toContain(
      'Unknown tool "delete_repo" in namespace "github"',
    );
    expect(unknownTool.error).toContain("create_issue");

    expect(mcp.executeMcpToolByRegistry).not.toHaveBeenCalled();
  });

  it("refuses everything when no catalog is declared", async () => {
    const mcp = createMcpManager({ tools: FIVE_TOOLS.slice(0, 2) });
    const toolManager = new ToolManager({
      container: createContainer(mcp),
    });
    const result = await toolManager.execute(
      TOOL_INVOKE_TOOL_NAME,
      { namespace: "github", tool: "create_issue", args: {} },
      context(),
    );
    expect(result.success).toBe(false);
    expect(mcp.executeMcpToolByRegistry).not.toHaveBeenCalled();
  });

  it("does not let one agent's pool reach another agent's catalog", async () => {
    const mcp = createMcpManager({ tools: FIVE_TOOLS });

    // The wider pool is built first on purpose: a catalog cached at container
    // or module level instead of per agent would leak this `Write` below.
    const main = new ToolManager({ container: createContainer(mcp) });
    main.register(bashTool);
    main.register(deferredBuiltIn("Write"));
    expect(toolInvokeDescription(main)).toContain("builtin.Write()");
    const allowed = await main.execute(
      TOOL_INVOKE_TOOL_NAME,
      { namespace: "builtin", tool: "Write", args: { file_path: "x" } },
      context(),
    );
    expect(allowed.success).toBe(true);

    // "subagent": whitelisted to Bash, and its own custom tool is filtered out
    // by that whitelist, so Write is not registered at all even though it would
    // have been defer-annotated.
    const subagent = new ToolManager({
      container: createContainer(mcp),
      tools: ["bash"],
      customTools: [deferredBuiltIn("Write")],
    });
    subagent.initializeBuiltInTools();

    expect(declaredNames(subagent)).not.toContain("Write");
    expect(toolInvokeDescription(subagent)).not.toContain("builtin.Write");

    const escalation = await subagent.execute(
      TOOL_INVOKE_TOOL_NAME,
      { namespace: "builtin", tool: "Write", args: { file_path: "x" } },
      context(),
    );
    expect(escalation.success).toBe(false);
    expect(escalation.error).toContain('Unknown namespace "builtin"');
  });
});

describe("ToolManager deferred loading — permission fidelity", () => {
  function permissionHarness(options: {
    allowedRules?: string[];
    deniedRules?: string[];
    canUseToolCallback?: () => Promise<{ behavior: "allow" | "deny" }>;
    mcp: FakeMcpManager;
  }) {
    const container = createContainer(options.mcp);
    const permissionManager = new PermissionManager(container, {
      allowedRules: options.allowedRules ?? [],
      deniedRules: options.deniedRules ?? [],
    });
    container.register("PermissionManager", permissionManager);
    if (options.canUseToolCallback) {
      container.register("CanUseToolCallback", options.canUseToolCallback);
    }
    const toolManager = new ToolManager({ container });
    // Bash is never deferred by the shipped annotations; annotating it here is
    // what makes it reachable through the catalog, so these tests exercise the
    // permission path a forwarded leaf would take.
    toolManager.register({ ...bashTool, defer: true });
    const createContextSpy = vi.spyOn(permissionManager, "createContext");
    return { permissionManager, toolManager, createContextSpy };
  }

  it("matches an allow rule against the leaf name and the leaf's own command", async () => {
    const mcp = createMcpManager({ tools: FIVE_TOOLS });
    const { toolManager, createContextSpy } = permissionHarness({
      mcp,
      allowedRules: ["Bash(node --version)"],
    });

    const result = await toolManager.execute(
      TOOL_INVOKE_TOOL_NAME,
      {
        namespace: "builtin",
        tool: "Bash",
        args: { command: "node --version" },
      },
      context(),
    );

    expect(result.success).toBe(true);
    expect(result.content).toMatch(/v\d+\./);
    const [toolName, , , toolInput] = createContextSpy.mock.calls[0];
    expect(toolName).toBe("Bash");
    expect(toolInput).toMatchObject({ command: "node --version" });
    expect(Object.keys(toolInput!)).not.toContain("namespace");
    expect(Object.keys(toolInput!)).not.toContain("tool");
  });

  it("does not treat a rule for one command as a blanket allowance", async () => {
    const mcp = createMcpManager({ tools: FIVE_TOOLS });
    // The allow rule covers `npm test` only. A forwarded call must not ride on
    // it — the rule has to be matched against the leaf's own command, which is
    // the whole reason the namespace wrapper is never what gets checked.
    const canUseToolCallback = vi.fn(async () => ({
      behavior: "deny" as const,
    }));
    const { toolManager, createContextSpy } = permissionHarness({
      mcp,
      allowedRules: ["Bash(npm test)"],
      canUseToolCallback,
    });

    const result = await toolManager.execute(
      TOOL_INVOKE_TOOL_NAME,
      { namespace: "builtin", tool: "Bash", args: { command: "rm -rf /" } },
      context(),
    );

    expect(result.success).toBe(false);
    expect(canUseToolCallback).toHaveBeenCalledTimes(1);
    const [toolName, , , toolInput] = createContextSpy.mock.calls[0];
    expect(toolName).toBe("Bash");
    expect(toolInput).toMatchObject({ command: "rm -rf /" });
    expect(toolName).not.toBe(TOOL_INVOKE_TOOL_NAME);
    expect(toolInput).not.toHaveProperty("namespace");
    expect(toolInput).not.toHaveProperty("tool");
  });

  it("still denies a leaf covered by a deny rule, without executing it", async () => {
    const mcp = createMcpManager({ tools: FIVE_TOOLS });
    const canUseToolCallback = vi.fn(async () => ({
      behavior: "allow" as const,
    }));
    const { toolManager, createContextSpy } = permissionHarness({
      mcp,
      deniedRules: ["Bash(rm *)"],
      canUseToolCallback,
    });

    const result = await toolManager.execute(
      TOOL_INVOKE_TOOL_NAME,
      {
        namespace: "builtin",
        tool: "Bash",
        args: { command: "rm -rf ./deferred-tools-does-not-exist" },
      },
      context(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("denied");
    // Deny wins before the confirmation prompt, and the identity it saw is the
    // leaf's — the outer namespace/tool fields never reach the permission layer.
    expect(canUseToolCallback).not.toHaveBeenCalled();
    const [toolName, , , toolInput] = createContextSpy.mock.calls[0];
    expect(toolName).toBe("Bash");
    expect(toolInput).toMatchObject({
      command: "rm -rf ./deferred-tools-does-not-exist",
    });
  });

  it("rejects a forwarding call outright when ToolInvoke itself is denied", async () => {
    const mcp = createMcpManager({ tools: FIVE_TOOLS });
    const container = createContainer(mcp);
    container.register(
      "PermissionManager",
      new PermissionManager(container, {
        deniedRules: [TOOL_INVOKE_TOOL_NAME],
      }),
    );
    const toolManager = new ToolManager({ container });

    expect(toolManager.getDeferredToolsPlan(workdir)).toBeNull();
    const result = await toolManager.execute(
      TOOL_INVOKE_TOOL_NAME,
      { namespace: "github", tool: "create_issue", args: {} },
      context(),
    );
    expect(result.success).toBe(false);
    expect(mcp.executeMcpToolByRegistry).not.toHaveBeenCalled();
  });
});

describe("ToolManager deferred loading — ToolSearch", () => {
  it("searches the complete catalog and returns catalog notation", async () => {
    const mcp = createMcpManager({ tools: FIVE_TOOLS });
    const toolManager = new ToolManager({
      container: createContainer(mcp),
    });

    const result = await toolManager.execute(
      TOOL_SEARCH_TOOL_NAME,
      { query: "issue" },
      context(),
    );
    expect(result.success).toBe(true);
    expect(result.content).toContain("github.create_issue(");
    expect(result.content).toMatch(/5 of 5/);
  });

  it("bounds its results and points at the next page", async () => {
    const mcp = createMcpManager({ tools: FIVE_TOOLS });
    const toolManager = new ToolManager({
      container: createContainer(mcp),
    });

    const result = await toolManager.execute(
      TOOL_SEARCH_TOOL_NAME,
      { query: "issue", limit: 2 },
      context(),
    );
    expect(result.content).toMatch(/2 of 5/);
    expect(result.content).toContain("offset=2");
  });

  it("explains a miss instead of returning nothing", async () => {
    const mcp = createMcpManager({ tools: FIVE_TOOLS });
    const toolManager = new ToolManager({
      container: createContainer(mcp),
    });

    const result = await toolManager.execute(
      TOOL_SEARCH_TOOL_NAME,
      { query: "nonexistent-capability" },
      context(),
    );
    expect(result.success).toBe(true);
    expect(result.content).toContain(
      'No tools matched "nonexistent-capability"',
    );
    expect(result.content).toContain("shorter or more general keyword");
  });

  it("requires a query and is unavailable while the gate is closed", async () => {
    const mcp = createMcpManager({ tools: FIVE_TOOLS });
    const open = new ToolManager({ container: createContainer(mcp) });
    const noQuery = await open.execute(TOOL_SEARCH_TOOL_NAME, {}, context());
    expect(noQuery.success).toBe(false);
    expect(noQuery.error).toContain("non-empty");

    const closed = new ToolManager({
      container: createContainer(
        createMcpManager({ tools: FIVE_TOOLS.slice(0, 2) }),
      ),
    });
    const unavailable = await closed.execute(
      TOOL_SEARCH_TOOL_NAME,
      { query: "issue" },
      context(),
    );
    expect(unavailable.success).toBe(false);
    expect(declaredNames(closed)).not.toContain(TOOL_SEARCH_TOOL_NAME);
  });
});

describe("ToolManager deferred loading — budget and truncation", () => {
  /** A pool whose entries cannot all fit in the budget below. */
  const WIDE_POOL: McpToolFixture[] = Array.from({ length: 40 }, (_, i) => ({
    server: i < 20 ? "github" : "slack",
    tool: `tool_${String(i).padStart(2, "0")}`,
    parameters: {
      type: "object",
      properties: {
        payload: {
          type: "string",
          description: `Element ${i}; `.repeat(20),
        },
      },
    },
  }));

  it("truncates to the configured budget and says so without naming the budget", () => {
    settings.mockReturnValue({ enabled: true, tokenBudget: 400 });
    const mcp = createMcpManager({ tools: WIDE_POOL });
    const toolManager = new ToolManager({ container: createContainer(mcp) });
    const plan = toolManager.getDeferredToolsPlan(workdir)!;

    expect(plan.totalTools).toBe(40);
    expect(plan.shownTools).toBeLessThan(40);
    expect(plan.tokens).toBeLessThanOrEqual(400);
    const description = toolInvokeDescription(toolManager);
    expect(description).toContain(
      `PARTIAL — ${plan.shownTools} of 40 tools shown`,
    );
    expect(description).toContain(TOOL_SEARCH_TOOL_NAME);
    // The budget number is operational: it stays in host logs.
    expect(description).not.toContain("400");
  });

  it("keeps one representative line per connected namespace when truncating", () => {
    settings.mockReturnValue({ enabled: true, tokenBudget: 200 });
    const mcp = createMcpManager({ tools: WIDE_POOL });
    const toolManager = new ToolManager({ container: createContainer(mcp) });
    const plan = toolManager.getDeferredToolsPlan(workdir)!;

    expect(plan.shownTools).toBeGreaterThan(0);
    const description = toolInvokeDescription(toolManager);
    expect(description).toContain("github: 20 tools");
    expect(description).toContain("slack: 20 tools");
  });

  it("says COMPLETE, and lets search reach what truncation left out", async () => {
    settings.mockReturnValue({ enabled: true, tokenBudget: 400 });
    const mcp = createMcpManager({ tools: WIDE_POOL });
    const toolManager = new ToolManager({ container: createContainer(mcp) });
    const plan = toolManager.getDeferredToolsPlan(workdir)!;

    const hidden = plan.catalog.filter(
      (entry) => !toolInvokeDescription(toolManager).includes(entry.tool),
    );
    expect(hidden.length).toBeGreaterThan(0);
    const found = await toolManager.execute(
      TOOL_SEARCH_TOOL_NAME,
      { query: hidden[0].tool },
      context(),
    );
    expect(found.success).toBe(true);
    expect(found.content).toContain(hidden[0].tool);

    settings.mockReturnValue({
      enabled: true,
      tokenBudget: CATALOG_DEFAULT_BUDGET_TOKENS,
    });
    const roomy = new ToolManager({ container: createContainer(mcp) });
    expect(toolInvokeDescription(roomy)).toContain("COMPLETE — all 40 tools");
  });
});

describe("ToolManager deferred loading — built-in annotation whitelist", () => {
  /**
   * The shipped whitelist. Built-in tools are never deferred by default, so
   * this list is the whole surface of the mechanism for built-ins and every
   * addition has to be argued from the doctrine in
   * `docs/specs/core/tool-deferred-loading.md`.
   */
  const DEFERRED_BUILT_INS = [
    "EnterWorktree",
    "ExitWorktree",
    "WebFetch",
    "Workflow",
  ];

  /**
   * Tools that must never be deferred: task management (the model has to
   * remember it can track work), interaction / mode switches, the hot coding
   * path used every turn, mechanism-coupled tools, and the capability tools
   * whose call is driven by the model rather than by a request.
   */
  const NEVER_DEFER = [
    "TaskCreate",
    "TaskGet",
    "TaskUpdate",
    "TaskList",
    "TaskStop",
    "AskUserQuestion",
    "EnterPlanMode",
    "ExitPlanMode",
    "Read",
    "Edit",
    "Write",
    "Bash",
    "Grep",
    "Glob",
    "Skill",
    "Agent",
    "Artifact",
    "CronCreate",
    "CronDelete",
    "CronList",
    "LSP",
  ];

  function shippedTools(): ToolPlugin[] {
    const toolManager = new ToolManager({
      container: createContainer(createMcpManager({ tools: [] })),
    });
    toolManager.initializeBuiltInTools();
    return toolManager.getTools();
  }

  it("defers exactly the whitelisted built-ins", () => {
    const deferred = shippedTools()
      .filter((tool) => tool.defer === true)
      .map((tool) => tool.name)
      .sort();
    expect(deferred).toEqual([...DEFERRED_BUILT_INS].sort());
  });

  it("leaves every never-defer tool individually declared", () => {
    const shipped = shippedTools();
    const annotated = shipped
      .filter((tool) => NEVER_DEFER.includes(tool.name))
      .filter((tool) => tool.defer === true)
      .map((tool) => tool.name);
    expect(annotated).toEqual([]);
  });

  it("does not let the whitelist re-declare a deferred tool flat", () => {
    // Mutual exclusion from the spec: an annotated tool must never show up both
    // as its own declaration and as a catalog entry.
    const toolManager = new ToolManager({
      container: createContainer(createMcpManager({ tools: FIVE_TOOLS })),
    });
    toolManager.initializeBuiltInTools();
    const names = declaredNames(toolManager);
    expect(names).toContain(TOOL_INVOKE_TOOL_NAME);
    for (const name of DEFERRED_BUILT_INS) {
      expect(names).not.toContain(name);
      expect(toolInvokeDescription(toolManager)).toContain(`builtin.${name}`);
    }
  });
});
