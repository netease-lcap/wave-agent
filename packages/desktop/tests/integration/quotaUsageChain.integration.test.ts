/**
 * Real-host integration suite — the 额度 (quota) chain, end to end against a
 * stand-in codechat:
 *
 *   fake codechat (real `x-codechat-quota-*` HTTP headers + real /api/v1/account)
 *     → real `wave --stdio` child (agent-sdk → agentBridge → stdio notification)
 *     → real DesktopHost (accountCache → `desktopAccountInfo` push)
 *
 * Only the codechat side is faked — exactly the surface the codechat test
 * environment provides — so this covers the seams no unit test can: a header
 * really leaving a response, crossing the child process as a notification, and
 * landing in the account card's snapshot. Login is seeded through a throwaway
 * `~/.wave/auth.json` (the CLI reads `SSO_TOKEN` from there).
 *
 * Guards (spec docs/specs/desktop/desktop-account.md「用量刷新时机」):
 *  - 场景 1: a header-carrying response refreshes the reading without any request
 *  - 场景 2: a 402 error response carries the same headers and refreshes too
 *  - 场景 6: no header at all ⇒ no push, no account query
 *  - 场景 4: `desktopRefreshAccountUsage` = exactly one `/api/v1/account` hit
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as http from "http";
import * as path from "path";
import {
  REALHOST_HOME,
  assertNoUnexpectedRejections,
  clearFakeModelEndpoint,
  createRealHost,
  resetRealHostState,
  type HostMessage,
  type RealHost,
} from "./realHostHarness";

interface FakeCodechat {
  origin: string;
  accountHits: () => number;
  /** Quota the account endpoint answers with (default: 不限额, used 0). */
  setAccountQuota(quota: {
    limit: number | null;
    used: number;
    scope?: "user" | "department";
  }): void;
  /** Headers the next model response carries (undefined = none at all). */
  setQuota(headers: Record<string, string> | undefined): void;
  /** Make the next model responses fail with this status instead of streaming. */
  failWith(status: number | undefined): void;
  reply(text: string): void;
  close(): Promise<void>;
}

