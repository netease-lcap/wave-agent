import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  renderChatApp,
  render,
  screen,
  fireEvent,
  act,
  sendHostMessage,
  fixtures,
  createMockVscode,
} from "./test-utils";
import SettingsPage from "../../src/components/SettingsPage";
import type { SubagentConfiguration } from "wave-agent-sdk/dist/types/index.js";

const builtinAgent: SubagentConfiguration = {
  name: "explore",
  description: "独立探索代码库结构，快速定位文件与关键实现",
  model: "glm-5.2",
  tools: ["Glob", "Grep", "Read"],
  systemPrompt: "你是代码探索专家，负责快速定位代码实现。",
  scope: "builtin",
  priority: 0,
  filePath: "/builtin/agents/explore.md",
};

const pluginAgent: SubagentConfiguration = {
  name: "sdd:specify",
  description: "根据自然语言描述创建或更新功能规格说明",
  model: "deepseek-v4-flash",
  tools: ["Read", "Write"],
  systemPrompt: "你是规格编写专家，负责产出用户故事与验收场景。",
  scope: "plugin",
  priority: 0,
  filePath: "/plugins/sdd/agents/specify.md",
};

const userAgent: SubagentConfiguration = {
  name: "code-review",
  description: "代码评审助手，检查潜在缺陷与改进点",
  tools: ["Bash", "Read"],
  systemPrompt: "你是严格的代码评审专家。",
  scope: "user",
  priority: 0,
  filePath: "~/.wave/agents/code-review.md",
};

const projectAgent: SubagentConfiguration = {
  name: "deploy-agent",
  description: "项目部署专用子代理",
  tools: ["Bash"],
  systemPrompt: "你是项目部署专家。",
  scope: "project",
  priority: 0,
  filePath: "/work/a/.wave/agents/deploy-agent.md",
};

async function openAgentsCommand() {
  const { vscode } = renderChatApp();
  const input = screen.getByTestId("message-input");
  input.focus();
  await act(async () => {
    input.textContent = "/agents";
    const range = document.createRange();
    range.selectNodeContents(input);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    fireEvent.input(input, { data: "/agents", inputType: "insertText" });
  });
  // Send the command (Enter)
  fireEvent.keyDown(input, { key: "Enter" });
  return { vscode };
}

function renderSettingsPage(
  vscode?: { postMessage: (msg: unknown) => void },
  props?: { onPrefillPrompt?: (prompt: string) => void },
) {
  const mockVscode =
    vscode ||
    (createMockVscode() as unknown as { postMessage: (msg: unknown) => void });
  render(
    <SettingsPage
      configurationData={null}
      onClose={() => {}}
      userAgentsContent={null}
      projectAgentsContent={null}
      onLoadAgentsContent={() => {}}
      initialNav="subagents"
      vscode={mockVscode}
      workdir="/work/a"
      onPrefillPrompt={props?.onPrefillPrompt}
    />,
  );
  return { vscode: mockVscode };
}

describe("/agents 斜杠命令 → 设置页「子代理」选项卡", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("IDE 模式（VSCE/JB）发送 openSettings + nav=subagents，不再弹窗", async () => {
    const { vscode } = await openAgentsCommand();

    const call = vscode.postMessage.mock.calls.find(
      (c) => c[0]?.command === "openSettings",
    );
    expect(call).toBeDefined();
    expect(call?.[0]?.nav).toBe("subagents");
    // 弹窗已删除：不渲染 agents-dialog，也不发旧的请求命令（数据由设置页视图请求）
    expect(screen.queryByTestId("agents-dialog")).not.toBeInTheDocument();
  });
});

