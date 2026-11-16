import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { contentHash } from "wave-webview-fixtures";
import { render, screen, fireEvent } from "./test-utils";
import SettingsPage from "../../src/components/SettingsPage";
import type { AgentsScope } from "../../src/components/SettingsPage";
import type { AgentsReadState } from "../../src/utils/agentsReadState";

/**
 * SettingsPage「个性化」AGENTS.md 编辑器（用户级/项目级/个人级可编辑 + 独立保存）。
 * 2026-09-04 产品拍板由只读展示恢复可编辑（PM bug 3466367350195712）：
 * - 文本区去除硬编码 readOnly，onChange 更新当前作用域草稿；
 * - 各作用域独立「保存用户级/项目级/个人级配置」按钮 → onSaveAgentsContent(scope, content)；
 * - host 回发 agentsContentSaved（agentsSaving false）复位按钮禁用；
 *   2026-09-09 设计师拍板：保存结果反馈改走宿主全局 toast，设置页不再渲染
 *   页面内「保存成功 / 保存失败」提示（见 desktop-settings
 *   「设置页反馈语义」）。
 * 2026-11 三档（spec memory-management「设置页三档记忆编辑器」）：新增个人级
 * `<workdir>/AGENTS.local.md`，个人级 tab 下多一行 .gitignore 静态提示（场景 7）。
 * 2026-11 并发保护与读状态（同一故事场景 8–13）：编辑器是否可写由「内容是否已加载
 * + 读状态（exists / readable / hash）」决定，保存带 `expectedHash`。
 */

/**
 * 按内容派生「读完且文件存在」的读状态——也就是**可编辑**那一档。用例只关心某一维
 * 时用 `readState` 覆盖单个 scope，其余档仍按这个默认值走。
 */
function readableState(content: string): AgentsReadState {
  return { exists: true, readable: true, hash: contentHash(content) };
}

function renderPersonalization(options?: {
  userAgentsContent?: string | null;
  projectAgentsContent?: string | null;
  localAgentsContent?: string | null;
  /** 覆盖某一档的读状态（缺省 = 内容已读、文件存在、hash 由内容派生）。 */
  readState?: Partial<Record<AgentsScope, AgentsReadState | null>>;
  agentsConflict?: { scope: AgentsScope; token: number } | null;
  agentsSaving?: boolean;
}) {
  const onSaveAgentsContent = vi.fn();
  const onLoadAgentsContent = vi.fn();
  const userAgentsContent =
    options?.userAgentsContent === undefined
      ? "# User Memory"
      : options.userAgentsContent;
  const projectAgentsContent =
    options?.projectAgentsContent === undefined
      ? "# Project Rules"
      : options.projectAgentsContent;
  const localAgentsContent = options?.localAgentsContent;
  const defaultState = (
    content: string | null | undefined,
  ): AgentsReadState | null =>
    typeof content === "string" ? readableState(content) : null;
  const readState = {
    user: defaultState(userAgentsContent),
    project: defaultState(projectAgentsContent),
    local: defaultState(localAgentsContent),
    ...options?.readState,
  };
  const props: React.ComponentProps<typeof SettingsPage> = {
    configurationData: { language: "zh-CN" },
    onClose: () => {},
    initialNav: "personalization",
    userAgentsContent,
    projectAgentsContent,
    // 未显式给出 = 个人级尚未加载（由 SettingsPage 按 null 处理，切到个人级才拉取）
    localAgentsContent,
    agentsReadState: readState,
    agentsConflict: options?.agentsConflict ?? null,
    onLoadAgentsContent,
    onSaveAgentsContent,
    agentsSaving: options?.agentsSaving ?? false,
  };
  const utils = render(<SettingsPage {...props} />);
  return { onSaveAgentsContent, onLoadAgentsContent, props, readState, utils };
}

