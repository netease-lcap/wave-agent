import type { Page } from "@playwright/test";
import {
  openWebviewOnHttpOrigin,
  test,
  expect,
} from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";

/**
 * e2e（真 Chromium + 真 chat.js bundle）— 插入引用标签时，随 `prompt.edit` 上报
 * 给插件的必须是**用户看得见的那份草稿**，不能是标签内部的占位标记。
 *
 * 出处（#2950 B2，与 #2973「粘贴截图被拍成 `[image]`」同族）：三条 chip 插入路径
 * 都是「先给 `tagSpan.innerText` 写一句内部标记（`[@file:…]` / `[Selection: …]` /
 * `[@agent:…]` / `[@ide:…]`），再 `ReactDOM.createRoot(tagSpan).render(...)`，
 * 紧接着**同步**派发 `input`」。React 渲染要等一次微/宏任务才提交，所以
 * `handleInput` 读到的 `innerText` 还是那句标记 —— 这段文本被当成用户的编辑内容
 * 上报给插件，插件按它算偏移（拼写检查、语法闸门、改写），一次改写落地就把引用
 * 标签压成一串方括号字面量。
 *
 * 口径（本文件守的不变量）：**读 `innerText` 之前必须保证子节点已提交**。图片粘贴
 * 那条已经这么修了（`image-paste-prompt-edit.e2e.ts` 守着），这里守其余三条 ——
 * 它们此前在 e2e 里完全没覆盖，所以既查不出占位符外泄，也查不出「标签根本没渲染」。
 *
 * 断言写法说明：旧实现里「插入那一次上报」的 `inputText` 就是 `[Selection: …]`，
 * 修复后它变成标签的可见文本（`@PaymentService.ts#45-62`），因此不能靠标记去找
 * 那一次上报 —— 这里对**整段交互的每一条**上报都断言「两个字段里没有内部标记」，
 * 修复前必红、修复后必绿。
 */

const DIR = "/Users/dev/projects/wave-agent";
const SESSION = {
  id: "s-prompt-edit-chip",
  sessionType: "main" as const,
  workdir: DIR,
  firstMessage: "",
  lastActiveAt: 1782000000000,
  latestTotalTokens: 0,
};

const selection = {
  filePath: "/src/services/payment/PaymentService.ts",
  fileName: "PaymentService.ts",
  startLine: 45,
  endLine: 62,
  selectedText: "async processPayment(tx: PaymentTx): Promise<Result> {",
  isEmpty: false,
};

interface PromptEditReport {
  requestId: string;
  text: string;
  cursor: number;
  start: number;
  end: number;
  inputText: string;
}

async function setup(injector: MessageInjector, page: Page) {
  await page.setViewportSize({ width: 1080, height: 720 });
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: DIR,
    recentWorkdirs: [DIR],
  });
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", {
    messages: [],
    isStreaming: false,
    isAuthenticated: true,
    permissionMode: "default",
    inputContent: "",
    session: SESSION,
  });
  await injector.simulateExtensionMessage("authStatusResponse", {
    isAuthenticated: true,
    user: { id: "user-1", email: "alice@example.com" },
  });
  await page.waitForSelector('[data-testid="message-input"]');
}

async function promptEdits(
  injector: MessageInjector,
): Promise<PromptEditReport[]> {
  const messages = await injector.getMessagesSentToExtension();
  return messages.filter(
    (m) => m.command === "modPromptEdit",
  ) as unknown as PromptEditReport[];
}

/**
 * 从第 `from` 条上报开始，逐条断言「没有内部标记漏给插件」，并返回这一段上报。
 *
 * `markers` 是这条插入路径自己那套内部标记：上传/选文件用 `[@file:`，选区用
 * `[Selection:`，子代理用 `[@agent:`。
 */
