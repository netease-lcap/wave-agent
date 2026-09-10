/**
 * Real-host integration suite (Part B) — session lifecycle.
 *
 * Every case drives the real DesktopHost against a real `wave --stdio` child
 * process and a real local model server, so it covers the cross-process seams
 * the webview e2e layer (mock host) cannot: JSON-RPC round trips, transcript
 * files on disk, and host↔CLI state convergence.
 *
 * Regressions guarded here (the webview-side halves live in `packages/webview/e2e`):
 *  - session restore from a real transcript, including a truncated tail (#2137)
 *  - deleting a session must not be revived by the Ctrl+Tab cycle (#2150)
 *  - multi-pane / multi-project sessions stay isolated (FR-031/FR-020)
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import {
  assertNoUnexpectedRejections,
  createRealHost,
  projectDir,
  resetRealHostState,
  startFakeModelServer,
  transcriptFiles,
  truncateTranscriptTail,
  type FakeModelServer,
  type RealHost,
} from "./realHostHarness";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let ctx: RealHost;
let model: FakeModelServer;
let dirA: string;
let dirB: string;

beforeEach(async () => {
  const dirs = resetRealHostState();
  dirA = dirs.dirA;
  dirB = dirs.dirB;
  model = await startFakeModelServer();
  model.reply("回复：A-OK");
  ctx = createRealHost();
  // Point the real CLI at the local model server — no real LLM, no network.
  ctx.store.setConfiguration({
    apiKey: "test-key",
    baseURL: model.baseURL,
    model: "test-model",
    fastModel: "test-model",
  });
});

afterEach(async () => {
  await ctx.close();
  await model.close();
  assertNoUnexpectedRejections();
});

/** `desktopReady` → pick a workdir → first real session bound to the pane. */
async function openProject(dir: string): Promise<void> {
  await ctx.host.handleWebviewMessage({ command: "desktopReady" });
  await ctx.host.handleWebviewMessage({
    command: "desktopSelectRecentWorkdir",
    path: dir,
    host: "local",
  });
  await ctx.waitFor("setInitialState");
}

