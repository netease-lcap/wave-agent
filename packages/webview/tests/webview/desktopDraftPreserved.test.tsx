/**
 * 桌面端输入草稿跨视图切换保留（spec `desktop-sessions.md`「会话管理」场景 23 +
 * `desktop-preview.md`「预览面板全屏」场景 7）：进设置页 / 看会话看板 / 进预览全屏
 * 再回来，未发送的输入内容必须还在。
 *
 * 迁移自 `e2e/desktop-draft-preserved.e2e.ts`。原文强调只有真浏览器能验：全屏那条
 * 的关键是「对话列缩成浮动卡片、输入框仍挂在同一处」，不跑样式拿不到可见性。这里
 * 同样跑在真 Chromium 里（browser mode）。
 *
 * 宿主那一半（`webviewReady` → `setInitialState` 按下发的 `inputContent` 回填草稿）
 * 由用例手动模拟：从页面发出的 `updateInputContent` 里取草稿，再按快照回灌。
 *
 * 草稿里的粘贴图片走 webview 侧的 IndexedDB（`[@image:<id>]` 标记 + 本地字节），
 * browser mode 的页面是真实 http origin（不是 e2e 用的 `setContent` 那种 opaque
 * origin），IndexedDB 可以直接用。
 */

import { describe, it, expect, afterEach } from "vitest";
import { page, userEvent } from "vitest/browser";
import { fireEvent, screen } from "@testing-library/react";
import { sendCommand } from "./test-utils";
import {
  bootDesktop,
  isVisible,
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
  sentCommands,
} from "./desktopHarness";

const DIR = "/Users/dev/projects/wave-agent";
const SESSION = {
  id: "s-draft-1",
  sessionType: "main" as const,
  workdir: DIR,
  firstMessage: "修复下单接口的超时问题",
  lastActiveAt: 1782000000000,
  latestTotalTokens: 1200,
};
// 单行草稿：contenteditable 里不涉及 <br> 换行，断言只看文本。
const DRAFT = "把下单接口的重试次数改成 3 次，并补一条超时用例";
/** 上传文件的绝对路径（宿主回 uploadedFiles 时给的就是它）。 */
const UPLOADED = `${DIR}/src/order.ts`;

type Vscode = { postMessage: unknown };

afterEach(() => {
  resetHostTier();
  resetPanelState();
});

/** 宿主 inputDrafts 里这一版草稿（页面最后一次 `updateInputContent` 的内容）。 */
function lastDraft(vscode: Vscode): string {
  return (
    (sentCommands(vscode)
      .filter((message) => message.command === "updateInputContent")
      .map((message) => message.content as string)
      .pop() ??
      "") ||
    ""
  );
}

/**
 * 模拟宿主在 `webviewReady` 之后重发权威快照：`inputContent` 取 `inputDrafts`
 * 的值。桌面端就是这样把草稿送回重挂载的输入框的。
 */
function replaySnapshot(vscode: Vscode, draft: string) {
  sendCommand("setInitialState", {
    messages: [],
    isStreaming: false,
    isAuthenticated: true,
    permissionMode: "default",
    inputContent: draft,
    session: SESSION,
  });
}

/** 一条消息文本（输入框正文）——内容是标签 + 文本时只能看 textContent。 */
const inputText = () =>
  (
    document.querySelector<HTMLElement>('[data-testid="message-input"]')
      ?.textContent ?? ""
  ).trim();

const inputCount = () =>
  document.querySelectorAll('[data-testid="message-input"]').length;

/** 输入框里某选择器的元素个数（`toHaveCount` 的等价写法）。 */
const countInInput = (selector: string) =>
  document
    .querySelector<HTMLElement>('[data-testid="message-input"]')!
    .querySelectorAll(selector).length;

/** 起一遍桌面端：工作目录 + 空会话（欢迎页）+ 一条未发送草稿的空位。 */
async function setup() {
  const { vscode } = renderDesktopApp();
  bootDesktop({
    workdir: DIR,
    extra: { inputContent: "", session: SESSION },
  });
  // 原文的 `waitForChatAppReady()`：pane 里的 ChatApp 挂上监听器之后才推初值。
  await expect
    .poll(() => isVisible('[data-testid="message-input"]'))
    .toBe(true);
  sendCommand("authStatusResponse", {
    isAuthenticated: true,
    user: { id: "user-1", email: "alice@example.com" },
  });
  // 账户卡片（设置页入口）由 authStatusResponse 的 user 驱动。
  await expect
    .poll(() => isVisible('[data-testid="account-card-hotzone"]'))
    .toBe(true);
  return { vscode };
}

