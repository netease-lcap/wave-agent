import { describe, expect, it } from "vitest";
import {
  fixtures,
  fixtureSession,
  fixtureConfirmation,
  fixtureQueuedMessage,
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
    // Untagged variant is what plugin hosts send.
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

  it("remoteControlResponse defaults to a connected link, attributed by requestId", () => {
    const msg = fixtures.remoteControlResponse("rc1");
    expect(msg).toMatchObject({
      command: "remoteControlResponse",
      requestId: "rc1",
      snapshot: {
        state: "online",
        pageUrl: "https://relay.example/remote/?host=h1",
      },
    });
    // 失败形态走 error，快照缺席（宿主 RPC 失败时不许伪造 state 快照）。
    const failure = fixtures.remoteControlResponse("rc2", {
      snapshot: undefined,
      error: "Remote control is not enabled on this process",
    });
    expect(failure.snapshot).toBeUndefined();
    expect(failure.error).toBeTruthy();
  });

  it("earlierMessages 默认「到头了」，按 requestId 归属", () => {
    const msg = fixtures.earlierMessages([], "p1");
    expect(msg).toMatchObject({
      command: "earlierMessages",
      requestId: "p1",
      messages: [],
      hasMore: false,
    });
    // 锚点失效是显式信号：页据它重定位，而不是把一次空页当成「到底」。
    expect(msg.anchorLost).toBeUndefined();
    expect(
      fixtures.earlierMessages([], "p2", { anchorLost: true }).anchorLost,
    ).toBe(true);
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
  });
});