describe("real host · session lifecycle", () => {
  it("boots the CLI and binds a real session to the pane", async () => {
    await ctx.host.handleWebviewMessage({ command: "desktopReady" });

    // One unbound pane, no workdir — the launch placeholder.
    expect(ctx.of("desktopPanes")).toHaveLength(1);
    expect(ctx.paneSessionId()).toBeUndefined();
    expect(ctx.last("desktopWorkdirState")?.workdir).toBeUndefined();

    await ctx.host.handleWebviewMessage({
      command: "desktopSelectRecentWorkdir",
      path: dirA,
      host: "local",
    });
    const state = await ctx.waitFor("setInitialState");
    const sessionId = (state.session as { id: string }).id;

    // The sessionId and workdir are the real CLI's answers to `initialize`.
    expect(sessionId).toMatch(UUID);
    expect(state.workdir).toBe(dirA);
    expect(state.messages).toEqual([]);
    expect(state.isAuthenticated).toBe(false);
    expect(ctx.paneSessionId()).toBe(sessionId);
  });

  it("runs a real turn: CLI → model HTTP → streamed reply → transcript on disk", async () => {
    await openProject(dirA);
    model.reply("这是真实回复。");

    await ctx.turn("你好");

    // The user message and the streamed assistant reply reached the webview.
    const userPushes = ctx
      .of("appendMessage")
      .filter((m) => (m.message as { role?: string }).role === "user");
    expect(userPushes).toHaveLength(1);
    expect(JSON.stringify(userPushes[0].message)).toContain("你好");
    expect(ctx.streamedText()).toContain("这是真实回复。");
    expect(ctx.of("endStreaming").length).toBeGreaterThan(0);

    // The model received the user text (the request really left the process).
    expect(model.sawRequest("你好")).toBe(true);

    // …and the turn was flushed to a real transcript file.
    const files = transcriptFiles(dirA);
    expect(files).toHaveLength(1);
    const lines = readFileSync(files[0], "utf-8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines[0]).toMatchObject({ type: "metadata", workdir: dirA });
    const turns = lines.filter((l) => l.role);
    expect(turns.map((l) => l.role)).toEqual(["user", "assistant"]);
    expect(JSON.stringify(turns[0])).toContain("你好");
    expect(JSON.stringify(turns[1])).toContain("这是真实回复。");

    // The sidebar entry is derived from the real transcript's first message.
    const mine = ctx.tree().find((s) => s.sessionId === ctx.paneSessionId());
    expect(mine).toMatchObject({ title: "你好", workdir: dirA });
  });

  it("restores a historical session's context from its transcript", async () => {
    await openProject(dirA);
    await ctx.turn("第一条");
    const firstId = ctx.paneSessionId() as string;

    await ctx.host.handleWebviewMessage({ command: "newSession" });
    await ctx.waitFor("setInitialState", {
      predicate: (m) => (m.session as { id?: string }).id !== firstId,
    });
    await ctx.turn("第二条");
    const secondId = ctx.paneSessionId() as string;
    expect(secondId).not.toBe(firstId);
    expect(ctx.tree().map((s) => s.sessionId)).toEqual([secondId, firstId]);

    // Switch back: the host spawns a fresh agent + real `restoreSession` RPC.
    ctx.clear();
    await ctx.host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: dirA,
      sessionId: firstId,
    });
    const restored = await ctx.waitFor("setInitialState", {
      predicate: (m) => (m.session as { id?: string }).id === firstId,
    });

    expect(ctx.paneSessionId()).toBe(firstId);
    const restoredMessages = JSON.stringify(restored.messages);
    expect(restoredMessages).toContain("第一条");
    expect(restoredMessages).toContain("回复：A-OK");
    expect(restoredMessages).not.toContain("第二条");
  });

  it("recovers a session whose transcript tail was cut off by a kill (#2137)", async () => {
    await openProject(dirA);
    await ctx.turn("截断前的消息");
    const id = ctx.paneSessionId() as string;

    // A new session to switch away to, then simulate a killed append (no
    // trailing newline, unparseable last line).
    await ctx.host.handleWebviewMessage({ command: "newSession" });
    await ctx.waitFor("setInitialState", {
      predicate: (m) => (m.session as { id?: string }).id !== id,
    });
    truncateTranscriptTail(dirA);

    ctx.clear();
    await ctx.host.handleWebviewMessage({
      command: "desktopSelectSession",
      workdir: dirA,
      sessionId: id,
    });
    const restored = await ctx.waitFor("setInitialState", {
      predicate: (m) => (m.session as { id?: string }).id === id,
    });

    // The truncated tail is dropped, the readable history survives — the
    // session is NOT reported as missing.
    expect(JSON.stringify(restored.messages)).toContain("截断前的消息");
    expect(ctx.store.getSessionIndex().some((e) => e.sessionId === id)).toBe(
      true,
    );
    expect(
      ctx
        .of("showToast")
        .some((m) => JSON.stringify(m.toast).includes("加载失败")),
    ).toBe(false);
  });

  it("never revives a deleted session through the Ctrl+Tab cycle (#2150)", async () => {
    await openProject(dirA);
    await ctx.turn("会话一");
    const firstId = ctx.paneSessionId() as string;

    await ctx.host.handleWebviewMessage({ command: "newSession" });
    await ctx.waitFor("setInitialState", {
      predicate: (m) => (m.session as { id?: string }).id !== firstId,
    });
    await ctx.turn("会话二");
    const secondId = ctx.paneSessionId() as string;

    // Ctrl+Tab / Ctrl+Shift+Tab are Electron menu accelerators wired straight
    // to the host — not reachable from the webview harness.
    await ctx.host.activateAdjacentSession(1);
    await ctx.waitFor("setInitialState", {
      predicate: (m) => (m.session as { id?: string }).id === firstId,
    });
    expect(ctx.paneSessionId()).toBe(firstId);

    // Delete the session the frozen cycle order would return next…
    ctx.clear();
    await ctx.host.handleWebviewMessage({
      command: "desktopDeleteSession",
      sessionId: firstId,
    });
    await ctx.waitFor("desktopSessionTree", {
      predicate: (m) => !JSON.stringify(m.groups).includes(firstId),
    });
    expect(
      ctx.store.getSessionIndex().some((e) => e.sessionId === firstId),
    ).toBe(false);

    // …and press again: the deleted session must never come back.
    await ctx.host.activateAdjacentSession(1);
    await new Promise((r) => setTimeout(r, 1_500));
    expect(ctx.paneSessionId()).not.toBe(firstId);
    expect(JSON.stringify(ctx.messages)).not.toContain(firstId);
    expect(
      ctx.store.getSessionIndex().some((e) => e.sessionId === firstId),
    ).toBe(false);
    expect(ctx.paneSessionId()).toBe(secondId);
  });

  it("keeps two panes on different projects isolated", async () => {
    await openProject(dirA);
    const turnA = await ctx.turn("A 项目消息");
    const idA = ctx.paneSessionId() as string;
    expect(JSON.stringify(turnA)).toContain("A 项目消息");

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
    model.reply("B-REPLY");
    const turnB = await ctx.turn("B 项目消息", pane2);
    const idB = ctx.paneSessionId(pane2) as string;
    expect(JSON.stringify(turnB)).toContain("B-REPLY");

    // Two projects, two transcripts, two independent sessions.
    expect(idA).not.toBe(idB);
    expect(projectDir(dirA)).not.toBe(projectDir(dirB));
    expect(transcriptFiles(dirA)).toHaveLength(1);
    expect(transcriptFiles(dirB)).toHaveLength(1);
    expect(readFileSync(transcriptFiles(dirA)[0], "utf-8")).not.toContain(
      "B 项目消息",
    );
    expect(readFileSync(transcriptFiles(dirB)[0], "utf-8")).toContain(
      "B 项目消息",
    );
    // The second pane's turn touched only its own pane.
    expect(
      turnB.every((m) => m.paneId === undefined || m.paneId === pane2),
    ).toBe(true);

    // Focusing the other pane does not touch the first pane's binding.
    ctx.clear();
    await ctx.host.handleWebviewMessage({
      command: "desktopFocusPane",
      paneId: "pane-1",
    });
    await ctx.waitFor("desktopPanes", {
      predicate: (m) => m.focusedPaneId === "pane-1",
    });
    expect(ctx.paneSessionId("pane-1")).toBe(idA);
    expect(ctx.paneSessionId(pane2)).toBe(idB);
  });
});
