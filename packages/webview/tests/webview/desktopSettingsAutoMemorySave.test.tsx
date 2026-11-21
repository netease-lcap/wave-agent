/**
 * 桌面设置页「个性化 → 自动记忆规则」的保存路径：用户改的开关与轮次必须真的离开
 * webview（#2115「自动记忆开关不生效」的 webview 侧守护）。
 *
 * 迁移自 `e2e/desktop-settings-auto-memory-save.e2e.ts`。#2115 的根因是
 * `autoMemoryEnabled` / `autoMemoryFrequency` 在 webview 保存 → host → CLI → SDK
 * 链上缺字段、全 optional 编译期不报错。原缺陷落在下游（host→CLI→SDK），webview
 * 这一跳当时是对的；本用例把这一跳钉死，防后续重构悄悄把字段丢掉。
 *
 * 分层：host → CLI 的 stdio 透传由补测会话负责；host 落 `~/.wave/settings.json`、
 * SDK 实时重载由 desktop 单测与真 host 层负责（见 agent-config.md「验证分层」）。
 */

import { describe, it, expect, afterEach } from "vitest";
import { page, userEvent } from "vitest/browser";
import { screen } from "@testing-library/react";
import { sendCommand } from "./test-utils";
import {
  bootDesktop,
  isVisible,
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
  sentCommands,
} from "./desktopHarness";

const WORKDIR = "/Users/dev/projects/wave-agent";

const accountInfo = {
  isAuthenticated: true,
  user: { id: "user-1", email: "alice@example.com" },
  billing: null,
  apiQuota: null,
};

afterEach(() => {
  resetHostTier();
  resetPanelState();
});

/** 起一遍桌面端并推一份配置（`configurationData` 随初值一起下发）。 */
function boot(configurationData: Record<string, unknown>) {
  const { vscode } = renderDesktopApp();
  bootDesktop({ workdir: WORKDIR, extra: { configurationData } });
  sendCommand("desktopAccountInfo", accountInfo);
  return vscode;
}

/** 左导航按文案点一项（`settings-nav-item` 是图标 + 文字的按钮）。 */
async function clickNavItem(label: string) {
  const item = Array.from(
    document.querySelectorAll<HTMLElement>(".settings-nav-item"),
  ).find((el) => (el.textContent ?? "").includes(label));
  expect(item).toBeTruthy();
  await userEvent.click(item!);
}

/** 侧栏账户卡「更多」→「设置」→ 左导航「个性化」。 */
async function openPersonalization() {
  await expect
    .poll(() => isVisible('[data-testid="account-card-hotzone"]'))
    .toBe(true);
  await userEvent.click(screen.getByTestId("account-card-hotzone"));
  await expect.poll(() => isVisible('[data-testid="more-menu"]')).toBe(true);
  await userEvent.click(screen.getByTestId("more-menu-settings"));
  await expect.poll(() => isVisible(".settings-page")).toBe(true);
  await clickNavItem("个性化");
  await expect
    .poll(() =>
      screen.queryAllByRole("heading", { name: "自动记忆规则" }).some((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }),
    )
    .toBe(true);
}

/** 「自动记忆规则」那张卡片（原文 `locator("section", { has: heading })`）。 */
function memorySection(): HTMLElement {
  const section = screen
    .getByRole("heading", { name: "自动记忆规则" })
    .closest("section");
  expect(section).toBeTruthy();
  return section as HTMLElement;
}

/** 卡片里的某个控件（`input[aria-label=…]`）。 */
function control(ariaLabel: string): HTMLInputElement {
  const el = memorySection().querySelector<HTMLInputElement>(
    `input[aria-label="${ariaLabel}"]`,
  );
  expect(el).toBeTruthy();
  return el!;
}

/** 某个开关控件对应的样式化外层（复选框本体 opacity:0，用户点的是它）。 */
function switchOf(ariaLabel: string): HTMLElement {
  const wrapper = control(ariaLabel).closest(".settings-switch");
  expect(wrapper).toBeTruthy();
  return wrapper as HTMLElement;
}

