import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./utils/webviewTestHarness.js";
import {
  openSettings,
  sentToHost,
  simulateHostMessage,
} from "./utils/settingsHarness.js";

/**
 * Regression（设置页写盘反馈，2026-09-09 拍板「走宿主全局 toast」+ 2026-11-04
 * 拍板「用户偏好即时提交、无保存按钮」）：
 *
 * 设置页此前自己渲染页面内提示（`.settings-save-message` 内联灰字，全局设置 /
 * 个性化 / AGENTS.md 三处）。拍板后改为：写盘结果的用户可见反馈由宿主（桌面
 * showToast / VSCE showInformationMessage / JB IdeService.showInfo）给出，webview
 * 只负责 ①发出正确的写盘消息 ②（仅 AGENTS.md 整文件写入）维护「保存中」禁用态并
 * 在 host 回包后复位，**不再渲染任何页面内提示**。本文件驱动真实 settings.js
 * bundle 覆盖这两件事，同时补 AGENTS.md「键入 → 保存」的请求载荷（G8）。
 *
 * 断言口径：
 * - 载荷 = 发给 host 的 `updateConfiguration`（每个控件一条，只含该键）/
 *   `setAgentsContent` 消息内容；
 * - 无页面内提示 = 旧类名 `.settings-save-message` 不存在；
 * - 复位 = 回 `configurationError` 后界面回滚到上一次生效值、`agentsContentSaved`
 *   后文本区与保存按钮重新可用（偏好键没有「保存中」态：写盘是乐观显示）。
 */

/** 保存区块（按小标题定位，避免同一视图内多个 `.settings-actions` 撞车）。 */
function saveSection(webviewPage: Page, heading: string): Locator {
  return webviewPage
    .locator(".settings-section")
    .filter({ has: webviewPage.getByRole("heading", { name: heading }) });
}

/** 该区块内不得出现自建提示（旧实现的内联灰字 + 追加在动作行里的文案）。 */
async function expectNoInlineSaveHint(section: Locator, actionText: string) {
  await expect(section.locator(".settings-save-message")).toHaveCount(0);
  // 旧实现把提示文字追加在保存按钮所在的动作行内：无提示时该行只有按钮文本
  await expect(section.locator(".settings-actions")).toHaveText(actionText);
}

/**
 * 三档 tab（用户级 / 项目级 / 个人级）必须排在同一行，且**不得溢出**：
 * 第三个 tab 不许换行、不许被挤到容器/视口之外，文本也不许被压扁裁掉。
 *
 * 为什么光比 y 不够：`.settings-tabs` 是 `display:flex` 且没有 `flex-wrap`，子项
 * 天然同一行——标签被挤出可视区域（右侧溢出、或子项被 flex 压窄后文字溢出边界）
 * 时「同一 y + x 递增」照样成立，断言等于恒真。所以补三条几何口径：
 * ① 最后一个 tab 的右边界不出容器；② 容器自身不出视口；③ 每个 tab 的
 * scrollWidth ≤ clientWidth（内容没被裁）；④ 容器 scrollWidth ≤ clientWidth
 * （子项没有横向溢出容器）。
 */
async function expectTabsOnOneRow(webviewPage: Page) {
  const names = ["用户级", "项目级", "个人级"] as const;
  const boxes: { x: number; y: number; width: number }[] = [];
  for (const name of names) {
    const box = await webviewPage.getByRole("tab", { name }).boundingBox();
    expect(box).not.toBeNull();
    boxes.push(box!);
  }
  for (const box of boxes) {
    expect(box.y).toBeCloseTo(boxes[0].y, 0);
    // 三档依次向右排列（x 递增），而不是折行后回到行首
    expect(box.x).toBeGreaterThanOrEqual(boxes[0].x);
  }
  const last = boxes[boxes.length - 1];
  expect(last.x + last.width).toBeGreaterThan(boxes[1].x);

  // 亚像素容差：浏览器按小数排布，边界比较允许 1px 误差。
  const tolerance = 1;

  const tabsRow = webviewPage.locator(".settings-tabs").first();
  const rowBox = await tabsRow.boundingBox();
  expect(rowBox).not.toBeNull();
  // ① 最后一个 tab 整体落在 tab 条内（不是被推到容器右侧之外）
  expect(last.x + last.width).toBeLessThanOrEqual(
    rowBox!.x + rowBox!.width + tolerance,
  );
  // ② tab 条自身落在视口内（容器比视口宽时右侧同样看不见）
  const viewport = webviewPage.viewportSize();
  expect(viewport).not.toBeNull();
  expect(rowBox!.x + rowBox!.width).toBeLessThanOrEqual(
    viewport!.width + tolerance,
  );
  // ④ 子项没有横向撑出容器
  const rowOverflow = await tabsRow.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(rowOverflow.scrollWidth).toBeLessThanOrEqual(
    rowOverflow.clientWidth + tolerance,
  );
  // ③ 每个 tab 的文字没被压窄裁掉（flex-shrink 会把按钮压到比文字还窄）
  for (const name of names) {
    const tabOverflow = await webviewPage
      .getByRole("tab", { name })
      .evaluate((el) => ({
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      }));
    expect(tabOverflow.scrollWidth).toBeLessThanOrEqual(
      tabOverflow.clientWidth + tolerance,
    );
  }
}

