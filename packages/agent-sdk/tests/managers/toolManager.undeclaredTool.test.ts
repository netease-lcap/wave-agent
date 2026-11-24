import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolManager } from "../../src/managers/toolManager.js";
import { Container } from "../../src/utils/container.js";
import type { McpManager } from "../../src/managers/mcpManager.js";
import type { ToolContext, ToolPlugin } from "../../src/tools/types.js";

/**
 * The declaration check in `ToolManager.execute`: a `tool_use` naming a tool this
 * request never declared is answered with an error instead of being executed
 * (spec `core/repl-tool.md`「开关把核心文件与 shell 工具也收进 REPL」场景 5).
 *
 * The fixture is the shape that made the bug visible: `Bash` is registered and
 * pooled (so the sandbox can still reach it), the request declared only `REPL`,
 * and the model calls `Bash` flat.
 */
describe("ToolManager undeclared tool call", () => {
  const WORKDIR = "/test/workdir";
  let toolManager: ToolManager;
  let mcpManager: McpManager;
  let bashExecute: ReturnType<typeof vi.fn>;
  let echoExecute: ReturnType<typeof vi.fn>;

  const tool = (
    name: string,
    options: { defer?: boolean; run: ReturnType<typeof vi.fn> },
  ): ToolPlugin =>
    ({
      name,
      defer: options.defer,
      config: {
        type: "function",
        function: { name, description: `${name} description` },
      },
      execute: options.run,
    }) as unknown as ToolPlugin;

  const contextWith = (declared?: string[]): ToolContext =>
    ({
      workdir: WORKDIR,
      sessionId: "session-1",
      ...(declared === undefined
        ? {}
        : { declaredToolNames: new Set(declared) }),
    }) as unknown as ToolContext;

  beforeEach(() => {
    bashExecute = vi.fn().mockResolvedValue({ success: true, content: "ran" });
    echoExecute = vi.fn().mockResolvedValue({ success: true, content: "echo" });
    mcpManager = {
      isMcpTool: vi.fn().mockReturnValue(false),
      getMcpToolPlugins: vi.fn().mockReturnValue([]),
      getMcpToolsConfig: vi.fn().mockReturnValue([]),
      getMcpToolOutputSchemas: vi.fn().mockReturnValue(new Map()),
      executeMcpToolByRegistry: vi.fn(),
    } as unknown as McpManager;

    const container = new Container();
    container.register("McpManager", mcpManager);
    container.register("CurrentWorkdir", WORKDIR);
    container.register("PermissionManager", {
      isToolDenied: vi.fn().mockReturnValue(false),
      getCurrentEffectiveMode: vi
        .fn()
        .mockImplementation((mode) => mode || "default"),
    } as unknown as Record<string, unknown>);
    for (const key of [
      "TaskManager",
      "ReversionManager",
      "BackgroundTaskManager",
      "ForegroundTaskManager",
      "LspManager",
    ]) {
      container.register(key, {} as unknown as Record<string, unknown>);
    }

    toolManager = new ToolManager({ container });
    // `REPL` is registered so the pool is declared at all; `Bash` defers into it,
    // which is what an `enableReplCoreTools` session looks like to this layer.
    toolManager.register(tool("REPL", { run: vi.fn() }));
    toolManager.register(tool("Bash", { defer: true, run: bashExecute }));
    toolManager.register(tool("Echo", { run: echoExecute }));
  });

  it("rejects a flat call of a pooled tool and points at the script form", async () => {
    const result = await toolManager.execute(
      "Bash",
      { command: "echo PROBE" },
      contextWith(["REPL"]),
    );

    expect(result.success).toBe(false);
    expect(result.content).toContain("No such tool available: Bash");
    expect(result.content).toContain("await tools.Bash({...})");
    expect(result.content).toContain("REPL pool");
    // The judgment is about running it, not about the wording: the tool body must
    // not have been reached.
    expect(bashExecute).not.toHaveBeenCalled();
  });

  it("runs the same tool when the request did declare it", async () => {
    const result = await toolManager.execute(
      "Bash",
      { command: "echo PROBE" },
      contextWith(["REPL", "Bash"]),
    );

    expect(result.success).toBe(true);
    expect(bashExecute).toHaveBeenCalledTimes(1);
  });

  it("runs an undeclared tool when the call is not a model's tool_use", async () => {
    // No declaration set: a REPL script's second hop or a host invocation. The
    // sandbox reaches the pool, not `tools[]`, so this must keep working.
    const result = await toolManager.execute(
      "Bash",
      { command: "echo PROBE" },
      contextWith(),
    );

    expect(result.success).toBe(true);
    expect(bashExecute).toHaveBeenCalledTimes(1);
  });

  it("rejects a registered tool the request simply did not declare, without the pool hint", async () => {
    const result = await toolManager.execute("Echo", {}, contextWith(["REPL"]));

    expect(result.success).toBe(false);
    expect(result.content).toContain("No such tool available: Echo");
    expect(result.content).toContain(
      "It is not among the tools available in this request",
    );
    expect(result.content).not.toContain("pool");
    expect(echoExecute).not.toHaveBeenCalled();
  });

  it("rejects an unregistered name as undeclared rather than as a missing tool", async () => {
    const result = await toolManager.execute(
      "Ghost",
      {},
      contextWith(["REPL"]),
    );

    expect(result.success).toBe(false);
    expect(result.content).toContain("No such tool available: Ghost");
    expect(result.error).not.toContain("not found");
  });

  it("rejects a pooled MCP tool called flat, before the MCP funnel", async () => {
    // Hyphenated on purpose: that is the shape the script form has to bracket
    // (`tools.mcp__my-srv__x` would parse as a subtraction).
    const name = "mcp__my-srv__lookup";
    vi.mocked(mcpManager.isMcpTool).mockImplementation(
      (tool: string) => tool === name,
    );
    vi.mocked(mcpManager.getMcpToolPlugins).mockReturnValue([
      tool(name, { run: vi.fn() }),
    ] as unknown as ReturnType<McpManager["getMcpToolPlugins"]>);

    const result = await toolManager.execute(name, {}, contextWith(["REPL"]));

    expect(result.success).toBe(false);
    expect(result.content).toContain(`No such tool available: ${name}`);
    expect(result.content).toContain(`await tools["${name}"]({...})`);
    expect(mcpManager.executeMcpToolByRegistry).not.toHaveBeenCalled();
  });
});
