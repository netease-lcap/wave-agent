import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "./test-utils";
import SettingsPage from "../../src/components/SettingsPage";
import type { ConfigurationData } from "../../src/types";

const savedConfiguration: ConfigurationData = {
  apiKey: "sk-ant-api03-TEST",
  baseURL: "https://api.example.com/v1",
  model: "claude-sonnet-4-20250514",
  fastModel: "claude-haiku-4-20250514",
  language: "zh-CN",
  contextLength: 200,
};

function renderConnectionView() {
  const onSave = vi.fn();
  render(
    <SettingsPage
      configurationData={savedConfiguration}
      onSave={onSave}
      onClose={() => {}}
      userAgentsContent={null}
      projectAgentsContent={null}
      onLoadAgentsContent={() => {}}
      onSaveAgentsContent={() => {}}
      initialNav="connection"
    />,
  );
  return { onSave };
}

describe("SettingsPage 直连设置视图（内容自 ConfigDialog 直连设置选项卡迁移）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("渲染四个字段并回填已保存配置", () => {
    renderConnectionView();

    expect(
      screen.getByRole("heading", { name: "直连设置" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("API Key")).toHaveValue("sk-ant-api03-TEST");
    expect(screen.getByLabelText("Base URL")).toHaveValue(
      "https://api.example.com/v1",
    );
    expect(screen.getByLabelText("Agent Model")).toHaveValue(
      "claude-sonnet-4-20250514",
    );
    expect(screen.getByLabelText("Fast Model")).toHaveValue(
      "claude-haiku-4-20250514",
    );
  });

  it("修改字段后保存，onSave 收到含直连字段的完整配置", () => {
    const { onSave } = renderConnectionView();

    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: "sk-new-key" },
    });
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://new.example.com/v1" },
    });
    fireEvent.change(screen.getByLabelText("Agent Model"), {
      target: { value: "claude-opus-4" },
    });
    fireEvent.change(screen.getByLabelText("Fast Model"), {
      target: { value: "claude-sonnet-4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(onSave).toHaveBeenCalledWith({
      ...savedConfiguration,
      apiKey: "sk-new-key",
      baseURL: "https://new.example.com/v1",
      model: "claude-opus-4",
      fastModel: "claude-sonnet-4",
    });
  });

  it("配置未加载（null）时保存按钮禁用", () => {
    render(
      <SettingsPage
        configurationData={null}
        onSave={() => {}}
        onClose={() => {}}
        userAgentsContent={null}
        projectAgentsContent={null}
        onLoadAgentsContent={() => {}}
        onSaveAgentsContent={() => {}}
        initialNav="connection"
      />,
    );
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  });
});
