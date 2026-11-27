import { expect, test } from "@playwright/test";
import { createReadStream, existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

/**
 * 切会话的那一瞬在真远控页产物里的样子（spec remote-web.md 场景 10）：
 *
 * - 切到另一条：正文换成本页的恢复占位（`chat-restoring-overlay`），上一条的
 *   消息当场从屏上消失；
 * - 切回**这次打开期间看过**的那条也一样：页面不在内存里留任何会话内容
 *   （2026-11-28 拿掉了那层记忆），所以照样从占位起步，随后由回包整表换成权威
 *   内容。
 *
 * 台子与 `remote-page-slash-filter.e2e.ts` 同一副（真 `remote/dist` + 真
 * Chromium + 假中继）。区别只在这里的 `getMessages` 可以**被挂住**：不卡住回包
 * 就看不到「占位那几百毫秒」，而这正是要验的东西。
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

/** 两条活会话：`s-b` 最近活跃，所以首屏是它。 */
const SESSIONS = [
  {
    sessionId: "s-a",
    sessionCwd: "/repo",
    customTitle: "会话 A",
    lastActiveAt: "2026-11-25T09:00:00.000Z",
    isBusy: false,
  },
  {
    sessionId: "s-b",
    sessionCwd: "/repo",
    customTitle: "会话 B",
    lastActiveAt: "2026-11-25T10:00:00.000Z",
    isBusy: false,
  },
];

/** 一条只有文本的消息，`id` 跟着文本走，方便按内容认。 */
function tailOf(text: string) {
  return {
    messages: [
      {
        id: "m-" + text,
        role: "user",
        blocks: [{ type: "text", content: text }],
      },
    ],
    contextUsagePercent: 3,
  };
}

const ANSWERS: Record<string, unknown> = {
  getSessionInfo: {
    sessionId: "s-a",
    permissionMode: "default",
    tasks: [],
    backgroundTasks: [],
    isCompacting: false,
    isCommandRunning: false,
  },
  listPendingPermissions: { requests: [] },
  getWorkflowRuns: { runs: [] },
  getRecentWorkdirs: { dirs: [] },
  getConfiguredModels: { models: [], current: null },
};

type Held = { send: (data: string) => void; id: number };

/** 被挂住的 `getMessages` 回包，由用例显式放行。 */
let held: Held[] = [];
let holdTails = false;
/** 让接下来这一拍 `getMessages` 回错误帧的次数（模拟机器侧这一拍没读到）。 */
let failTails = 0;
let tailErrors = 0;

async function releaseTails(result: unknown) {
  const frames = held;
  held = [];
  for (const frame of frames) {
    frame.send(
      JSON.stringify({ id: frame.id, method: "result", params: { result } }),
    );
  }
}

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

/** 打开远控页：登录态进 `localStorage`，socket 由 `routeWebSocket` 接住。 */
async function openRemotePage(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("token", "probe-token");
  });

  await page.routeWebSocket(/\/relay\/probe$/, (ws) => {
    ws.onMessage((raw) => {
      let frame: {
        type?: string;
        id?: number;
        method?: string;
        sessionId?: string;
      };
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
      let result: unknown;
      if (frame.method === "listDaemonSessions")
        result = { sessions: SESSIONS };
      else if (frame.method === "getMessages") {
        if (failTails > 0) {
          failTails -= 1;
          tailErrors += 1;
          ws.send(
            JSON.stringify({
              id: frame.id,
              method: "error",
              params: { code: -32603, message: "boom" },
            }),
          );
          return;
        }
        if (holdTails) {
          held.push({ send: (data) => ws.send(data), id: frame.id ?? 0 });
          return;
        }
        result = tailOf(frame.sessionId === "s-a" ? "A 的消息" : "B 的消息");
      } else result = ANSWERS[frame.method] ?? {};
      ws.send(
        JSON.stringify({ id: frame.id, method: "result", params: { result } }),
      );
    });
  });

  const socket = base.replace("http://", "ws://");
  await page.goto(`${base}/index.html?ws=${socket}/relay/probe&host=probe`);
  await expect(page.getByTestId("message-input")).toBeVisible();
}

