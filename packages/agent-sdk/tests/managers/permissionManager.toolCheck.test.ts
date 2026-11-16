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
import type { ModToolCheckEvent } from "../../src/types/mods.js";

/**
 * 第二判定源 `tool.check`（spec ecosystem/plugin-mods.md「第二判定源」与用户故事
 * 「插件能在工具真跑之前多问一次，也能拒绝」）。
 *
 * 落点是 `PermissionManager.checkPermission()`：规则 + 模式先算出**三档**结论，
 * 再交给 `tool.check` 链换掉，最后才决定要不要弹卡片。三个方向都算数（含放宽，
 * CC 的契约是 `return any { decision }`），这里测的是判定点本身：结论怎么映射、
 * 卡片弹不弹、模型读到哪段文本、`e` 里带什么。
 */

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

/** 一张会弹出来的卡片：调用它就算「问过人了」。 */
function allowCallback(decision?: Partial<PermissionDecision>) {
  const callback = vi.fn(
    async (_context: unknown): Promise<PermissionDecision> => ({
      behavior: "allow",
      ...decision,
    }),
  );
  return callback;
}

function createManager(
  options: PermissionManagerOptions = {},
  dispatchToolCheck?: (event: ModToolCheckEvent) => Promise<unknown>,
) {
  const container = new Container();
  container.register("ModManager", {
    // 假的 dispatchToolCheck：默认「不表态」—— 原样把宿主的决定还回来
    // （`{ decision: hostDecision }`），与真链上没有匹配的插件时同形。
    dispatchToolCheck:
      dispatchToolCheck ??
      (async (event: ModToolCheckEvent) => ({
        decision: event.decision,
        reason: event.reason,
      })),
    collectToolDescription: vi.fn(
      async ({ description }: { description: string }) => description,
    ),
    notifyMods: vi.fn(),
  } as unknown as ModManager);
  return { manager: new PermissionManager(container, options), container };
}

function context(
  manager: PermissionManager,
  {
    tool = "Bash",
    mode = "default" as PermissionMode,
    callback,
    input = { command: "npm publish" },
    toolCallId = "call-1",
  }: {
    tool?: string;
    mode?: PermissionMode;
    callback?: ReturnType<typeof allowCallback>;
    input?: Record<string, unknown>;
    toolCallId?: string;
  } = {},
) {
  return manager.createContext(
    tool,
    mode,
    callback as unknown as Parameters<PermissionManager["createContext"]>[2],
    input,
    toolCallId,
  );
}

