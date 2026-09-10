/**
 * Real-host integration suite (Part B) — per-pane project settings.
 *
 * `getProjectSettings` / `setBuiltinPluginEnabled` / `getAgentsContent` /
 * `setAgentsContent` are the RPCs whose workdir must follow the *focused pane*
 * (PR #2152/#2155). Here the host runs against the real CLI, so the write can
 * be verified against the real files of each project on disk.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "fs";
import * as path from "path";
import {
  assertNoUnexpectedRejections,
  clearFakeModelEndpoint,
  createRealHost,
  resetRealHostState,
  startFakeModelServer,
  takeUnexpectedRejections,
  useFakeModelEndpoint,
  type FakeModelServer,
  type RealHost,
} from "./realHostHarness";

let ctx: RealHost;
let model: FakeModelServer;
let dirA: string;
let dirB: string;

beforeEach(async () => {
  const dirs = resetRealHostState();
  dirA = dirs.dirA;
  dirB = dirs.dirB;
  model = await startFakeModelServer();
  model.reply("OK");
  // Point the real CLI at the local model server — no real LLM, no network.
  useFakeModelEndpoint(model.baseURL);
  ctx = createRealHost();
  ctx.store.setConfiguration({
    model: "test-model",
    fastModel: "test-model",
  });
});

afterEach(async () => {
  await ctx.close();
  await model.close();
  clearFakeModelEndpoint();
  assertNoUnexpectedRejections();
});

/** pane-1 on dirA plus a second pane on dirB (two projects side by side). */
async function twoPanes(): Promise<string> {
  await ctx.host.handleWebviewMessage({ command: "desktopReady" });
  await ctx.host.handleWebviewMessage({
    command: "desktopSelectRecentWorkdir",
    path: dirA,
    host: "local",
  });
  await ctx.waitFor("setInitialState");
  // A split only makes sense once the first pane holds a conversation
  // (`desktopNewSessionInPane` no-ops on an empty session).
  await ctx.turn("pane-1 首条");

  await ctx.host.handleWebviewMessage({ command: "desktopNewSessionInPane" });
  const panes = await ctx.waitFor("desktopPanes", {
    predicate: (m) => (m.panes as unknown[]).length === 2,
  });
  const pane2 = (panes.panes as Array<{ paneId: string }>).find(
    (p) => p.paneId !== "pane-1",
  )?.paneId as string;

  await ctx.host.handleWebviewMessage({
    command: "desktopSelectRecentWorkdir",
    path: dirB,
    host: "local",
    paneId: pane2,
  });
  await ctx.waitFor("setInitialState", {
    predicate: (m) => m.paneId === pane2,
  });
  return pane2;
}

/** Project settings as the real CLI sees them for one pane. */
async function projectSettings(paneId: string) {
  ctx.clear();
  await ctx.host.handleWebviewMessage({
    command: "getProjectSettings",
    paneId,
  });
  return ctx.waitFor("projectSettings", {
    predicate: (m) => m.paneId === paneId,
  });
}

function projectSettingsFile(dir: string): string {
  return path.join(dir, ".wave", "settings.json");
}

