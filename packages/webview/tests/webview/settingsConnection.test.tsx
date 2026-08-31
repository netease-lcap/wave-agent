import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "./test-utils";
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

function renderConnectionView(
  configurationData: ConfigurationData | null = savedConfiguration,
) {
  render(
    <SettingsPage
      configurationData={configurationData}
      onClose={() => {}}
      userAgentsContent={null}
      projectAgentsContent={null}
      onLoadAgentsContent={() => {}}
      initialNav="connection"
    />,
  );
}

describe("SettingsPage 直连设置视图（只读展示，2026-08-31 用户拍板）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("只读展示四个字段的当前值并回填已保存配置", () => {
    renderConnectionView();

    expect(
      screen.getByRole("heading", { name: "直连设置" }),
    ).toBeInTheDocument();
    expect(screen.getByText("sk-ant-api03-TEST")).toBeInTheDocument();
    expect(screen.getByText("https://api.example.com/v1")).toBeInTheDocument();
    expect(screen.getByText("claude-sonnet-4-20250514")).toBeInTheDocument();
    expect(screen.getByText("claude-haiku-4-20250514")).toBeInTheDocument();
  });

  it("未配置字段显示「未配置」占位文本", () => {
    renderConnectionView({
      ...savedConfiguration,
      apiKey: "",
      baseURL: "",
    });

    expect(screen.getAllByText("未配置").length).toBeGreaterThanOrEqual(2);
  });

  it("视图不提供任何编辑控件与保存按钮", () => {
    renderConnectionView();

    // 无输入框（文本输入类）与保存按钮
    expect(screen.queryAllByRole("textbox").length).toBe(0);
    expect(
      screen.queryByRole("button", { name: "保存" }),
    ).not.toBeInTheDocument();
    // 只读值以文本呈现
    expect(screen.getByText("sk-ant-api03-TEST")).toBeInTheDocument();
  });
});
