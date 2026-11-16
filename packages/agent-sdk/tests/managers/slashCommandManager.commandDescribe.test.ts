import * as path from "node:path";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { SlashCommandManager } from "../../src/managers/slashCommandManager.js";
import { Container } from "../../src/utils/container.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ModManager } from "../../src/managers/modManager.js";
import type { SlashCommand } from "../../src/types/index.js";

/**
 * `command.describe`（spec ecosystem/plugin-mods.md「给工具、技能、命令写描述」）：
 * 命令列表要画时每个命令问一次、**等答案回来再画**，返回的
 * `{ description, argumentHint, isHidden }` 三个字段都可选、只覆盖给了的。
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

async function row(
  manager: SlashCommandManager,
  name: string,
): Promise<SlashCommand | undefined> {
  return (await manager.getCommands()).find((command) => command.name === name);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("command.describe", () => {
  it("每次画列表都问一次，答案当次就用上（只覆盖给了的字段）", async () => {
    const { manager, collectCommandDescribe } = build({
      describe: (command) =>
        command === "deploy" ? { description: "部署到测试环境" } : {},
    });

    const deploy = await row(manager, "deploy");
    expect(deploy?.description).toBe("部署到测试环境");
    // 没给的字段保留宿主的。
    expect(deploy?.argumentHint).toBe("[path]");
    expect(collectCommandDescribe).toHaveBeenCalledTimes(2);
  });

  it("argumentHint 也能被改", async () => {
    const { manager } = build({
      describe: () => ({ argumentHint: "<env> <version>" }),
    });

    expect((await row(manager, "deploy"))?.argumentHint).toBe(
      "<env> <version>",
    );
  });

  it("isHidden 只影响列表：列表里不显示，直接敲照旧能执行", async () => {
    const { manager, handler, messageManager } = build({
      describe: (command) => (command === "probe" ? { isHidden: true } : {}),
    });

    expect(
      (await manager.getCommands()).map((command) => command.name),
    ).toEqual(["deploy"]);
    expect(await row(manager, "probe")).toBeUndefined();

    // 藏起来不等于不能跑：`hasCommand` / `executeCommand` 都还认它。
    expect(manager.hasCommand("probe")).toBe(true);
    expect(await manager.executeCommand("probe")).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(messageManager.saveSession).toHaveBeenCalled();
  });

  it("答案是每次现问的：插件改了口，下一次画就变了", async () => {
    let hidden = true;
    const { manager, collectCommandDescribe } = build({
      describe: (command) =>
        command === "deploy" && hidden ? { isHidden: true } : {},
    });

    expect(await row(manager, "deploy")).toBeUndefined();

    hidden = false;
    expect((await row(manager, "deploy"))?.description).toBe(
      "宿主描述：deploy",
    );
    // 两次画，每次每个命令各问一次。
    expect(collectCommandDescribe).toHaveBeenCalledTimes(4);
  });

  it("没接 ModManager 时照旧：宿主自己的描述与参数提示", async () => {
    const { manager, collectCommandDescribe } = build({
      withoutModManager: true,
    });

    expect(await row(manager, "deploy")).toMatchObject({
      description: "宿主描述：deploy",
      argumentHint: "[path]",
    });
    expect(await manager.getCommands()).toHaveLength(2);
    expect(collectCommandDescribe).not.toHaveBeenCalled();
  });
});