test("切到另一条再切回来：两次都从占位起步，不留旧内容", async ({ page }) => {
  held = [];
  holdTails = false;
  await openRemotePage(page);

  // 首屏：注册表里最近活跃的那条（s-b）。
  await expect(page.getByText("B 的消息")).toBeVisible();

  // 切到没看过的 s-a：上一条的消息当场消失，正文是恢复占位。
  holdTails = true;
  await page.getByTestId("session-switch-btn").click();
  await page.getByTestId("remote-session-row-select-s-a").click();
  await expect(page.getByTestId("chat-restoring-overlay")).toBeVisible();
  await expect(page.getByText("B 的消息")).toHaveCount(0);

  // 放行：内容回来，占位揭开。
  await releaseTails(tailOf("A 的消息"));
  await expect(page.getByText("A 的消息")).toBeVisible();
  await expect(page.getByTestId("chat-restoring-overlay")).toHaveCount(0);

  // 切回 s-b —— 这条刚刚看过，但页面不在内存里留任何会话内容：照样占位，绝不
  // 把刚才那份 B 的尾页先画出来。
  holdTails = true;
  await page.getByTestId("session-switch-btn").click();
  await page.getByTestId("remote-session-row-select-s-b").click();
  await expect(page.getByTestId("chat-restoring-overlay")).toBeVisible();
  await expect(page.getByText("B 的消息")).toHaveCount(0);
  await expect(page.getByText("A 的消息")).toHaveCount(0);

  // 放行：权威内容上屏，占位揭开。
  await releaseTails(tailOf("B 的消息（已更新）"));
  await expect(page.getByText("B 的消息（已更新）")).toBeVisible();
  await expect(page.getByTestId("chat-restoring-overlay")).toHaveCount(0);
});

/**
 * 切过去那一拍读**失败**：占位不许揭开（spec remote-web 场景 10「那一拍读
 * 失败」）。
 *
 * 这条是真机序的回归位：以前失败时远程页会补发一份空快照把占位摘掉，页面随即
 * 落成「新对话」的欢迎页——用户看到的是「切过去是一条空对话」，而真相只是这一
 * 拍没读到。现在占位留在原地、原因上状态条，页面**不自己重读**（2026-11-26 定），
 * 自愈靠本来就会重跑整份快照的那几条入口——这里验「手机回前台」那条。
 */
test("切过去那一拍读失败：占位不撤，回前台时内容才上屏", async ({ page }) => {
  held = [];
  holdTails = false;
  failTails = 0;
  tailErrors = 0;
  await openRemotePage(page);
  await expect(page.getByText("B 的消息")).toBeVisible();

  // 让切过去那一拍的尾页读回错误帧。
  failTails = 1;
  await page.getByTestId("session-switch-btn").click();
  await page.getByTestId("remote-session-row-select-s-a").click();

  // 这一拍没读到 ≠ 这条会话是空的：正文仍是恢复占位，欢迎页一个字都不该出现。
  await expect(page.locator("#remote-status-text")).toContainText(
    "拉取会话失败",
  );
  expect(tailErrors).toBe(1);
  await expect(page.getByTestId("chat-restoring-overlay")).toBeVisible();
  await expect(page.getByTestId("welcome-wordmark")).toHaveCount(0);

  // 页面也不会自己重读：等一会儿，占位照样在、欢迎页照样没有（以前那档 2 秒自动
  // 重试已经拿掉，这里等的是「没有」）。
  await page.waitForTimeout(2500);
  await expect(page.getByTestId("chat-restoring-overlay")).toBeVisible();
  await expect(page.getByTestId("welcome-wordmark")).toHaveCount(0);

  // 出口是本来就会重跑整份快照的那几条路之一：手机回前台（`resync` 在消息为空时
  // 退化成整份拉取）→ 内容这时才上屏，占位揭开、状态条收掉。
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page.getByText("A 的消息")).toBeVisible();
  await expect(page.getByTestId("chat-restoring-overlay")).toHaveCount(0);
  await expect(page.locator("#remote-status")).toHaveCount(0);
});
