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
 * 用户偏好（AI 回复语言 / 上下文长度 / 自动记忆）不在 globalState：它们经共享
 * CLI 进程（= 会话所在进程）的 `getUserSettings` / `updateUserSettings` 读写用户级
 * `~/.wave/settings.json`（spec core/agent-config.md「设置实时重载」与「IDE 插件
 * 配置入口」场景 6）。
 */

import { describe, it, expect, vi } from "vitest";
import type * as vscode from "vscode";
import {
  ConfigurationService,
  type ConfigurationData,
} from "../../src/services/configurationService";
import type { StdioClient } from "../../src/stdio/stdioClient";

/** Minimal ExtensionContext double backed by a Map. */
function createService(stored: Record<string, unknown> = {}) {
  const state = new Map<string, unknown>(Object.entries(stored));
  const context = {
    globalState: {
      get: (key: string) => state.get(key),
      update: (key: string, value: unknown) => {
        state.set(key, value);
        return Promise.resolve();
      },
    },
  } as unknown as vscode.ExtensionContext;
  return { service: new ConfigurationService(context), state };
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
  it("does not load credential fields, even when a pre-removal build left them in globalState", async () => {
    const { service } = createService({
      apiKey: "legacy-key",
      headers: "X-Legacy: 1",
      baseURL: "https://legacy.example.com",
      model: "m1",
    });

    const config = await service.loadConfiguration();

    expect(config).not.toHaveProperty("apiKey");
    expect(config).not.toHaveProperty("headers");
    expect(config).not.toHaveProperty("baseURL");
    expect(config.model).toBe("m1");
  });

  it("ignores credential fields passed to saveConfiguration", async () => {
    const { service, state } = createService();

    await service.saveConfiguration({
      apiKey: "k",
      headers: "X-Legacy: 1",
      baseURL: "https://legacy.example.com",
      serverUrl: "https://codechat.example.com",
    } as unknown as ConfigurationData);

    expect(state.has("apiKey")).toBe(false);
    expect(state.has("headers")).toBe(false);
    expect(state.has("baseURL")).toBe(false);
    expect(state.get("serverUrl")).toBe("https://codechat.example.com");
  });

  it("loads user preferences through the shared CLI client, not host storage", async () => {
    const { service } = createService({ model: "m1" });
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
      model: "m1",
      fastModel: "",
      serverUrl: "",
      language: "English",
      contextLength: 200,
      autoMemoryEnabled: false,
      autoMemoryFrequency: 5,
    });
  });

  it("save keeps local keys in globalState and sends only user preferences to the CLI", async () => {
    const { service, state } = createService();
    const { client, calls } = createClient();
    service.attachClient(client);

    await service.saveConfiguration({
      model: "m2",
      fastModel: "m2-fast",
      serverUrl: "https://codechat.example.com",
      language: "English",
      contextLength: 200,
      autoMemoryEnabled: false,
      autoMemoryFrequency: 5,
    });

    expect(state.get("model")).toBe("m2");
    expect(state.get("fastModel")).toBe("m2-fast");
    expect(state.get("serverUrl")).toBe("https://codechat.example.com");
    // 用户偏好不落 globalState（唯一落点 = settings.json）。
    expect(state.has("language")).toBe(false);
    expect(state.has("contextLength")).toBe(false);
    expect(state.has("autoMemoryEnabled")).toBe(false);
    expect(state.has("autoMemoryFrequency")).toBe(false);
    // 只有用户偏好键进 settings.json，扩展私有键（model/fastModel/serverUrl）不发。
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
    const { service } = createService();
    const { client, calls } = createClient();
    service.attachClient(client);

    await service.saveConfiguration({ serverUrl: "https://x.example.com" });

    expect(calls).toHaveLength(0);
  });

  it("degrades to empty preferences when the CLI read fails (settings page still renders)", async () => {
    const { service } = createService();
    const failing = {
      request: vi.fn(async () => {
        throw new Error("cli down");
      }),
    } as unknown as StdioClient;
    service.attachClient(failing);

    await expect(service.loadConfiguration()).resolves.toEqual({
      model: "",
      fastModel: "",
      serverUrl: "",
    });
  });

  it("reads empty preferences before a client is attached", async () => {
    const { service } = createService({ model: "m1" });

    await expect(service.loadConfiguration()).resolves.toEqual({
      model: "m1",
      fastModel: "",
      serverUrl: "",
    });
  });

  it("fails a user-preference save when no CLI client is attached", async () => {
    const { service, state } = createService();

    await expect(
      service.saveConfiguration({ model: "m2", language: "English" }),
    ).rejects.toThrow("CLI 会话未就绪");

    // 本地键已落盘、用户偏好键未落 globalState。
    expect(state.get("model")).toBe("m2");
    expect(state.has("language")).toBe(false);
  });
});
