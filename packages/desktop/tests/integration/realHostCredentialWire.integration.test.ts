/**
 * Real-host integration suite (PR-1) — the credential pipeline is gone from the
 * wire.
 *
 * `WAVE_CLI_PATH` points at `fixtures/stdioTee.cjs`, a transparent proxy that
 * forwards stdin/stdout/stderr to the *real* `wave --stdio` CLI untouched and
 * records both directions as JSONL. The assertions therefore read the real
 * host→CLI JSON-RPC payloads instead of mock expectations: the unit layer can
 * only prove "the host did not pass a field to the mocked client", this layer
 * proves the field never reaches the process.
 *
 * Guarded regressions:
 *  - `initialize` / `updateConfig` / `sendMessage` params carrying
 *    apiKey / baseURL / defaultHeaders (the removed host-side user-config
 *    pipeline — spec sso-auth 边界情况「IDE 宿主不再有直连免登录旁路」).
 *  - the CLI still reaches the gateway through the *supported* channel
 *    (`WAVE_API_KEY` / `WAVE_BASE_URL` env) once the host stops forwarding
 *    credentials, i.e. removing the pipeline did not break local runs.
 *  - an unauthenticated host reports `isAuthenticated: false` and cannot
 *    silently complete a turn without credentials.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  REALHOST_ROOT,
  assertNoUnexpectedRejections,
  clearFakeModelEndpoint,
  createRealHost,
  resetRealHostState,
  startFakeModelServer,
  useFakeModelEndpoint,
  type FakeModelServer,
  type RealHost,
} from "./realHostHarness";

/** Transparent stdio proxy — see the file header for the log format. */
const TEE_SCRIPT = path.resolve(
  process.cwd(),
  "tests/integration/fixtures/stdioTee.cjs",
);
/** The workspace CLI the tee forwards to (same target as the vitest env). */
const REAL_CLI = path.resolve(process.cwd(), "../code/bin/wave-code.js");
const WIRE_LOG = path.join(REALHOST_ROOT, "stdio-wire.jsonl");

/** Credential keys the host must never put on the wire again. */
const CREDENTIAL_KEYS = ["apiKey", "baseURL", "defaultHeaders"];

interface WireLine {
  dir: "req" | "res";
  line?: { method?: string; params?: unknown; result?: unknown };
  raw?: string;
}

/** Every recorded line, both directions, parsed. */
function readWire(): WireLine[] {
  if (!fs.existsSync(WIRE_LOG)) {
    throw new Error(
      `No stdio wire log at ${WIRE_LOG} — the tee did not run (WAVE_CLI_PATH was not honoured?)`,
    );
  }
  return fs
    .readFileSync(WIRE_LOG, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as WireLine);
}

/** Host→CLI requests, in order. */
function requests(wire: WireLine[]) {
  return wire
    .filter((w) => w.dir === "req")
    .map((w) => w.line as { method?: string; params?: unknown });
}

let ctx: RealHost;
let model: FakeModelServer;
let dirA: string;

beforeAll(() => {
  expect(fs.existsSync(TEE_SCRIPT)).toBe(true);
  expect(fs.existsSync(REAL_CLI)).toBe(true);
  // Route the host through the tee *before* the first agent spawns (the
  // resolver memoizes the path inside this test file's module registry).
  process.env.WAVE_CLI_PATH = TEE_SCRIPT;
  process.env.WAVE_STDIO_TEE_LOG = WIRE_LOG;
  process.env.WAVE_STDIO_TEE_CLI = REAL_CLI;
});

beforeEach(async () => {
  dirA = resetRealHostState().dirA;
  model = await startFakeModelServer();
  model.reply("回复：A-OK");
  // Credentials reach the CLI the supported way: process env, not the host
  // payload (`StdioClient` merges `process.env` into the child env).
  useFakeModelEndpoint(model.baseURL);
  ctx = createRealHost();
  ctx.store.setConfiguration({ model: "test-model", fastModel: "test-model" });
});

afterEach(async () => {
  await ctx.close();
  await model.close();
  clearFakeModelEndpoint();
  assertNoUnexpectedRejections();
});

async function openProject(dir: string): Promise<void> {
  await ctx.host.handleWebviewMessage({ command: "desktopReady" });
  await ctx.host.handleWebviewMessage({
    command: "desktopSelectRecentWorkdir",
    path: dir,
    host: "local",
  });
  await ctx.waitFor("setInitialState");
}