async function expectChipTextReported(
  injector: MessageInjector,
  from: number,
  markers: string[],
  visibleText: string,
) {
  const reports = (await promptEdits(injector)).slice(from);
  expect(
    reports.length,
    "插入标签会派发一次 input，应当上报一次 prompt.edit",
  ).toBeGreaterThan(0);
  for (const report of reports) {
    // `text` 是这次编辑前的全文、`inputText` 是这次替换掉的片段：两个字段都会
    // 原样交给插件，任何一个带内部标记都算漏。
    for (const marker of markers) {
      expect(report.text, "上报的「编辑前全文」含内部占位标记").not.toContain(
        marker,
      );
      expect(
        report.inputText,
        "上报的「本次替换片段」含内部占位标记",
      ).not.toContain(marker);
    }
  }
  // 反向：可见文本确实报上去了（否则「不多报标记」可以靠「什么都不报」达成）。
  expect(reports.map((r) => r.inputText).join("")).toContain(visibleText);
  return reports;
}

test.describe("引用标签插入：prompt.edit 上报可见文本", () => {
  test("上传文件（insertUploadedFilePaths）", async ({ page }) => {
    await openWebviewOnHttpOrigin(page);
    const injector = new MessageInjector(page);
    await setup(injector, page);

    const input = page.getByTestId("message-input");
    await input.click();
    // 先打一个字：`prompt.edit` 的差值是跟「上一次全文」比的，空草稿上插入不产生
    // 上报（`prevEditTextRef` 还是 null），那样这条用例就什么也验不到。
    await page.keyboard.type("hi ");
    const from = (await promptEdits(injector)).length;

    const filePath = `${DIR}/src/order.ts`;
    await injector.simulateExtensionMessage("uploadSuccess", {
      uploadedFiles: [filePath],
    });
    const chip = input.locator(
      `.context-tag-container[data-path="${filePath}"]`,
    );
    await expect(chip).toHaveCount(1);
    await expect(chip).toContainText("order.ts");

    await expectChipTextReported(injector, from, ["[@file:"], "order.ts");
  });

  test("引用选区（insertSelectionTag）", async ({ page }) => {
    await openWebviewOnHttpOrigin(page);
    const injector = new MessageInjector(page);
    await setup(injector, page);

    const input = page.getByTestId("message-input");
    await input.click();
    await page.keyboard.type("hi ");
    const from = (await promptEdits(injector)).length;

    // 真宿主（VS Code 右键「添加到对话」）投递选区
    await injector.simulateExtensionMessage("addSelectionToInput", {
      selection,
    });
    const chip = page.locator(
      '#messageInput .context-tag-container[data-is-selection="true"]',
    );
    await expect(chip).toHaveCount(1);
    await expect(chip).toContainText("PaymentService.ts#45-62");

    await expectChipTextReported(
      injector,
      from,
      ["[Selection:"],
      "PaymentService.ts#45-62",
    );
  });

  test("@ 选文件（handleFileSelect）", async ({ page }) => {
    await openWebviewOnHttpOrigin(page);
    const injector = new MessageInjector(page);
    await setup(injector, page);

    const input = page.getByTestId("message-input");
    await input.click();
    await page.keyboard.type("hi ");
    const from = (await promptEdits(injector)).length;

    // `@` → 200ms 防抖后向宿主请求文件建议（SELECTION_CHANGE_DEBOUNCE_MS）
    await page.keyboard.type("@");
    const requestId = await injector.waitForFileSuggestionRequest();
    await injector.simulateExtensionMessage("fileSuggestionsResponse", {
      suggestions: [
        {
          path: `${DIR}/src/order.ts`,
          relativePath: "src/order.ts",
          name: "order.ts",
          extension: "ts",
          icon: "codicon-file",
          isDirectory: false,
        },
      ],
      filterText: "",
      requestId,
    });

    const item = page.locator(".file-suggestion-dropdown .suggestion-item");
    await expect(item).toHaveCount(1);
    await item.click();

    const chip = input.locator(
      '.context-tag-container[data-path="src/order.ts"]',
    );
    await expect(chip).toHaveCount(1);
    await expect(chip).toContainText("order.ts");

    await expectChipTextReported(injector, from, ["[@file:"], "order.ts");
  });
});
