import { describe, it, expect, vi } from "vitest";
import {
  PermissionManager,
  type PermissionManagerOptions,
} from "../../src/managers/permissionManager.js";
import { Container } from "../../src/utils/container.js";
import type {
  PermissionDecision,
  PermissionMode,
} from "../../src/types/permissions.js";
import type { ModManager } from "../../src/managers/modManager.js";

/**
 * 影子事件 `classic.PermissionDenied`（spec ecosystem/plugin-mods.md「影子事件」）：
 * 一次工具调用被拒之后报一次，`reason` 是四档短码 —— 插件据此区分「规则不许」
 * 与「用户刚拒了」（后者才值得弹一条提示让人重试）。
 *
 * 派发点放在 `checkPermission` 这个唯一收口里：规则、模式、没人能答、用户点了
 * 拒绝最后都经过它，漏一条就等于某个插件永远收不到。
 */

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function createManager(options: PermissionManagerOptions = {}) {
  const container = new Container();
  const notifyMods = vi.fn();
  container.register("ModManager", { notifyMods } as unknown as ModManager);
  return {
    manager: new PermissionManager(container, options),
    notifyMods,
    container,
  };
}

function deniedPayloads(notifyMods: ReturnType<typeof vi.fn>): unknown[] {
  return notifyMods.mock.calls
    .filter((call) => call[0] === "classic.PermissionDenied")
    .map((call) => call[1]);
}

/** 一次受限制工具的调用（Bash 在日常用法里最容易撞到各种拒绝）。 */
function bashCall(
  manager: PermissionManager,
  options: {
    mode?: PermissionMode;
    callback?: () => Promise<PermissionDecision>;
    command?: string;
  } = {},
) {
  const { mode = "default", callback, command = "rm -rf /" } = options;
  return manager.checkPermission(
    manager.createContext(
      "Bash",
      mode,
      callback as unknown as
        | Parameters<PermissionManager["createContext"]>[2]
        | undefined,
      { command },
      "call-1",
    ),
  );
}

describe("classic.PermissionDenied", () => {
  it("规则拒：reason 是 denied_by_rule，带上工具名/入参/调用 id", async () => {
    const { manager, notifyMods } = createManager({ deniedRules: ["Bash"] });

    const decision = await bashCall(manager, { command: "rm -rf /" });

    expect(decision.behavior).toBe("deny");
    expect(deniedPayloads(notifyMods)).toEqual([
      {
        tool_name: "Bash",
        tool_input: { command: "rm -rf /" },
        tool_use_id: "call-1",
        reason: "denied_by_rule",
      },
    ]);
  });

  it("模式拒：dontAsk 自动拒是 denied_by_mode，不是规则", async () => {
    const { manager, notifyMods } = createManager();

    await bashCall(manager, { mode: "dontAsk" });

    expect(deniedPayloads(notifyMods)).toEqual([
      expect.objectContaining({ reason: "denied_by_mode" }),
    ]);
  });

  it("没人能答：没有审批回调是 no_permission_prompt", async () => {
    const { manager, notifyMods } = createManager();

    await bashCall(manager);

    expect(deniedPayloads(notifyMods)).toEqual([
      expect.objectContaining({ reason: "no_permission_prompt" }),
    ]);
  });

  it("用户点的拒绝是 user_denied（这一档才值得提示重试）", async () => {
    const { manager, notifyMods } = createManager();
    const callback = vi.fn().mockResolvedValue({
      behavior: "deny" as const,
      message: "不改这一行",
    });

    await bashCall(manager, { callback });

    expect(deniedPayloads(notifyMods)).toEqual([
      expect.objectContaining({ reason: "user_denied" }),
    ]);
  });

  it("放行时不发（只有真拒了才报）", async () => {
    const { manager, notifyMods } = createManager();
    const callback = vi.fn().mockResolvedValue({ behavior: "allow" as const });

    const decision = await bashCall(manager, { callback });

    expect(decision.behavior).toBe("allow");
    expect(deniedPayloads(notifyMods)).toEqual([]);
  });

  it("容器里没有 ModManager 时不抛错", async () => {
    const manager = new PermissionManager(new Container(), {
      deniedRules: ["Bash"],
    });

    await expect(bashCall(manager)).resolves.toEqual(
      expect.objectContaining({ behavior: "deny" }),
    );
  });
});
