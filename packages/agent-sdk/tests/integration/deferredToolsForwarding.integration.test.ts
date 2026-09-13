/**
 * End-to-end forwarding check on a real stdio MCP server.
 *
 * The unit suite pins the mechanism against fakes. This file closes the
 * admission-gate fidelity debt of PR-1: the catalog the model reads is built from
 * a live server's `tools/list`, the forwarded call goes through the real
 * `McpManager` connection, and the judgement comes from the server itself —
 * `scripts/catalog-proxy-probe/server.mjs` validates every argument object
 * against the tool's schema and rejects it with a machine-readable error code, so
 * "the arguments built from the compact signature were accepted" is decidable
 * without trusting a model.
 *
 * The server is the probe fixture (three complexity tiers: simple scalars /
 * nested object with enums and defaults / nested arrays of objects).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Container } from "@/utils/container.js";
import { McpManager } from "@/managers/mcpManager.js";
import { PermissionManager } from "@/managers/permissionManager.js";
import { ToolManager } from "@/managers/toolManager.js";
import { readTool } from "@/tools/readTool.js";
import {
  TOOL_INVOKE_TOOL_NAME,
  TOOL_SEARCH_TOOL_NAME,
} from "@/tools/deferredTools.js";
import { CATALOG_DEFAULT_BUDGET_TOKENS } from "@/utils/toolCatalog.js";
import type { ToolContext } from "@/tools/types.js";

// The settings switch a user would set. Kept a mock so the test does not depend
// on any real settings.json on the machine; everything else is the real stack.
vi.mock("@/services/deferredToolsAvailability.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/services/deferredToolsAvailability.js")
  >()),
  readDeferredToolsSettings: vi.fn(() => ({
    enabled: true,
    tokenBudget: CATALOG_DEFAULT_BUDGET_TOKENS,
  })),
}));

const here = dirname(fileURLToPath(import.meta.url));
const PROBE_SERVER = resolve(
  here,
  "../../../../scripts/catalog-proxy-probe/server.mjs",
);
const workdir = process.cwd();

describe("deferred loading over a real stdio MCP server", () => {
  let container: Container;
  let mcpManager: McpManager;
  let toolManager: ToolManager;

  beforeAll(async () => {
    container = new Container();
    container.register("Workdir", workdir);
    container.register("TaskManager", {});
    container.register("ReversionManager", {});
    container.register("BackgroundTaskManager", {});
    container.register("ForegroundTaskManager", {
      registerForegroundTask: vi.fn(),
      unregisterForegroundTask: vi.fn(),
    });
    container.register("LspManager", {});
    container.register(
      "PermissionManager",
      new PermissionManager(container, {
        configuredPermissionMode: "bypassPermissions",
      }),
    );

    mcpManager = new McpManager(container, {
      mcpServers: {
        probe: {
          command: process.execPath,
          args: [PROBE_SERVER],
          env: { PROBE_DESC_LANG: "en" },
        },
      },
    });
    container.register("McpManager", mcpManager);
    await mcpManager.initialize(workdir, false);
    const connected = await mcpManager.connectServer("probe");
    expect(connected).toBe(true);

    toolManager = new ToolManager({
      container,
      customTools: [
        // Read is never deferred by the shipped whitelist. Annotating it here is
        // what lets the built-in leg of the forwarding path run against a real
        // shipped tool; the whitelisted built-ins all have side effects
        // (worktrees, network, subagents) that a test must not trigger.
        { ...readTool, defer: true },
      ],
    });
    toolManager.initializeBuiltInTools();
  }, 30_000);

  afterAll(async () => {
    await mcpManager?.cleanup();
  });

  const context = (): ToolContext => ({ workdir }) as ToolContext;

  function declared(): string[] {
    return toolManager
      .getToolsConfig({ workdir })
      .map((tool) => tool.function.name);
  }

  function catalogText(): string {
    const config = toolManager
      .getToolsConfig({ workdir })
      .find((tool) => tool.function.name === TOOL_INVOKE_TOOL_NAME);
    expect(config).toBeDefined();
    return config!.function.description ?? "";
  }

  it("builds the catalog from the live server and hides its tools", () => {
    const names = declared();
    expect(names).toContain(TOOL_INVOKE_TOOL_NAME);
    expect(names).toContain(TOOL_SEARCH_TOOL_NAME);
    expect(names).not.toContain("mcp__probe__simple_report");
    expect(names).not.toContain("mcp__probe__build_pipeline");

    const catalog = catalogText();
    expect(catalog).toContain("probe.simple_report(");
    expect(catalog).toContain("probe.compose_config(");
    expect(catalog).toContain("probe.build_pipeline(");
    expect(catalog).toContain("probe: 3 tools");
    expect(catalog).toContain("COMPLETE — all");
    // The information the complex tier needs to be callable without its schema:
    // the enums and defaults are what make the first-try call above possible.
    expect(catalog).toContain('kind: "build"|"test"|"deploy"|"rollback"');
    expect(catalog).toContain('env: "dev"|"staging"|"prod"');
    expect(catalog).toContain('"email"|"im"|"webhook"');
    expect(catalog).toContain('="warn"');
    // Past the renderer's depth limit the entry degrades explicitly instead of
    // pretending to be complete, and the 400-token description clip applies to
    // the ~1.5k-character description.
    expect(catalog).toContain("[parameters: nested structure omitted");
    expect(catalog).not.toContain(
      "the same call may be repeated safely after a network timeout.",
    );
  });

  it("forwards a complex-schema call the server accepts first try", async () => {
    // Arguments built from the compact signature alone — the three stage kinds
    // and the environment ladder are enums in the schema, so a wrong guess is
    // rejected by the server rather than silently coerced.
    const result = await toolManager.execute(
      TOOL_INVOKE_TOOL_NAME,
      {
        namespace: "probe",
        tool: "build_pipeline",
        args: {
          artifactName: "release-check.tar.gz",
          pipeline: {
            stages: [
              { id: "build", kind: "build", env: "dev" },
              { id: "test", kind: "test", env: "staging" },
            ],
          },
          notify: { channels: ["im"] },
        },
      },
      context(),
    );

    expect(result.success).toBe(true);
    const payload = JSON.parse(result.content) as {
      ok: boolean;
      tool: string;
      accepted: Record<string, unknown>;
    };
    expect(payload.ok).toBe(true);
    expect(payload.tool).toBe("build_pipeline");
    expect(payload.accepted).toMatchObject({
      artifactName: "release-check.tar.gz",
      notify: { channels: ["im"], level: "warn" },
    });
  });

  it("forwards the nested-object tier with its defaults applied", async () => {
    const result = await toolManager.execute(
      TOOL_INVOKE_TOOL_NAME,
      {
        namespace: "probe",
        tool: "compose_config",
        args: {
          name: "web-gateway",
          target: { os: "macos", arch: "arm64" },
        },
      },
      context(),
    );

    expect(result.success).toBe(true);
    const payload = JSON.parse(result.content) as {
      accepted: { target: Record<string, unknown> };
    };
    expect(payload.accepted.target).toMatchObject({
      os: "macos",
      arch: "arm64",
      retries: 3,
    });
  });

  it("forwards a real built-in leaf through the same mechanism", async () => {
    const result = await toolManager.execute(
      TOOL_INVOKE_TOOL_NAME,
      {
        namespace: "builtin",
        tool: "Read",
        args: { file_path: PROBE_SERVER },
      },
      context(),
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("catalog-proxy-probe");
    expect(result.content).toContain("tools/call");
  });

  it("lets the server, not the client, reject bad arguments", async () => {
    const result = await toolManager.execute(
      TOOL_INVOKE_TOOL_NAME,
      {
        namespace: "probe",
        tool: "simple_report",
        args: { title: "monthly inspection", count: 5000, enabled: true },
      },
      context(),
    );

    // The machine-readable code comes from the fixture's own validator, which
    // proves the client did not pre-validate or rewrite `args`.
    const rejection = JSON.parse(result.content) as {
      error: string;
      code: string;
      path: string;
    };
    expect(rejection.error).toBe("INVALID_ARGUMENTS");
    expect(rejection.path).toContain("count");
    // Note: `success` stays true here because the MCP layer does not currently
    // map a leaf's `isError` result onto it — pre-existing behaviour, identical
    // for flat declarations, deliberately untouched by this change.
    expect(result.error).toBeUndefined();
  });

  it("refuses a leaf that is not in the live catalog", async () => {
    const result = await toolManager.execute(
      TOOL_INVOKE_TOOL_NAME,
      { namespace: "probe", tool: "drop_database", args: {} },
      context(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown tool "drop_database"');
    expect(result.error).toContain("simple_report");
  });

  it("finds a truncated-away-looking target by search, then calls it", async () => {
    const found = await toolManager.execute(
      TOOL_SEARCH_TOOL_NAME,
      { query: "pipeline" },
      context(),
    );
    expect(found.success).toBe(true);
    expect(found.content).toContain("probe.build_pipeline(");

    const called = await toolManager.execute(
      TOOL_INVOKE_TOOL_NAME,
      {
        namespace: "probe",
        tool: "simple_report",
        args: { title: "月度巡检", count: 12, enabled: true },
      },
      context(),
    );
    expect(called.success).toBe(true);
  });
});
