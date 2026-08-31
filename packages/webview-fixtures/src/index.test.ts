import { describe, expect, it } from "vitest";
import {
  fixtures,
  fixtureSession,
  fixtureConfirmation,
  fixtureQueuedMessage,
  fixtureConfig,
} from "./index.js";

describe("fixtures factory", () => {
  it("setInitialState carries the contract anchors hosts must always send", () => {
    const msg = fixtures.setInitialState();
    expect(msg.command).toBe("setInitialState");
    // Desktop host always sends inputContent ('' when no draft); a gate that
    // stops asserting it would let the input-flush regression pass silently.
    expect(msg.inputContent).toBe("");
    expect(msg.isAuthenticated).toBe(true);
    expect(msg.sessions).toEqual([]);
    expect(msg.messages).toEqual([]);
    expect(msg.tasks).toEqual([]);
    expect(msg.backgroundTasks).toEqual([]);
    expect(msg.workflowRuns).toEqual([]);
    expect(msg.pendingConfirmations).toEqual([]);
    expect(msg.queuedMessages).toEqual([]);
    expect(msg.isStreaming).toBe(false);
  });

  it("overrides win over defaults", () => {
    const msg = fixtures.setInitialState({
      inputContent: "draft",
      isAuthenticated: false,
    });
    expect(msg.inputContent).toBe("draft");
    expect(msg.isAuthenticated).toBe(false);
  });

  it("authStatusResponse defaults to authenticated", () => {
    expect(fixtures.authStatusResponse()).toMatchObject({
      command: "authStatusResponse",
      isAuthenticated: true,
    });
  });

  it("pane-scoped commands accept an optional paneId", () => {
    const msg = fixtures.updateMessages([], { paneId: "pane-1" });
    expect(msg.paneId).toBe("pane-1");
    // Untagged variant is what IDE hosts send.
    expect(fixtures.updateMessages([]).paneId).toBeUndefined();
  });

  it("desktop commands default to empty state", () => {
    expect(fixtures.desktopPanes()).toMatchObject({
      command: "desktopPanes",
      panes: [],
    });
    expect(fixtures.desktopSessionTree()).toMatchObject({
      command: "desktopSessionTree",
      groups: [],
    });
    expect(fixtures.desktopWorkdirState()).toMatchObject({
      command: "desktopWorkdirState",
      host: "local",
      hosts: ["local"],
      recentWorkdirs: [],
    });
  });

  it("host reply fixtures pass through their payloads verbatim", () => {
    const servers = [{ name: "server-a" }];
    expect(fixtures.mcpServersResponse(servers)).toMatchObject({
      command: "mcpServersResponse",
      servers,
    });
    const configs = [{ name: "Explore", scope: "builtin" }];
    expect(fixtures.subagentConfigurationsResponse(configs)).toMatchObject({
      command: "subagentConfigurationsResponse",
      configurations: configs,
    });
    const hooks = { PreToolUse: [{ matcher: "Write", hooks: [] }] };
    expect(fixtures.hooksResponse(hooks)).toMatchObject({
      command: "hooksResponse",
      hooks,
    });
    expect(
      fixtures.mcpConfigPathsResponse("/tmp/u.json", "/tmp/p.json"),
    ).toMatchObject({
      command: "mcpConfigPathsResponse",
      userPath: "/tmp/u.json",
      projectPath: "/tmp/p.json",
    });
  });

  it("nested value helpers carry realistic defaults", () => {
    expect(fixtureSession().id).toBe("test-session");
    expect(fixtureConfirmation()).toMatchObject({
      confirmationId: "confirm-1",
      toolName: "Bash",
    });
    expect(fixtureQueuedMessage("hi")).toMatchObject({
      content: "hi",
      type: "message",
    });
    expect(fixtureConfig().model).toBe("glm-5.2");
  });
});