describe("tool.check：规则与模式算完之后、卡片弹出来之前", () => {
  it("场景 1：规则放行、钩子抬成 ask → 卡片弹出、带上那句 reason，批准后照常执行", async () => {
    const events: ModToolCheckEvent[] = [];
    const { manager } = createManager({}, async (event) => {
      events.push(event);
      return { decision: "ask", reason: "发布前请确认版本号" };
    });
    const callback = allowCallback();

    const decision = await manager.checkPermission(
      context(manager, { callback, input: { command: "git status" } }),
    );

    // 钩子拿到的是「宿主的结论」：git status 命中了默认 allow 规则，什么都没拒。
    expect(events).toEqual([
      expect.objectContaining({
        tool: "Bash",
        tool_use_id: "call-1",
        input: { command: "git status" },
        decision: "allow",
      }),
    ]);
    // 抬成 ask 就是要弹卡片，而且卡片上带着插件那句话（走 `warning` 这条现成通道）。
    expect(callback).toHaveBeenCalledTimes(1);
    const cardContext = callback.mock.calls[0][0] as { warning?: string };
    expect(cardContext.warning).toBe("发布前请确认版本号");
    // 用户批准 → 工具照常跑。
    expect(decision.behavior).toBe("allow");
  });

  it("场景 2：命中 deny 规则、钩子放宽成 allow → 照钩子的走（CC 契约：三个方向都算数）", async () => {
    // 真插件的主要用途就是这一档：sotto 用它给自家的 `mcp__sotto__*` 工具免审批。
    const { manager } = createManager({ deniedRules: ["Bash"] }, async () => ({
      decision: "allow",
      reason: "自家工具不用问",
    }));

    const decision = await manager.checkPermission(
      context(manager, { input: { command: "npm publish" } }),
    );

    expect(decision.behavior).toBe("allow");
  });

  it("场景 2b：钩子没表态（原样返回宿主决定）时，deny 规则照旧、文本与没有钩子时逐字相同", async () => {
    const { manager } = createManager({ deniedRules: ["Bash"] });
    const withHook = await manager.checkPermission(
      context(manager, { input: { command: "npm publish" } }),
    );

    // 同一个调用在没有 ModManager 时算什么。
    const bare = new PermissionManager(new Container(), {
      deniedRules: ["Bash"],
    });
    const withoutHook = await bare.checkPermission(
      bare.createContext(
        "Bash",
        "default",
        undefined,
        { command: "npm publish" },
        "call-1",
      ),
    );

    expect(withHook.behavior).toBe("deny");
    expect(withHook.message).toBe(withoutHook.message);
  });

  it("场景 3：钩子判 deny → 模型收到的错误文本是那句 reason", async () => {
    const { manager } = createManager({}, async () => ({
      decision: "deny",
      reason: "这个仓库里不许 npm publish",
    }));

    const decision = await manager.checkPermission(
      context(manager, { input: { command: "npm publish" } }),
    );

    expect(decision.behavior).toBe("deny");
    expect(decision.message).toBe("这个仓库里不许 npm publish");
  });

  it("场景 3：`classic.PermissionDenied` 的 reason 仍是宿主的短码，不被插件的 reason 覆盖", async () => {
    const notifyMods = vi.fn();
    const container = new Container();
    container.register("ModManager", {
      dispatchToolCheck: async () => ({
        decision: "deny",
        reason: "插件的理由",
      }),
      notifyMods,
    } as unknown as ModManager);
    const manager = new PermissionManager(container, {
      deniedRules: ["Bash"],
    });

    const decision = await manager.checkPermission(
      context(manager, { input: { command: "npm publish" } }),
    );

    expect(decision.message).toBe("插件的理由");
    expect(
      notifyMods.mock.calls
        .filter((call) => call[0] === "classic.PermissionDenied")
        .map((call) => call[1]),
    ).toEqual([
      expect.objectContaining({ reason: "denied_by_rule", tool_name: "Bash" }),
    ]);
  });

  it("场景 4：dontAsk 下原本不弹卡片，钩子抬成 ask 之后照弹", async () => {
    // Read 不是受限制工具：dontAsk 模式下宿主直接放行，本来一张卡都不会弹。
    const quiet = createManager();
    const quietCallback = allowCallback();
    const allowed = await quiet.manager.checkPermission(
      context(quiet.manager, {
        tool: "Read",
        mode: "dontAsk",
        callback: quietCallback,
        input: { file_path: "a.ts" },
      }),
    );
    expect(allowed.behavior).toBe("allow");
    expect(quietCallback).not.toHaveBeenCalled();

    const { manager } = createManager({}, async () => ({
      decision: "ask",
      reason: "读这个文件前先问一声",
    }));
    const callback = allowCallback();
    const decision = await manager.checkPermission(
      context(manager, {
        tool: "Read",
        mode: "dontAsk",
        callback,
        input: { file_path: "a.ts" },
      }),
    );

    expect(callback).toHaveBeenCalledTimes(1);
    expect((callback.mock.calls[0][0] as { warning?: string }).warning).toBe(
      "读这个文件前先问一声",
    );
    expect(decision.behavior).toBe("allow");
  });

  it("场景 5：钩子抛错 → 按宿主原本的决定走（不因为插件坏了就放行）", async () => {
    const { manager } = createManager({ deniedRules: ["Bash"] }, async () => {
      throw new Error("mod 炸了");
    });

    const decision = await manager.checkPermission(
      context(manager, { input: { command: "npm publish" } }),
    );

    expect(decision.behavior).toBe("deny");
  });

  it("场景 6：子代理发起的调用带 agentId；主会话的调用上这个键不出现", async () => {
    const events: ModToolCheckEvent[] = [];
    const dispatch = async (event: ModToolCheckEvent) => {
      events.push(event);
      return { decision: event.decision };
    };

    const subagent = createManager({ agentId: "sub-1" }, dispatch);
    await subagent.manager.checkPermission(
      context(subagent.manager, { input: { command: "git status" } }),
    );

    const main = createManager({}, dispatch);
    await main.manager.checkPermission(
      context(main.manager, { input: { command: "git status" } }),
    );

    expect(events[0].agentId).toBe("sub-1");
    expect("agentId" in events[1]).toBe(false);
  });

  it("isReadOnly 只在工具自己报了只读时出现（不是 false）", async () => {
    const events: ModToolCheckEvent[] = [];
    const { manager } = createManager({}, async (event) => {
      events.push(event);
      return { decision: event.decision };
    });

    await manager.checkPermission(
      context(manager, { tool: "Read", input: { file_path: "a.ts" } }),
    );
    await manager.checkPermission(
      context(manager, { tool: "Bash", input: { command: "git status" } }),
    );

    expect(events[0].isReadOnly).toBe(true);
    expect("isReadOnly" in events[1]).toBe(false);
  });

  it("没接 ModManager 时照旧：规则与模式的结论原样返回", async () => {
    const deniedManager = new PermissionManager(new Container(), {
      deniedRules: ["Bash"],
    });
    const denied = await deniedManager.checkPermission(
      context(deniedManager, { input: { command: "npm publish" } }),
    );

    // 默认放行规则（`Bash(git status*)`）照旧生效，没人接 `tool.check` 也不影响。
    const plainManager = new PermissionManager(new Container());
    const allowed = await plainManager.checkPermission(
      context(plainManager, { input: { command: "git status" } }),
    );

    expect(denied.behavior).toBe("deny");
    expect(allowed.behavior).toBe("allow");
  });
});
