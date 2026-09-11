/**
 * The VS Code host no longer has a credential pipeline: `apiKey` / `headers` /
 * `baseURL` are gone from `ConfigurationData` and from globalState, so an
 * unauthenticated IDE user cannot bypass login with a leftover direct-connect
 * config (spec sso-auth「IDE 宿主不再有直连免登录旁路」).
 *
 * The SDK/CLI layer keeps its own `apiKey` / `baseURL` / `defaultHeaders`
 * support and the `WAVE_API_KEY` / `WAVE_BASE_URL` env vars — only the host-side
 * user-config pipeline was removed.
 *
 * 用户偏好（AI 回复语言 / 上下文长度 / 自动记忆）也不在 globalState：它们经共享
 * CLI 进程（= 会话所在进程）的 `getUserSettings` / `updateUserSettings` 读写用户级
 * `~/.wave/settings.json`（spec core/agent-config.md「设置实时重载」与「IDE 插件
 * 配置入口」场景 6）。服务不再持有 ExtensionContext——宿主私有存储不再是任何键的
 * 真源。
 */

import { describe, it, expect, vi } from "vitest";
import {
  ConfigurationService,
  type ConfigurationData,
} from "../../src/services/configurationService";
import type { StdioClient } from "../../src/stdio/stdioClient";

function createService() {
  return new ConfigurationService();
}

/**
 * Minimal StdioClient double: `request` answers the two user-setting methods and
 * records every call so tests can assert what (and whether anything) was sent to
 * the session process.
 */
function createClient(getResult: unknown = {}) {
  const calls: Array<{ method: string; params: unknown }> = [];
  const client = {
    request: vi.fn(async (method: string, params?: unknown) => {
      calls.push({ method, params });
      if (method === "getUserSettings") return getResult;
      if (method === "updateUserSettings") return params;
      throw new Error(`unexpected method ${method}`);
    }),
  } as unknown as StdioClient;
  return { client, calls };
}

describe("ConfigurationService", () => {
  it("ignores every non-preference field passed to saveConfiguration", async () => {
    const service = createService();
    const { client, calls } = createClient();
    service.attachClient(client);

    await service.saveConfiguration({
      apiKey: "k",
      headers: "X-Legacy: 1",
      baseURL: "https://legacy.example.com",
      model: "m2",
      serverUrl: "https://codechat.example.com",
    } as unknown as ConfigurationData);

    // 一个用户偏好键都没有 → 不写 settings.json。
    expect(calls).toHaveLength(0);
  });

  it("loads user preferences through the shared CLI client, not host storage", async () => {
    const service = createService();
    const { client, calls } = createClient({
      language: "English",
      contextLength: 200,
      autoMemoryEnabled: false,
      autoMemoryFrequency: 5,
    });
    service.attachClient(client);

    const config = await service.loadConfiguration();

    expect(calls.map((c) => c.method)).toContain("getUserSettings");
    expect(config).toEqual({
      language: "English",
      contextLength: 200,
      autoMemoryEnabled: false,
      autoMemoryFrequency: 5,
    });
  });

  it("save sends only user preferences to the CLI", async () => {
    const service = createService();
    const { client, calls } = createClient();
    service.attachClient(client);

    await service.saveConfiguration({
      language: "English",
      contextLength: 200,
      autoMemoryEnabled: false,
      autoMemoryFrequency: 5,
    });

    expect(calls.filter((c) => c.method === "updateUserSettings")).toEqual([
      {
        method: "updateUserSettings",
        params: {
          language: "English",
          contextLength: 200,
          autoMemoryEnabled: false,
          autoMemoryFrequency: 5,
        },
      },
    ]);
  });

  it("does not touch settings.json when the payload has no user preference key", async () => {
    const service = createService();
    const { client, calls } = createClient();
    service.attachClient(client);

    await service.saveConfiguration({});

    expect(calls).toHaveLength(0);
  });

  it("degrades to empty preferences when the CLI read fails (settings page still renders)", async () => {
    const service = createService();
    const failing = {
      request: vi.fn(async () => {
        throw new Error("cli down");
      }),
    } as unknown as StdioClient;
    service.attachClient(failing);

    await expect(service.loadConfiguration()).resolves.toEqual({});
  });

  it("reads empty preferences before a client is attached", async () => {
    const service = createService();

    await expect(service.loadConfiguration()).resolves.toEqual({});
  });

  it("fails a user-preference save when no CLI client is attached", async () => {
    const service = createService();

    await expect(
      service.saveConfiguration({ language: "English" }),
    ).rejects.toThrow("CLI 会话未就绪");
  });
});
