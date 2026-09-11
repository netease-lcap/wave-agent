import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  within,
  fireEvent,
  waitFor,
  sendHostMessage,
} from "./test-utils";
import SettingsPage, {
  MANAGED_SETTINGS_EMPTY_TEXT,
  MANAGED_SETTINGS_LOADING_TEXT,
  type NavKey,
} from "../../src/components/SettingsPage";
import { fixtures } from "wave-webview-fixtures";

/**
 * 「服务端配置」区块（spec server-managed-config「在设置页查看服务端下发的配置」）：
 * 「全局设置」视图内只读展示服务端下发的托管配置原文，让用户看到服务端到底管控了
 * 什么。三端共用本组件（desktop 全页设置 / VSCE·JB 编辑器区域设置标签页）。
 */

function renderSettingsPage(initialNav?: NavKey) {
  const postMessage = vi.fn();
  const vscode = { postMessage };
  render(
    <SettingsPage
      configurationData={{ language: "zh-CN" }}
      onClose={() => {}}
      userAgentsContent={null}
      projectAgentsContent={null}
      onLoadAgentsContent={() => {}}
      initialNav={initialNav}
      vscode={vscode}
    />,
  );
  return { postMessage, vscode };
}

/** 最近一次 getManagedSettings 请求的归属键（host 回包须原样带回）。 */
function lastRequestId(postMessage: ReturnType<typeof vi.fn>): string {
  const calls = (postMessage.mock.calls as unknown[][]).map(
    (c) => c[0] as { command?: string; requestId?: string },
  );
  const last = calls.filter((c) => c.command === "getManagedSettings").pop();
  expect(last?.requestId).toBeTruthy();
  return last!.requestId!;
}

function serverConfigSection(): HTMLElement {
  const heading = screen.getByRole("heading", { name: "服务端配置" });
  const section = heading.closest("section");
  if (!section) throw new Error("找不到「服务端配置」区块");
  return section as HTMLElement;
}

/** 导航到「全局设置」（首次挂载已在该视图时无需切换）。 */
function goToGlobalView(heading: string) {
  fireEvent.click(screen.getByRole("button", { name: heading }));
}

describe("SettingsPage「服务端配置」区块", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("进入「全局设置」视图即请求下发配置原文", () => {
    const { postMessage } = renderSettingsPage();

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "getManagedSettings" }),
    );
  });

  it("已下发时以只读 JSON 展示完整原文（格式化缩进、不做字段筛选、不脱敏）", () => {
    const { postMessage } = renderSettingsPage();
    const delivered = {
      permissions: { deny: ["Bash"] },
      env: { WAVE_MODEL: "org-model", WAVE_API_KEY: "org-secret" },
      autoMemoryEnabled: false,
    };

    sendHostMessage(
      fixtures.managedSettingsResponse(delivered, {
        requestId: lastRequestId(postMessage),
      }),
    );

    const json = within(serverConfigSection()).getByTestId(
      "settings-managed-json",
    );
    // 展示的是下发原文本身：含所有键（含 env 里的密钥，边界说明「不脱敏」）且是
    // 格式化后的 JSON（缩进 2 空格），不是一行压平或筛选过的摘要。
    expect(json.textContent).toBe(JSON.stringify(delivered, null, 2));
    expect(json.textContent).toContain("org-secret");
    expect(json.textContent).toContain("\n  ");
    expect(json.tagName).toBe("PRE");
  });

  it("未下发时显示空态说明，不渲染 {} 空块或空白文本框", () => {
    const { postMessage } = renderSettingsPage();

    sendHostMessage(
      fixtures.managedSettingsResponse(null, {
        requestId: lastRequestId(postMessage),
      }),
    );

    const section = serverConfigSection();
    expect(
      within(section).getByTestId("settings-managed-empty"),
    ).toHaveTextContent(MANAGED_SETTINGS_EMPTY_TEXT);
    expect(within(section).queryByTestId("settings-managed-json")).toBeNull();
    expect(section.textContent).not.toContain("{}");
  });

  it("尚未拿到回包时说明是读取中，不冒称「没有下发」", () => {
    renderSettingsPage();

    expect(
      within(serverConfigSection()).getByTestId("settings-managed-empty"),
    ).toHaveTextContent(MANAGED_SETTINGS_LOADING_TEXT);
    expect(MANAGED_SETTINGS_LOADING_TEXT).not.toBe(MANAGED_SETTINGS_EMPTY_TEXT);
  });

  it("区块纯只读：没有任何编辑控件或保存按钮", () => {
    const { postMessage } = renderSettingsPage();
    sendHostMessage(
      fixtures.managedSettingsResponse(
        { permissions: { deny: ["Bash"] } },
        { requestId: lastRequestId(postMessage) },
      ),
    );

    const section = serverConfigSection();
    expect(within(section).queryByRole("button")).toBeNull();
    expect(within(section).queryByRole("textbox")).toBeNull();
    expect(within(section).queryByRole("checkbox")).toBeNull();
    expect(within(section).queryByRole("combobox")).toBeNull();
  });

  it("反复进出视图重新拉取，读到的是当前下发内容而不是启动时的旧值", async () => {
    const { postMessage } = renderSettingsPage();
    const firstRequestId = lastRequestId(postMessage);

    goToGlobalView("个性化");
    goToGlobalView("全局设置");

    await waitFor(() =>
      expect(
        (postMessage.mock.calls as unknown[][]).filter(
          (c) =>
            (c[0] as { command?: string }).command === "getManagedSettings",
        ).length,
      ).toBe(2),
    );
    const secondRequestId = lastRequestId(postMessage);
    expect(secondRequestId).not.toBe(firstRequestId);

    // 重入后服务端已更新：以**当前**下发内容为准（spec 场景 4）。
    sendHostMessage(
      fixtures.managedSettingsResponse(
        { autoMemoryEnabled: true },
        { requestId: secondRequestId },
      ),
    );
    expect(
      within(serverConfigSection()).getByTestId("settings-managed-json")
        .textContent,
    ).toBe(JSON.stringify({ autoMemoryEnabled: true }, null, 2));
  });

  it("丢弃晚到的旧回包（requestId 不再匹配最新请求）", () => {
    const { postMessage } = renderSettingsPage();
    const staleRequestId = lastRequestId(postMessage);

    // 重入视图会发出新请求：先到的旧批次回包不得覆盖当前状态。
    goToGlobalView("个性化");
    goToGlobalView("全局设置");
    const freshRequestId = lastRequestId(postMessage);
    expect(freshRequestId).not.toBe(staleRequestId);

    sendHostMessage(
      fixtures.managedSettingsResponse(
        { stale: "old" },
        { requestId: staleRequestId },
      ),
    );

    const section = serverConfigSection();
    expect(within(section).queryByTestId("settings-managed-json")).toBeNull();
    expect(section.textContent).not.toContain("stale");

    // 当前批次的回包照常生效。
    sendHostMessage(
      fixtures.managedSettingsResponse(
        { fresh: "new" },
        { requestId: freshRequestId },
      ),
    );
    expect(
      within(section).getByTestId("settings-managed-json").textContent,
    ).toContain("new");
  });
});
