import { describe, expect, test, vi } from "vitest";
import { ConfigurationService } from "../../src/services/configurationService";
import type { StdioClient } from "../../src/stdio/stdioClient";

/**
 * Regression（Bug #2115：设置页关掉「自动记忆」后仍记忆）——**PR-2 后落点改为用户级
 * `~/.wave/settings.json`**：`autoMemoryEnabled` / `autoMemoryFrequency` 是可选参数，
 * 漏写不会报错，只会静默丢失（保存看起来「成功」但下一环拿不到值）。
 *
 * 这里盯的是 VSCE 侧的这一个 hop：保存必须把两个键**原样**发给 CLI 进程的
 * `updateUserSettings`（含 `false`，不得被 `||` 吞成 true），回读也只有 CLI 一个真源
 * （宿主私有存储已不再参与）。
 */

/** 记录每个 CLI 请求的参数；`getUserSettings` 返回给定的用户偏好。 */
function fakeClient(prefs: Record<string, unknown> = {}) {
  const request = vi.fn(async (method: string, _params?: unknown) =>
    method === "getUserSettings" ? prefs : {},
  );
  return { request };
}

function withClient(client: ReturnType<typeof fakeClient>) {
  const service = new ConfigurationService();
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

  test("load 的唯一真源是 CLI 回读，false 不被吞成 true", async () => {
    const service = withClient(
      fakeClient({
        autoMemoryEnabled: false,
        autoMemoryFrequency: 5,
      }),
    );

    const loaded = await service.loadConfiguration();
    expect(loaded.autoMemoryEnabled).toBe(false);
    expect(loaded.autoMemoryFrequency).toBe(5);
  });

  test("无用户偏好键的保存不触碰 settings.json", async () => {
    const client = fakeClient();
    const service = withClient(client);

    await service.saveConfiguration({});

    expect(
      client.request.mock.calls.filter(([m]) => m === "updateUserSettings"),
    ).toEqual([]);
  });

  test("CLI 读失败降级为空偏好（设置页不因此打不开）", async () => {
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
    expect(loaded).toEqual({});
  });
});