describe("SettingsPage「个性化」AGENTS.md 编辑器可编辑 + 独立保存", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("文本区不再只读：用户级可键入并更新草稿", () => {
    renderPersonalization();

    const textarea = screen.getByLabelText(
      "用户级 AGENTS.md 内容",
    ) as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();
    // 回归护栏：此前为硬编码 readOnly（PM bug 根因），现须可编辑
    expect(textarea.readOnly).toBe(false);
    fireEvent.change(textarea, { target: { value: "# 新规则" } });
    expect(textarea.value).toBe("# 新规则");
  });

  it("点击「保存用户级配置」按当前草稿回调 onSaveAgentsContent('user', …)，并带上读到的 hash", () => {
    const { onSaveAgentsContent } = renderPersonalization({
      userAgentsContent: "# 初稿",
    });

    const textarea = screen.getByLabelText(
      "用户级 AGENTS.md 内容",
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "# 改后" } });
    fireEvent.click(screen.getByRole("button", { name: "保存用户级配置" }));

    expect(onSaveAgentsContent).toHaveBeenCalledTimes(1);
    // 第三个参数 = 打开编辑器时读到的那份内容的 hash（spec 场景 12），不是草稿的 hash
    expect(onSaveAgentsContent).toHaveBeenCalledWith(
      "user",
      "# 改后",
      contentHash("# 初稿"),
    );
  });

  it("项目级 tab 保存回调 onSaveAgentsContent('project', …) 且草稿独立保留", () => {
    const { onSaveAgentsContent } = renderPersonalization({
      userAgentsContent: "# 用户内容",
      projectAgentsContent: "# 项目内容",
    });

    // 先在用户级改草稿但不保存
    fireEvent.change(screen.getByLabelText("用户级 AGENTS.md 内容"), {
      target: { value: "# 用户未保存草稿" },
    });
    // 切到项目级：内容为该作用域独立草稿
    fireEvent.click(screen.getByRole("tab", { name: "项目级" }));
    const projectTextarea = screen.getByLabelText(
      "项目级 AGENTS.md 内容",
    ) as HTMLTextAreaElement;
    expect(projectTextarea.value).toBe("# 项目内容");
    fireEvent.change(projectTextarea, { target: { value: "# 项目改后" } });
    fireEvent.click(screen.getByRole("button", { name: "保存项目级配置" }));

    expect(onSaveAgentsContent).toHaveBeenCalledTimes(1);
    expect(onSaveAgentsContent).toHaveBeenCalledWith(
      "project",
      "# 项目改后",
      contentHash("# 项目内容"),
    );

    // 切回用户级：未保存草稿保留，未触发任何写回
    fireEvent.click(screen.getByRole("tab", { name: "用户级" }));
    expect(
      (screen.getByLabelText("用户级 AGENTS.md 内容") as HTMLTextAreaElement)
        .value,
    ).toBe("# 用户未保存草稿");
    expect(onSaveAgentsContent).toHaveBeenCalledTimes(1);
  });

  it("保存期间按钮禁用，host 回发后复位；不渲染页面内「保存成功」文字", () => {
    const { utils } = renderPersonalization({ agentsSaving: false });

    fireEvent.click(screen.getByRole("button", { name: "保存用户级配置" }));
    expect(screen.queryByText("保存成功")).not.toBeInTheDocument();

    // 保存中（agentsSaving=true）：按钮禁用、无页面内反馈（toast 由宿主负责）
    utils.rerender(
      <SettingsPage
        configurationData={{ language: "zh-CN" }}
        onClose={() => {}}
        initialNav="personalization"
        userAgentsContent="# User Memory"
        projectAgentsContent="# Project Rules"
        onLoadAgentsContent={() => {}}
        onSaveAgentsContent={() => {}}
        agentsSaving={true}
      />,
    );
    expect(
      screen.getByRole("button", { name: "保存用户级配置" }),
    ).toBeDisabled();
    expect(screen.queryByText("保存成功")).not.toBeInTheDocument();

    // host 回发完成（agentsSaving=false）：按钮复位；成功提示不再落页面内
    utils.rerender(
      <SettingsPage
        configurationData={{ language: "zh-CN" }}
        onClose={() => {}}
        initialNav="personalization"
        userAgentsContent="# User Memory"
        projectAgentsContent="# Project Rules"
        onLoadAgentsContent={() => {}}
        onSaveAgentsContent={() => {}}
        agentsSaving={false}
      />,
    );
    expect(
      screen.getByRole("button", { name: "保存用户级配置" }),
    ).toBeEnabled();
    expect(screen.queryByText("保存成功")).not.toBeInTheDocument();

    // 切换导航项无残留（本就无页面内反馈状态）
    fireEvent.click(screen.getByRole("button", { name: "全局设置" }));
    expect(screen.queryByText("保存成功")).not.toBeInTheDocument();
  });

  it("保存失败原因不落页面内文字（统一由宿主全局 toast 提示）", () => {
    const { utils } = renderPersonalization({ agentsSaving: false });

    // 模拟一次完整保存周期：触发保存 → 保存中 → 完成；任何时刻都无失败提示
    fireEvent.click(screen.getByRole("button", { name: "保存用户级配置" }));
    utils.rerender(
      <SettingsPage
        configurationData={{ language: "zh-CN" }}
        onClose={() => {}}
        initialNav="personalization"
        userAgentsContent="# User Memory"
        projectAgentsContent="# Project Rules"
        onLoadAgentsContent={() => {}}
        onSaveAgentsContent={() => {}}
        agentsSaving={true}
      />,
    );
    utils.rerender(
      <SettingsPage
        configurationData={{ language: "zh-CN" }}
        onClose={() => {}}
        initialNav="personalization"
        userAgentsContent="# User Memory"
        projectAgentsContent="# Project Rules"
        onLoadAgentsContent={() => {}}
        onSaveAgentsContent={() => {}}
        agentsSaving={false}
      />,
    );
    expect(screen.queryByText(/保存失败/)).not.toBeInTheDocument();
    // 页面内无任何保存反馈容器（容器样式类亦已随提示移除）
    expect(document.querySelector(".settings-save-message")).toBeNull();
    expect(document.querySelector(".agents-save-message")).toBeNull();
  });

  it("宿主未提供 onSaveAgentsContent 时保存按钮禁用（降级只读源）", () => {
    render(
      <SettingsPage
        configurationData={{ language: "zh-CN" }}
        onClose={() => {}}
        initialNav="personalization"
        userAgentsContent="# 用户内容"
        projectAgentsContent={null}
        agentsReadState={{ user: readableState("# 用户内容") }}
        onLoadAgentsContent={() => {}}
      />,
    );
    // 内容已读到 ⇒ 文本区仍可编辑（无 host 写入能力时只禁用保存按钮）
    const textarea = screen.getByLabelText(
      "用户级 AGENTS.md 内容",
    ) as HTMLTextAreaElement;
    expect(textarea.readOnly).toBe(false);
    expect(
      screen.getByRole("button", { name: "保存用户级配置" }),
    ).toBeDisabled();
  });
});

