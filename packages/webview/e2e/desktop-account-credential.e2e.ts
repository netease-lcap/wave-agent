import type { Page } from "@playwright/test";
import { test, expect } from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";

/**
 * 真浏览器（真布局）下的账户卡片「认证方式」几何：企业账号（sso）与自定义网关
 * （gateway）两种形态**必须逐像素同构**——行业高相同、卡片总高相同、主文本不
 * 被截断（spec `docs/specs/desktop/desktop-account.md`「账户卡片 · 认证方式」
 * 场景 2 与「独立测试」里的几何断言）。
 *
 * jsdom 没有布局（`getBoundingClientRect` 全 0、`scrollWidth` 也是 0），所以这
 * 三条只能在这里验。为什么要在意：卡片 `flex-shrink: 0` 钉在侧栏底部，行高一变
 * 就挤压会话列表，两种形态也立刻不对称——「自定义网关 + 域名次行」那个方案正是
 * 因为把行高从 30px 抬到约 46px 被否掉的。
 */

const DIR_A = "/Users/dev/projects/wave-agent";

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

const ssoAccount = {
  isAuthenticated: true,
  credential: { kind: "sso" },
  user: { id: "user-1", email: "alice@example.com" },
  billing: null,
  apiQuota: null,
};

const gatewayAccount = {
  isAuthenticated: false,
  credential: { kind: "gateway", gateway: { host: "api.example.com" } },
  user: null,
  billing: null,
  apiQuota: null,
};

type CardGeometry = {
  /** 个人信息行（`.account-card-main`）与卡片本身的高度。 */
  rowHeight: number;
  cardHeight: number;
  /** 主文本的可用宽度与内容宽度（相等或更宽 = 被 ellipsis 截断）。 */
  nameClientWidth: number;
  nameScrollWidth: number;
};

async function measureCard(webviewPage: Page): Promise<CardGeometry> {
  return webviewPage.evaluate(() => {
    const row = document.querySelector<HTMLElement>(".account-card-main");
    const card = document.querySelector<HTMLElement>(
      '[data-testid="account-card"]',
    );
    const name = document.querySelector<HTMLElement>(
      '[data-testid="account-card-name"]',
    );
    if (!row || !card || !name) throw new Error("账户卡片的布局盒量不到");
    return {
      rowHeight: row.getBoundingClientRect().height,
      cardHeight: card.clientHeight,
      nameClientWidth: name.clientWidth,
      nameScrollWidth: name.scrollWidth,
    };
  });
}

/** 同一窗口尺寸下推两种凭据形态的快照（其余字段一致）。 */
async function bootWith(
  webviewPage: Page,
  account: Record<string, unknown>,
): Promise<MessageInjector> {
  const injector = new MessageInjector(webviewPage);
  await webviewPage.setViewportSize({ width: 960, height: 720 });
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A],
  });
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", initialState);
  await injector.simulateExtensionMessage("desktopAccountInfo", account);
  await expect(webviewPage.getByTestId("account-card")).toBeVisible();
  return injector;
}

test.describe("Desktop account card authentication-form geometry", () => {
  test("企业账号与自定义网关两态的行业高、卡片总高完全一致，主文本不截断", async ({
    webviewPage,
  }) => {
    await bootWith(webviewPage, ssoAccount);
    await expect(webviewPage.getByTestId("account-card-name")).toHaveText(
      "alice@example.com",
    );
    const sso = await measureCard(webviewPage);

    const injector = new MessageInjector(webviewPage);
    await injector.simulateExtensionMessage(
      "desktopAccountInfo",
      gatewayAccount,
    );
    await expect(webviewPage.getByTestId("account-card-name")).toHaveText(
      "自定义网关",
    );
    const gateway = await measureCard(webviewPage);

    // 行高与卡片总高逐像素相同：网关形态不是「多一行」的另一种行。
    expect(gateway.rowHeight).toBe(sso.rowHeight);
    expect(gateway.cardHeight).toBe(sso.cardHeight);
    // 「自定义网关」6 个字必须整段可见（域名没被塞进行内）。
    expect(gateway.nameScrollWidth).toBeLessThanOrEqual(
      gateway.nameClientWidth,
    );
    expect(gateway.nameClientWidth).toBeGreaterThan(0);
  });

  test("网关域名只进 title：行内文本与 sso 形态同宽同高", async ({
    webviewPage,
  }) => {
    await bootWith(webviewPage, gatewayAccount);

    const hotzone = webviewPage.getByTestId("account-card-hotzone");
    await expect(hotzone).toHaveAttribute(
      "title",
      "自定义网关 · api.example.com",
    );
    await expect(hotzone).not.toContainText("api.example.com");
    const shortHost = await measureCard(webviewPage);

    // 长域名也不能把行撑开（它只进 title）：换成 52 字符的主机名后几何一模一样。
    const longHostName = "inference-gateway.internal.example.corp.example.com";
    const injector = new MessageInjector(webviewPage);
    await injector.simulateExtensionMessage("desktopAccountInfo", {
      ...gatewayAccount,
      credential: { kind: "gateway", gateway: { host: longHostName } },
    });
    await expect(hotzone).toHaveAttribute(
      "title",
      `自定义网关 · ${longHostName}`,
    );
    const longHost = await measureCard(webviewPage);
    expect(longHost.rowHeight).toBe(shortHost.rowHeight);
    expect(longHost.cardHeight).toBe(shortHost.cardHeight);
    expect(longHost.nameScrollWidth).toBeLessThanOrEqual(
      longHost.nameClientWidth,
    );
  });
});
