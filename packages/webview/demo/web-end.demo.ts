import { test, expect } from "../e2e/utils/webviewTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { MockDataGenerator } from "../e2e/fixtures/mockData.js";
import { screenshotWebp } from "../e2e/utils/screenshot.js";
import {
  openSettings,
  simulateHostMessage,
} from "../e2e/utils/settingsHarness.js";
import fs from "node:fs";
import path from "node:path";
import {
  ASK_USER_QUESTION_TOOL_NAME,
  BASH_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  type Message,
} from "wave-agent-sdk";
import type { Page } from "@playwright/test";

/**
 * Web 端（远控 Web 页）手机布局截图 —— docs/web.md 用。
 *
 * 远控页是共享 webview bundle 的第五个宿主，靠两样东西与 IDE 宿主区分：
 * `window.waveRemotePage = true`（`isRemotePageHost()` 读它，决定顶栏的「会话 /
 * 切换电脑」入口、会话整页列表、计划正文内联审批等）与 `<html data-remote-page>`
 * （`styles/remote-page.css` 的手机档样式全部挂在这个属性下）。测试 harness 造的是
 * IDE 宿主页面，所以这里两样都自己补上，再用 iPhone 竖屏尺寸截图。
 */

const PHONE = { width: 390, height: 844 };
const DIR_A = "/Users/dev/projects/wave-agent";
const DIR_B = "/Users/dev/projects/web-dashboard";
const DIR_C = "/Users/dev/projects/payment-service";

const now = Date.now();
const at = (msAgo: number) => new Date(now - msAgo).toISOString();

const sessions = [
  {
    id: "s-web-1",
    customTitle: "修复登录页样式对齐",
    workdir: DIR_A,
    lastActiveAt: at(60_000),
  },
  {
    id: "s-web-2",
    firstMessage: "重构订单状态流转，把状态机抽成独立模块并补测试",
    workdir: DIR_B,
    lastActiveAt: at(25 * 60_000),
  },
  {
    id: "s-web-3",
    customTitle: "评审支付回调幂等逻辑",
    workdir: DIR_C,
    lastActiveAt: at(26 * 3600_000),
  },
];

/** iPhone 竖屏视口（2× 像素密度，截图进文档后在视网膜屏上不糊）。 */
async function emulatePhoneViewport(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: PHONE.width,
    height: PHONE.height,
    deviceScaleFactor: 2,
    mobile: true,
  });
  // `mobile: true` 只管视口尺寸与 UA 语义，**不会**让 `pointer` 变成 coarse：
  // 手机档样式（`@media (pointer: coarse), (hover: none)`，见 remote-page.css）
  // 的判据是输入能力，所以必须再把触控打开 —— 否则截出来的是 PC 密度那一档，
  // 与真机打开这一页看到的两回事（真机上"图标按钮按手指给足"那条根本不生效）。
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 5,
  });
}

/** 手机视口 + 远控页宿主身份（harness 只造 IDE 宿主页面）。 */
async function emulateRemotePhone(page: Page): Promise<void> {
  await emulatePhoneViewport(page);
  await page.evaluate(() => {
    // 这个标记由页面 shim 打（remote/shim.js），demo 的 tsconfig 看不到那份声明，
    // 用 Object.assign 赋值避免为此在 demo 侧再声明一遍全局类型。
    Object.assign(window, { waveRemotePage: true });
    document.documentElement.dataset.remotePage = "1";
    document.documentElement.dataset.theme = "dark";
  });
}

/** 远控页冷启动快照：会话、状态点、当前会话一次给全。 */
async function seedRemoteState(injector: MessageInjector) {
  await injector.simulateExtensionMessage("setInitialState", {
    messages: [],
    isStreaming: false,
    sessions,
    currentSession: sessions[0],
    // 顶栏标题由 `message.session` 落进 `state.currentSession`（`getSessionTitle`
    // 读的是它，不是 `currentSession` 这个键）。
    session: sessions[0],
    sessionStatus: {
      running: ["s-web-1"],
      waiting: ["s-web-3"],
      background: ["s-web-2"],
      worktrees: [],
    },
    isAuthenticated: true,
    permissionMode: "default",
    workdir: DIR_A,
  });
  await injector.waitForChatAppReady();
}

