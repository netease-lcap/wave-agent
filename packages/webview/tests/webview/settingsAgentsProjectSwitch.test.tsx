import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  waitFor,
  act,
  fireEvent,
  sendHostMessage,
  fixtures,
  createMockVscode,
} from "./test-utils";
import React from "react";
import { contentHash } from "wave-webview-fixtures";
import { ChatApp } from "../../src/components/ChatApp";
import type { VsCodeApi } from "../../src/types";

// 与 settingsPaneDelegate.test.tsx 同构的 desktop host props（root 实例）。
function desktopHost() {
  return {
    type: "desktop",
    host: "local",
    hosts: ["local"],
    recentWorkdirs: ["/work/a"],
    workdir: "/work/a",
    sessionTree: [],
    panes: [{ paneId: "pane-1" }],
    focusedPaneId: "pane-1",
    onSelectWorkdir: () => {},
    onSelectRecentWorkdir: () => {},
    onRemoveRecentWorkdir: () => {},
    onSelectHost: () => {},
    onSaveSshConnection: () => {},
    onDeleteSshConnection: () => {},
    onSelectRemotePath: () => {},
    onListRemoteDir: () => {},
    onSelectSession: () => {},
    onDeleteSession: () => {},
    onOpenPane: () => {},
  } as unknown as React.ComponentProps<typeof ChatApp>["host"];
}

async function openSettings() {
  const input = await screen.findByTestId("message-input");
  input.focus();
  await act(async () => {
    input.textContent = "/config";
    const range = document.createRange();
    range.selectNodeContents(input);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    fireEvent.input(input, { data: "/config", inputType: "insertText" });
  });
  fireEvent.keyDown(input, { key: "Enter" });
  await screen.findByText("管理 CodeWave IDE 的界面、模型和基础行为。");
}

/** 进入个性化视图并把作用域切到「项目级」。 */
async function openProjectTab() {
  fireEvent.click(screen.getByRole("button", { name: "个性化" }));
  const tab = await screen.findByRole("tab", { name: "项目级" });
  fireEvent.click(tab);
  await screen.findByLabelText("项目级 AGENTS.md 内容");
}

/** mockVscode.postMessage 中 getAgentsContent(project) 的发出次数。 */
function projectRequests(mockVscode: ReturnType<typeof createMockVscode>) {
  return mockVscode.postMessage.mock.calls.filter(
    ([msg]) =>
      (msg as { command?: string }).command === "getAgentsContent" &&
      (msg as { scope?: string }).scope === "project",
  );
}

/** 进入个性化视图并把作用域切到「个人级」（AGENTS.local.md）。 */
async function openLocalTab() {
  fireEvent.click(screen.getByRole("button", { name: "个性化" }));
  const tab = await screen.findByRole("tab", { name: "个人级" });
  fireEvent.click(tab);
  await screen.findByLabelText("个人级 AGENTS.md 内容");
}

type SentMessage = {
  command?: string;
  scope?: string;
  content?: string;
  workdir?: string;
};

/** mockVscode.postMessage 中某条命令（可再按 scope 过滤）的全部载荷。 */
function sentMessages(
  mockVscode: ReturnType<typeof createMockVscode>,
  command: string,
  scope?: string,
) {
  return mockVscode.postMessage.mock.calls
    .map(([msg]) => msg as SentMessage)
    .filter((msg) => msg.command === command)
    .filter((msg) => scope === undefined || msg.scope === scope);
}

/**
 * Bug 回归：desktop 设置页「个性化」项目级 AGENTS.md 编辑器。
 *
 * 根因 1（读回旧值）：AGENTS.md 内容缓存在 root ChatApp state，只在值为 null
 * 时（设置页首次挂载）才向 host 请求——保存后关闭再打开设置页不重新读取磁盘，
 * 一直显示上一次加载的快照。修复：每次打开设置页重置缓存为 null，设置页挂载
 * 后按需重新读取（项目级在「项目级」tab 首次激活时读取）。
 *
 * 根因 2（不随项目切换）：同一缓存与「当前项目」解耦——切换项目/会话后重开
 * 设置页仍显示上一个项目那份文件。与根因 1 同一修复点（逐次打开按当前项目
 * 重读；workdir 归属由 desktopHost 按聚焦 pane 解析，见 desktopHost.test）。
 */
