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

async function openSkillsDialog() {
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

describe("SkillsDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens via /skills and requests skill metadata from the host", async () => {
    const { vscode } = await openSkillsDialog();

    expect(await screen.findByTestId("skills-dialog")).toBeInTheDocument();
    const getSkillsCall = vscode.postMessage.mock.calls.find(
      (c) => c[0]?.command === "getSkillMetadata",
    );
    expect(getSkillsCall).toBeDefined();
  });

  it("groups skills by scope (内置 / 用户 / 项目 / 插件) with name · pluginName · description rows", async () => {
    await openSkillsDialog();

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
    await openSkillsDialog();

    sendHostMessage(fixtures.skillMetadataResponse([]));

    expect(await screen.findByText("暂无可用技能")).toBeInTheDocument();
  });

  it("enters detail view on click and shows full metadata", async () => {
    await openSkillsDialog();

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
    await openSkillsDialog();

    sendHostMessage(fixtures.skillMetadataResponse([restrictedSkill]));

    await act(async () => {
      fireEvent.click(await screen.findByText("deep-research"));
    });
    expect(
      screen.getByText("不可通过 /命令 调用，模型自动调用已禁用"),
    ).toBeInTheDocument();
  });

  it("closes via Esc, and Esc in detail returns to the list first", async () => {
    await openSkillsDialog();
    sendHostMessage(fixtures.skillMetadataResponse([builtinSkill]));

    await act(async () => {
      fireEvent.click(await screen.findByText("deep-research"));
    });
    expect(screen.getByText("路径：")).toBeInTheDocument();

    // Esc in detail → back to list
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByText("内置 skills")).toBeInTheDocument();
    expect(screen.queryByText("路径：")).not.toBeInTheDocument();

    // Esc in list → closes the dialog
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByTestId("skills-dialog")).not.toBeInTheDocument();
    });
  });

  it("closes when clicking outside the dialog", async () => {
    vi.useFakeTimers();
    try {
      await openSkillsDialog();
      sendHostMessage(fixtures.skillMetadataResponse([builtinSkill]));

      // Let the deferred mousedown listener register, then click the overlay (outside the dialog)
      vi.advanceTimersByTime(0);
      const overlay = document.querySelector(".configuration-dialog-overlay");
      expect(overlay).not.toBeNull();
      fireEvent.mouseDown(overlay as HTMLElement);

      expect(screen.queryByTestId("skills-dialog")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