const conversation: Message[] = [
  MockDataGenerator.createUserMessage(
    "登录页在小屏幕上按钮错位了，先看看是什么原因",
    "msg-web-u1",
  ),
  {
    id: "msg-web-a1",
    role: "assistant",
    timestamp: at(4 * 60_000),
    blocks: [
      {
        type: "text",
        content:
          "登录表单在 375px 下用的是两列布局，容器宽度不够导致按钮被挤出。我先改成断点内单列，再跑一遍视觉验证。",
      },
      {
        type: "tool",
        name: BASH_TOOL_NAME,
        stage: "end",
        parameters: JSON.stringify({
          command: "pnpm -F wave-webview test:demo -- login",
        }),
        result: "12 passed (8.4s)",
      },
      {
        type: "text",
        content:
          "改完了：375 / 768 两档都过。改动集中在表单容器与按钮两处，没有动其他页面。",
      },
    ],
  },
  MockDataGenerator.createUserMessage(
    "顺手把这两档视觉回归接到 CI 上",
    "msg-web-u2",
  ),
];

test.describe("Web 端（远控页）手机截图", () => {
  test("对话页：顶栏会话入口 + 流式对话", async ({ webviewPage }) => {
    await emulateRemotePhone(webviewPage);
    const injector = new MessageInjector(webviewPage);
    await seedRemoteState(injector);
    await injector.updateMessages(conversation);
    await expect(webviewPage.getByTestId("session-switch-btn")).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/web-chat.webp",
    );
  });

  test("会话列表整页：状态点与行级动作", async ({ webviewPage }) => {
    await emulateRemotePhone(webviewPage);
    const injector = new MessageInjector(webviewPage);
    await seedRemoteState(injector);
    await injector.updateMessages(conversation);
    await webviewPage.getByTestId("session-switch-btn").click();
    await expect(
      webviewPage.getByTestId("remote-session-row-s-web-3"),
    ).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/web-session-list.webp",
    );
  });

  test("审批：从手机批一条命令", async ({ webviewPage }) => {
    await emulateRemotePhone(webviewPage);
    const injector = new MessageInjector(webviewPage);
    await seedRemoteState(injector);
    await injector.updateMessages(conversation);
    await injector.simulateExtensionMessage("showConfirmation", {
      confirmationId: "web-confirm-1",
      toolName: BASH_TOOL_NAME,
      confirmationType: "命令待执行",
      toolInput: {
        command: "git push origin fix/login-alignment",
        description: "推送修复分支",
      },
    });
    await expect(webviewPage.getByText("git push origin")).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/web-approval.webp",
    );
  });

  test("提问弹窗：右上角两枚图标按手指给足（场景 27 第三族）", async ({
    webviewPage,
  }) => {
    // 这两枚（折叠选项 / 关闭）绝对定位在卡片右上角，放大后会往下压住第一道
    // 内容、往左压住标题——几何只能在真实浏览器里量，jsdom 不解析样式表。
    // 数值口径见 remote-page.css 手机档与 spec 场景 27。
    await emulateRemotePhone(webviewPage);
    const injector = new MessageInjector(webviewPage);
    await seedRemoteState(injector);
    await injector.updateMessages(conversation);
    await injector.simulateExtensionMessage("showConfirmation", {
      confirmationId: "web-confirm-ask",
      toolName: ASK_USER_QUESTION_TOOL_NAME,
      confirmationType: "需要确认",
      toolInput: {
        questions: [
          {
            question: "登录页的断点定在哪一档？",
            options: [
              { label: "375", description: "按 iPhone SE 起" },
              { label: "480", description: "覆盖主流小屏" },
            ],
            multiSelect: false,
          },
        ],
      },
    });
    await expect(webviewPage.locator(".confirmation-dialog")).toBeVisible();
    await expect(
      webviewPage.getByTestId("confirmation-collapse-toggle"),
    ).toBeVisible();

    const geom = await webviewPage.evaluate(() => {
      const box = (sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          left: r.left,
          top: r.top,
          right: r.right,
          bottom: r.bottom,
          w: r.width,
          h: r.height,
        };
      };
      const glyph = (sel: string) =>
        document.querySelector(sel)?.getBoundingClientRect().width ?? 0;
      return {
        collapse: box(".confirmation-collapse-btn"),
        close: box(".confirmation-close-btn"),
        title: box(".confirmation-title"),
        row: box(".confirmation-header-top"),
        next: box(".ask-user-questions") ?? box(".confirmation-command"),
        chevronGlyph: glyph(".confirmation-collapse-chevron"),
        closeGlyph: glyph(".confirmation-close-btn-icon"),
        gap: getComputedStyle(
          document.querySelector(".confirmation-header-actions")!,
        ).gap,
        scroll: document.documentElement.scrollHeight,
        viewport: document.documentElement.clientHeight,
      };
    });

    // 一枚按钮 40×40，字形 20，两枚之间 8。
    expect([geom.collapse!.w, geom.collapse!.h]).toEqual([40, 40]);
    expect([geom.close!.w, geom.close!.h]).toEqual([40, 40]);
    expect(geom.chevronGlyph).toBe(20);
    expect(geom.closeGlyph).toBe(20);
    expect(geom.gap).toBe("8px");
    // 两枚之间真的有 8px 空档（不是热区相贴）。
    expect(geom.close!.left - geom.collapse!.right).toBe(8);
    // 让位：标题行装得下按钮，标题本身不伸到按钮组底下。
    expect(geom.row!.h).toBe(40);
    expect(geom.title!.right).toBeLessThan(geom.collapse!.left);
    // 不放大的竖向溢出：按钮组不越过标题行去压第一道内容。
    expect(geom.collapse!.bottom).toBeLessThanOrEqual(geom.row!.bottom);
    expect(geom.next!.top).toBeGreaterThanOrEqual(geom.row!.bottom);
    // 场景 14 的整屏约束仍成立。
    expect(geom.scroll).toBe(geom.viewport);
  });

  test("计划审批：计划正文内联在对话框里", async ({ webviewPage }) => {
    await emulateRemotePhone(webviewPage);
    const injector = new MessageInjector(webviewPage);
    await seedRemoteState(injector);
    await injector.updateMessages(conversation);
    await injector.simulateExtensionMessage("showConfirmation", {
      confirmationId: "web-confirm-plan",
      toolName: EXIT_PLAN_MODE_TOOL_NAME,
      confirmationType: "计划执行确认",
      planContent: [
        "## 登录页响应式修复",
        "",
        "1. `LoginForm.tsx` 容器由固定两列改为断点单列（≤480px）",
        "2. 主按钮改为整行宽度，次级链接下移一行",
        "3. 补 375 / 768 两档回归用例",
      ].join("\n"),
    });
    await expect(webviewPage.getByTestId("plan-content-preview")).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/web-plan-approval.webp",
    );
  });

  test("新建会话：选目录与 worktree", async ({ webviewPage }) => {
    await emulateRemotePhone(webviewPage);
    const injector = new MessageInjector(webviewPage);
    await seedRemoteState(injector);
    await injector.updateMessages(conversation);
    await webviewPage.getByTestId("new-session-btn").click();
    await expect(
      webviewPage.getByTestId("remote-new-session-dialog"),
    ).toBeVisible();
    // 点最近目录 → 弹窗拉分支（决定下半区是「分支 + worktree」还是只有目录）。
    // requestId 由弹窗自己分配，回执必须原样带回，否则被当作过期回包丢掉。
    await webviewPage
      .getByTestId("remote-new-session-recent-item")
      .first()
      .click();
    const branchRequest = await webviewPage.evaluate(() =>
      window
        .getTestMessages()
        .filter((m) => m.command === "newSessionListBranches")
        .pop(),
    );
    await injector.simulateExtensionMessage("newSessionBranches", {
      requestId: (branchRequest as { requestId?: string } | undefined)
        ?.requestId,
      // 宿主 `listGitBranches` 的回执形状：一对 {branches, current}（与桌面端
      // `desktopGitBranches` 同一份），不是裸的分支名数组。
      result: { branches: ["main", "fix/login-alignment"], current: "main" },
    });
    await expect(
      webviewPage.getByTestId("remote-new-session-branch-select"),
    ).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/web-new-session.webp",
    );
  });

  test("会话行级动作：重命名 / 删除会话", async ({ webviewPage }) => {
    await emulateRemotePhone(webviewPage);
    const injector = new MessageInjector(webviewPage);
    await seedRemoteState(injector);
    await injector.updateMessages(conversation);
    await webviewPage.getByTestId("session-switch-btn").click();
    await webviewPage.getByTestId("remote-session-more-s-web-2").click();
    await expect(
      webviewPage.getByTestId("remote-session-actions"),
    ).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/web-session-actions.webp",
    );
  });

  test("更多菜单：通知开关与设置入口", async ({ webviewPage }) => {
    await emulateRemotePhone(webviewPage);
    const injector = new MessageInjector(webviewPage);
    await seedRemoteState(injector);
    await injector.updateMessages(conversation);
    await injector.simulateExtensionMessage("pushState", {
      supported: true,
      subscribed: true,
      needsHomeScreen: false,
    });
    await webviewPage.getByTestId("more-btn").click();
    await expect(webviewPage.locator(".more-menu")).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/web-more-menu.webp",
    );
  });

  test("切换电脑：机器列表浮层", async ({ webviewPage }) => {
    await emulatePhoneViewport(webviewPage);
    // 这个浮层由页面 shim 手写 DOM（不在共享 webview 里，`isRemotePageHost()`
    // 分支也照不到它），只能把**真 shim** 装进浏览器里跑一遍。做法：假一个
    // `remote.test` 源，index.html 内联 shim.js，机器列表接口用 route 挡住回桩
    // 数据 —— shim 冷启动没有 `?host=` 时自己就弹这个列表，不需要真实中继。
    const shimSource = fs.readFileSync(
      path.join(process.cwd(), "remote", "shim.js"),
      "utf8",
    );
    const hosts = [
      {
        id: "host-a",
        name: "dev-macbook-pro",
        platform: "darwin",
        online: true,
      },
      { id: "host-b", name: "ci-linux-02", platform: "linux", online: true },
      {
        id: "host-c",
        name: "win-workstation",
        platform: "win32",
        online: false,
      },
    ];
    await webviewPage.route("http://remote.test/**", (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname === "/api/relay/hosts") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ hosts }),
        });
      }
      if (pathname === "/" || pathname === "/index.html") {
        return route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body:
            `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8" />` +
            `<meta name="viewport" content="width=device-width, initial-scale=1" />` +
            `<style>html,body{margin:0;height:100%;background:#1f1f1f}</style></head><body>` +
            // 有令牌就不再走续期，直接落到「没有通道键 → 自己挑一台机器」
            `<script>try{localStorage.setItem("token","demo-token")}catch(e){}</script>` +
            `<script>${shimSource}</script></body></html>`,
        });
      }
      return route.fulfill({ status: 404, body: "" });
    });
    await webviewPage.goto("http://remote.test/index.html");
    await expect(webviewPage.locator("#remote-machine-picker")).toBeVisible();
    await expect(webviewPage.locator("#remote-machine-list")).toContainText(
      "ci-linux-02",
    );
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/web-machine-picker.webp",
    );
  });

  test("宽表：在表格区域内横向滚动，短词不被压成竖排", async ({
    webviewPage,
  }) => {
    // 回归：横向滚动原先只写在 `[data-host="desktop"]` 层，远控页（`data-host` 是
    // ide 档）拿不到 → 宽表被 `.messages-column` 的 `overflow-x: clip` 静默裁掉，
    // 右侧列既看不见也滚不到（2026-10-21 用户报「iOS 上 table 没法横向滚动」）。
    // 同时列宽分配（短 token 单行 / 长 token 断行）也只在桌面层，手机档没有它时
    // 每个中文格被压到 1 字宽，滚过去看见的是逐字竖排 —— 两半一起量。
    // 这条只能在真浏览器里量：jsdom 不解析样式表、更没有横向滚动。
    await emulateRemotePhone(webviewPage);
    const injector = new MessageInjector(webviewPage);
    await seedRemoteState(injector);
    const wideTable = [
      "改动清单：",
      "",
      "| 模块 | 文件 | 状态 | 负责人 | 说明 |",
      "| --- | --- | --- | --- | --- |",
      "| 登录表单 | packages/webview/src/components/LoginForm.tsx | 已完成 | 张三 | 断点改成单列后按钮不再错位 |",
      "| 订单状态机 | packages/agent-sdk/src/services/orderStateMachine.ts | 进行中 | 李四 | 抽成独立模块并补测试 |",
    ].join("\n");
    await injector.updateMessages([
      MockDataGenerator.createUserMessage("给我看下改动清单", "msg-web-tbl-u"),
      MockDataGenerator.createAssistantMessage(wideTable, "msg-web-tbl-a"),
    ]);

    const scroll = await webviewPage.evaluate(() => {
      const wrap = document.querySelector(
        ".md-table-scroll",
      ) as HTMLElement | null;
      if (!wrap) return null;
      const lastCell = wrap.querySelector("th:last-child") as HTMLElement;
      const before = getComputedStyle(wrap).overflowX;
      // 短 token 格（md-cell-token，如「已完成」「张三」）必须保持单行：直接数文字
      // 行框数量——被压成竖排时一个 3 字词会拆成 3 个行框。
      const tokenLines = Array.from(
        wrap.querySelectorAll("td.md-cell-token"),
      ).map((cell) => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        return { text: cell.textContent, lines: range.getClientRects().length };
      });
      wrap.scrollLeft = wrap.scrollWidth;
      const wrapBox = wrap.getBoundingClientRect();
      return {
        overflowX: before,
        clientWidth: wrap.clientWidth,
        scrollWidth: wrap.scrollWidth,
        maxScrollLeft: wrap.scrollLeft,
        // 滚到最右：末列表头右缘落在滚动容器内（不再被裁）
        lastCellRight: lastCell.getBoundingClientRect().right,
        wrapRight: wrapBox.right,
        pageHorizontalScroll:
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
        tokenLines,
      };
    });

    expect(scroll).not.toBeNull();
    // 真有横向溢出（否则这条用例是空跑）。
    expect(scroll!.scrollWidth).toBeGreaterThan(scroll!.clientWidth);
    // 承接溢出的就是表格自己的滚动容器。
    expect(scroll!.overflowX).toBe("auto");
    expect(scroll!.maxScrollLeft).toBeGreaterThan(0);
    // 滚到底时末列完整可见（留 1px 亚像素余量）。
    expect(scroll!.lastCellRight).toBeLessThanOrEqual(scroll!.wrapRight + 1);
    // 页面本身不因此横向滚动。
    expect(scroll!.pageHorizontalScroll).toBe(0);
    // 短 token 格不被挤成逐字竖排：每格只占一行。
    expect(scroll!.tokenLines.length).toBeGreaterThan(0);
    expect(scroll!.tokenLines.filter((c) => c.lines !== 1)).toEqual([]);
  });

  test("电脑侧开启：页面地址与二维码", async ({ webviewPage }) => {
    // 入口在**电脑**上：桌面端 / IDE 插件的设置页「远程控制」项。手机页自己
    // 不画这个二维码（它本身就是二维码指向的那一端）。
    await openSettings(webviewPage, {
      width: 1000,
      height: 760,
      settingsState: { workdir: DIR_A, nav: "remoteControl" },
    });
    // 视图挂载即轮询 `remoteControl`，回执按 requestId 关联 —— 必须带最新那次。
    const request = await webviewPage.evaluate(() =>
      window
        .getTestMessages()
        .filter((m) => m.command === "remoteControl")
        .pop(),
    );
    await simulateHostMessage(webviewPage, {
      command: "remoteControlResponse",
      requestId: (request as { requestId?: string } | undefined)?.requestId,
      snapshot: {
        state: "online",
        pageUrl:
          "https://codechat.codewave.163.com/remote/?host=7cg4m2xw9pk1qv3b",
      },
    });
    await expect(webviewPage.getByTestId("remote-control-qr")).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-remote-control.webp",
    );
  });
});