/**
 * 三档记忆编辑器（spec memory-management「设置页三档记忆编辑器」场景 1–3、7）：
 * 用户级 ~/.wave/AGENTS.md、项目级 <workdir>/AGENTS.md、个人级
 * <workdir>/AGENTS.local.md。切 tab 只换编辑器绑定（不触发保存），个人级另有一行
 * .gitignore 静态提示。
 */
describe("SettingsPage「个性化」三档记忆编辑器（含个人级 AGENTS.local.md）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("三个 tab 都存在且顺序为用户级 → 项目级 → 个人级", () => {
    renderPersonalization();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual([
      "用户级",
      "项目级",
      "个人级",
    ]);
    // 默认停在用户级
    expect(screen.getByRole("tab", { name: "用户级" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("切 tab 只换编辑器绑定，不触发保存", () => {
    const { onSaveAgentsContent, onLoadAgentsContent } = renderPersonalization({
      userAgentsContent: "# 用户内容",
      projectAgentsContent: "# 项目内容",
      localAgentsContent: "# 个人内容",
    });

    fireEvent.click(screen.getByRole("tab", { name: "项目级" }));
    expect(
      (screen.getByLabelText("项目级 AGENTS.md 内容") as HTMLTextAreaElement)
        .value,
    ).toBe("# 项目内容");

    fireEvent.click(screen.getByRole("tab", { name: "个人级" }));
    expect(
      (screen.getByLabelText("个人级 AGENTS.md 内容") as HTMLTextAreaElement)
        .value,
    ).toBe("# 个人内容");
    // 三档内容都已加载 ⇒ 不额外请求；切档本身绝不写盘
    expect(onLoadAgentsContent).not.toHaveBeenCalled();
    expect(onSaveAgentsContent).not.toHaveBeenCalled();
  });

  it("个人级保存回调 onSaveAgentsContent('local', …)，三档草稿互相独立", () => {
    const { onSaveAgentsContent } = renderPersonalization({
      userAgentsContent: "# 用户内容",
      projectAgentsContent: "# 项目内容",
      localAgentsContent: "# 个人内容",
    });

    fireEvent.click(screen.getByRole("tab", { name: "个人级" }));
    const localTextarea = screen.getByLabelText(
      "个人级 AGENTS.md 内容",
    ) as HTMLTextAreaElement;
    fireEvent.change(localTextarea, { target: { value: "# 个人改后" } });
    fireEvent.click(screen.getByRole("button", { name: "保存个人级配置" }));

    expect(onSaveAgentsContent).toHaveBeenCalledTimes(1);
    expect(onSaveAgentsContent).toHaveBeenCalledWith(
      "local",
      "# 个人改后",
      contentHash("# 个人内容"),
    );

    // 另两档草稿未被个人级的编辑污染
    fireEvent.click(screen.getByRole("tab", { name: "用户级" }));
    expect(
      (screen.getByLabelText("用户级 AGENTS.md 内容") as HTMLTextAreaElement)
        .value,
    ).toBe("# 用户内容");
    fireEvent.click(screen.getByRole("tab", { name: "项目级" }));
    expect(
      (screen.getByLabelText("项目级 AGENTS.md 内容") as HTMLTextAreaElement)
        .value,
    ).toBe("# 项目内容");
    expect(onSaveAgentsContent).toHaveBeenCalledTimes(1);
  });

  it("个人级 tab 显示 .gitignore 提示，其余两档不显示", () => {
    // 个人级要显式给出「已读到」的内容 + 读状态：未加载时该档是只读态（场景 9），
    // 与这里要验的「提示不拦截保存」无关。
    renderPersonalization({ localAgentsContent: "# 个人内容" });

    // 用户级 / 项目级：没有这一行提示
    expect(document.querySelector(".agents-local-hint")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "项目级" }));
    expect(document.querySelector(".agents-local-hint")).toBeNull();

    // 个人级：一行静态提示，点名 .gitignore 与 AGENTS.local.md
    fireEvent.click(screen.getByRole("tab", { name: "个人级" }));
    const hint = document.querySelector(".agents-local-hint");
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toContain(".gitignore");
    expect(hint?.textContent).toContain("AGENTS.local.md");
    // 提示不拦截保存（保存按钮照常可用）
    expect(
      screen.getByRole("button", { name: "保存个人级配置" }),
    ).toBeEnabled();
  });

  it("host 回发个人级内容只填个人级编辑器，不覆盖另两档草稿", () => {
    const { props, utils } = renderPersonalization({
      userAgentsContent: "# 用户内容",
      projectAgentsContent: "# 项目内容",
      localAgentsContent: null,
    });

    // 个人级尚未加载 → 切到个人级时按需拉取这一档
    fireEvent.click(screen.getByRole("tab", { name: "个人级" }));
    expect(props.onLoadAgentsContent).toHaveBeenCalledWith("local");

    // 回包落地（ChatApp 收到 agentsContentResponse(scope: "local") 后回填本 prop）
    utils.rerender(
      <SettingsPage {...props} localAgentsContent="# 磁盘个人内容" />,
    );
    expect(
      (screen.getByLabelText("个人级 AGENTS.md 内容") as HTMLTextAreaElement)
        .value,
    ).toBe("# 磁盘个人内容");

    fireEvent.click(screen.getByRole("tab", { name: "用户级" }));
    expect(
      (screen.getByLabelText("用户级 AGENTS.md 内容") as HTMLTextAreaElement)
        .value,
    ).toBe("# 用户内容");
    fireEvent.click(screen.getByRole("tab", { name: "项目级" }));
    expect(
      (screen.getByLabelText("项目级 AGENTS.md 内容") as HTMLTextAreaElement)
        .value,
    ).toBe("# 项目内容");
  });

  /**
   * 跨项目串写（评审缺陷）：插件端设置页是常驻 tab，宿主每次打开都重推一份新的
   * `workdir`，而三档内容缓存不会跟着变——A 项目的正文就此停在编辑器里，用户点
   * 保存就把 B 项目的 `AGENTS.md` 覆盖成 A 的内容。
   *
   * 修复：`workdir` 变了 ⇒ 作废项目级 / 个人级草稿并请宿主把这两档缓存置回 null
   * （随即按新项目重读）；**用户级不重置**（spec memory-management 场景 6：用户级
   * 与项目无关，不重读）。
   */
  it("workdir 变了：项目级/个人级草稿作废并按新项目重读，用户级不重置", () => {
    const onLoadAgentsContent = vi.fn();
    const onResetProjectAgentsContent = vi.fn();
    const props: React.ComponentProps<typeof SettingsPage> = {
      configurationData: { language: "zh-CN" },
      onClose: () => {},
      initialNav: "personalization",
      userAgentsContent: "# 用户内容",
      projectAgentsContent: "# A 项目规则",
      localAgentsContent: "# A 个人档",
      onLoadAgentsContent,
      onSaveAgentsContent: () => {},
      onResetProjectAgentsContent,
    };
    const { rerender } = render(<SettingsPage {...props} workdir="/work/a" />);

    // 停在项目级 tab：显示 A 项目的内容
    fireEvent.click(screen.getByRole("tab", { name: "项目级" }));
    const projectValue = () =>
      (screen.getByLabelText("项目级 AGENTS.md 内容") as HTMLTextAreaElement)
        .value;
    expect(projectValue()).toBe("# A 项目规则");

    // 宿主切项目：只是 workdir 变了（内容 props 尚未变）
    rerender(<SettingsPage {...props} workdir="/work/b" />);
    expect(onResetProjectAgentsContent).toHaveBeenCalledTimes(1);
    // A 的正文不得留在编辑器里，否则一次保存就把 B 的 AGENTS.md 写成 A 的内容
    expect(projectValue()).toBe("");

    // 宿主按契约把两档缓存置回 null ⇒ 按新项目重读（只拉项目级这一档）
    rerender(
      <SettingsPage
        {...props}
        workdir="/work/b"
        projectAgentsContent={null}
        localAgentsContent={null}
      />,
    );
    expect(onLoadAgentsContent).toHaveBeenCalledWith("project");

    // 新项目回包落地：编辑器显示 B 的正文
    rerender(
      <SettingsPage
        {...props}
        workdir="/work/b"
        projectAgentsContent="# B 项目规则"
        localAgentsContent={null}
      />,
    );
    expect(projectValue()).toBe("# B 项目规则");

    // 个人级同样被作废并按需重读（切过去才拉，符合「各自按需」）
    fireEvent.click(screen.getByRole("tab", { name: "个人级" }));
    expect(onLoadAgentsContent).toHaveBeenCalledWith("local");

    // 用户级：草稿保留、也没有重新读过（与项目无关）
    fireEvent.click(screen.getByRole("tab", { name: "用户级" }));
    expect(
      (screen.getByLabelText("用户级 AGENTS.md 内容") as HTMLTextAreaElement)
        .value,
    ).toBe("# 用户内容");
    expect(onLoadAgentsContent).not.toHaveBeenCalledWith("user");
  });
});

