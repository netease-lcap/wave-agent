import { test, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  HOST_SLASH_COMMANDS,
  hostSlashCommandsFor,
  parseHostSurface,
  toSlashCommandInfo,
} from "../../src/stdio/hostSlashCommands.js";
import { REMOTE_ALLOWED_METHODS } from "../../src/remote/remoteControlService.js";

/**
 * spec ui/slash-commands.md「弹窗里的宿主命令只有一份表——由服务端下发并按入口
 * 过滤」的用例。这里钉的不是文案，而是**各入口看到哪一批**：表与执行点分居两处
 * 之后，只有用例能把「表声称支持」和「该入口真的实现了」绑在一起。
 */

const ALL_SURFACES = ["desktop", "vscode", "jetbrains", "remote-page"] as const;

function idsFor(surface: (typeof ALL_SURFACES)[number]): string[] {
  return hostSlashCommandsFor(surface).map((command) => command.id);
}

function idsForAllSurfaces(): string[] {
  return HOST_SLASH_COMMANDS.map((command) => command.id);
}

test("每个入口拿到的正是它那份表：桌面 17 / VS Code 18 / JB 17 / 远控页 8", () => {
  // 数字是**能力盘点**，不是排版偏好：改动这张表就要连带确认对应入口真的能执行
  // 新加的那条（见下面的对齐用例），否则就是把一条点了没反应的行塞给用户。
  expect(idsFor("desktop")).toHaveLength(17);
  expect(idsFor("vscode")).toHaveLength(18);
  expect(idsFor("jetbrains")).toHaveLength(17);
  expect(idsFor("remote-page")).toHaveLength(8);
});

test("各入口的差异只有既有拍板的三条", () => {
  const desktop = idsFor("desktop");
  const vscode = idsFor("vscode");
  const jetbrains = idsFor("jetbrains");

  // 桌面端整端移除 `/clear`（2026-09-05 拍板，clear-command.md）。
  expect(desktop).not.toContain("clear");
  expect(vscode).toContain("clear");
  expect(jetbrains).toContain("clear");

  // JB 没有 `/config`（设置页在自己的菜单里）。
  expect(desktop).toContain("config");
  expect(vscode).toContain("config");
  expect(jetbrains).not.toContain("config");

  // 其余完全一致 —— 三个 GUI 入口之间不再有第四种差异：桌面端 = VS Code 去掉
  // `/clear`，JB = VS Code 去掉 `/config`。
  expect(desktop).toEqual(vscode.filter((id) => id !== "clear"));
  expect(jetbrains).toEqual(vscode.filter((id) => id !== "config"));
});

test("远控页只拿页面上真能执行的那 8 条，界面类的一条都不给", () => {
  expect(idsFor("remote-page")).toEqual([
    "status",
    "clear",
    "compact",
    "tasks",
    "workflows",
    "rewind",
    "model",
    "btw",
  ]);
  // 设置页 / 插件市场 / 计划预览 / 远程控制自身 / 磁盘历史会话：页面上没有承载
  // 它们的界面（ui/remote-control.md 场景 24），所以一条都不能出现在弹窗里。
  for (const id of [
    "config",
    "plugin",
    "reload-plugins",
    "mcp",
    "remote-control",
    "agents",
    "skills",
    "hooks",
    "resume",
    "plan",
  ]) {
    expect(idsFor("remote-page")).not.toContain(id);
  }
});

test("远控页那 8 条对应的远端方法都在白名单里", () => {
  // 「弹窗里有 ⇒ 点了真的有效」。页面上的命令最终都落成远端 RPC，白名单是那道
  // 唯一的门；把两者钉在一起，才不会出现「点了回 -32601，提示去升级机器版本」。
  const remoteMethods: Record<string, string[]> = {
    // 只读弹窗：数据来自页面已经收到的状态/通知，不需要额外请求。
    status: [],
    tasks: [],
    compact: ["compact"],
    workflows: ["getWorkflowRuns"],
    rewind: ["listRewindCheckpoints", "rewindToMessage"],
    model: ["getConfiguredModels", "setModel"],
    btw: ["askBtw"],
    clear: ["clearMessages"],
  };

  const listed = idsFor("remote-page");
  // 映射表本身也得跟着表走：漏一条就等于跳过了那条命令的对齐检查。
  expect(Object.keys(remoteMethods).sort()).toEqual([...listed].sort());

  for (const commandId of listed) {
    for (const method of remoteMethods[commandId]) {
      expect(
        REMOTE_ALLOWED_METHODS.has(method),
        `${commandId} 依赖远端方法 ${method}，但它不在白名单里`,
      ).toBe(true);
    }
  }
});