/** 从侧栏账户卡片进设置页，等到「全局设置」真的顶替了对话区。 */
async function openSettings() {
  await userEvent.click(screen.getByTestId("account-card-hotzone"));
  await expect
    .poll(() => isVisible('[data-testid="more-menu-settings"]'))
    .toBe(true);
  await userEvent.click(screen.getByTestId("more-menu-settings"));
  const heading = await screen.findByRole("heading", { name: "全局设置" });
  expect(heading.getBoundingClientRect().height).toBeGreaterThan(0);
}

/** 设置页返回（左侧返回箭头）。 */
async function closeSettings() {
  await userEvent.click(document.querySelector<HTMLElement>(".settings-back")!);
}

/** 1x1 透明 PNG：草稿图片就是一段 data URL，图里画了什么不参与断言。 */
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** 往输入框塞一张粘贴图：结构与真实粘贴产物一致（只是不经过剪贴板）。 */
function pasteImage() {
  const input = document.querySelector<HTMLElement>(
    '[data-testid="message-input"]',
  );
  if (!input) throw new Error("message-input missing");
  input.appendChild(document.createTextNode("这张图里是什么 "));
  const chip = document.createElement("span");
  chip.className = "context-tag-container";
  chip.contentEditable = "false";
  chip.setAttribute("data-path", "pasted-image-e2e.png");
  chip.setAttribute("data-name", "图片 1");
  chip.setAttribute("data-is-image", "true");
  chip.setAttribute("data-image-url", PNG);
  chip.textContent = "图片 1";
  input.appendChild(chip);
  fireEvent.input(input, { bubbles: true });
}

