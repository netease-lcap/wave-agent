import { describe, it, expect } from "vitest";
import { ToolManager } from "../../src/managers/toolManager.js";
import type { McpManager } from "../../src/managers/mcpManager.js";
import { Container } from "../../src/utils/container.js";
import { SessionConsumers } from "../../src/services/sessionConsumers.js";
import { SEND_USER_FILE_TOOL_NAME } from "../../src/constants/tools.js";

/**
 * `SendUserFile` 的声明闸（spec `core/session-consumers.md`）：工具**常驻注册表**，
 * 只有"声明给模型的清单"按会话消费者过滤。注册表里拿掉会让历史转录里的调用变成
 * `Tool not found`，所以注册与声明必须分开验。
 */
function makeToolManager(consumers?: SessionConsumers): ToolManager {
  const container = new Container();
  container.register("McpManager", {
    isMcpTool: () => false,
    executeMcpToolByRegistry: () => Promise.resolve(),
    getAllConnectedTools: () => [],
    getToolsConfig: () => [],
    getMcpToolsConfig: () => [],
    getMcpToolPlugins: () => [],
    getMcpToolOutputSchemas: () => ({}),
  } as unknown as McpManager);
  if (consumers) container.register("SessionConsumers", consumers);
  const toolManager = new ToolManager({ container });
  toolManager.initializeBuiltInTools();
  return toolManager;
}

function declared(toolManager: ToolManager): string[] {
  return toolManager.getToolsConfig().map((tool) => tool.function.name);
}

function registered(toolManager: ToolManager): string[] {
  return toolManager.list().map((tool) => tool.name);
}

describe("SendUserFile is declared only where somebody can render it", () => {
  it("withholds it from a terminal-only session, keeping it registered", () => {
    const toolManager = makeToolManager(new SessionConsumers(["terminal"]));
    expect(declared(toolManager)).not.toContain(SEND_USER_FILE_TOOL_NAME);
    // A replayed call from a transcript still has to resolve.
    expect(registered(toolManager)).toContain(SEND_USER_FILE_TOOL_NAME);
  });

  it("withholds it from a session with no surface at all (`wave -p`)", () => {
    expect(declared(makeToolManager(new SessionConsumers([])))).not.toContain(
      SEND_USER_FILE_TOOL_NAME,
    );
  });

  it("declares it to a desktop / IDE session from the first turn", () => {
    for (const base of ["desktop", "vscode"] as const) {
      expect(declared(makeToolManager(new SessionConsumers([base])))).toContain(
        SEND_USER_FILE_TOOL_NAME,
      );
    }
  });

  it("declares it to a terminal session once a page is attached", () => {
    const consumers = new SessionConsumers(["terminal"]);
    const toolManager = makeToolManager(consumers);
    expect(declared(toolManager)).not.toContain(SEND_USER_FILE_TOOL_NAME);

    // The relay layer reports the page; the next turn's list follows.
    consumers.setAttached(["remote-page"]);
    expect(declared(toolManager)).toContain(SEND_USER_FILE_TOOL_NAME);
  });

  it("withholds it when the container carries no consumer state at all", () => {
    // A bare ToolManager (test fixtures, subagent-shaped setups) must not be the
    // one place where an unrenderable call becomes reachable.
    expect(declared(makeToolManager())).not.toContain(SEND_USER_FILE_TOOL_NAME);
  });
});