test.describe("设置页写盘反馈（settings tab）", () => {
  test("全局设置：改语言/上下文各自即时发一条只含该键的 updateConfiguration，无页面内提示", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage);

    // 没有「保存」按钮（2026-11-04 拍板，spec agent-config「设置页控件的保存时机」）
    await expect(
      webviewPage.getByRole("button", { name: "保存", exact: true }),
    ).toHaveCount(0);

    await webviewPage.getByLabel("AI 回复语言").selectOption("en-US");
    await expect
      .poll(async () => {
        const sent = await sentToHost<{
          command?: string;
          configurationData?: Record<string, unknown>;
        }>(webviewPage);
        return sent
          .filter((m) => m.command === "updateConfiguration")
          .map((m) => m.configurationData);
      })
      .toEqual([{ language: "en-US" }]);

    // 数字输入：打字途中不写盘，失焦才写
    const contextLength = webviewPage.getByLabel("上下文长度");
    await contextLength.fill("300");
    await contextLength.blur();
    await expect
      .poll(async () => {
        const sent = await sentToHost<{
          command?: string;
          configurationData?: Record<string, unknown>;
        }>(webviewPage);
        return sent
          .filter((m) => m.command === "updateConfiguration")
          .map((m) => m.configurationData);
      })
      .toEqual([{ language: "en-US" }, { contextLength: 300 }]);

    // 页面内无自建提示（反馈由宿主全局 toast 承担）
    await expect(
      saveSection(webviewPage, "基础设置").locator(".settings-save-message"),
    ).toHaveCount(0);
    await expect(webviewPage.getByText(/保存成功/)).toHaveCount(0);
  });

  test("个性化：自动记忆开关拨动即写、轮次失焦写；失败回执后回滚、无页面内错误文案", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage);
    await webviewPage
      .getByRole("button", { name: "个性化", exact: true })
      .click();

    const toggle = webviewPage.getByLabel("开启自动记忆");
    await expect(toggle).toBeChecked();
    // 开关 input 是视觉隐藏（opacity: 0）的自绘 switch：点可视滑轨（label 内）切换
    await saveSection(webviewPage, "自动记忆规则")
      .locator(".settings-switch-slider")
      .click();
    await expect(toggle).not.toBeChecked();

    const frequency = webviewPage.getByLabel("触发记忆提取会话轮次");
    await frequency.fill("5");
    await frequency.blur();

    const sent = await sentToHost<{
      command?: string;
      configurationData?: Record<string, unknown>;
    }>(webviewPage);
    // 关闭态（false）必须真的随报文下发——#2115「关了还在记忆」的回归点；
    // 每个控件只管自己那一键（diff 语义：未改的键不出现）。
    expect(
      sent
        .filter((m) => m.command === "updateConfiguration")
        .map((m) => m.configurationData),
    ).toEqual([{ autoMemoryEnabled: false }, { autoMemoryFrequency: 5 }]);

    await expect(
      saveSection(webviewPage, "自动记忆规则").locator(
        ".settings-save-message",
      ),
    ).toHaveCount(0);

    // 失败回执（configurationError）：界面回滚到上一次生效值（宿主不回
    // configurationResponse 就表示没写进文件），且不出现任何页面内错误文案。
    await simulateHostMessage(webviewPage, {
      command: "configurationError",
      error: "Failed to save configuration: boom",
    });
    await expect(toggle).toBeChecked();
    await expect(webviewPage.getByText(/保存失败|保存出错/)).toHaveCount(0);
  });

  test("AGENTS.md：键入用户级内容后保存，发出带 expectedHash 的 setAgentsContent（scope user）", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage);
    await webviewPage
      .getByRole("button", { name: "个性化", exact: true })
      .click();
    await simulateHostMessage(webviewPage, {
      command: "agentsContentResponse",
      scope: "user",
      content: "# 旧规则",
      // 读成功且文件存在：编辑器可写，保存必须带上这份内容的 hash（场景 12）
      exists: true,
      readable: true,
      hash: "hash-user-v1",
    });

    const textarea = webviewPage.getByLabel("用户级 AGENTS.md 内容");
    await expect(textarea).toHaveValue("# 旧规则");
    await textarea.fill("# 新规则\n- 测试覆盖");

    const saveButton = webviewPage.getByRole("button", {
      name: "保存用户级配置",
    });
    await saveButton.click();

    // 保存中：文本区与按钮一并禁用（host 回包前不可再编辑）
    await expect(textarea).toBeDisabled();
    await expect(saveButton).toBeDisabled();

    const saved = await sentToHost<{
      command?: string;
      scope?: string;
      content?: string;
      workdir?: string;
      expectedHash?: string | null;
    }>(webviewPage);
    const request = saved.find((m) => m.command === "setAgentsContent");
    expect(request).toMatchObject({
      scope: "user",
      content: "# 新规则\n- 测试覆盖",
      workdir: undefined,
      expectedHash: "hash-user-v1",
    });

    await expectNoInlineSaveHint(
      saveSection(webviewPage, "AGENTS.md"),
      "保存用户级配置",
    );

    // agentsContentSaved 复位：文本区与按钮重新可用
    await simulateHostMessage(webviewPage, {
      command: "agentsContentSaved",
      scope: "user",
      ok: true,
    });
    await expect(textarea).toBeEnabled();
    await expect(saveButton).toBeEnabled();
  });

  test("AGENTS.md：项目级保存带当前 workdir（归属键）", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage, {
      settingsState: { workdir: "/work/wave-agent" },
    });
    await webviewPage
      .getByRole("button", { name: "个性化", exact: true })
      .click();
    await webviewPage.getByRole("tab", { name: "项目级" }).click();
    await simulateHostMessage(webviewPage, {
      command: "agentsContentResponse",
      scope: "project",
      content: "# 项目规则",
      exists: true,
      readable: true,
      hash: "hash-project-v1",
    });

    // 先等 host 内容落地（回填 effect 会覆盖草稿），再键入
    const textarea = webviewPage.getByLabel("项目级 AGENTS.md 内容");
    await expect(textarea).toHaveValue("# 项目规则");
    await textarea.fill("# 项目规则 v2");
    await webviewPage.getByRole("button", { name: "保存项目级配置" }).click();

    const saved = await sentToHost<{
      command?: string;
      scope?: string;
      content?: string;
      workdir?: string;
      expectedHash?: string | null;
    }>(webviewPage);

    // 读取请求与写入请求都要带归属键：workdir 决定读写哪个项目的 AGENTS.md，
    // 漏传就会被 host 兜底到 effectiveWorkdir（#2152/#2155 的错项目根因）。
    expect(
      saved.find(
        (m) => m.command === "getAgentsContent" && m.scope === "project",
      ),
    ).toMatchObject({ scope: "project", workdir: "/work/wave-agent" });

    const request = saved.find((m) => m.command === "setAgentsContent");
    expect(request).toMatchObject({
      scope: "project",
      content: "# 项目规则 v2",
      workdir: "/work/wave-agent",
      expectedHash: "hash-project-v1",
    });
  });

  test("AGENTS.md：个人级（AGENTS.local.md）保存带当前 workdir，并显示 .gitignore 提示", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage, {
      settingsState: { workdir: "/work/wave-agent" },
    });
    await webviewPage
      .getByRole("button", { name: "个性化", exact: true })
      .click();

    // 三档 tab 排成一行（第三个 tab 不得换行/挤坏布局），宽窄两档都验
    await expectTabsOnOneRow(webviewPage);
    await webviewPage.setViewportSize({ width: 420, height: 760 });
    await expectTabsOnOneRow(webviewPage);
    await webviewPage.setViewportSize({ width: 1000, height: 760 });

    await webviewPage.getByRole("tab", { name: "个人级" }).click();

    // 场景 7：个人级下给一行 .gitignore 提示（不拦截保存）
    await expect(webviewPage.locator(".agents-local-hint")).toContainText(
      ".gitignore",
    );
    await expect(webviewPage.locator(".agents-local-hint")).toContainText(
      "AGENTS.local.md",
    );

    await simulateHostMessage(webviewPage, {
      command: "agentsContentResponse",
      scope: "local",
      content: "# 个人规则",
      exists: true,
      readable: true,
      hash: "hash-local-v1",
    });

    // 先等 host 内容落地（回填 effect 会覆盖草稿），再键入
    const textarea = webviewPage.getByLabel("个人级 AGENTS.md 内容");
    await expect(textarea).toHaveValue("# 个人规则");
    await textarea.fill("# 个人规则 v2");
    await webviewPage.getByRole("button", { name: "保存个人级配置" }).click();

    const saved = await sentToHost<{
      command?: string;
      scope?: string;
      content?: string;
      workdir?: string;
      expectedHash?: string | null;
    }>(webviewPage);

    // 个人级与项目级一样落在某个项目目录里：读、写都必须带 workdir
    // （漏传会被宿主按「缺 workdir」拒绝，个人档在插件端就保存不了）。
    expect(
      saved.find(
        (m) => m.command === "getAgentsContent" && m.scope === "local",
      ),
    ).toMatchObject({ scope: "local", workdir: "/work/wave-agent" });

    const request = saved.find((m) => m.command === "setAgentsContent");
    expect(request).toMatchObject({
      scope: "local",
      content: "# 个人规则 v2",
      workdir: "/work/wave-agent",
      expectedHash: "hash-local-v1",
    });
  });

  /**
   * 跨项目串写（评审缺陷，插件端真机路径）：设置页是编辑器区的**常驻** tab，宿主
   * 每次 openSettings 都重推一份新的 `workdir`（VS Code `chatProvider.openSettings`
   * → `settingsState`），而三档内容缓存不跟着变——A 项目的正文停在编辑器里，用户点
   * 保存就把 B 项目的 `AGENTS.md` 覆盖成 A 的内容。
   *
   * spec memory-management 场景 6：项目级与个人级必须按新项目重新读取，用户级不重读。
   */
  test("个性化：宿主重推新 workdir 后项目级编辑器作废重读，不停着上一项目的正文", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage, {
      settingsState: { workdir: "/work/project-a" },
    });
    await webviewPage
      .getByRole("button", { name: "个性化", exact: true })
      .click();
    await webviewPage.getByRole("tab", { name: "项目级" }).click();

    // A 项目的文件回包并显示出来
    await simulateHostMessage(webviewPage, {
      command: "agentsContentResponse",
      scope: "project",
      content: "# A 项目规范",
    });
    const editor = webviewPage.getByLabel("项目级 AGENTS.md 内容");
    await expect(editor).toHaveValue("# A 项目规范");

    // 宿主在另一个项目里打开设置页：只重推 workdir（常驻 tab，页面不重挂载）
    await simulateHostMessage(webviewPage, {
      command: "settingsState",
      workdir: "/work/project-b",
    });

    // A 的正文当场作废——修复前它一直停在编辑器里，点保存就写进 B 的 AGENTS.md
    await expect(editor).toHaveValue("");

    // 并按新项目重读：项目级读请求带的是 B 的 workdir
    await expect
      .poll(async () => {
        const sent = await sentToHost<{ command?: string; scope?: string }>(
          webviewPage,
        );
        return sent
          .filter(
            (m) => m.command === "getAgentsContent" && m.scope === "project",
          )
          .map((m) => (m as { workdir?: string }).workdir);
      })
      .toEqual(["/work/project-a", "/work/project-b"]);

    await simulateHostMessage(webviewPage, {
      command: "agentsContentResponse",
      scope: "project",
      content: "# B 项目规范",
      exists: true,
      readable: true,
      hash: "hash-project-b",
    });
    await expect(editor).toHaveValue("# B 项目规范");
  });

  /**
   * 读状态（spec memory-management「设置页三档记忆编辑器」场景 10、11）。
   *
   * 真 bundle 上验两种「界面上都是空 textarea」的情况必须区别对待：读取失败只读且
   * 带 error 文案（不然用户一次保存就把磁盘文件覆盖成空），文件不存在则可编辑
   * 可新建（刻意比 Claude Code 桌面端宽松）。
   */
  test("AGENTS.md：读取失败只读并显示原因，文件不存在则可编辑保存", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage);
    await webviewPage
      .getByRole("button", { name: "个性化", exact: true })
      .click();

    // ① 读取失败：内容为空 + readable: false + error
    await simulateHostMessage(webviewPage, {
      command: "agentsContentResponse",
      scope: "user",
      content: "",
      exists: true,
      readable: false,
      hash: null,
      error: "EACCES: permission denied",
    });
    const editor = webviewPage.getByLabel("用户级 AGENTS.md 内容");
    await expect(webviewPage.locator(".agents-editor-status")).toContainText(
      "EACCES: permission denied",
    );
    // 文案必须点明「看到的空 ≠ 文件是空的」，并禁用保存
    await expect(webviewPage.locator(".agents-editor-status")).toContainText(
      "并不代表文件是空的",
    );
    await expect(editor).toHaveAttribute("readonly", "");
    await expect(
      webviewPage.getByRole("button", { name: "保存用户级配置" }),
    ).toBeDisabled();

    // ② 文件不存在：提示尚未创建，但可以写，保存发 expectedHash: null
    await webviewPage.getByRole("tab", { name: "个人级" }).click();
    await simulateHostMessage(webviewPage, {
      command: "agentsContentResponse",
      scope: "local",
      content: "",
      exists: false,
      readable: true,
      hash: null,
    });
    await expect(webviewPage.locator(".agents-editor-status")).toContainText(
      "尚未创建",
    );
    const localEditor = webviewPage.getByLabel("个人级 AGENTS.md 内容");
    await expect(localEditor).not.toHaveAttribute("readonly", "");
    await localEditor.fill("# 新建的个人档");
    await webviewPage.getByRole("button", { name: "保存个人级配置" }).click();

    const saved = await sentToHost<{
      command?: string;
      scope?: string;
      content?: string;
      expectedHash?: string | null;
    }>(webviewPage);
    expect(saved.find((m) => m.command === "setAgentsContent")).toMatchObject({
      scope: "local",
      content: "# 新建的个人档",
      expectedHash: null,
    });
  });

  /**
   * 并发冲突（spec memory-management 场景 12）：编辑器打开期间文件被外部改过。
   * 宿主拒绝写入后，界面必须重读磁盘、给出提示，并保住用户刚才的编辑（可恢复）。
   */
  test("AGENTS.md：保存冲突后重读磁盘新内容、提示外部改动并可恢复草稿", async ({
    webviewPage,
  }) => {
    await openSettings(webviewPage, {
      settingsState: { workdir: "/work/wave-agent" },
    });
    await webviewPage
      .getByRole("button", { name: "个性化", exact: true })
      .click();
    await webviewPage.getByRole("tab", { name: "项目级" }).click();
    await simulateHostMessage(webviewPage, {
      command: "agentsContentResponse",
      scope: "project",
      content: "# 项目规则",
      exists: true,
      readable: true,
      hash: "hash-project-v1",
    });

    const editor = webviewPage.getByLabel("项目级 AGENTS.md 内容");
    await expect(editor).toHaveValue("# 项目规则");
    await editor.fill("# 我的改动");
    await webviewPage.getByRole("button", { name: "保存项目级配置" }).click();

    // 宿主按 hash 校验发现磁盘已变：拒绝写入
    await simulateHostMessage(webviewPage, {
      command: "agentsContentSaved",
      scope: "project",
      ok: false,
      conflict: true,
    });

    // 重读该档（第二次读请求），并把磁盘上的最新内容显示出来
    await expect
      .poll(async () => {
        const sent = await sentToHost<{ command?: string; scope?: string }>(
          webviewPage,
        );
        return sent.filter(
          (m) => m.command === "getAgentsContent" && m.scope === "project",
        ).length;
      })
      .toBe(2);
    await simulateHostMessage(webviewPage, {
      command: "agentsContentResponse",
      scope: "project",
      content: "# 外部改过的内容",
      exists: true,
      readable: true,
      hash: "hash-project-v2",
    });
    await expect(editor).toHaveValue("# 外部改过的内容");

    // 冲突提示 + 草稿可恢复（用户的编辑没有被静默丢掉）
    await expect(webviewPage.locator(".agents-editor-conflict")).toContainText(
      "被外部修改",
    );
    await webviewPage.getByRole("button", { name: "恢复我的编辑" }).click();
    await expect(editor).toHaveValue("# 我的改动");
    await expect(webviewPage.locator(".agents-editor-conflict")).toHaveCount(0);
  });
});
