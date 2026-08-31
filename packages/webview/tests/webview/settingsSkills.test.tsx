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

const projectSkill: SkillMetadata = {
  name: "deploy",
  description: "项目专用部署技能",
  type: "project",
  skillPath: "/work/a/.wave/skills/deploy/SKILL.md",
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
      initialNav="skills"
      vscode={mockVscode}
      workdir="/work/a"
      onPrefillPrompt={props?.onPrefillPrompt}
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

describe("SettingsPage 技能选项卡视图（4 Tab + 项目分组卡片）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("请求技能元数据并展示四个来源 Tab（插件/内置/用户/项目）", async () => {
    const { vscode } = renderSettingsPage();

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "getSkillMetadata",
    });

    sendHostMessage(
      fixtures.skillMetadataResponse([builtinSkill, pluginSkill, userSkill]),
    );

    expect(await screen.findByText("插件技能")).toBeInTheDocument();
    expect(screen.getByText("内置技能")).toBeInTheDocument();
    expect(screen.getByText("用户技能")).toBeInTheDocument();
    expect(screen.getByText("项目技能")).toBeInTheDocument();

    // 默认选中第一个 Tab（插件技能）：展示插件技能
    expect(screen.getByText("sdd:specify")).toBeInTheDocument();
    expect(screen.getByText("· sdd")).toBeInTheDocument();
  });

  it("点击 Tab 切换来源，用户技能 Tab 提供「新建技能」入口", async () => {
    renderSettingsPage();
    sendHostMessage(
      fixtures.skillMetadataResponse([builtinSkill, pluginSkill, userSkill]),
    );

    await act(async () => {
      fireEvent.click(await screen.findByText("用户技能"));
    });
    expect(screen.getByText("my-skill")).toBeInTheDocument();
    expect(
      screen.getByText("个人自定义技能，用于日常代码审查"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /新建技能/ }),
    ).toBeInTheDocument();
  });

  it("项目技能 Tab 按项目分组卡片展示（/技能名 样式 + 新增指令）", async () => {
    renderSettingsPage();
    sendHostMessage(fixtures.skillMetadataResponse([projectSkill]));

    await act(async () => {
      fireEvent.click(await screen.findByText("项目技能"));
    });

    // 项目卡片（workdir 推断项目名 a）+ /技能名 样式 + 新增指令
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("/deploy")).toBeInTheDocument();
    expect(screen.getByText("项目专用部署技能")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /新增指令/ }),
    ).toBeInTheDocument();
  });

  it("shows an empty state when no skills are configured", async () => {
    renderSettingsPage();
    sendHostMessage(fixtures.skillMetadataResponse([]));
    expect(await screen.findByText("插件技能暂无内容")).toBeInTheDocument();
  });

  it("enters detail view on click and shows full metadata", async () => {
    renderSettingsPage();
    sendHostMessage(fixtures.skillMetadataResponse([userSkill]));

    await act(async () => {
      fireEvent.click(await screen.findByText("用户技能"));
    });
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
    expect(screen.getByText("用户技能")).toBeInTheDocument();
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
      fireEvent.click(screen.getByRole("tab", { name: "内置技能" }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByText("deep-research"));
    });
    expect(
      screen.getByText("不可通过 /命令 调用，模型自动调用已禁用"),
    ).toBeInTheDocument();
  });

  it("用户技能「新建技能」→ onPrefillPrompt 预填用户级提示词", async () => {
    const onPrefillPrompt = vi.fn();
    renderSettingsPage(undefined, { onPrefillPrompt });
    sendHostMessage(fixtures.skillMetadataResponse([userSkill]));

    await act(async () => {
      fireEvent.click(await screen.findByText("用户技能"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /新建技能/ }));
    });

    expect(onPrefillPrompt).toHaveBeenCalledWith(
      expect.stringContaining("帮我新建一个用户级技能"),
    );
  });

  it("项目卡片「新增指令」→ 预填带项目名的项目级提示词", async () => {
    const onPrefillPrompt = vi.fn();
    renderSettingsPage(undefined, { onPrefillPrompt });
    sendHostMessage(fixtures.skillMetadataResponse([projectSkill]));

    await act(async () => {
      fireEvent.click(await screen.findByText("项目技能"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /新增指令/ }));
    });

    expect(onPrefillPrompt).toHaveBeenCalledWith(
      expect.stringContaining("帮我在【a】下新建一个技能"),
    );
  });

  it("「编辑」→ 预填编辑提示词并发送 openFile（IDE 回退）", async () => {
    const onPrefillPrompt = vi.fn();
    const { vscode } = renderSettingsPage(undefined, { onPrefillPrompt });
    sendHostMessage(fixtures.skillMetadataResponse([userSkill]));

    await act(async () => {
      fireEvent.click(await screen.findByText("用户技能"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /编辑/ }));
    });

    expect(onPrefillPrompt).toHaveBeenCalledWith(
      expect.stringContaining("帮我改技能my-skill"),
    );
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "openFile",
      path: "~/.wave/skills/my-skill.md",
    });
  });

  it("「删除」→ 二次确认 → deleteSkill RPC", async () => {
    const { vscode } = renderSettingsPage();
    sendHostMessage(fixtures.skillMetadataResponse([userSkill]));

    await act(async () => {
      fireEvent.click(await screen.findByText("用户技能"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /删除/ }));
    });

    // 确认框出现（含技能名与路径）
    expect(await screen.findByText("删除技能「my-skill」")).toBeInTheDocument();
    expect(
      screen.getByText(/~\/\.wave\/skills\/my-skill\.md/),
    ).toBeInTheDocument();

    // 取消不删除
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));
    });
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "deleteSkill" }),
    );

    // 再次打开并确认
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /删除/ }));
    });
    await act(async () => {
      fireEvent.click(await screen.findByTestId("confirm-dialog-confirm"));
    });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "deleteSkill",
      name: "my-skill",
    });
  });

  it("插件/内置技能不提供「删除」入口（只读来源）", async () => {
    renderSettingsPage();
    sendHostMessage(
      fixtures.skillMetadataResponse([builtinSkill, pluginSkill]),
    );

    expect(
      screen.queryByRole("button", { name: /删除/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /编辑/ }),
    ).not.toBeInTheDocument();
  });
});
