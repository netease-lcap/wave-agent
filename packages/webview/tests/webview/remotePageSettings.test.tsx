/**
 * 第三批解禁：远控网页的设置页（spec ui/remote-control.md「Web 端也能改设置」）。
 *
 * 这一页复用桌面端**同一个** SettingsPage，所以这个文件钉的不是视图细节（那些在
 * settingsGlobal / settingsProject / settingsAgentsEditor 里各宿主共享），而是**这台
 * 手机上少掉/多出来的那几点**：
 *
 * - 它整页替换会话区（不是宿主另开的标签页，也不是弹层），三条会话区入口
 *   （`/config`、更多菜单的「设置」）都落在同一页；
 * - 导航只留真能在页面上用起来的三块——插件市场 / 技能 / 子代理 / 钩子 / MCP 是
 *   **整项缺席**而不是渲染后置灰（它们要的是宿主的界面能力，白名单也没放行）；
 * - 桌面端本地偏好（主题 / 接收 Beta 版更新）与补全两行不渲染：前者改的是那台电脑
 *   的显示与更新通道，后者要一个代码编辑器；
 * - 保存走的仍是 `updateConfiguration` 这一条（shim 再折成 `updateUserSettings`），
 *   不会顺手发 `setThemeSource` / `setUpdateChannel` 这类桌面端本地命令；
 * - 宿主结构化地说「不支持」时，整页给一句常驻文案并把可编辑控件按掉。
 *
 * 视口相关的单列布局是纯 CSS（jsdom 没有布局引擎），由 `tests/remote/
 * settingsMobileLayout.test.ts` 从样式表钉；这里只保证 390px 下结构不变、控件
 * 都在（布局不该改变渲染出什么）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  createMockVscode,
  fireEvent,
  fireInput,
  renderChatApp,
  screen,
  sendCommand,
} from "./test-utils";

const postsOf = (vscode: ReturnType<typeof createMockVscode>) =>
  vscode.postMessage.mock.calls.map(([msg]) => msg as Record<string, unknown>);

async function typeAndSend(text: string) {
  const input = screen.getByTestId("message-input");
  input.textContent = text;
  await fireInput(input);
  fireEvent.keyDown(input, { key: "Enter" });
}

/** 打开设置页的常规路径：`/config` 是页面上唯一一条「打开设置」的命令。 */
async function openSettings(vscode: ReturnType<typeof createMockVscode>) {
  await act(async () => {
    await typeAndSend("/config");
  });
  await act(async () => {
    sendCommand("configurationResponse", {
      configurationData: { language: "zh-CN" },
    });
  });
  return vscode;
}

function navLabels(): string[] {
  const nav = document.querySelector(".settings-navigation");
  expect(nav).not.toBeNull();
  return Array.from(
    (nav as HTMLElement).querySelectorAll(".settings-nav-item"),
  ).map((item) => (item.textContent ?? "").trim());
}

afterEach(() => {
  delete window.waveRemotePage;
  Object.defineProperty(window, "innerWidth", {
    value: 1024,
    configurable: true,
    writable: true,
  });
  vi.restoreAllMocks();
});

