import { describe, expect, test, vi } from "vitest";
import type * as vscode from "vscode";
import { ConfigurationService } from "../../src/services/configurationService";
import type { StdioClient } from "../../src/stdio/stdioClient";

/**
 * Regression（Bug #2115：设置页关掉「自动记忆」后仍记忆）——**PR-2 后落点改为用户级
 * `~/.wave/settings.json`**：`autoMemoryEnabled` / `autoMemoryFrequency` 是可选参数，
 * 漏写不会报错，只会静默丢失（保存看起来「成功」但下一环拿不到值）。
 *
 * 这里盯的是 VSCE 侧的这一个 hop：保存必须把两个键**原样**发给 CLI 进程的
 * `updateUserSettings`（含 `false`，不得被 `||` 吞成 true），且 globalState
 * **不得**再当第二真源（否则界面会显示宿主里的旧值、与 settings.json 打架）。
 */

/** In-memory stand-in for vscode's globalState (a Map with the Memento API). */
function context(): vscode.ExtensionContext {
  const state = new Map<string, unknown>();
  return {
    globalState: {
      get: (key: string) => state.get(key),
      update: async (key: string, value: unknown) => {
        state.set(key, value);
      },
    },
  } as unknown as vscode.ExtensionContext;
}

/** 记录每个 CLI 请求的参数；`getUserSettings` 返回给定的用户偏好。 */
function fakeClient(prefs: Record<string, unknown> = {}) {
  const request = vi.fn(async (method: string, _params?: unknown) =>
    method === "getUserSettings" ? prefs : {},
  );
  return { request };
}

function withClient(client: ReturnType<typeof fakeClient>) {
  const service = new ConfigurationService(context());
  service.attachClient(client as unknown as StdioClient);
  return service;
}

describe("ConfigurationService · auto-memory 落用户级 settings.json", () => {
  test("保存把两个键原样交给 updateUserSettings（false 不被吞掉）", async () => {
    const client = fakeClient();
    const service = withClient(client);

    await service.saveConfiguration({
      autoMemoryEnabled: false,
      autoMemoryFrequency: 5,
    });

    expect(client.request).toHaveBeenCalledWith("updateUserSettings", {
      autoMemoryEnabled: false,
      autoMemoryFrequency: 5,
    });
  });

  test("globalState 不是第二真源：本地存了旧值，load 仍以 CLI 回读为准", async () => {
    const ctx = context();
    await ctx.globalState.update("autoMemoryEnabled", true);
    const service = new ConfigurationService(ctx);
    service.attachClient(
      fakeClient({
        autoMemoryEnabled: false,
        autoMemoryFrequency: 5,
      }) as unknown as StdioClient,
    );

    const loaded = await service.loadConfiguration();
    expect(loaded.autoMemoryEnabled).toBe(false);
    expect(loaded.autoMemoryFrequency).toBe(5);
  });

  test("无用户偏好键（仅同步扩展私有键）不触碰 settings.json", async () => {
    const client = fakeClient();
    const service = withClient(client);

    await service.saveConfiguration({ serverUrl: "https://example.com" });

    expect(
      client.request.mock.calls.filter(([m]) => m === "updateUserSettings"),
    ).toEqual([]);
  });

  test("CLI 读失败降级为只回本地键（设置页不因此打不开）", async () => {
    const client = {
      request: vi.fn(async (method: string) => {
        if (method === "getUserSettings") throw new Error("boom");
        return {};
      }),
    };
    const service = withClient(
      client as unknown as ReturnType<typeof fakeClient>,
    );

    const loaded = await service.loadConfiguration();
    expect(loaded.model).toBe("");
    expect(loaded.autoMemoryEnabled).toBeUndefined();
  });
});
