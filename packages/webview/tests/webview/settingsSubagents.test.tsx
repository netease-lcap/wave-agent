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
import { ChatApp } from "../../src/components/ChatApp";
import SettingsPage from "../../src/components/SettingsPage";
import type { SubagentConfiguration } from "wave-agent-sdk/dist/types/index.js";
import type { VsCodeApi } from "../../src/types";

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

function renderSettingsPage(vscode?: { postMessage: (msg: unknown) => void }) {
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

  it("desktop 模式打开设置页并选中「子代理」选项卡，视图请求 agent 定义", async () => {
    const mockVscode = createMockVscode();
    const host = {
      type: "desktop",
      host: "local",
      hosts: ["local"],
      recentWorkdirs: [],
      workdir: "/work/a",
      sessionTree: [],
      panes: [],
      focusedPaneId: undefined,
      onSelectWorkdir: () => {},
      onSelectRecentWorkdir: () => {},
      onRemoveRecentWorkdir: () => {},
      onSelectHost: () => {},
      onAddHost: () => {},
      onSelectRemotePath: () => {},
      onListRemoteDir: () => {},
      onSelectSession: () => {},
      onDeleteSession: () => {},
      onOpenPane: () => {},
    } as unknown as React.ComponentProps<typeof ChatApp>["host"];
    render(<ChatApp vscode={mockVscode as unknown as VsCodeApi} host={host} />);
    sendHostMessage(fixtures.authStatusResponse());

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
    fireEvent.keyDown(input, { key: "Enter" });

    // 设置页打开且「子代理」选项卡激活（nav header + 导航项 is-active）
    expect(
      await screen.findByText("配置用于并行处理任务的子代理。"),
    ).toBeInTheDocument();
    expect(
      mockVscode.postMessage.mock.calls.find(
        (c) => c[0]?.command === "getSubagentConfigurations",
      ),
    ).toBeDefined();
  });
});

describe("SettingsPage 子代理选项卡视图（内容自 AgentsDialog 迁移）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("请求 agent 定义并按来源分组展示（内置 / 用户 / 插件）", async () => {
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

    expect(await screen.findByText("内置 agents")).toBeInTheDocument();
    expect(screen.getByText("插件 agents")).toBeInTheDocument();
    expect(screen.getByText("用户 agents")).toBeInTheDocument();

    // Row shows name + model
    expect(screen.getByText("explore")).toBeInTheDocument();
    expect(screen.getByText("· glm-5.2")).toBeInTheDocument();
    // Plugin agent shows its namespaced name
    expect(screen.getByText("sdd:specify")).toBeInTheDocument();
    // Description is shown in the row
    expect(
      screen.getByText("代码评审助手，检查潜在缺陷与改进点"),
    ).toBeInTheDocument();
  });

  it("shows an empty state when no agents are configured", async () => {
    renderSettingsPage();
    sendHostMessage(fixtures.subagentConfigurationsResponse([]));
    expect(await screen.findByText("暂无可用 agents")).toBeInTheDocument();
  });

  it("enters detail view on click and shows full configuration", async () => {
    renderSettingsPage();
    sendHostMessage(fixtures.subagentConfigurationsResponse([builtinAgent]));

    const row = await screen.findByText("explore");
    await act(async () => {
      fireEvent.click(row);
    });

    // Detail fields
    expect(screen.getByText("模型：")).toBeInTheDocument();
    expect(screen.getByText("glm-5.2")).toBeInTheDocument();
    expect(screen.getByText("来源：")).toBeInTheDocument();
    // Scope badge in the detail header and the 来源 field both render the label
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
    expect(screen.getByText("内置 agents")).toBeInTheDocument();
  });

  it("shows a placeholder model when none is configured", async () => {
    const noModelAgent: SubagentConfiguration = {
      ...userAgent,
      model: undefined,
    };
    renderSettingsPage();
    sendHostMessage(fixtures.subagentConfigurationsResponse([noModelAgent]));

    await act(async () => {
      fireEvent.click(await screen.findByText("code-review"));
    });
    expect(screen.getByText("默认（未显式配置）")).toBeInTheDocument();
  });
});