describe("SettingsPage 子代理选项卡视图（4 Tab + 项目 Tab 平铺）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("请求 agent 定义并展示四个来源 Tab（插件/内置/用户/项目）", async () => {
    const { vscode } = renderSettingsPage();

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "getSubagentConfigurations",
    });

    sendHostMessage(
      fixtures.subagentConfigurationsResponse([
        builtinAgent,
        pluginAgent,
        userAgent,
      ]),
    );

    expect(await screen.findByText("插件子代理")).toBeInTheDocument();
    expect(screen.getByText("内置子代理")).toBeInTheDocument();
    expect(screen.getByText("用户子代理")).toBeInTheDocument();
    expect(screen.getByText("项目子代理")).toBeInTheDocument();

    // 默认选中第一个 Tab（插件子代理）：展示插件子代理
    expect(screen.getByText("sdd:specify")).toBeInTheDocument();
    expect(screen.getByText("· deepseek-v4-flash")).toBeInTheDocument();
  });

  it("点击 Tab 切换来源，用户子代理 Tab 提供「新增子代理」入口", async () => {
    renderSettingsPage();
    sendHostMessage(
      fixtures.subagentConfigurationsResponse([builtinAgent, userAgent]),
    );

    await act(async () => {
      fireEvent.click(await screen.findByText("用户子代理"));
    });
    expect(screen.getByText("code-review")).toBeInTheDocument();
    expect(
      screen.getByText("代码评审助手，检查潜在缺陷与改进点"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /新增子代理/ }),
    ).toBeInTheDocument();
  });

  it("项目子代理 Tab 平铺展示（+ 新增指令）", async () => {
    renderSettingsPage();
    sendHostMessage(fixtures.subagentConfigurationsResponse([projectAgent]));

    await act(async () => {
      fireEvent.click(await screen.findByText("项目子代理"));
    });

    // 单项目模型：平铺展示，无项目分组卡片（2026-09-01 用户拍板）+ 新增指令
    expect(screen.queryByText("a")).not.toBeInTheDocument();
    expect(screen.getByText("deploy-agent")).toBeInTheDocument();
    expect(screen.getByText("项目部署专用子代理")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /新增指令/ }),
    ).toBeInTheDocument();
  });

  it("shows an empty state when no agents are configured", async () => {
    renderSettingsPage();
    sendHostMessage(fixtures.subagentConfigurationsResponse([]));
    expect(await screen.findByText("插件子代理暂无内容")).toBeInTheDocument();
  });

  it("enters detail view on click and shows full configuration", async () => {
    renderSettingsPage();
    sendHostMessage(fixtures.subagentConfigurationsResponse([builtinAgent]));

    await act(async () => {
      fireEvent.click(await screen.findByText("内置子代理"));
    });
    const row = await screen.findByText("explore");
    await act(async () => {
      fireEvent.click(row);
    });

    // Detail fields
    expect(screen.getByText("模型：")).toBeInTheDocument();
    expect(screen.getByText("glm-5.2")).toBeInTheDocument();
    expect(screen.getByText("来源：")).toBeInTheDocument();
    const sourceField = screen.getByText("来源：").parentElement;
    expect(sourceField).toHaveTextContent("内置");
    expect(screen.getByText("工具：")).toBeInTheDocument();
    expect(screen.getByText("Glob, Grep, Read")).toBeInTheDocument();
    expect(screen.getByText("文件：")).toBeInTheDocument();
    expect(screen.getByText("系统提示词：")).toBeInTheDocument();
    // System prompt body fully rendered
    expect(
      screen.getByText("你是代码探索专家，负责快速定位代码实现。"),
    ).toBeInTheDocument();

    // Back to list preserves loaded data
    await act(async () => {
      fireEvent.click(screen.getByText("返回列表"));
    });
    expect(screen.getByText("内置子代理")).toBeInTheDocument();
  });

  it("shows a placeholder model when none is configured", async () => {
    const noModelAgent: SubagentConfiguration = {
      ...userAgent,
      model: undefined,
    };
    renderSettingsPage();
    sendHostMessage(fixtures.subagentConfigurationsResponse([noModelAgent]));

    await act(async () => {
      fireEvent.click(await screen.findByText("用户子代理"));
    });
    await act(async () => {
      fireEvent.click(await screen.findByText("code-review"));
    });
    expect(screen.getByText("默认（未显式配置）")).toBeInTheDocument();
  });

  it("「新增子代理」→ onPrefillPrompt 预填用户级提示词", async () => {
    const onPrefillPrompt = vi.fn();
    renderSettingsPage(undefined, { onPrefillPrompt });
    sendHostMessage(fixtures.subagentConfigurationsResponse([userAgent]));

    await act(async () => {
      fireEvent.click(await screen.findByText("用户子代理"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /新增子代理/ }));
    });

    expect(onPrefillPrompt).toHaveBeenCalledWith(
      expect.stringContaining("帮我新建用户级子代理"),
    );
  });

  it("「编辑」→ 预填编辑提示词并发送 openFile（IDE 回退）", async () => {
    const onPrefillPrompt = vi.fn();
    const { vscode } = renderSettingsPage(undefined, { onPrefillPrompt });
    sendHostMessage(fixtures.subagentConfigurationsResponse([userAgent]));

    await act(async () => {
      fireEvent.click(await screen.findByText("用户子代理"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /编辑/ }));
    });

    expect(onPrefillPrompt).toHaveBeenCalledWith(
      expect.stringContaining("帮我编辑子代理code-review"),
    );
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "openFile",
      path: "~/.wave/agents/code-review.md",
    });
  });

  it("「编辑」优先走 onOpenExternalFile（desktop 系统编辑器）", async () => {
    const onOpenExternalFile = vi.fn();
    const onPrefillPrompt = vi.fn();
    const mockVscode = createMockVscode() as unknown as {
      postMessage: (msg: unknown) => void;
    };
    const { unmount } = render(
      <SettingsPage
        configurationData={null}
        onClose={() => {}}
        userAgentsContent={null}
        projectAgentsContent={null}
        onLoadAgentsContent={() => {}}
        initialNav="subagents"
        vscode={mockVscode}
        workdir="/work/a"
        onPrefillPrompt={onPrefillPrompt}
        onOpenExternalFile={onOpenExternalFile}
      />,
    );
    sendHostMessage(fixtures.subagentConfigurationsResponse([userAgent]));

    await act(async () => {
      fireEvent.click(await screen.findByText("用户子代理"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /编辑/ }));
    });

    expect(onOpenExternalFile).toHaveBeenCalledWith(
      "~/.wave/agents/code-review.md",
    );
    expect(mockVscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "openFile" }),
    );
    unmount();
  });

  it("「删除」→ 二次确认 → deleteSubagent RPC", async () => {
    const { vscode } = renderSettingsPage();
    sendHostMessage(fixtures.subagentConfigurationsResponse([userAgent]));

    await act(async () => {
      fireEvent.click(await screen.findByText("用户子代理"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /删除/ }));
    });

    // 确认框出现（含子代理名与路径）
    expect(
      await screen.findByText("删除子代理「code-review」"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/~\/\.wave\/agents\/code-review\.md/),
    ).toBeInTheDocument();

    // 取消不删除
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));
    });
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "deleteSubagent" }),
    );

    // 再次打开并确认
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /删除/ }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByTestId("confirm-dialog-confirm"));
    });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "deleteSubagent",
      name: "code-review",
    });
  });

  it("插件/内置子代理不提供「删除」入口（只读来源）", async () => {
    renderSettingsPage();
    sendHostMessage(
      fixtures.subagentConfigurationsResponse([builtinAgent, pluginAgent]),
    );

    expect(
      screen.queryByRole("button", { name: /删除/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /编辑/ }),
    ).not.toBeInTheDocument();
  });
});