async function startFakeCodechat(): Promise<FakeCodechat> {
  let hits = 0;
  let quota: Record<string, string> | undefined;
  let accountQuota: {
    limit: number | null;
    used: number;
    scope?: "user" | "department";
  } = { limit: null, used: 0 };
  let failStatus: number | undefined;
  let text = "回复：A-OK";

  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/api/v1/account") {
      hits += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          billing: {
            mode: "plan",
            plan: {
              monthUsed: 10,
              monthLimit: 100,
              weekUsed: 10,
              weekLimit: 100,
              expireDate: "2027-01-01",
            },
          },
          apiQuota: accountQuota,
        }),
      );
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (failStatus !== undefined) {
        res.writeHead(failStatus, {
          "Content-Type": "application/json",
          ...(quota ?? {}),
        });
        res.end(JSON.stringify({ error: { message: "quota exhausted" } }));
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        ...(quota ?? {}),
      });
      const chunk = (delta: unknown, extra: Record<string, unknown> = {}) =>
        res.write(
          `data: ${JSON.stringify({
            id: "chatcmpl-probe",
            object: "chat.completion.chunk",
            created: 1_700_000_000,
            model: "test-model",
            choices: [{ index: 0, delta, finish_reason: null }],
            ...extra,
          })}\n\n`,
        );
      chunk({ role: "assistant", content: text });
      chunk({}, { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    accountHits: () => hits,
    setAccountQuota: (q) => {
      accountQuota = q;
    },
    setQuota: (h) => {
      quota = h;
    },
    failWith: (status) => {
      failStatus = status;
    },
    reply: (t) => {
      text = t;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

let ctx: RealHost;
let codechat: FakeCodechat;
let dirA: string;

const accountPushes = (): HostMessage[] =>
  ctx.of("desktopAccountInfo").filter((m) => m.billing);

beforeEach(async () => {
  const dirs = resetRealHostState();
  dirA = dirs.dirA;
  codechat = await startFakeCodechat();

  // Seed a throwaway login: the CLI reads SSO_TOKEN from <HOME>/.wave/auth.json.
  fs.mkdirSync(path.join(REALHOST_HOME, ".wave"), { recursive: true });
  fs.writeFileSync(
    path.join(REALHOST_HOME, ".wave", "auth.json"),
    JSON.stringify({
      SSO_TOKEN: "integration-token",
      SSO_TOKEN_EXPIRES_AT: Date.now() + 86_400_000,
      user: { id: "integration", email: "integration@example.com" },
    }),
    "utf-8",
  );

  // The model gateway and the account endpoint are the same stand-in server.
  process.env.WAVE_API_KEY = "test-key";
  process.env.WAVE_BASE_URL = `${codechat.origin}/v1`;
  process.env.WAVE_MODEL = "test-model";
  process.env.WAVE_FAST_MODEL = "test-model";
  process.env.WAVE_SERVER_URL = codechat.origin;

  ctx = createRealHost();
});

afterEach(async () => {
  await ctx.close();
  await codechat.close();
  clearFakeModelEndpoint();
  delete process.env.WAVE_SERVER_URL;
  assertNoUnexpectedRejections();
});

async function openProject(): Promise<void> {
  await ctx.host.handleWebviewMessage({ command: "desktopReady" });
  await ctx.host.handleWebviewMessage({
    command: "desktopSelectRecentWorkdir",
    path: dirA,
    host: "local",
  });
  await ctx.waitFor("setInitialState");
}

describe("real host · quota headers drive the account card", () => {
  it("login seeds the card, a header-carrying turn refreshes it, a bare turn does not", async () => {
    await openProject();

    const seeded = await ctx.waitFor("desktopAccountInfo", {
      predicate: (m) => m.isAuthenticated === true && m.billing != null,
      timeout: 60_000,
    });
    expect(seeded.billing).toMatchObject({
      mode: "plan",
      plan: { weekUsed: 10, weekLimit: 100 },
    });

    // ① 带头的一次调用 ⇒ 卡片当场拿到头里的读数（头是主源）。
    codechat.setQuota({
      "x-codechat-quota-status": "allowed_warning",
      "x-codechat-quota-weekly-used": "900",
      "x-codechat-quota-weekly-limit": "1000",
      "x-codechat-quota-monthly-used": "500",
      "x-codechat-quota-monthly-limit": "1000",
      "x-codechat-quota-plan-expire": "2027-01-01",
    });
    const before = accountPushes().length;
    codechat.reply("这一轮响应带着额度头");
    await ctx.turn("你好");
    const fromHeaders = await ctx.waitFor("desktopAccountInfo", {
      predicate: (m) =>
        (m.billing as { plan?: { weekUsed?: number } } | null)?.plan
          ?.weekUsed === 900,
    });
    expect(fromHeaders.billing).toEqual({
      mode: "plan",
      plan: {
        monthUsed: 500,
        monthLimit: 1000,
        weekUsed: 900,
        weekLimit: 1000,
        expireDate: "2027-01-01",
      },
    });
    expect(accountPushes().length).toBeGreaterThan(before);

    // ② 一个额度头都不带的调用 ⇒ 不推送、不请求（老服务端 / 私有化）。
    codechat.setQuota(undefined);
    const hitsBefore = codechat.accountHits();
    const pushesBefore = accountPushes().length;
    codechat.reply("这一轮没有头");
    await ctx.turn("再问一句");
    expect(accountPushes()).toHaveLength(pushesBefore);
    expect(codechat.accountHits()).toBe(hitsBefore);

    // ③ 打开用量浮层 = 一次核对（desktopRefreshAccountUsage）。清空缓冲让这次
    // 推送不与前面的推送混淆（之后不再 turn，所以不必留着 setInitialState）。
    ctx.clear();
    await ctx.host.handleWebviewMessage({
      command: "desktopRefreshAccountUsage",
    });
    const refreshed = await ctx.waitFor("desktopAccountInfo");
    expect(codechat.accountHits()).toBe(hitsBefore + 1);
    // 账户接口的数字覆盖头里的读数（后到者胜，同源不同时刻）。
    expect(refreshed.billing).toMatchObject({ plan: { weekUsed: 10 } });
  });

  it("apiQuota.scope survives the CLI hop and later header patches", async () => {
    // 部门共享池：scope 只在这条 GET /api/v1/account 上出现（响应头里没有它）。
    codechat.setAccountQuota({ limit: 100, used: 40, scope: "department" });
    await openProject();

    const seeded = await ctx.waitFor("desktopAccountInfo", {
      predicate: (m) =>
        (m.apiQuota as { scope?: string } | null)?.scope === "department",
      timeout: 60_000,
    });
    // CLI 的 agentBridge 是透传（只做了 as 断言），scope 必须原样到宿主缓存。
    expect(seeded.apiQuota).toEqual({
      limit: 100,
      used: 40,
      scope: "department",
    });

    // 一次按 API 计费的调用：头里只有数字。若映射时整体重建 apiQuota，这里就会把
    // 标签退回「个人剩余积分」（数字仍是部门共享的）——spec 故事 3 场景 11。
    codechat.setQuota({
      "x-codechat-quota-api-limit": "80",
      "x-codechat-quota-api-used": "55",
    });
    codechat.reply("这一轮按 API 计费");
    await ctx.turn("你好");
    const patched = await ctx.waitFor("desktopAccountInfo", {
      predicate: (m) => (m.apiQuota as { used?: number } | null)?.used === 55,
    });
    expect(patched.apiQuota).toEqual({
      limit: 80,
      used: 55,
      scope: "department",
    });
  });

  it("a 402 error response still refreshes the reading (blocked conclusion)", async () => {
    await openProject();
    await ctx.waitFor("desktopAccountInfo", {
      predicate: (m) => m.isAuthenticated === true && m.billing != null,
      timeout: 60_000,
    });

    // 402 这一态也带套餐事实（2026-11-27，缺陷单 3525819196034816）：套餐维度据此说
    // 套餐的话，而不是把 402 的积分文案挂到套餐页签上。
    codechat.setQuota({
      "x-codechat-quota-status": "rejected",
      "x-codechat-quota-code": "USER_QUOTA_ZERO",
      "x-codechat-quota-weekly-used": "100",
      "x-codechat-quota-weekly-limit": "100",
      "x-codechat-quota-monthly-used": "40",
      "x-codechat-quota-monthly-limit": "100",
      "x-codechat-quota-plan-expire": "2026-12-01",
    });
    codechat.failWith(402);
    await ctx.turn("你好");

    const blocked = await ctx.waitFor("desktopAccountInfo", {
      predicate: (m) =>
        (m.billing as { mode?: string } | null)?.mode === "blocked",
    });
    expect(blocked.billing).toEqual({
      mode: "blocked",
      code: "USER_QUOTA_ZERO",
      plan: {
        monthUsed: 40,
        monthLimit: 100,
        weekUsed: 100,
        weekLimit: 100,
        expireDate: "2026-12-01",
      },
    });
  });
});