describe("real host · project settings follow the pane's project", () => {
  it("reads each pane's own project settings", async () => {
    const pane2 = await twoPanes();

    const a = await projectSettings("pane-1");
    const b = await projectSettings(pane2);

    expect(a.workdir).toBe(dirA);
    expect(b.workdir).toBe(dirB);
    expect(a.enabledPlugins).toEqual({});
    expect(b.enabledPlugins).toEqual({});
  });

  it("writes the setting into the focused pane's project only", async () => {
    const pane2 = await twoPanes();

    ctx.clear();
    await ctx.host.handleWebviewMessage({
      command: "setBuiltinPluginEnabled",
      paneId: pane2,
      pluginId: "sdd@builtin",
      enabled: true,
      scope: "project",
    });
    const written = await ctx.waitFor("projectSettings", {
      predicate: (m) => m.paneId === pane2,
    });

    expect(written.workdir).toBe(dirB);
    expect(written.enabledPlugins).toEqual({ "sdd@builtin": true });

    // The real project file of the focused pane's project changed…
    expect(
      JSON.parse(readFileSync(projectSettingsFile(dirB), "utf-8")),
    ).toEqual({ enabledPlugins: { "sdd@builtin": true } });
    // …and the other project was left untouched.
    expect(existsSync(projectSettingsFile(dirA))).toBe(false);

    // The other pane still reports its own project's (empty) settings.
    const a = await projectSettings("pane-1");
    expect(a.workdir).toBe(dirA);
    expect(a.enabledPlugins).toEqual({});
  });

  it("keeps both panes usable after the config write recreates their agents", async () => {
    const pane2 = await twoPanes();

    await ctx.host.handleWebviewMessage({
      command: "setBuiltinPluginEnabled",
      paneId: pane2,
      pluginId: "sdd@builtin",
      enabled: true,
      scope: "project",
    });
    await ctx.waitFor("projectSettings", {
      predicate: (m) => m.paneId === pane2,
    });

    // `setBuiltinPluginEnabled` recreates every live agent (destroy +
    // Agent.create with restoreSessionId). Both panes must survive it.
    model.reply("重建后仍可用");
    const first = await ctx.turn("重建后 pane-1 消息");
    const second = await ctx.turn("重建后 pane-2 消息", pane2);

    expect(JSON.stringify(first)).toContain("重建后仍可用");
    expect(JSON.stringify(second)).toContain("重建后仍可用");
    expect(ctx.paneSessionId("pane-1")).toBeTruthy();
    expect(ctx.paneSessionId(pane2)).toBeTruthy();
  });

  /**
   * The settings write is the widest host-side state change there is: it
   * recreates *every* live agent (`updateConfig` → destroy + `Agent.create`),
   * so in-flight RPCs reject with "Session not found" while
   * `backgroundTasksChange` notifications keep arriving. Any host promise
   * without a catch on that path leaks an unhandled rejection — fatal under
   * Node's default policy, and invisible to the unit layer (all RPCs mocked).
   *
   * The invariant asserted here is "the host never leaks": `afterEach` fails on
   * any rejection (no allow-list), and vitest fails the run for unhandled
   * errors. Reverting the `refreshWorkflowRuns` catch turns this suite red
   * ("Session not found: <id>" reaching `process.on("unhandledRejection")`).
   */
  it("does not leak an unhandled rejection when the write recreates the agents", async () => {
    const pane2 = await twoPanes();
    // The recreation does reject an in-flight refresh, and the host now reports
    // it instead of dropping it — silence the expected warning.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Only rejections from here on count.
    takeUnexpectedRejections();

    await ctx.host.handleWebviewMessage({
      command: "setBuiltinPluginEnabled",
      paneId: pane2,
      pluginId: "sdd@builtin",
      enabled: true,
      scope: "project",
    });
    await ctx.waitFor("projectSettings", {
      predicate: (m) => m.paneId === pane2,
    });

    // Both panes go through another full turn, so every rejection the
    // recreation kicked off has resolved by the time we look.
    model.reply("重建后仍可用");
    await ctx.turn("重建后 pane-1 消息");
    await ctx.turn("重建后 pane-2 消息", pane2);

    assertNoUnexpectedRejections();
    warn.mockRestore();
  });

  it("reads and writes project-level AGENTS.md per pane", async () => {
    writeFileSync(path.join(dirA, "AGENTS.md"), "A 项目规则\n", "utf-8");
    const pane2 = await twoPanes();

    ctx.clear();
    await ctx.host.handleWebviewMessage({
      command: "getAgentsContent",
      scope: "project",
      paneId: "pane-1",
    });
    const read = await ctx.waitFor("agentsContentResponse", {
      predicate: (m) => m.scope === "project",
    });
    expect(read.content).toBe("A 项目规则\n");

    // Save from the *other* pane → the other project's file.
    ctx.clear();
    await ctx.host.handleWebviewMessage({
      command: "setAgentsContent",
      scope: "project",
      paneId: pane2,
      content: "B 项目规则\n",
    });
    await ctx.waitFor("agentsContentSaved", {
      predicate: (m) => m.scope === "project",
    });

    expect(readFileSync(path.join(dirB, "AGENTS.md"), "utf-8")).toBe(
      "B 项目规则\n",
    );
    expect(readFileSync(path.join(dirA, "AGENTS.md"), "utf-8")).toBe(
      "A 项目规则\n",
    );
    expect(
      ctx
        .of("showToast")
        .some((m) => JSON.stringify(m.toast).includes("保存成功")),
    ).toBe(true);

    // Read back through the same pane — the CLI serves the project file.
    ctx.clear();
    await ctx.host.handleWebviewMessage({
      command: "getAgentsContent",
      scope: "project",
      paneId: pane2,
    });
    const reread = await ctx.waitFor("agentsContentResponse", {
      predicate: (m) => m.scope === "project",
    });
    expect(reread.content).toBe("B 项目规则\n");
  });
});