describe("real host · 凭据链路下线后的真实 stdio 报文", () => {
  it("initialize / updateConfig / sendMessage 报文里没有 apiKey / baseURL / defaultHeaders", async () => {
    await openProject(dirA);
    await ctx.turn("你好");

    // Save from the settings page: in PR-1 the host still forwards the config
    // to the live agents (the hot-reload rewrite is PR-2) — only the credential
    // fields must be gone.
    //
    // PR-2 note: once user preferences go straight to `~/.wave/settings.json`
    // (no `updateConfig` at all), this `updateConfig` anchor and the "params
    // still carry en-US" assertion below must move to the PR-2 save-path test
    // (`initialize` / `sendMessage` stay as the non-vacuity anchors here).
    ctx.clear();
    await ctx.host.handleWebviewMessage({
      command: "updateConfiguration",
      configurationData: { model: "test-model", language: "en-US" },
    });
    await ctx.waitFor("configurationResponse", {
      predicate: (m) =>
        (m.configurationData as { language?: string })?.language === "en-US",
    });

    const reqs = requests(readWire());
    const methods = reqs.map((r) => r.method);
    // Non-vacuous: the tee really captured the host→CLI direction of all three
    // request families this PR touches.
    expect(methods).toContain("initialize");
    expect(methods).toContain("updateConfig");
    expect(methods).toContain("sendMessage");

    // …and none of them carries a credential field.
    const offenders = reqs
      .map((r) => JSON.stringify(r))
      .filter((json) => CREDENTIAL_KEYS.some((k) => json.includes(k)));
    expect(offenders).toEqual([]);

    // The one config request that DID go out still carries the non-credential
    // keys, so the assertion above is not "we sent nothing".
    const updateConfig = reqs.find((r) => r.method === "updateConfig");
    expect(JSON.stringify(updateConfig?.params)).toContain("en-US");

    // The CLI's own answers never mention the credential keys either (this is
    // what would come back to the webview as configurationData).
    const responses = readWire()
      .filter((w) => w.dir === "res")
      .map((w) => JSON.stringify(w.line ?? {}));
    expect(
      responses.filter((json) => CREDENTIAL_KEYS.some((k) => json.includes(k))),
    ).toEqual([]);
  });

  it("宿主不再转发凭据后，CLI 仍能经 WAVE_API_KEY / WAVE_BASE_URL 打通模型", async () => {
    await openProject(dirA);
    await ctx.turn("走 env 通道");

    // A full turn completed: the request really left the process to the fake
    // model server, i.e. removing the host-side pipeline did not break the
    // supported (env / SSO / 企业下发) configuration channels.
    expect(model.sawRequest("走 env 通道")).toBe(true);
    expect(ctx.streamedText()).toContain("回复：A-OK");
  });

  it("未登录时宿主如实回带未登录（webview 据此禁用发送入口），且不发模型请求", async () => {
    // No SSO token (throwaway HOME has no auth.json), no WAVE_API_KEY /
    // WAVE_BASE_URL, no 企业下发.
    clearFakeModelEndpoint();

    await openProject(dirA);

    // The host's own state is honest — nothing in the removed pipeline can
    // pretend the user is authenticated. These two fields are exactly what the
    // webview's send-entry gate reads (ChatApp derives
    // `disabled`/`data-placeholder` from `setInitialState.isAuthenticated`),
    // so pinning them here is what makes the UI gate meaningful on a real
    // machine — the gate itself is asserted at the webview layer
    // (packages/webview/e2e/desktop-unauthenticated-input-disabled.e2e.ts and
    // tests/webview/unauthenticatedInputDisabled.test.tsx).
    expect(ctx.last("setInitialState")?.isAuthenticated).toBe(false);
    expect(ctx.last("desktopAccountInfo")?.isAuthenticated).toBe(false);

    // …and the wire carries no credential the CLI could silently use.
    const reqs = requests(readWire());
    expect(reqs.map((r) => r.method)).toContain("initialize");
    expect(
      reqs
        .map((r) => JSON.stringify(r))
        .filter((json) => CREDENTIAL_KEYS.some((k) => json.includes(k))),
    ).toEqual([]);

    // 绕过 UI 直接让宿主发一轮：未登录时不得调用模型（入口禁用之外的第二道事实——
    // 即使有人绕过置灰的输入框，也不会白跑通）。用户消息被回显进 pane，但本地模型
    // 服务端收不到任何请求，也永远不会有回复 / 流结束。
    ctx.clear();
    // Fire-and-forget on purpose: without credentials the RPC never settles
    // (observed: still pending after 60s, no error surfaced), so awaiting it
    // would only hang. `afterEach`'s dispose rejects it — the
    // "[DesktopHost] 发送消息失败" stderr line in this test's output is that
    // expected teardown, not a failure (the pending RPC is what makes the
    // absence of a reply observable).
    void ctx.host
      .handleWebviewMessage({ command: "sendMessage", text: "无凭据" })
      .catch(() => {});
    await ctx.waitFor("startStreaming");
    await new Promise((r) => setTimeout(r, 3_000));

    expect(model.requests).toHaveLength(0);
    expect(ctx.of("endStreaming")).toHaveLength(0);
    expect(ctx.streamedText()).toBe("");
  });
});
