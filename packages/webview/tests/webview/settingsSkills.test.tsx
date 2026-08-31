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
import type { SkillMetadata } from "wave-agent-sdk/dist/types/index.js";

const builtinSkill: SkillMetadata = {
  name: "deep-research",
  description: "深度研究：并行检索并交叉验证信息源，产出带引用的报告",
  type: "builtin",
  skillPath: "/builtin/skills/deep-research.md",
  allowedTools: ["WebFetch", "Grep"],
  userInvocable: true,
};

const pluginSkill: SkillMetadata = {
  name: "sdd:specify",
  description: "根据自然语言描述创建或更新功能规格说明",
  type: "builtin",
  skillPath: "/plugins/sdd/skills/specify.md",
  pluginName: "sdd",
  userInvocable: true,
};

const userSkill: SkillMetadata = {
  name: "my-skill",
  description: "个人自定义技能，用于日常代码审查",
  type: "personal",
  skillPath: "~/.wave/skills/my-skill.md",
  model: "glm-5.2",
  allowedTools: ["Read", "Write"],
  userInvocable: true,
};

async function openSkillsCommand() {
  const { vscode } = renderChatApp();
  const input = screen.getByTestId("message-input");
  input.focus();
  await act(async () => {
    input.textContent = "/skills";
    const range = document.createRange();
    range.selectNodeContents(input);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    fireEvent.input(input, { data: "/skills", inputType: "insertText" });
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
      initialNav="skills"
      vscode={mockVscode}
    />,
  );
  return { vscode: mockVscode };
}

describe("/skills 斜杠命令 → 设置页「技能」选项卡", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("IDE 模式（VSCE/JB）发送 openSettings + nav=skills，不再弹窗", async () => {
    const { vscode } = await openSkillsCommand();

    const call = vscode.postMessage.mock.calls.find(
      (c) => c[0]?.command === "openSettings",
    );
    expect(call).toBeDefined();
    expect(call?.[0]?.nav).toBe("skills");
    expect(screen.queryByTestId("skills-dialog")).not.toBeInTheDocument();
  });
});

describe("SettingsPage 技能选项卡视图（内容自 SkillsDialog 迁移）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("请求技能元数据并按来源分组展示（内置 / 用户 / 插件）", async () => {
    const { vscode } = renderSettingsPage();

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "getSkillMetadata",
    });

    sendHostMessage(
      fixtures.skillMetadataResponse([builtinSkill, pluginSkill, userSkill]),
    );

    expect(await screen.findByText("内置 skills")).toBeInTheDocument();
    expect(screen.getByText("用户 skills")).toBeInTheDocument();
    expect(screen.getByText("插件 skills")).toBeInTheDocument();

    // Row shows name + plugin name for plugin skills
    expect(screen.getByText("deep-research")).toBeInTheDocument();
    expect(screen.getByText("sdd:specify")).toBeInTheDocument();
    expect(screen.getByText("· sdd")).toBeInTheDocument();
    // Description is shown in the row
    expect(
      screen.getByText("个人自定义技能，用于日常代码审查"),
    ).toBeInTheDocument();
  });

  it("shows an empty state when no skills are configured", async () => {
    renderSettingsPage();
    sendHostMessage(fixtures.skillMetadataResponse([]));
    expect(await screen.findByText("暂无可用技能")).toBeInTheDocument();
  });

  it("enters detail view on click and shows full metadata", async () => {
    renderSettingsPage();
    sendHostMessage(fixtures.skillMetadataResponse([userSkill]));

    const row = await screen.findByText("my-skill");
    await act(async () => {
      fireEvent.click(row);
    });

    // Detail fields
    expect(screen.getByText("来源：")).toBeInTheDocument();
    const sourceField = screen.getByText("来源：").parentElement;
    expect(sourceField).toHaveTextContent("用户");
    expect(screen.getByText("路径：")).toBeInTheDocument();
    expect(screen.getByText("~/.wave/skills/my-skill.md")).toBeInTheDocument();
    expect(screen.getByText("模型：")).toBeInTheDocument();
    expect(screen.getByText("glm-5.2")).toBeInTheDocument();
    expect(screen.getByText("允许的工具：")).toBeInTheDocument();
    expect(screen.getByText("Read, Write")).toBeInTheDocument();
    expect(screen.getByText("调用方式：")).toBeInTheDocument();
    expect(screen.getByText("用户与模型均可调用")).toBeInTheDocument();

    // Back to list preserves loaded data
    await act(async () => {
      fireEvent.click(screen.getByText("返回列表"));
    });
    expect(screen.getByText("用户 skills")).toBeInTheDocument();
  });

  it("shows invocation restrictions in the detail view", async () => {
    const restrictedSkill: SkillMetadata = {
      ...builtinSkill,
      userInvocable: false,
      disableModelInvocation: true,
    };
    renderSettingsPage();
    sendHostMessage(fixtures.skillMetadataResponse([restrictedSkill]));

    await act(async () => {
      fireEvent.click(await screen.findByText("deep-research"));
    });
    expect(
      screen.getByText("不可通过 /命令 调用，模型自动调用已禁用"),
    ).toBeInTheDocument();
  });
});
