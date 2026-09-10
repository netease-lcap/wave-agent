import { describe, expect, test } from "vitest";
import type * as vscode from "vscode";
import { ConfigurationService } from "../../src/services/configurationService";

/**
 * Regression（Bug #2115：设置页关掉「自动记忆」后仍记忆）链路的第一个 hop——
 * 宿主存储。`autoMemoryEnabled` / `autoMemoryFrequency` 是可选项，漏存或漏读都
 * 不会报错，只会静默丢失：保存出来的配置看起来「成功」，但下一环拿不到这个值。
 * 这里断言 globalState 往返后两个字段原样保留（含 `false`，不得被 `||` 吞掉）。
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

describe("ConfigurationService · auto-memory persistence", () => {
  test("save/load round-trips the auto-memory toggle and frequency", async () => {
    const service = new ConfigurationService(context());

    await service.saveConfiguration({
      autoMemoryEnabled: false,
      autoMemoryFrequency: 5,
    });

    const loaded = await service.loadConfiguration();
    expect(loaded.autoMemoryEnabled).toBe(false);
    expect(loaded.autoMemoryFrequency).toBe(5);
  });
});