describe("the settings page on the remote-control Web page", () => {
  it("opens in place of the conversation, from /config, as a full page", async () => {
    window.waveRemotePage = true;
    const { vscode } = renderChatApp();

    await openSettings(vscode);

    // 整页替换会话区：聊天输入不在了，设置页自己占满。
    expect(screen.queryByTestId("message-input")).not.toBeInTheDocument();
    expect(document.querySelector(".settings-page")).not.toBeNull();
    expect(
      screen.getByRole("heading", { name: "全局设置" }),
    ).toBeInTheDocument();

    // 进页面就拉一次配置（shim 把它折成 `getUserSettings`）；不发 IDE 宿主的
    // `openSettings`（那会让宿主另开一个 webview 标签页，页面上不存在这条路）。
    const commands = postsOf(vscode).map((post) => post.command);
    expect(commands).toContain("getConfiguration");
    expect(commands).not.toContain("openSettings");
  });

  it("keeps only the three views that work here; the rest are absent, not greyed", async () => {
    window.waveRemotePage = true;
    const { vscode } = renderChatApp();
    await openSettings(vscode);

    // 通用 → 全局设置 / 个性化；工作区 → 项目设置。「AI 与扩展」整组缺席。
    expect(navLabels()).toEqual(["全局设置", "个性化", "项目设置"]);

    for (const label of ["插件市场", "技能", "子代理", "钩子", "MCP 服务"]) {
      expect(
        screen.queryByRole("button", { name: label }),
      ).not.toBeInTheDocument();
    }
  });

  it("does not render the desktop-only blocks or the completion rows", async () => {
    window.waveRemotePage = true;
    const { vscode } = renderChatApp();
    await openSettings(vscode);

    // 「桌面端设置」= 主题 + 接收 Beta 版更新：改的是那台电脑的显示与更新通道，
    // 从手机上调它既看不出效果，也和「页面能改什么」不是一回事。
    expect(
      screen.queryByRole("heading", { name: "桌面端设置" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("接收 Beta 版更新")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("主题")).not.toBeInTheDocument();

    // 补全两行要一个代码编辑器：这台手机上没有编辑器，补全从不触发。
    expect(screen.queryByLabelText("补全模型")).not.toBeInTheDocument();
    // 反证：同样的行在 VS Code 宿主里是渲染的（settingsGlobal.test.tsx）。
    // 这里只钉「页面上没有」，避免把宿主判断写成整页关掉。
    expect(screen.getByLabelText("AI 回复语言")).toBeInTheDocument();
    expect(screen.getByLabelText("上下文长度")).toBeInTheDocument();
    expect(screen.getByLabelText("服务端地址")).toBeInTheDocument();
  });

  it("shows org-managed keys as managed, using the per-key source layer", async () => {
    window.waveRemotePage = true;
    renderChatApp();
    await act(async () => {
      await typeAndSend("/config");
    });
    await act(async () => {
      sendCommand("configurationResponse", {
        configurationData: {
          language: "en-US",
          preferenceSources: { language: "remote" },
        },
      });
    });

    // 生效值 + 来源层：被组织配置覆盖的键显示「由组织配置管理」并置灰，而不是
    // 在手机上看起来可以随便改、存完发现没生效。
    expect(screen.getByText("由组织配置管理")).toBeInTheDocument();
    expect(screen.getByLabelText("AI 回复语言")).toBeDisabled();
  });

  it("saves through updateConfiguration, and sends no desktop-local command", async () => {
    window.waveRemotePage = true;
    const { vscode } = renderChatApp();
    await openSettings(vscode);

    vscode.postMessage.mockClear();
    await act(async () => {
      fireEvent.change(screen.getByLabelText("AI 回复语言"), {
        target: { value: "en-US" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
    });

    const posts = postsOf(vscode);
    expect(posts).toContainEqual(
      expect.objectContaining({
        command: "updateConfiguration",
        configurationData: expect.objectContaining({ language: "en-US" }),
      }),
    );
    // 桌面端本地偏好走 host 直连的另外两条命令，页面上不该有它们的影子。
    expect(
      posts.filter(
        (post) =>
          post.command === "setThemeSource" ||
          post.command === "setUpdateChannel",
      ),
    ).toEqual([]);
  });

  it("loads the personalisation and project views from the same page", async () => {
    window.waveRemotePage = true;
    const { vscode } = renderChatApp();
    await openSettings(vscode);

    // AGENTS.md 编辑器在挂载时就拉用户级内容（项目级等切到那个作用域再拉）。
    // 次数不钉：内容未回包前每次重渲染都会补一次读，幂等。
    const agentsReads = postsOf(vscode).filter(
      (post) => post.command === "getAgentsContent",
    );
    expect(agentsReads.length).toBeGreaterThan(0);
    expect(agentsReads).toEqual(
      agentsReads.map(() => expect.objectContaining({ scope: "user" })),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "个性化" }));
    });
    expect(screen.getByRole("heading", { name: "个性化" })).toBeInTheDocument();

    vscode.postMessage.mockClear();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "项目设置" }));
    });
    // 进视图重读一次项目设置（SDD 开关的初值就从这里来）。
    expect(postsOf(vscode)).toContainEqual({ command: "getProjectSettings" });
  });

  it("turns 「this host does not support it」 into one sentence and a disabled page", async () => {
    window.waveRemotePage = true;
    const { vscode } = renderChatApp();
    await openSettings(vscode);

    act(() => {
      sendCommand("settingsHostUnsupported", {
        reason:
          "这台电脑上的会话不支持读写设置（它没有常驻的 daemon）。换一台运行 daemon 的机器再试。",
      });
    });

    expect(screen.getByTestId("settings-host-unsupported")).toHaveTextContent(
      "这台电脑上的会话不支持读写设置",
    );
    // 与其让用户对着一个必然失败的保存按钮反复按，不如整片按掉。
    expect(screen.getByLabelText("AI 回复语言")).toBeDisabled();
    expect(screen.getByLabelText("上下文长度")).toBeDisabled();
    expect(screen.getByLabelText("服务端地址")).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();

    // 返回会话区之后还能再进来一次（重开时会清掉这个判断，重试一次再说）。
    expect(screen.getByRole("button", { name: "返回" })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "返回" }));
    });
    expect(screen.getByTestId("message-input")).toBeInTheDocument();
    expect(
      screen.queryByTestId("settings-host-unsupported"),
    ).not.toBeInTheDocument();
  });

  it("renders the same page at a 390px phone viewport", async () => {
    // jsdom 不做布局：视口大小不改变渲染出什么，单列的几何由 media query 负责
    // （tests/remote/settingsMobileLayout.test.ts 钉）。这里钉的是「窄屏下这一页
    // 仍然完整可用」——三个视图都在、没有一个控件因为宽度被摘掉。
    Object.defineProperty(window, "innerWidth", {
      value: 390,
      configurable: true,
      writable: true,
    });
    window.waveRemotePage = true;
    const { vscode } = renderChatApp();
    await openSettings(vscode);

    expect(navLabels()).toEqual(["全局设置", "个性化", "项目设置"]);
    expect(screen.getByLabelText("AI 回复语言")).toBeInTheDocument();
    expect(screen.getByLabelText("上下文长度")).toBeInTheDocument();
    expect(screen.getByLabelText("服务端地址")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回" })).toBeInTheDocument();

    // 三块视图都能切过去（窄屏下导航是横向滚动条，不是被折叠掉的抽屉）。
    for (const label of ["个性化", "项目设置"]) {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: label }));
      });
      expect(screen.getByRole("heading", { name: label })).toBeInTheDocument();
    }
  });
});
