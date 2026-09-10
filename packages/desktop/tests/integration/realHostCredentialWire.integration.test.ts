/**
 * Real-host integration suite — the credential pipeline is gone from the wire,
 * and user-preference saves reach the session process instead of being
 * forwarded to the agents.
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
 *  - 设置页保存的用户偏好（语言 / 上下文长度 / 自动记忆）经
 *    `updateUserSettings` 落会话进程的 `~/.wave/settings.json`，**不**下发
 *    `updateConfig` 覆盖层、不重建会话；下一轮对话直接生效
 *    (spec core/agent-config.md「设置实时重载」「用户偏好的保存路径与重建时机」).
 *  - the CLI still reaches the gateway through the *supported* channel
 *    (`WAVE_API_KEY` / `WAVE_BASE_URL` env) once the host stops forwarding
 *    credentials, i.e. removing the pipeline did not break local runs.
 *  - an unauthenticated host reports `isAuthenticated: false` and cannot
 *    silently complete a turn without credentials.
 */

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  REALHOST_HOME,
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
  it("initialize / updateUserSettings / sendMessage 报文里没有 apiKey / baseURL / defaultHeaders", async () => {
    await openProject(dirA);
    await ctx.turn("你好");

    // Save from the settings page: user preferences go straight to the session
    // process (`updateUserSettings` → ~/.wave/settings.json) — no `updateConfig`
    // overlay, no rebuild (spec「用户偏好的保存路径与重建时机」)。
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
    expect(methods).toContain("updateUserSettings");
    expect(methods).toContain("sendMessage");
    // 保存用户偏好不重建会话 ⇒ 全程没有 updateConfig。
    expect(methods).not.toContain("updateConfig");

    // …and none of them carries a credential field.
    const offenders = reqs
      .map((r) => JSON.stringify(r))
      .filter((json) => CREDENTIAL_KEYS.some((k) => json.includes(k)));
    expect(offenders).toEqual([]);

    // The one user-settings request that DID go out still carries the
    // non-credential value, so the assertion above is not "we sent nothing".
    const save = reqs.find((r) => r.method === "updateUserSettings");
    expect(JSON.stringify(save?.params)).toContain("en-US");

    // The CLI's own answers never mention the credential keys either (this is
    // what would come back to the webview as configurationData).
    const responses = readWire()
      .filter((w) => w.dir === "res")
      .map((w) => JSON.stringify(w.line ?? {}));
    expect(
      responses.filter((json) => CREDENTIAL_KEYS.some((k) => json.includes(k))),
    ).toEqual([]);
  });

  it("保存用户偏好只写 ~/.wave/settings.json：不重建会话，下一轮直接生效", async () => {
    await openProject(dirA);
    await ctx.turn("第一轮");
    const sessionBefore = ctx.paneSessionId("pane-1");
    expect(sessionBefore).toBeTruthy();

    const mark = ctx.messages.length;
    await ctx.host.handleWebviewMessage({
      command: "updateConfiguration",
      configurationData: {
        model: "test-model",
        language: "en-US",
        contextLength: 200,
        autoMemoryEnabled: false,
        autoMemoryFrequency: 5,
      },
    });
    // 回执立即给出：设置页展示值来自会话进程读回的 settings.json。
    const response = await ctx.waitFor("configurationResponse", {
      predicate: (m) =>
        (m.configurationData as { language?: string })?.language === "en-US",
    });
    expect(response.configurationData).toMatchObject({
      language: "en-US",
      contextLength: 200,
      autoMemoryEnabled: false,
      autoMemoryFrequency: 5,
    });
    expect(
      ctx.messages
        .slice(mark)
        .some(
          (m) =>
            m.command === "showToast" &&
            JSON.stringify(m.toast).includes("保存成功"),
        ),
    ).toBe(true);

    // 落点是**会话进程**的 HOME（远端即远端机器上的该文件），上下文长度落在
    // env.WAVE_MAX_INPUT_TOKENS（K×1000）。CLI 启动时已自建该文件（插件市场
    // 引导），故此处的写入是「改动既有文件」，watcher 门禁场景见 SDK 单测。
    const settingsFile = path.join(REALHOST_HOME, ".wave", "settings.json");
    const settings = JSON.parse(fs.readFileSync(settingsFile, "utf-8")) as {
      language?: string;
      autoMemoryEnabled?: boolean;
      autoMemoryFrequency?: number;
      env?: Record<string, string>;
    };
    expect(settings.language).toBe("en-US");
    expect(settings.autoMemoryEnabled).toBe(false);
    expect(settings.autoMemoryFrequency).toBe(5);
    expect(settings.env?.WAVE_MAX_INPUT_TOKENS).toBe("200000");

    // 不重建会话：同一 sessionId 继续服务（保存只落盘，不 destroy + create）。
    expect(ctx.paneSessionId("pane-1")).toBe(sessionBefore);
    expect(requests(readWire()).map((r) => r.method)).not.toContain(
      "updateConfig",
    );

    // 下一轮（未重启会话）语言指令已进系统提示——实时重载按轮生效。
    model.reply("第二轮 OK");
    await ctx.turn("第二轮");
    await vi.waitFor(
      async () => {
        if (model.sawRequest("Always respond in en-US")) return;
        // watcher 落定前的一轮不含指令：再走一轮（真 CLI + 假模型，成本极低）。
        await ctx.turn("重试等待实时重载");
      },
      { timeout: 20_000 },
    );
    expect(model.sawRequest("Always respond in en-US")).toBe(true);
  });

  it("文件里没有这些键时：空载荷保存不新建键（不被钉住），生效值仍是 SDK 默认 zh-CN", async () => {
    await openProject(dirA);
    await ctx.turn("第一轮");
    const sessionBefore = ctx.paneSessionId("pane-1");

    const settingsFile = path.join(REALHOST_HOME, ".wave", "settings.json");
    // 真 CLI 启动时会自建该文件（插件市场引导），但**不含**本 PR 涉及的四个用户
    // 偏好键——这正是「全新安装」在真机上的形态，先钉住这个前提。
    const before = JSON.parse(fs.readFileSync(settingsFile, "utf-8")) as {
      language?: string;
      autoMemoryEnabled?: boolean;
      autoMemoryFrequency?: number;
      env?: Record<string, string>;
    };
    expect(before.language).toBeUndefined();
    expect(before.autoMemoryEnabled).toBeUndefined();
    expect(before.autoMemoryFrequency).toBeUndefined();
    expect(before.env?.WAVE_MAX_INPUT_TOKENS).toBeUndefined();

    // 设置页初始值以该文件唯一真源：没有键 ⇒ 回包里也没有这些字段（webview 据此
    // 显示「未设置」态：占位符 /「未设置（默认：中文）」项，spec 场景 7）。
    // 注意：这里不能用 `ctx.clear()` 后再 `ctx.turn()`——`turn` 要等
    // `setInitialState`，而它正是被 clear 清掉的那条（harness 的既有约束）。
    const readBack = async (action: () => Promise<void>) => {
      const mark = ctx.messages.length;
      await action();
      await vi.waitFor(
        () =>
          expect(
            ctx.messages
              .slice(mark)
              .some((m) => m.command === "configurationResponse"),
          ).toBe(true),
        { timeout: 20_000 },
      );
      return ctx.messages
        .slice(mark)
        .find((m) => m.command === "configurationResponse")!
        .configurationData as Record<string, unknown>;
    };

    const shownData = await readBack(() =>
      ctx.host.handleWebviewMessage({ command: "getConfiguration" }),
    );
    expect(shownData).not.toHaveProperty("language");
    expect(shownData).not.toHaveProperty("contextLength");
    expect(shownData).not.toHaveProperty("autoMemoryEnabled");
    expect(shownData).not.toHaveProperty("autoMemoryFrequency");

    // 「一个字都没改就点保存」在真机上就是空载荷（webview 的 diff 载荷语义）：
    // 任何键都不得被写进文件——系统环境里已设的 WAVE_MAX_INPUT_TOKENS 因而不会
    // 被这次保存钉成 200000（spec agent-config 边界说明「省略键 = 不改该键」）。
    await readBack(() =>
      ctx.host.handleWebviewMessage({
        command: "updateConfiguration",
        configurationData: {},
      }),
    );

    const after = JSON.parse(fs.readFileSync(settingsFile, "utf-8")) as {
      language?: string;
      autoMemoryEnabled?: boolean;
      autoMemoryFrequency?: number;
      env?: Record<string, string>;
    };
    expect(after.language).toBeUndefined();
    expect(after.autoMemoryEnabled).toBeUndefined();
    expect(after.autoMemoryFrequency).toBeUndefined();
    expect(after.env?.WAVE_MAX_INPUT_TOKENS).toBeUndefined();
    // 保存不重建会话（同一 sessionId 继续服务）。
    expect(ctx.paneSessionId("pane-1")).toBe(sessionBefore);
    expect(requests(readWire()).map((r) => r.method)).not.toContain(
      "updateConfig",
    );

    // 语言键从未写进文件 ⇒ 生效值 = SDK 解析链末尾的默认（A 方案：全新安装按
    // zh-CN 回复，不会退化成「不注入 # Language 指令、模型按自身默认回答」）。
    model.reply("第二轮 OK");
    await ctx.turn("第二轮");
    await vi.waitFor(
      async () => {
        if (model.sawRequest("Always respond in zh-CN")) return;
        await ctx.turn("重试等待实时重载");
      },
      { timeout: 20_000 },
    );
    expect(model.sawRequest("Always respond in zh-CN")).toBe(true);
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
