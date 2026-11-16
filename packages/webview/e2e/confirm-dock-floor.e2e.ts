import { test, expect } from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import { MockDataGenerator } from "./fixtures/mockData.js";
import { BASH_TOOL_NAME } from "wave-agent-sdk";

/**
 * 底部确认区的地板高度（`--approval-dock-floor`，形状对齐 CC 桌面端，
 * 见 ConfirmationDialog.css 顶部）。
 *
 * 两件事只能量：地板真的被扣住（computed style 拿不到就等于没生效）、
 * 以及窄容器把地板抬到 208px 的那一档（容器查询断的是「卡片自己多宽」，
 * 不是视口宽度 —— 侧栏 / 分屏 / 远控页各不同，写死视口会假绿）。
 */
const WORKDIR = "/Users/dev/projects/wave-agent";
const WIDE = { width: 1400, height: 900 };
const NARROW = { width: 760, height: 600 };

/** 与 ConfirmationDialog.css 同值：地板两档 + 容器查询断点。 */
const FLOOR_WIDE = 144;
const FLOOR_NARROW = 208;
const BREAKPOINT = 500;

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

/** 最短的那类确认（一行命令、无描述）：内容高度最容易掉到地板以下。 */
async function openShortConfirmation(
  page: import("@playwright/test").Page,
  confirmationId: string,
) {
  const injector = new MessageInjector(page);
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: WORKDIR,
    recentWorkdirs: [WORKDIR],
  });
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", initialState);
  await expect(page.getByTestId("desktop-workdir")).toBeVisible();
  await injector.updateMessages([
    MockDataGenerator.createUserMessage("看下当前目录。", "msg-floor-u1"),
  ]);

  await injector.simulateExtensionMessage("showConfirmation", {
    confirmationId,
    toolName: BASH_TOOL_NAME,
    confirmationType: "Bash 命令执行确认",
    toolInput: { command: "ls" },
  });
  await page.waitForSelector(".confirmation-dialog");
  return injector;
}

/** 卡片高度、地板值、以及容器（.confirmation-dialog 的 content box）宽度。 */
async function measure(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const card = document.querySelector(
      ".confirmation-dialog-inner",
    ) as HTMLElement;
    const dialog = document.querySelector(
      ".confirmation-dialog",
    ) as HTMLElement;
    const style = getComputedStyle(dialog);
    return {
      cardHeight: card.getBoundingClientRect().height,
      floor: getComputedStyle(card)
        .getPropertyValue("--approval-dock-floor")
        .trim(),
      // 容器查询断的是容器的 content box
      containerWidth:
        dialog.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight),
    };
  });
}

test.describe("confirmation dock floor", () => {
  test("keeps the dock floor, raised in a narrow container", async ({
    webviewPage,
  }) => {
    await webviewPage.setViewportSize(WIDE);
    await openShortConfirmation(webviewPage, "floor-wide");

    const wide = await measure(webviewPage);
    // 宽档：容器在断点以上 ⇒ 144px 地板
    expect(wide.containerWidth).toBeGreaterThan(BREAKPOINT);
    expect(wide.floor).toBe(`${FLOOR_WIDE}px`);
    expect(wide.cardHeight).toBeGreaterThanOrEqual(FLOOR_WIDE);

    await webviewPage.setViewportSize(NARROW);
    await webviewPage.waitForTimeout(150);

    const narrow = await measure(webviewPage);
    // 窄档：容器掉到断点以下 ⇒ 地板抬到 208px，卡片高度跟着抬
    expect(narrow.containerWidth).toBeLessThanOrEqual(BREAKPOINT);
    expect(narrow.floor).toBe(`${FLOOR_NARROW}px`);
    expect(narrow.cardHeight).toBeGreaterThanOrEqual(FLOOR_NARROW);
  });
});