/**
 * `mark` 之后发出的同类报文（原文 `clearMessageLog()` + `getTestMessages()`
 * `.filter(command)`：记下当时的条数，之后只看切片）。
 */
const postedSince = (
  vscode: { postMessage: unknown },
  mark: number,
  command: string,
) =>
  sentCommands(vscode)
    .slice(mark)
    .filter((message) => message.command === command);

const postedSinceOne = (
  vscode: { postMessage: unknown },
  mark: number,
  command: string,
) => postedSince(vscode, mark, command)[0];

describe("桌面设置页「个性化 → 自动记忆规则」保存路径", () => {
  it("关掉开关 + 改轮次：两个控件各自即时发出 updateConfiguration", async () => {
    await page.viewport(1280, 800);
    const vscode = boot({
      language: "zh-CN",
      autoMemoryEnabled: true,
      autoMemoryFrequency: 1,
    });
    await openPersonalization();
    // 打开设置页会 post getConfiguration（desktopHost 的生效配置回包）；mock 里
    // 无 paneId 的消息会被路由到聚焦 pane，故这里显式回一次 configurationResponse
    // ——它不受 pane 门控，根实例（渲染全页设置页的那一个）据此拿到配置。
    sendCommand("configurationResponse", {
      configurationData: {
        language: "zh-CN",
        autoMemoryEnabled: true,
        autoMemoryFrequency: 1,
      },
    });

    const toggle = control("开启自动记忆");
    const frequency = control("触发记忆提取会话轮次");
    await expect.poll(() => toggle.checked).toBe(true);

    // 打开设置页之后的报文不再关心，从用户的真实动作开始记录。
    const mark = sentCommands(vscode).length;

    // 开关的 checkbox 本体是 opacity:0 的隐藏 input，交互点在样式化的外层
    // .settings-switch 上（与真机一致）。
    await userEvent.click(switchOf("开启自动记忆"));
    await expect.poll(() => control("开启自动记忆").checked).toBe(false);
    // 设置页没有「保存」按钮：拨动即写、轮次在失焦时写。
    await userEvent.fill(frequency, "6");
    control("触发记忆提取会话轮次").blur();

    await expect
      .poll(() => postedSince(vscode, mark, "updateConfiguration").length)
      .toBe(2);
    expect(postedSince(vscode, mark, "updateConfiguration")).toEqual([
      // 每个控件只管自己那一键（spec agent-config 场景 8 的 diff 语义 +
      // 「设置页控件的保存时机」）：未改的 language 不出现在任何报文里。
      {
        command: "updateConfiguration",
        configurationData: { autoMemoryEnabled: false },
      },
      {
        command: "updateConfiguration",
        configurationData: { autoMemoryFrequency: 6 },
      },
    ]);

    // 保存路径只落盘 + 回执（PR-2）：不得因保存触发任何会话重建或插件重载——
    // 真 host 若要重建会先弹确认框并等用户回执，故「没有确认框、没有
    // reloadPlugins 回执」在 UI 上就等于「没有重建」（spec plugin「插件变更的
    // 就地重载」）；设置页自身仍是保存后的状态。
    expect(document.querySelectorAll(".confirm-dialog").length).toBe(0);
    expect(postedSinceOne(vscode, mark, "reloadPlugins")).toBeUndefined();
    expect(isVisible(".settings-page")).toBe(true);
  });

  it("host 下发的自动记忆偏好如实回填（关闭态/自定义轮次）", async () => {
    await page.viewport(1280, 800);
    boot({
      language: "zh-CN",
      autoMemoryEnabled: true,
      autoMemoryFrequency: 1,
    });
    await openPersonalization();

    // host 回发生效配置（例如另一处改动或外部更新）：界面必须跟着走到「关闭 + 7 轮」
    sendCommand("configurationResponse", {
      configurationData: {
        language: "zh-CN",
        autoMemoryEnabled: false,
        autoMemoryFrequency: 7,
      },
    });

    await expect.poll(() => control("开启自动记忆").checked).toBe(false);
    await expect.poll(() => control("触发记忆提取会话轮次").value).toBe("7");
  });
});
