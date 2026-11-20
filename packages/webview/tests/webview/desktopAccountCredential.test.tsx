/**
 * 桌面端账户卡片「认证方式」的几何：企业账号（sso）与自定义网关（gateway）两种
 * 形态**必须逐像素同构** —— 行业高相同、卡片总高相同、主文本不被截断
 * （spec `docs/specs/desktop/desktop-account.md`「账户卡片 · 认证方式」场景 2 与
 * 「独立测试」里的几何断言）。
 *
 * 迁移自 `e2e/desktop-account-credential.e2e.ts`。为什么要在意：卡片 `flex-shrink: 0`
 * 钉在侧栏底部，行高一变就挤压会话列表，两种形态也立刻不对称 ——「自定义网关 +
 * 域名次行」那个方案正是因为把行高从 30px 抬到约 46px 被否掉的。
 *
 * 本套件跑在真 Chromium 里，`getBoundingClientRect` / `clientWidth` / `scrollWidth`
 * 都是真布局（形态与菜单项的行为断言在 `accountCardCredential.test.tsx`）。
 */

import { describe, it, expect, afterEach } from "vitest";
import { page } from "vitest/browser";
import { sendCommand } from "./test-utils";
import {
  bootDesktop,
  isVisible,
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
} from "./desktopHarness";

const DIR_A = "/Users/dev/projects/wave-agent";

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
  /** 主文本的可用宽度与内容宽度（内容比可用宽 = 被 ellipsis 截断）。 */
  nameClientWidth: number;
  nameScrollWidth: number;
};

/** 量卡片的三块布局盒（真浏览器才有布局）。 */
function measureCard(): CardGeometry {
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
}

const cardName = () =>
  document.querySelector<HTMLElement>('[data-testid="account-card-name"]');

const hotzone = () =>
  document.querySelector<HTMLElement>('[data-testid="account-card-hotzone"]');

/** 启动到侧栏出现，再推一份账户快照（同一窗口尺寸下推两种形态）。 */
async function bootWith(account: Record<string, unknown>) {
  const result = renderDesktopApp();
  bootDesktop({ workdir: DIR_A });
  sendCommand("desktopAccountInfo", account);
  await expect.poll(() => isVisible('[data-testid="account-card"]')).toBe(true);
  return result;
}

afterEach(() => {
  resetHostTier();
  resetPanelState();
});

describe("Desktop account card authentication-form geometry", () => {
  it("企业账号与自定义网关两态的行业高、卡片总高完全一致，主文本不截断", async () => {
    await page.viewport(960, 720);
    await bootWith(ssoAccount);
    await expect
      .poll(() => (cardName()?.textContent ?? "").trim())
      .toBe("alice@example.com");
    const sso = measureCard();

    sendCommand("desktopAccountInfo", gatewayAccount);
    await expect
      .poll(() => (cardName()?.textContent ?? "").trim())
      .toBe("自定义网关");
    const gateway = measureCard();

    // 行高与卡片总高逐像素相同：网关形态不是「多一行」的另一种行。
    expect(gateway.rowHeight).toBe(sso.rowHeight);
    expect(gateway.cardHeight).toBe(sso.cardHeight);
    // 「自定义网关」6 个字必须整段可见（域名没被塞进行内）。
    expect(gateway.nameScrollWidth).toBeLessThanOrEqual(
      gateway.nameClientWidth,
    );
    expect(gateway.nameClientWidth).toBeGreaterThan(0);
  });

  it("网关域名只进 title：行内文本与 sso 形态同宽同高", async () => {
    await page.viewport(960, 720);
    await bootWith(gatewayAccount);

    await expect
      .poll(() => hotzone()?.getAttribute("title"))
      .toBe("自定义网关 · api.example.com");
    expect(hotzone()?.textContent ?? "").not.toContain("api.example.com");
    const shortHost = measureCard();

    // 长域名也不能把行撑开（它只进 title）：换成 52 字符的主机名后几何一模一样。
    const longHostName = "inference-gateway.internal.example.corp.example.com";
    sendCommand("desktopAccountInfo", {
      ...gatewayAccount,
      credential: { kind: "gateway", gateway: { host: longHostName } },
    });
    await expect
      .poll(() => hotzone()?.getAttribute("title"))
      .toBe(`自定义网关 · ${longHostName}`);
    const longHost = measureCard();
    expect(longHost.rowHeight).toBe(shortHost.rowHeight);
    expect(longHost.cardHeight).toBe(shortHost.cardHeight);
    expect(longHost.nameScrollWidth).toBeLessThanOrEqual(
      longHost.nameClientWidth,
    );
  });
});