test("表里说某入口支持的每一条，webview 里都有一条以它为准的拦截分支", async () => {
  // 表的 `surfaces` 是**能力**声明：说某入口能看到这条，就意味着该入口点下去真能
  // 执行。执行点在共享 webview 的拦截 switch 里（`ChatApp.tsx` 按 `/名字` 逐一
  // 分支，四个入口共用同一份 UI）。所以这里反过来查一遍：表里出现的每个名字，
  // 都有对应的字面量分支 —— 否则就是把一条点了没反应的行塞进弹窗。
  const chatApp = await readFile(
    fileURLToPath(
      new URL("../../../webview/src/components/ChatApp.tsx", import.meta.url),
    ),
    "utf8",
  );

  for (const command of HOST_SLASH_COMMANDS) {
    expect(
      chatApp.includes(`"/${command.id}"`),
      `${command.id} 在表里，但 webview 没有以 "/${command.id}" 为准的拦截分支`,
    ).toBe(true);
  }
});

test("回包形状只带 id / name / description / runOnSelect —— 没有 handler", () => {
  for (const surface of ALL_SURFACES) {
    for (const command of hostSlashCommandsFor(surface)) {
      expect(command.id).toBe(command.name);
      expect(command.description).not.toHaveLength(0);
      expect(Object.keys(command).sort()).toEqual(
        command.runOnSelect
          ? ["description", "id", "name", "runOnSelect"]
          : ["description", "id", "name"],
      );
    }
  }
});

test("只有 /btw 不是选中即执行", () => {
  // 选中行为的唯一判据是 `runOnSelect`（webview 不再自带命令名名单）：`/btw` 要
  // 让用户接着补问题，所以只插 `/btw `；其余都是打开某个界面或直接执行。
  const insertOnly = HOST_SLASH_COMMANDS.filter(
    (command) => !command.runOnSelect,
  ).map((command) => command.id);
  expect(insertOnly).toEqual(["btw"]);
});

test("表里的 id 不重复，且每个入口的排列顺序与表一致", () => {
  const ids = idsForAllSurfaces();
  expect(new Set(ids).size).toBe(ids.length);

  // 顺序由表决定（弹窗按原样渲染），所以过滤不能打乱它。
  const tableOrder = new Map(ids.map((id, index) => [id, index]));
  for (const surface of ALL_SURFACES) {
    const order = idsFor(surface).map((id) => tableOrder.get(id) as number);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  }
});

test("toSlashCommandInfo 丢掉 handler，只留 skillSource 真设置时的标记", () => {
  expect(
    toSlashCommandInfo({
      id: "review",
      name: "review",
      description: "技能：代码评审",
      skillSource: "user",
      handler: () => {},
    } as Parameters<typeof toSlashCommandInfo>[0]),
  ).toEqual({
    id: "review",
    name: "review",
    description: "技能：代码评审",
    skillSource: "user",
  });

  // 普通命令不带 `skillSource` 键：webview 靠「有没有这个字段」判断来源标签。
  expect(
    toSlashCommandInfo({
      id: "ship",
      name: "ship",
      description: "自定义命令",
      handler: () => {},
    } as Parameters<typeof toSlashCommandInfo>[0]),
  ).toEqual({ id: "ship", name: "ship", description: "自定义命令" });
});

test("parseHostSurface 只认四个入口，其余（含缺失）一律 undefined", () => {
  for (const surface of ALL_SURFACES) {
    expect(parseHostSurface(surface)).toBe(surface);
  }
  // 旧客户端不带这个字段 —— 拿到的还是 SDK 那一半，不能凭空多出本地命令。
  expect(parseHostSurface(undefined)).toBeUndefined();
  expect(parseHostSurface("cli")).toBeUndefined();
  expect(parseHostSurface("")).toBeUndefined();
  expect(parseHostSurface(1)).toBeUndefined();
});
