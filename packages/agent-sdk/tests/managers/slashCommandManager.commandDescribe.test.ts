import * as path from "node:path";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { SlashCommandManager } from "../../src/managers/slashCommandManager.js";
import { Container } from "../../src/utils/container.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ModManager } from "../../src/managers/modManager.js";
import type { SlashCommand } from "../../src/types/index.js";

/**
 * `command.describe`（spec ecosystem/plugin-mods.md「给工具、技能、命令写描述」）：
 * 命令列表要画时每个命令问一次，返回的 `{ description, argumentHint, isHidden }`
 * 三个字段都可选、只覆盖给了的。
 *
 * `isHidden` 只影响**列表**：列表里不显示，但 `hasCommand` / `executeCommand` 照旧
 * 找得到它 —— 用户直接敲那个命令时它得能跑（spec 验收场景 8）。
 */

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const WORKDIR = path.resolve("/fake/project");

/** 让 `command.describe` 那次问答落地：一条 promise 链，没有定时器。 */
async function settleDescribe(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await Promise.resolve();
  }
}

function build(
  options: {
    describe?: (command: string) => unknown;
    withoutModManager?: boolean;
  } = {},
) {
  const container = new Container();
  const messageManager = {
    saveSession: vi.fn().mockResolvedValue(undefined),
    countUserTurns: () => 1,
  };
  container.register(
    "MessageManager",
    messageManager as unknown as MessageManager,
  );
  const collectCommandDescribe = vi.fn(async (command: string) => {
    const described = options.describe?.(command);
    return (described ?? {}) as {
      description?: string;
      argumentHint?: string;
      isHidden?: boolean;
    };
  });
  if (!options.withoutModManager) {
    container.register("ModManager", {
      collectCommandDescribe,
    } as unknown as ModManager);
  }

  const manager = new SlashCommandManager(container, { workdir: WORKDIR });
  const handler = vi.fn();
  const register = (command: Partial<SlashCommand> & { name: string }) => {
    manager.registerCommand({
      description: `宿主描述：${command.name}`,
      argumentHint: "[path]",
      ...command,
      id: command.name,
      name: command.name,
      handler,
    } as SlashCommand);
  };
  register({ name: "deploy" });
  register({ name: "probe" });

  return { manager, collectCommandDescribe, handler, messageManager, register };
}

function row(
  manager: SlashCommandManager,
  name: string,
): SlashCommand | undefined {
  return manager.getCommands().find((command) => command.name === name);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("command.describe", () => {
  it("每个命令问一次，答案在下一次画列表时生效（只覆盖给了的字段）", async () => {
    const { manager, collectCommandDescribe } = build({
      describe: (command) =>
        command === "deploy" ? { description: "部署到测试环境" } : {},
    });

    // 第一次画：钩子是异步的，这一份还是宿主自己的。
    expect(row(manager, "deploy")?.description).toBe("宿主描述：deploy");
    expect(collectCommandDescribe).toHaveBeenCalledTimes(2);
    await settleDescribe();

    const deploy = row(manager, "deploy");
    expect(deploy?.description).toBe("部署到测试环境");
    // 没给的字段保留宿主的。
    expect(deploy?.argumentHint).toBe("[path]");
    // 一轮画多少次都只问过一次。
    row(manager, "deploy");
    row(manager, "deploy");
    expect(collectCommandDescribe).toHaveBeenCalledTimes(2);
  });

  it("argumentHint 也能被改", async () => {
    const { manager } = build({
      describe: () => ({ argumentHint: "<env> <version>" }),
    });

    row(manager, "deploy");
    await settleDescribe();

    expect(row(manager, "deploy")?.argumentHint).toBe("<env> <version>");
  });

  it("isHidden 只影响列表：列表里不显示，直接敲照旧能执行", async () => {
    const { manager, handler, messageManager } = build({
      describe: (command) => (command === "probe" ? { isHidden: true } : {}),
    });

    row(manager, "probe");
    await settleDescribe();

    expect(manager.getCommands().map((command) => command.name)).toEqual([
      "deploy",
    ]);
    expect(row(manager, "probe")).toBeUndefined();

    // 藏起来不等于不能跑：`hasCommand` / `executeCommand` 都还认它。
    expect(manager.hasCommand("probe")).toBe(true);
    expect(await manager.executeCommand("probe")).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(messageManager.saveSession).toHaveBeenCalled();
  });

  it("命令重新注册时旧答案作废，会重新问一次", async () => {
    const { manager, collectCommandDescribe, register } = build({
      describe: (command) => (command === "deploy" ? { isHidden: true } : {}),
    });

    row(manager, "deploy");
    await settleDescribe();
    expect(row(manager, "deploy")).toBeUndefined();

    register({ name: "deploy" });
    row(manager, "deploy");
    await settleDescribe();

    expect(collectCommandDescribe).toHaveBeenCalledTimes(3);
    // 重新问过之后还是「藏起来」（假 ModManager 的回答不变），只是问过第二次。
    expect(row(manager, "deploy")).toBeUndefined();
  });

  it("没接 ModManager 时照旧：宿主自己的描述与参数提示", () => {
    const { manager, collectCommandDescribe } = build({
      withoutModManager: true,
    });

    expect(row(manager, "deploy")).toMatchObject({
      description: "宿主描述：deploy",
      argumentHint: "[path]",
    });
    expect(manager.getCommands()).toHaveLength(2);
    expect(collectCommandDescribe).not.toHaveBeenCalled();
  });
});