describe("desktop 设置页「个性化」项目级 AGENTS.md 随项目切换刷新", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("保存后关闭再打开设置页会重新拉取项目级内容并显示磁盘新值", async () => {
    const mockVscode = createMockVscode();
    render(
      <ChatApp
        vscode={mockVscode as unknown as VsCodeApi}
        host={desktopHost()}
      />,
    );
    // Root 单实例就绪（非 desktopPanes 路由——host 消息保持 untagged 直达 root）。
    sendHostMessage(fixtures.authStatusResponse());
    sendHostMessage(fixtures.setInitialState());

    // 第一次打开：进入 项目级 tab → host 拉取 → 回包落盘快照 A
    await openSettings();
    await openProjectTab();
    expect(projectRequests(mockVscode)).toHaveLength(1);
    act(() => {
      sendHostMessage(fixtures.agentsContentResponse("project", "# 版本 A"));
    });
    await waitFor(() => {
      expect(
        (screen.getByLabelText("项目级 AGENTS.md 内容") as HTMLTextAreaElement)
          .value,
      ).toBe("# 版本 A");
    });

    // 关闭设置页（等同客户「关掉」）。设置页全页打开期间 DesktopShell 卸载了
    // pane 的 ChatApp；关闭后重挂载需宿主重推 auth 快照才会进入 welcome 态并
    // 挂载输入框（真实 desktopHost 对重挂载 pane 的 webviewReady 会回放快照，
    // 这里手动补推 authStatusResponse 以模拟宿主）。
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    sendHostMessage(fixtures.authStatusResponse());
    await screen.findByTestId("message-input");

    // 磁盘已更新（模拟保存成功后的文件新值）；再次打开设置页
    await openSettings();
    await openProjectTab();

    // 修复前：projectAgentsContent 缓存未重置（仍非 null）→ 不重新请求，
    // 文本区继续显示旧快照「# 版本 A」——此处 count 仍为 1，测试先红。
    expect(projectRequests(mockVscode)).toHaveLength(2);
    // host 回发磁盘新值（当前项目文件）
    act(() => {
      sendHostMessage(fixtures.agentsContentResponse("project", "# 版本 B"));
    });
    await waitFor(() => {
      expect(
        (screen.getByLabelText("项目级 AGENTS.md 内容") as HTMLTextAreaElement)
          .value,
      ).toBe("# 版本 B");
    });
  });

  /**
   * 根因 3（等回包期间重复请求，见 #2533）：加载 effect 曾把父组件传的内联回调
   * 列进依赖，ChatApp 每次重渲染都会换一个回调引用 ⇒ effect 重跑；此时内容仍是
   * null（回包没到）、守卫成立，于是再发一次 getAgentsContent。全量并发下命中
   * 偶发失败。
   *
   * 这里用确定性机制复现：进入「项目级」tab 后、回包之前，推一条与这段数据无关
   * 的窗口级广播（切更新通道）逼 ChatApp 重渲染，断言请求次数不变。
   */
  it("等回包期间 ChatApp 重渲染不会再发一次请求", async () => {
    const mockVscode = createMockVscode();
    render(
      <ChatApp
        vscode={mockVscode as unknown as VsCodeApi}
        host={desktopHost()}
      />,
    );
    sendHostMessage(fixtures.authStatusResponse());
    sendHostMessage(fixtures.setInitialState());

    await openSettings();
    await openProjectTab();
    expect(projectRequests(mockVscode)).toHaveLength(1);

    // 与 AGENTS.md 无关的状态变更：ChatApp 状态变了 ⇒ 整棵树重渲染，父组件传给
    // SettingsPage 的内联回调也换了引用。
    act(() => {
      sendHostMessage({ command: "desktopUpdateChannel", channel: "beta" });
    });

    expect(projectRequests(mockVscode)).toHaveLength(1);

    // 回包到达后照常回填，且没有因重渲染多发的请求。
    act(() => {
      sendHostMessage(fixtures.agentsContentResponse("project", "# 版本 A"));
    });
    await waitFor(() => {
      expect(
        (screen.getByLabelText("项目级 AGENTS.md 内容") as HTMLTextAreaElement)
          .value,
      ).toBe("# 版本 A");
    });
    expect(projectRequests(mockVscode)).toHaveLength(1);
  });

  /**
   * 三档（spec memory-management「设置页三档记忆编辑器」场景 1–3、6）：个人级
   * `<workdir>/AGENTS.local.md` 与项目级一样按项目定位，读写都必须带 workdir
   * （漏带会被宿主按「缺 workdir」拒绝）；回包 `scope: "local"` 只能填个人级
   * 编辑器，落到用户级/项目级就是把个人档内容显示在别的档上。
   */
  it("个人级：读写请求都带项目 workdir，回包 scope=local 只填个人级编辑器", async () => {
    const mockVscode = createMockVscode();
    render(
      <ChatApp
        vscode={mockVscode as unknown as VsCodeApi}
        host={desktopHost()}
      />,
    );
    sendHostMessage(fixtures.authStatusResponse());
    sendHostMessage(fixtures.setInitialState({ workdir: "/work/a" }));

    await openSettings();
    await openLocalTab();

    // 读请求：scope=local + 项目 workdir（不能 undefined）
    const loads = sentMessages(mockVscode, "getAgentsContent", "local");
    expect(loads).toHaveLength(1);
    expect(loads[0]).toMatchObject({ scope: "local", workdir: "/work/a" });

    // 回包只落个人级
    act(() => {
      sendHostMessage(fixtures.agentsContentResponse("local", "# 个人档规则"));
    });
    await waitFor(() => {
      expect(
        (screen.getByLabelText("个人级 AGENTS.md 内容") as HTMLTextAreaElement)
          .value,
      ).toBe("# 个人档规则");
    });
    // 用户级从未收到这份内容（它的编辑器仍是空草稿）
    fireEvent.click(screen.getByRole("tab", { name: "用户级" }));
    expect(
      (screen.getByLabelText("用户级 AGENTS.md 内容") as HTMLTextAreaElement)
        .value,
    ).toBe("");

    // 保存：同一 workdir 一起发出去
    fireEvent.click(screen.getByRole("tab", { name: "个人级" }));
    const textarea = screen.getByLabelText(
      "个人级 AGENTS.md 内容",
    ) as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.value).toBe("# 个人档规则"));
    fireEvent.change(textarea, { target: { value: "# 个人档改后" } });
    fireEvent.click(screen.getByRole("button", { name: "保存个人级配置" }));

    const saves = sentMessages(mockVscode, "setAgentsContent", "local");
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({
      scope: "local",
      content: "# 个人档改后",
      workdir: "/work/a",
      // 并发保护基准 = 编辑时读到的那份内容的 hash（spec 场景 12）
      expectedHash: contentHash("# 个人档规则"),
    });
  });

  /**
   * 根因 4（跨项目串写，评审缺陷）：设置页只在「内容 prop 为 null」时重读，而
   * 内容缓存在 workdir 变化时并不失效——聚焦 pane 换了项目后，编辑器继续显示上一个
   * 项目的正文，用户点保存就把新项目的 AGENTS.md 覆盖成旧项目的内容。
   *
   * 修复（spec memory-management 场景 6）：workdir 变化 ⇒ 项目级 / 个人级草稿与
   * 缓存一起作废并按新项目重读；**用户级不重读**（与项目无关）。
   */
  it("切换项目（workdir 变化）：项目级按新项目重读、用户级不重读", async () => {
    const mockVscode = createMockVscode();
    const hostA = desktopHost();
    const { rerender } = render(
      <ChatApp vscode={mockVscode as unknown as VsCodeApi} host={hostA} />,
    );
    sendHostMessage(fixtures.authStatusResponse());
    sendHostMessage(fixtures.setInitialState({ workdir: "/work/a" }));

    await openSettings();
    // 用户级：打开即拉一次并落盘（之后的断言以这一次为基线）
    expect(sentMessages(mockVscode, "getAgentsContent", "user")).toHaveLength(
      1,
    );
    act(() => {
      sendHostMessage(fixtures.agentsContentResponse("user", "# 用户级规则"));
    });

    await openProjectTab();
    expect(projectRequests(mockVscode)).toHaveLength(1);
    act(() => {
      sendHostMessage(
        fixtures.agentsContentResponse("project", "# A 项目规则"),
      );
    });
    const projectTextarea = () =>
      screen.getByLabelText("项目级 AGENTS.md 内容") as HTMLTextAreaElement;
    await waitFor(() => expect(projectTextarea().value).toBe("# A 项目规则"));

    // 聚焦 pane 换到 B 项目：宿主推进新的 workdir（只有 workdir 变，内容不变）
    rerender(
      <ChatApp
        vscode={mockVscode as unknown as VsCodeApi}
        host={
          {
            ...hostA,
            workdir: "/work/b",
            recentWorkdirs: ["/work/b", "/work/a"],
          } as React.ComponentProps<typeof ChatApp>["host"]
        }
      />,
    );

    // A 的正文当场消失（这之前它就是「点保存写进 B 项目」的内容）
    expect(projectTextarea().value).toBe("");

    // 按新项目重读：请求第二次发出，且带的是 B 的 workdir
    await waitFor(() => expect(projectRequests(mockVscode)).toHaveLength(2));
    expect(projectRequests(mockVscode)[1][0]).toMatchObject({
      scope: "project",
      workdir: "/work/b",
    });

    act(() => {
      sendHostMessage(
        fixtures.agentsContentResponse("project", "# B 项目规则"),
      );
    });
    await waitFor(() => expect(projectTextarea().value).toBe("# B 项目规则"));

    // 用户级：草稿保留、没有第二次请求（`~/.wave/AGENTS.md` 与项目无关）
    fireEvent.click(screen.getByRole("tab", { name: "用户级" }));
    expect(
      (screen.getByLabelText("用户级 AGENTS.md 内容") as HTMLTextAreaElement)
        .value,
    ).toBe("# 用户级规则");
    expect(sentMessages(mockVscode, "getAgentsContent", "user")).toHaveLength(
      1,
    );
  });

  /**
   * 并发保护（spec memory-management 场景 12）：编辑器打开期间文件被外部改过。
   *
   * 宿主拒绝写入（`agentsContentSaved { conflict: true }`）后，webview 必须：
   * ① **不覆盖**磁盘（用户这次的内容不落盘）；② 重新读取该档，让编辑器显示磁盘上
   * 的最新内容；③ 给出可读提示，并且不静默丢掉用户刚才的编辑（可恢复）。
   */
  it("冲突：保存被拒后重新读取该档、显示磁盘新内容并保留可恢复的草稿", async () => {
    const mockVscode = createMockVscode();
    render(
      <ChatApp
        vscode={mockVscode as unknown as VsCodeApi}
        host={desktopHost()}
      />,
    );
    sendHostMessage(fixtures.authStatusResponse());
    sendHostMessage(fixtures.setInitialState({ workdir: "/work/a" }));

    await openSettings();
    await openProjectTab();
    act(() => {
      sendHostMessage(fixtures.agentsContentResponse("project", "# 版本 A"));
    });
    const textarea = () =>
      screen.getByLabelText("项目级 AGENTS.md 内容") as HTMLTextAreaElement;
    await waitFor(() => expect(textarea().value).toBe("# 版本 A"));

    // 用户改到一半并保存：请求里带的是这次读到的那份 hash
    fireEvent.change(textarea(), { target: { value: "# 我的改动" } });
    fireEvent.click(screen.getByRole("button", { name: "保存项目级配置" }));
    expect(
      sentMessages(mockVscode, "setAgentsContent", "project")[0],
    ).toMatchObject({ expectedHash: contentHash("# 版本 A") });

    // 宿主判定磁盘已变（外部改动）→ 拒绝写入
    act(() => {
      sendHostMessage(
        fixtures.agentsContentSaved("project", {
          ok: false,
          conflict: true,
          error: "file changed since you started editing",
        }),
      );
    });

    // ① 重新读取该档（第二次 getAgentsContent，仍带当前 workdir）
    await waitFor(() => expect(projectRequests(mockVscode)).toHaveLength(2));
    expect(projectRequests(mockVscode)[1][0]).toMatchObject({
      scope: "project",
      workdir: "/work/a",
    });
    // 重读窗口内编辑器只读（不能用不可信的内容再存一次）
    expect(textarea().readOnly).toBe(true);

    // ②③ 磁盘新内容落地：编辑器换成它，冲突提示可见、草稿可恢复
    act(() => {
      sendHostMessage(
        fixtures.agentsContentResponse("project", "# 外部改过的内容"),
      );
    });
    await waitFor(() => expect(textarea().value).toBe("# 外部改过的内容"));
    expect(document.querySelector(".agents-editor-conflict")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "恢复我的编辑" }));
    expect(textarea().value).toBe("# 我的改动");
  });
});