/**
 * 并发保护与读状态（spec memory-management「设置页三档记忆编辑器」场景 8–13）。
 *
 * 三档编辑器此前只有「内容」一个输入，三种完全不同的情况（还没读到 / 读取失败 /
 * 文件不存在）在界面上都长得一样：一个空 textarea + 一个可点的保存按钮。于是
 * 「权限错误的文件」和「空文件」无法区分，用户点一次保存就把磁盘上的文件覆盖成空；
 * 切项目重读的那一帧也能把上一个项目的正文写进新项目。
 *
 * 现在可写性由「内容已加载 + 读状态」决定：只有 `readable && (hash 是字符串 或
 * exists === false)` 才允许编辑与保存，保存时把 hash 作为 `expectedHash` 发出去。
 */
describe("SettingsPage「个性化」AGENTS.md 并发保护与读状态", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const saveButton = (label: string) =>
    screen.getByRole("button", {
      name: `保存${label}配置`,
    }) as HTMLButtonElement;
  const textarea = (label: string) =>
    screen.getByLabelText(`${label} AGENTS.md 内容`) as HTMLTextAreaElement;

  it("场景 9：内容还没回来（首帧 / 切项目重读）⇒ 只读 + 保存禁用", () => {
    renderPersonalization({
      userAgentsContent: null,
      projectAgentsContent: null,
      readState: { user: null, project: null },
    });

    expect(textarea("用户级").readOnly).toBe(true);
    expect(saveButton("用户级")).toBeDisabled();
    expect(
      document.querySelector(".agents-editor-status")?.textContent,
    ).toContain("正在读取");

    // 切到同样未加载的项目级：一样只读（重读窗口不能写）
    fireEvent.click(screen.getByRole("tab", { name: "项目级" }));
    expect(textarea("项目级").readOnly).toBe(true);
    expect(saveButton("项目级")).toBeDisabled();
  });

  it("场景 9：有内容但没拿到 hash ⇒ 只读 + 保存禁用（没有并发校验基准）", () => {
    renderPersonalization({
      userAgentsContent: "# 用户内容",
      readState: { user: { exists: true, readable: true, hash: null } },
    });

    expect(textarea("用户级").readOnly).toBe(true);
    expect(saveButton("用户级")).toBeDisabled();
    expect(
      document.querySelector(".agents-editor-status")?.textContent,
    ).toContain("校验值");
  });

  it("场景 10：读取失败 ⇒ 与「空文件」可区分的失败态，只读且禁止保存", () => {
    // 读取失败：回包内容为空（那不代表文件为空）+ error 文案
    const { utils, props } = renderPersonalization({
      userAgentsContent: "",
      readState: {
        user: {
          exists: true,
          readable: false,
          hash: null,
          error: "EACCES: permission denied",
        },
      },
    });

    expect(
      document.querySelector(".agents-editor-status")?.textContent,
    ).toContain("EACCES: permission denied");
    // 关键：文案必须点明「看到的空不代表文件为空」，否则用户会以为文件被清空了
    expect(
      document.querySelector(".agents-editor-status")?.textContent,
    ).toContain("并不代表文件是空的");
    expect(textarea("用户级").readOnly).toBe(true);
    expect(saveButton("用户级")).toBeDisabled();

    // 对照组：同样是空内容，但读成功（真的空文件）⇒ 可编辑、可保存、没有失败态
    utils.rerender(
      <SettingsPage {...props} agentsReadState={{ user: readableState("") }} />,
    );
    expect(document.querySelector(".agents-editor-status")).toBeNull();
    expect(textarea("用户级").readOnly).toBe(false);
    expect(saveButton("用户级")).toBeEnabled();
  });

  it("场景 11：文件不存在 ⇒ 显示「尚未创建」但允许编辑与保存，保存带 expectedHash: null", () => {
    const { onSaveAgentsContent } = renderPersonalization({
      userAgentsContent: "",
      readState: { user: { exists: false, readable: true, hash: null } },
    });

    expect(
      document.querySelector(".agents-editor-status")?.textContent,
    ).toContain("尚未创建");
    expect(textarea("用户级").readOnly).toBe(false);
    expect(saveButton("用户级")).toBeEnabled();

    fireEvent.change(textarea("用户级"), {
      target: { value: "# 新建的个人档" },
    });
    fireEvent.click(saveButton("用户级"));
    // null = 读的时候文件不存在：宿主据此把「从不存在变为存在」也判成冲突
    expect(onSaveAgentsContent).toHaveBeenCalledWith(
      "user",
      "# 新建的个人档",
      null,
    );
  });

  it("场景 12：保存带上编辑时读到的 hash", () => {
    const { onSaveAgentsContent } = renderPersonalization({
      userAgentsContent: "# 用户内容",
      readState: {
        user: { exists: true, readable: true, hash: "deadbeef" },
      },
    });

    fireEvent.change(textarea("用户级"), { target: { value: "# 改后" } });
    fireEvent.click(saveButton("用户级"));
    expect(onSaveAgentsContent).toHaveBeenCalledWith(
      "user",
      "# 改后",
      "deadbeef",
    );
  });

  it("场景 12：冲突后被拒 ⇒ 显示提示、编辑器换成磁盘新内容、草稿可恢复", () => {
    const { props, utils } = renderPersonalization({
      userAgentsContent: "# 用户内容",
    });

    // 用户改到一半，点保存（保存发出，界面先进入 saving 态）
    fireEvent.change(textarea("用户级"), {
      target: { value: "# 我的改动" },
    });
    fireEvent.click(saveButton("用户级"));

    // 宿主回 agentsContentSaved { conflict: true }：ChatApp 把该档内容置回 null
    // （= 未加载，触发重读）并把冲突信号透传下来
    utils.rerender(
      <SettingsPage
        {...props}
        userAgentsContent={null}
        agentsReadState={{ user: null }}
        agentsConflict={{ scope: "user", token: 1 }}
        agentsSaving={false}
      />,
    );
    // 重读窗口内：只读（草稿还在 textarea 里，未被覆盖）
    expect(textarea("用户级").readOnly).toBe(true);
    expect(textarea("用户级").value).toBe("# 我的改动");

    // 磁盘上的最新内容回来了：编辑器换成它（用户基于新内容重改），hash 也是新的
    utils.rerender(
      <SettingsPage
        {...props}
        userAgentsContent="# 外部改过的内容"
        agentsReadState={{ user: readableState("# 外部改过的内容") }}
        agentsConflict={{ scope: "user", token: 1 }}
        agentsSaving={false}
      />,
    );
    expect(textarea("用户级").value).toBe("# 外部改过的内容");
    expect(textarea("用户级").readOnly).toBe(false);

    // 冲突提示可见，且用户刚才的编辑没有被静默丢掉
    const notice = document.querySelector(".agents-editor-conflict");
    expect(notice?.textContent).toContain("被外部修改");
    fireEvent.click(screen.getByRole("button", { name: "恢复我的编辑" }));
    expect(textarea("用户级").value).toBe("# 我的改动");
    expect(document.querySelector(".agents-editor-conflict")).toBeNull();

    // 恢复后保存：带的是磁盘最新那份的 hash（否则会被再拒一次）
    fireEvent.click(saveButton("用户级"));
    expect(props.onSaveAgentsContent).toHaveBeenLastCalledWith(
      "user",
      "# 我的改动",
      contentHash("# 外部改过的内容"),
    );
  });

  it("场景 13：宿主不给读状态（老宿主）⇒ 保持可编辑、保存不带 expectedHash", () => {
    const onSaveAgentsContent = vi.fn();
    render(
      <SettingsPage
        configurationData={{ language: "zh-CN" }}
        onClose={() => {}}
        initialNav="personalization"
        userAgentsContent="# 用户内容"
        projectAgentsContent={null}
        onLoadAgentsContent={() => {}}
        onSaveAgentsContent={onSaveAgentsContent}
      />,
    );

    // 没有 agentsReadState ⇒ 不做只读降级（否则老宿主的记忆编辑器会永久不可写）
    expect(textarea("用户级").readOnly).toBe(false);
    expect(document.querySelector(".agents-editor-status")).toBeNull();
    fireEvent.change(textarea("用户级"), { target: { value: "# 改后" } });
    fireEvent.click(saveButton("用户级"));
    // 第三个参数省略（不是 null）：「不校验」与「当时文件不存在」是两件事
    expect(onSaveAgentsContent).toHaveBeenCalledWith("user", "# 改后");
  });
});
