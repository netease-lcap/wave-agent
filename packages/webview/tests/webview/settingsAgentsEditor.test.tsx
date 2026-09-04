import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "./test-utils";
import SettingsPage from "../../src/components/SettingsPage";

/**
 * SettingsPage「个性化」AGENTS.md 编辑器（用户级/项目级可编辑 + 独立保存）。
 * 2026-09-04 产品拍板由只读展示恢复可编辑（PM bug 3466367350195712）：
 * - 文本区去除硬编码 readOnly，onChange 更新当前作用域草稿；
 * - 各作用域独立「保存用户级/项目级配置」按钮 → onSaveAgentsContent(scope, content)；
 * - host 回发 agentsContentSaved（agentsSaving false + agentsSaveResult）后显示
 *   瞬态「保存成功 / 保存失败」反馈，切换导航项清除（对齐配置保存反馈交互）。
 */

interface AgentsSaveResult {
  scope: "user" | "project";
  ok: boolean;
  error?: string;
}

function renderPersonalization(options?: {
  userAgentsContent?: string | null;
  projectAgentsContent?: string | null;
  agentsSaving?: boolean;
  agentsSaveResult?: AgentsSaveResult | null;
}) {
  const onSaveAgentsContent = vi.fn();
  const utils = render(
    <SettingsPage
      configurationData={{ language: "zh-CN" }}
      onClose={() => {}}
      initialNav="personalization"
      userAgentsContent={options?.userAgentsContent ?? "# User Memory"}
      projectAgentsContent={options?.projectAgentsContent ?? "# Project Rules"}
      onLoadAgentsContent={() => {}}
      onSaveAgentsContent={onSaveAgentsContent}
      agentsSaving={options?.agentsSaving ?? false}
      agentsSaveResult={options?.agentsSaveResult ?? null}
    />,
  );
  return { onSaveAgentsContent, utils };
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

  it("点击「保存用户级配置」按当前草稿回调 onSaveAgentsContent('user', …)", () => {
    const { onSaveAgentsContent } = renderPersonalization({
      userAgentsContent: "# 初稿",
    });

    const textarea = screen.getByLabelText(
      "用户级 AGENTS.md 内容",
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "# 改后" } });
    fireEvent.click(screen.getByRole("button", { name: "保存用户级配置" }));

    expect(onSaveAgentsContent).toHaveBeenCalledTimes(1);
    expect(onSaveAgentsContent).toHaveBeenCalledWith("user", "# 改后");
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
    expect(onSaveAgentsContent).toHaveBeenCalledWith("project", "# 项目改后");

    // 切回用户级：未保存草稿保留，未触发任何写回
    fireEvent.click(screen.getByRole("tab", { name: "用户级" }));
    expect(
      (screen.getByLabelText("用户级 AGENTS.md 内容") as HTMLTextAreaElement)
        .value,
    ).toBe("# 用户未保存草稿");
    expect(onSaveAgentsContent).toHaveBeenCalledTimes(1);
  });

  it("host 回包成功后显示「保存成功」，切换导航项即清除", () => {
    const { utils } = renderPersonalization({
      agentsSaving: false,
      agentsSaveResult: null,
    });

    fireEvent.click(screen.getByRole("button", { name: "保存用户级配置" }));
    // 保存中（agentsSaving=true）：按钮禁用、无反馈
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
        agentsSaveResult={null}
      />,
    );
    expect(
      screen.getByRole("button", { name: "保存用户级配置" }),
    ).toBeDisabled();
    expect(screen.queryByText("保存成功")).not.toBeInTheDocument();

    // 回包成功（agentsSaving=false + ok）
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
        agentsSaveResult={{ scope: "user", ok: true }}
      />,
    );
    expect(screen.getByText("保存成功")).toBeInTheDocument();

    // 切换到「全局设置」：瞬态反馈不跨导航残留
    fireEvent.click(screen.getByRole("button", { name: "全局设置" }));
    expect(screen.queryByText("保存成功")).not.toBeInTheDocument();
  });

  it("保存失败显示「保存失败：<原因>」", () => {
    const { utils } = renderPersonalization();

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
        agentsSaving={false}
        agentsSaveResult={{
          scope: "user",
          ok: false,
          error: "磁盘写入失败",
        }}
      />,
    );
    expect(screen.getByText("保存失败：磁盘写入失败")).toBeInTheDocument();
  });

  it("宿主未提供 onSaveAgentsContent 时保存按钮禁用（降级只读源）", () => {
    render(
      <SettingsPage
        configurationData={{ language: "zh-CN" }}
        onClose={() => {}}
        initialNav="personalization"
        userAgentsContent={null}
        projectAgentsContent={null}
        onLoadAgentsContent={() => {}}
      />,
    );
    // 文本区仍可编辑（无 host 时仅保存按钮禁用，不强制 readOnly）
    const textarea = screen.getByLabelText(
      "用户级 AGENTS.md 内容",
    ) as HTMLTextAreaElement;
    expect(textarea.readOnly).toBe(false);
    expect(
      screen.getByRole("button", { name: "保存用户级配置" }),
    ).toBeDisabled();
  });
});
