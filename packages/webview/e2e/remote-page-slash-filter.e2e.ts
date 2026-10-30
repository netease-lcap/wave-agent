import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

/**
 * 远控页斜杠弹窗「`/` 之后继续打字就收窄」的那一半（spec
 * commands/slash-commands.md「命令发现和自动补全」场景 2），在真浏览器里取证。
 *
 * 与同目录其他用例形态不同：这一条测的是**远控页这份产物本身**。页面的宿主是
 * `remote/shim.js`（浏览器的第五个宿主），过滤写在它里面——mock host 那一套
 * （`webviewTestHarness` + `MessageInjector`）根本走不到这段代码，所以缺陷当时
 * 只在真机上看得见（2026-10-31 报障：手机上打完 `/` 再打字，弹窗一条都不减）。
 *
 * 因此台子按「真产物 + 真浏览器 + 假中继」搭：
 *
 * - 真产物：`remote/build.mjs` 现出的 `remote/dist`，由本地 http 服务按真实
 *   origin 提供。`file://` 不行：CSP、同源 `ws://`、`localStorage` 三样在那一侧
 *   都不成立，而这页的登录态与 socket 都靠它们。
 * - 真浏览器：Chromium + iPhone 触控 context，打字走键盘事件。
 * - 假中继：`routeWebSocket` 只做握手与应答，`getSlashCommands` **固定回同一份
 *   全量清单** —— 于是「收窄」只可能来自页面这一侧，服务端将来若自己开始过滤，
 *   这条用例也不会因此变绿。
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

/** 假中继下发的全量清单：三个 `re` 开头的名字，好区分收窄前后的条数。 */
const COMMANDS = [
  {
    id: "status",
    name: "/status",
    description: "查看当前状态",
    runOnSelect: true,
  },
  {
    id: "compact",
    name: "/compact",
    description: "手动压缩对话历史",
    runOnSelect: true,
  },
  {
    id: "rewind",
    name: "/rewind",
    description: "回退到之前的用户消息",
    runOnSelect: true,
  },
  {
    id: "review",
    name: "/review",
    description: "复盘这次改动",
    runOnSelect: true,
  },
  {
    id: "reload-plugins",
    name: "/reload-plugins",
    description: "就地重载插件",
    runOnSelect: true,
  },
  {
    id: "tasks",
    name: "/tasks",
    description: "查看后台任务",
    runOnSelect: true,
  },
  {
    id: "workflows",
    name: "/workflows",
    description: "查看工作流运行",
    runOnSelect: true,
  },
  { id: "btw", name: "/btw", description: "旁路提问（不进入聊天记录）" },
];

/** `re` 能匹配到的那三条，按服务端下发的顺序（页面不再排序）。 */
const MATCHING = ["//rewind", "//review", "//reload-plugins"];

/**
 * 页面挂载后要读的那几条。会话列表必须有内容：没有活会话时输入区是置灰的
 * （spec remote/remote-web.md），点不进也打不了字。
 */
const ANSWERS: Record<string, unknown> = {
  listDaemonSessions: {
    sessions: [
      {
        sessionId: "s-probe",
        sessionCwd: "/repo",
        customTitle: "探针会话",
        lastActiveAt: "2026-10-31T00:00:00.000Z",
        isBusy: false,
      },
    ],
  },
  getSessionInfo: {
    sessionId: "s-probe",
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
        blocks: [{ type: "text", text: "探针：输入 / 之后继续打字" }],
      },
    ],
    contextUsagePercent: 3,
  },
  listPendingPermissions: { requests: [] },
  getWorkflowRuns: { runs: [] },
  getSlashCommands: { commands: COMMANDS },
  getRecentWorkdirs: { dirs: [] },
  getConfiguredModels: { models: [], current: null },
};

// 手机档：这一页是五端里唯一「一种宿主对应两种设备」的页面，触控 context 才走到
// 真机那条样式与输入路径。
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
  // 产物就是被测对象：一份陈旧的 `remote/dist` 会让用例对着上一版 shim 变绿。
  // 构建幂等且快（webview 已 build 过时只剩重拷与算 hash），所以每次都现出。
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

/**
 * 打开远控页：登录态写进 `localStorage`（这页复用企业端登录，没有自己的登录
 * 表单），socket 由 `routeWebSocket` 接住——不接的话页面会真的去连那个地址，
 * 连不上就停在「电脑侧不在线」上，输入区也用不了。
 */
async function openRemotePage(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("token", "probe-token");
  });

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

/** 弹窗里当前渲染的命令名，按顺序。 */
function commandNames(page: Page) {
  return page.$$eval(".slash-command-item .slash-command-name", (nodes) =>
    nodes.map((node) => (node.textContent ?? "").trim()),
  );
}

test("typing after the slash narrows the popup", async ({ page }) => {
  await openRemotePage(page);

  await page.keyboard.type("/");
  await expect
    .poll(() => commandNames(page))
    .toEqual(COMMANDS.map((command) => "/" + command.name));

  // 判据与桌面 / VS Code / JB 三个宿主的 handler 一致：`id` / `name` 的大小写
  // 不敏感子串（描述不参与），所以大写也匹配。
  await page.keyboard.type("RE");
  await expect.poll(() => commandNames(page)).toEqual(MATCHING);
});

test("a filter that matches nothing closes the popup", async ({ page }) => {
  await openRemotePage(page);

  await page.keyboard.type("/re");
  await expect.poll(() => commandNames(page)).toEqual(MATCHING);

  // 空清单不渲染弹窗（`isVisible = isActive && commands.length > 0`）：页面上
  // 剩的只有输入框里的 `/rezzz`，不会挂一个「未找到可用命令」的空壳。
  await page.keyboard.type("zzz");
  await expect(page.locator(".slash-commands-popup")).toHaveCount(0);
});
