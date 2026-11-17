import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

/**
 * e2e（真 Chromium + iPhone 档 + 真 `remote/dist` + 假中继）— 手机页输入框里
 * **敲字不该弹「这个操作在 Web 端还没有接通」**。
 *
 * 出处（#2950 B1）：`MessageInput` 的 `handleInput` 每次编辑都**无条件**发
 * `modPromptEdit`（既不判 `isRemotePageHost()`，也不判有没有装 mod —— mods 一期只
 * 做桌面端，这条上报在手机上纯属空转）。而远控页宿主 `remote/shim.js` 的
 * `handleCommand` 没有这个分支 ⇒ 落到 `default:` ⇒
 * `showStatus("这个操作在 Web 端还没有接通：" + command)`，把一条红色状态条顶到
 * 页面最上方。用户**敲第一个字就看见**，之后每次编辑重贴一遍；点 × 之后按文本静音
 * 才算安静 —— 读起来像「远控页坏了」。
 *
 * 为什么之前没有测试守：`remote-page-slash-filter` / `remote-page-status-line` 都
 * 不碰 mods 命令；`scripts/audit-webview-commands.mjs` 的第五宿主核对只覆盖
 * `REMOTE_PAGE_GATED`（显式门控的手机页命令），**webview 无条件发送的命令只查
 * 三个本地宿主** —— 所以漏接第五宿主时审计一直是绿的。两处都补上了：shim 的
 * `UNSUPPORTED_NO_REPLY` 加一行（与 `modBandRender` / `modPanelRender` 同口径：
 * 静默丢弃，不播报），审计脚本加了 3c 断言。
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const WEBVIEW_ROOT = resolve(HERE, "..");
const DIST = join(WEBVIEW_ROOT, "remote", "dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
};

/** 假中继：手机页连上之后会按需问会话/消息/权限，这里给最小可用的一组答案。 */
const ANSWERS: Record<string, unknown> = {
  listDaemonSessions: {
    sessions: [
      {
        sessionId: "s-remote-mod-prompt-edit",
        sessionCwd: "/repo",
        customTitle: "远控会话",
        lastActiveAt: "2026-10-31T00:00:00.000Z",
        isBusy: false,
      },
    ],
  },
  getSessionInfo: {
    sessionId: "s-remote-mod-prompt-edit",
    permissionMode: "default",
    tasks: [],
    backgroundTasks: [],
    isCompacting: false,
    isCommandRunning: false,
  },
  getMessages: {
    messages: [
      {
        id: "m1",
        role: "user",
        blocks: [{ type: "text", text: "探针" }],
      },
    ],
    contextUsagePercent: 3,
  },
  listPendingPermissions: { requests: [] },
  getWorkflowRuns: { runs: [] },
  getSlashCommands: { commands: [] },
  getRecentWorkdirs: { dirs: [] },
  getConfiguredModels: { models: [], current: null },
};

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});

let server: Server;
let base = "";

test.beforeAll(async () => {
  // 远控页这一份产物不在普通 build 里（`remote/dist/` 是 gitignored 的），
  // 每次现建，免得测到上一轮的 chat.js + 旧 shim。
  execFileSync("node", ["remote/build.mjs"], {
    cwd: WEBVIEW_ROOT,
    stdio: "ignore",
  });

  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const rel = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = join(DIST, rel);
    if (!file.startsWith(DIST) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
    });
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((listening) =>
    server.listen(0, "127.0.0.1", listening),
  );
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((closed) => server.close(() => closed()));
});

async function openRemotePage(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("token", "probe-token");
  });

  // `page.routeWebSocket` 让页面连的是一个假中继（真 `routeWebSocket`，真 WS
  // 握手），因此 shim 走的是它线上那条路径：能收到回包，但没有机器在另一端。
  await page.routeWebSocket(/\/relay\/probe$/, (ws) => {
    ws.onMessage((raw) => {
      let frame: { type?: string; id?: number; method?: string };
      try {
        frame = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (frame.type === "auth") {
        ws.send(JSON.stringify({ type: "auth_ok" }));
        return;
      }
      if (!frame.method) return;
      if (frame.method === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }
      const result = frame.method in ANSWERS ? ANSWERS[frame.method] : {};
      ws.send(
        JSON.stringify({ id: frame.id, method: "result", params: { result } }),
      );
    });
  });

  const socket = base.replace("http://", "ws://");
  await page.goto(`${base}/index.html?ws=${socket}/relay/probe&host=probe`);

  const input = page.getByTestId("message-input");
  await expect(input).toBeVisible();
  await input.click();
}

test("手机页敲字不弹「还没有接通：modPromptEdit」状态条", async ({ page }) => {
  await openRemotePage(page);

  // 静止时页面没有状态条（这一页只在「有话说」时才挂那一行）。
  expect(await page.locator("#remote-status").count()).toBe(0);

  await page.keyboard.type("a");
  await expect(page.getByTestId("message-input")).toHaveText(/a/);

  // 第一次敲字就会触发：先前这条断言在旧实现上必红，失败信息就是那行红条。
  const banner = page.locator("#remote-status");
  const text = (await banner.count())
    ? ((await banner.textContent()) ?? "").trim()
    : "";
  expect(banner, `远控页弹出了状态条：${text}`).toHaveCount(0);

  // 「每次编辑都重贴」：继续打几个字，仍然不许出现。
  await page.keyboard.type("bc");
  await expect(page.getByTestId("message-input")).toHaveText(/abc/);
  expect(await page.locator("#remote-status").count()).toBe(0);
});
