import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  renderChatApp,
  screen,
  waitFor,
  fireEvent,
  act,
  sendHostMessage,
  fixtures,
} from "./test-utils";
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

async function openAgentsDialog() {
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

describe("AgentsDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens via /agents and requests agent definitions from the host", async () => {
    const { vscode } = await openAgentsDialog();

    expect(await screen.findByTestId("agents-dialog")).toBeInTheDocument();
    const getConfigCall = vscode.postMessage.mock.calls.find(
      (c) => c[0]?.command === "getSubagentConfigurations",
    );
    expect(getConfigCall).toBeDefined();
  });

  it("groups agents by scope (内置 / 用户 / 项目 / 插件) with name · model · description rows", async () => {
    await openAgentsDialog();

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
    await openAgentsDialog();

    sendHostMessage(fixtures.subagentConfigurationsResponse([]));

    expect(await screen.findByText("暂无可用 agents")).toBeInTheDocument();
  });

  it("enters detail view on click and shows full configuration", async () => {
    await openAgentsDialog();

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
    await openAgentsDialog();

    sendHostMessage(fixtures.subagentConfigurationsResponse([noModelAgent]));

    await act(async () => {
      fireEvent.click(await screen.findByText("code-review"));
    });
    expect(screen.getByText("默认（未显式配置）")).toBeInTheDocument();
  });

  it("closes via Esc, and Esc in detail returns to the list first", async () => {
    await openAgentsDialog();
    sendHostMessage(fixtures.subagentConfigurationsResponse([builtinAgent]));

    await act(async () => {
      fireEvent.click(await screen.findByText("explore"));
    });
    expect(screen.getByText("系统提示词：")).toBeInTheDocument();

    // Esc in detail → back to list
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByText("内置 agents")).toBeInTheDocument();
    expect(screen.queryByText("系统提示词：")).not.toBeInTheDocument();

    // Esc in list → closes the dialog
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByTestId("agents-dialog")).not.toBeInTheDocument();
    });
  });

  it("closes when clicking outside the dialog", async () => {
    vi.useFakeTimers();
    try {
      await openAgentsDialog();
      sendHostMessage(fixtures.subagentConfigurationsResponse([builtinAgent]));

      // Let the deferred mousedown listener register, then click the overlay (outside the dialog)
      vi.advanceTimersByTime(0);
      const overlay = document.querySelector(".configuration-dialog-overlay");
      expect(overlay).not.toBeNull();
      fireEvent.mouseDown(overlay as HTMLElement);

      expect(screen.queryByTestId("agents-dialog")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
