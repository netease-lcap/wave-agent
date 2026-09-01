import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  sendHostMessage,
  fixtures,
  createMockVscode,
} from "./test-utils";
import SettingsPage from "../../src/components/SettingsPage";

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
      initialNav="hooks"
      vscode={mockVscode}
      workdir="/work/a"
      onPrefillPrompt={props?.onPrefillPrompt}
    />,
  );
  return { vscode: mockVscode };
}

const userHooks = {
  PreToolUse: [
    {
      matcher: "Write",
      hooks: [{ type: "command", command: "node scripts/lint-check.js" }],
      enabled: true,
    },
    {
      matcher: "Read",
      hooks: [{ type: "command", command: "echo 'read' > /tmp/log" }],
      enabled: false,
    },
  ],
};

const pluginHooks = {
  SessionStart: [
    {
      hooks: [{ type: "command", command: "echo plugin-start" }],
      enabled: true,
    },
  ],
};

describe("SettingsPage 钩子选项卡视图（用户/项目/插件 Tab + 开关）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("挂载时按当前 Tab（用户级）请求 getHooksByScope，并展示三个 Tab", async () => {
    const { vscode } = renderSettingsPage();

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "getHooksByScope",
      scope: "user",
    });

    sendHostMessage(fixtures.hooksResponse(userHooks));

    expect(await screen.findByText("用户级钩子")).toBeInTheDocument();
    expect(screen.getByText("项目级钩子")).toBeInTheDocument();
    expect(screen.getByText("插件钩子")).toBeInTheDocument();

    // 条目显示 hookName（Event:Matcher）+ 命令
    expect(screen.getByText("PreToolUse:Write")).toBeInTheDocument();
    expect(screen.getByText("node scripts/lint-check.js")).toBeInTheDocument();
  });

  it("disabled 钩子显示「已关闭」标记且开关未勾选", async () => {
    renderSettingsPage();
    sendHostMessage(fixtures.hooksResponse(userHooks));

    expect(await screen.findByText("已关闭")).toBeInTheDocument();
    const toggle = screen.getByRole("checkbox", {
      name: "启用钩子 PreToolUse:Read",
    }) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it("切换 Tab 重新请求对应 scope 的钩子", async () => {
    const { vscode } = renderSettingsPage();
    sendHostMessage(fixtures.hooksResponse(userHooks));

    await act(async () => {
      fireEvent.click(await screen.findByText("项目级钩子"));
    });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "getHooksByScope",
      scope: "project",
    });
    sendHostMessage(fixtures.hooksResponse({}));
    expect(await screen.findByText("项目级钩子暂无内容")).toBeInTheDocument();
  });

  it("插件 Tab 展示插件钩子且无编辑/删除/开关（只读）", async () => {
    renderSettingsPage();
    sendHostMessage(fixtures.hooksResponse(pluginHooks));

    await act(async () => {
      fireEvent.click(await screen.findByText("插件钩子"));
    });
    // tab 切换触发重新请求，回发插件钩子数据
    sendHostMessage(fixtures.hooksResponse(pluginHooks));
    expect(await screen.findByText("SessionStart")).toBeInTheDocument();
    expect(screen.getByText("echo plugin-start")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /删除/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /编辑/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: /启用钩子/ }),
    ).not.toBeInTheDocument();
  });

  it("开关切换 → setHookEnabled RPC + 乐观更新", async () => {
    const { vscode } = renderSettingsPage();
    sendHostMessage(fixtures.hooksResponse(userHooks));

    const toggle = (await screen.findByRole("checkbox", {
      name: "启用钩子 PreToolUse:Write",
    })) as HTMLInputElement;
    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "setHookEnabled",
      scope: "user",
      hookName: "PreToolUse:Write",
      enabled: false,
    });
    // 乐观更新：开关变为关闭，出现「已关闭」标记
    expect((toggle as HTMLInputElement).checked).toBe(false);
    expect(screen.getAllByText("已关闭")).toHaveLength(2);
  });

  it("「新增钩子」→ onPrefillPrompt 预填用户级提示词", async () => {
    const onPrefillPrompt = vi.fn();
    renderSettingsPage(undefined, { onPrefillPrompt });
    sendHostMessage(fixtures.hooksResponse(userHooks));

    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: /新增钩子/ }));
    });

    expect(onPrefillPrompt).toHaveBeenCalledWith(
      expect.stringContaining("帮我配一个用户级钩子"),
    );
  });

  it("「编辑」→ 预填编辑提示词并打开配置文件（IDE 回退 openFile）", async () => {
    const onPrefillPrompt = vi.fn();
    const { vscode } = renderSettingsPage(undefined, { onPrefillPrompt });
    sendHostMessage(fixtures.hooksResponse(userHooks, { configPath: null }));

    await act(async () => {
      fireEvent.click(await screen.findByText("PreToolUse:Write"));
    });
    const editBtn = screen.getAllByRole("button", { name: /编辑/ })[0];
    await act(async () => {
      fireEvent.click(editBtn);
    });

    expect(onPrefillPrompt).toHaveBeenCalledWith(
      expect.stringContaining("帮我编辑钩子PreToolUse:Write"),
    );
    // 用户级无 configPath → 回退 ~/.wave/settings.json
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "openFile",
      path: "~/.wave/settings.json",
    });
  });

  it("「删除」→ 二次确认 → deleteHook RPC", async () => {
    const { vscode } = renderSettingsPage();
    sendHostMessage(fixtures.hooksResponse(userHooks, { configPath: null }));

    const delBtn = (
      await screen.findAllByRole("button", {
        name: /删除/,
      })
    )[0];
    await act(async () => {
      fireEvent.click(delBtn);
    });

    expect(
      await screen.findByText("删除钩子「PreToolUse:Write」"),
    ).toBeInTheDocument();

    // 取消不删除
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-dialog-cancel"));
    });
    expect(vscode.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ command: "deleteHook" }),
    );

    // 再次打开并确认
    await act(async () => {
      fireEvent.click(delBtn);
    });
    await act(async () => {
      fireEvent.click(await screen.findByTestId("confirm-dialog-confirm"));
    });
    expect(vscode.postMessage).toHaveBeenCalledWith({
      command: "deleteHook",
      scope: "user",
      hookName: "PreToolUse:Write",
    });
  });

  it("项目级钩子 Tab 平铺展示（+ 新增钩子）", async () => {
    renderSettingsPage();
    sendHostMessage(
      fixtures.hooksResponse(
        {
          PostToolUse: [
            {
              matcher: "Bash",
              hooks: [{ type: "command", command: "echo proj" }],
            },
          ],
        },
        { configPath: "/work/a/.wave/settings.json" },
      ),
    );

    await act(async () => {
      fireEvent.click(await screen.findByText("项目级钩子"));
    });
    // tab 切换触发重新请求，回发项目钩子数据
    sendHostMessage(
      fixtures.hooksResponse(
        {
          PostToolUse: [
            {
              matcher: "Bash",
              hooks: [{ type: "command", command: "echo proj" }],
            },
          ],
        },
        { configPath: "/work/a/.wave/settings.json" },
      ),
    );
    expect(await screen.findByText("PostToolUse:Bash")).toBeInTheDocument();
    // 单项目模型：平铺展示（无项目卡片名）+ 新增钩子按钮
    expect(screen.queryByText("a")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /新增钩子/ }),
    ).toBeInTheDocument();
  });
});