describe("Desktop 输入草稿跨视图切换保留", () => {
  it("设置页 / 会话看板 / 预览全屏往返后草稿仍在", async () => {
    await page.viewport(1080, 720);
    const { vscode } = await setup();

    const input = screen.getByTestId("message-input");
    await userEvent.click(input);
    await userEvent.keyboard(DRAFT);
    await expect.poll(inputText).toBe(DRAFT);

    // ── 1. 设置页往返 ────────────────────────────────────────────────
    await openSettings();
    // 设置页顶替会话区：输入框随对话区一起卸载，草稿只剩宿主那一份。
    expect(inputCount()).toBe(0);
    // 原文把 `lastDraft` 读一次再比；那次读之所以拿得到，是因为 Playwright 每步
    // 都等页面稳定（早过了 150ms 上报防抖）。这里对同一个值轮询，等的是同一份
    // 宿主草稿，判据不放宽（仍要求逐字相等）。
    await expect.poll(() => lastDraft(vscode), { timeout: 4000 }).toBe(DRAFT);
    const afterSettings = lastDraft(vscode);
    expect(afterSettings).toBe(DRAFT);
    await closeSettings();
    replaySnapshot(vscode, afterSettings);
    await expect.poll(inputText).toBe(DRAFT);

    // ── 2. 会话看板往返 ──────────────────────────────────────────────
    await userEvent.click(screen.getByTestId("desktop-sidebar-activity"));
    await expect
      .poll(() => isVisible('[data-testid="session-board"]'))
      .toBe(true);
    expect(inputCount()).toBe(0);
    await expect.poll(() => lastDraft(vscode), { timeout: 4000 }).toBe(DRAFT);
    const afterBoard = lastDraft(vscode);
    expect(afterBoard).toBe(DRAFT);
    await userEvent.click(screen.getByRole("button", { name: "返回当前会话" }));
    replaySnapshot(vscode, afterBoard);
    await expect.poll(inputText).toBe(DRAFT);

    // ── 3. 预览全屏往返 ─────────────────────────────────────────────
    await userEvent.click(screen.getByTestId("panel-toggle-btn"));
    await userEvent.click(
      await screen.findByTestId("panel-empty-item-preview"),
    );
    await userEvent.click(await screen.findByTestId("panel-fullscreen"));
    // 全屏下对话框缩成浮动卡片、仍是同一个输入框实例——所以草稿一定还在。
    expect(isVisible('[data-testid="message-input"]')).toBe(true);
    expect(inputText()).toBe(DRAFT);
    await userEvent.click(screen.getByTestId("panel-fullscreen"));
    expect(isVisible('[data-testid="message-input"]')).toBe(true);
    expect(inputText()).toBe(DRAFT);
    // 退出全屏把焦点还给输入框，用户可以接着打字。
    expect(document.activeElement).toBe(
      document.querySelector('[data-testid="message-input"]'),
    );
  });

  it("设置页往返后 @ 文件引用仍是引用标签、不退化成文本", async () => {
    await page.viewport(1080, 720);
    const { vscode } = await setup();

    const input = screen.getByTestId("message-input");
    await userEvent.click(input);
    await userEvent.keyboard("这个文件里写的是什么");

    // 上传完成：宿主回 uploadedFiles，输入框插入引用标签（+ 菜单上传那条路径）
    sendCommand("uploadSuccess", { uploadedFiles: [UPLOADED] });
    const chipSelector = `.context-tag-container[data-path="${UPLOADED}"]`;
    await expect.poll(() => countInInput(chipSelector)).toBe(1);

    // ── 设置页往返：输入框随对话区卸载，草稿只剩宿主那一份 ──────────────
    await openSettings();
    expect(inputCount()).toBe(0);
    // 草稿里必须是引用标记，而不是标签的可见文字（"@order.ts"）
    await expect
      .poll(() => lastDraft(vscode), { timeout: 4000 })
      .toContain(`[@file:${UPLOADED}]`);
    const draft = lastDraft(vscode);
    expect(draft).toContain(`[@file:${UPLOADED}]`);
    expect(draft).toContain("这个文件里写的是什么");

    await closeSettings();
    replaySnapshot(vscode, draft);
    await expect.poll(() => countInInput(chipSelector)).toBe(1);
    expect(inputText()).toContain("这个文件里写的是什么");
    // 标记语法不得残留在正文里
    expect(inputText()).not.toContain("[@file:");
  });

  it("设置页往返后草稿里的粘贴图片仍是图片标签、仍能随消息发出", async () => {
    await page.viewport(1080, 720);
    const { vscode } = await setup();

    const input = screen.getByTestId("message-input");
    await userEvent.click(input);
    pasteImage();
    const imageChip = '.context-tag-container[data-is-image="true"]';
    await expect.poll(() => countInInput(imageChip)).toBe(1);

    // 防抖 150ms 后才上报：图片字节落进本会话的本地存储，草稿文本里只剩标记。
    await expect
      .poll(() => lastDraft(vscode), { timeout: 4000 })
      .toContain("[@image:");
    const draft = lastDraft(vscode);
    expect(draft).toContain("这张图里是什么");

    // ── 设置页往返：输入框随对话区卸载，宿主只留得住那份草稿文本 ──────────
    await openSettings();
    expect(inputCount()).toBe(0);
    await closeSettings();
    replaySnapshot(vscode, draft);

    // 字节要异步从 IndexedDB 取回（`hydrateDraftImages`），所以等标签自己补齐。
    const restoredChip = () =>
      document.querySelector<HTMLElement>(
        `[data-testid="message-input"] ${imageChip}`,
      );
    await expect
      .poll(() => restoredChip()?.getAttribute("data-image-url") ?? "", {
        timeout: 4000,
      })
      .toBe(PNG);
    expect(countInInput(imageChip)).toBe(1);
    expect(inputText()).toContain("这张图里是什么");
    // 标记语法不得残留在正文里
    expect(inputText()).not.toContain("[@image:");

    // 图片随消息发出：发送载荷里仍是图片数据，不是「文件引用 + 让模型读文件」。
    // `{Enter}` 与原文的 `keyboard.press("Enter")` 一样打给当前焦点元素——回填之后
    // 焦点仍在输入框上（用户可以直接接着敲），不必再点一下。
    const mark = sentCommands(vscode).length;
    await userEvent.keyboard("{Enter}");
    await expect
      .poll(
        () =>
          sentCommands(vscode)
            .slice(mark)
            .find((message) => message.command === "sendMessage"),
        { timeout: 4000 },
      )
      .toBeTruthy();
    const outgoing = sentCommands(vscode)
      .slice(mark)
      .find((message) => message.command === "sendMessage");
    expect(JSON.stringify(outgoing)).toContain("image/png");
  });
});
