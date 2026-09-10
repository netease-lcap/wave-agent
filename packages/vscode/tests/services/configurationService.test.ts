/**
 * The VS Code host no longer has a credential pipeline: `apiKey` / `headers` /
 * `baseURL` are gone from `ConfigurationData` and from globalState, so an
 * unauthenticated IDE user cannot bypass login with a leftover direct-connect
 * config (spec sso-auth「IDE 宿主不再有直连免登录旁路」).
 *
 * The SDK/CLI layer keeps its own `apiKey` / `baseURL` / `defaultHeaders`
 * support and the `WAVE_API_KEY` / `WAVE_BASE_URL` env vars — only the host-side
 * user-config pipeline was removed.
 */

import { describe, it, expect } from "vitest";
import type * as vscode from "vscode";
import {
  ConfigurationService,
  type ConfigurationData,
} from "../../src/services/configurationService";

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
      language: "English",
    } as unknown as ConfigurationData);

    expect(state.has("apiKey")).toBe(false);
    expect(state.has("headers")).toBe(false);
    expect(state.has("baseURL")).toBe(false);
    expect(state.get("language")).toBe("English");
  });
});
