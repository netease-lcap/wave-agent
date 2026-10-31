/**
 * The **one** table of host-local slash commands (spec ui/slash-commands.md
 * 「弹窗里的宿主命令只有一份表——由服务端下发并按入口过滤」).
 *
 * These are the commands a front end handles itself — it opens a dialog, a
 * settings page or a panel, or it intercepts the text before it reaches the
 * agent. They are not registered with the SDK, so they cannot come from
 * `agent.getSlashCommands()`; before this table existed each host carried its
 * own copy (desktop 17, VS Code 18, JetBrains 17 — differing on `/clear` and
 * `/config` only) and the phone page carried none, which is why the same
 * command was visible on the computer and had to be typed by hand on the phone.
 *
 * It lives here, next to `AgentBridge`, because that is the one place every
 * front end already talks to: the daemon and each GUI's `--stdio` child serve
 * the popup from it, the phone's requests land on it, and JetBrains — which
 * cannot import TypeScript at all — reads it as JSON over the same RPC.
 *
 * **What each entry claims**: `surfaces` is the set of front ends that really
 * implement it. It is a capability statement, not a label: an entry listed for
 * a surface that has no handling behind it produces exactly the defect spec
 * remote/remote-web.md 场景 21 forbids — a row in the popup that does nothing
 * when picked. `hostSlashCommands.test.ts` pins each surface's set, and the
 * remote-page set is also cross-checked there against the remote allowlist,
 * which is the other half of the same promise (popup lists it ⇒ picking it
 * works).
 */

import type { HostSurface, SlashCommandInfo } from "wave-agent-sdk/types";

/** Which front ends a command is offered to. */
type Surfaces = readonly HostSurface[];

interface HostSlashCommandSpec {
  id: string;
  description: string;
  /** Absent = insert `/name ` and let the user finish (only `/btw` today). */
  runOnSelect?: boolean;
  surfaces: Surfaces;
}

/** Everyone's entries — `/clear` being the one that is not quite everyone's. */
const ALL: Surfaces = ["desktop", "vscode", "jetbrains", "remote-page"];

/** The GUIs that own a settings page / marketplace / panel — not the phone. */
const GUIS: Surfaces = ["desktop", "vscode", "jetbrains"];

/**
 * The table, in popup order. Order matters: the popup appends these after the
 * SDK's own commands and renders them as given, so the machine also decides
 * where a command sits. This is the order the two GUI hosts already used.
 */
export const HOST_SLASH_COMMANDS: readonly HostSlashCommandSpec[] = [
  // ── 需要宿主界面的：只有桌面端与 IDE 有承载它们的页面 ──
  {
    id: "config",
    description: "打开配置设置",
    runOnSelect: true,
    // JB 的设置页在自己的菜单里，没有这条入口；远控页没有设置页。
    surfaces: ["desktop", "vscode"],
  },
  {
    id: "plugin",
    description: "打开插件市场",
    runOnSelect: true,
    surfaces: GUIS,
  },
  {
    id: "reload-plugins",
    description: "就地重载插件（不重启对话）",
    runOnSelect: true,
    surfaces: GUIS,
  },
  {
    id: "mcp",
    description: "打开 MCP 服务器管理",
    runOnSelect: true,
    surfaces: GUIS,
  },

  // ── 页面也能执行的：背后是会话内的方法，不需要编辑器与文件系统 ──
  {
    id: "status",
    description: "查看当前状态",
    runOnSelect: true,
    surfaces: ALL,
  },
  {
    id: "remote-control",
    description: "远程控制（用手机接管本机会话）",
    runOnSelect: true,
    // 远控页不列它：那一页就是二维码指向的东西，给自己开一个入口是自我指涉。
    surfaces: GUIS,
  },
  {
    id: "clear",
    description: "清除对话历史并重置会话",
    runOnSelect: true,
    // 桌面端整端移除了 `/clear`（2026-09-05 拍板，见 clear-command.md 与
    // remote/remote-web.md 场景 21）。
    surfaces: ["vscode", "jetbrains", "remote-page"],
  },
  {
    id: "compact",
    description: "手动压缩对话历史",
    runOnSelect: true,
    surfaces: ALL,
  },
  {
    id: "tasks",
    description: "查看后台任务",
    runOnSelect: true,
    surfaces: ALL,
  },
  {
    id: "workflows",
    description: "查看工作流运行",
    runOnSelect: true,
    surfaces: ALL,
  },
  {
    id: "agents",
    description: "查看可用 agents",
    runOnSelect: true,
    surfaces: GUIS,
  },
  {
    id: "skills",
    description: "查看可用技能",
    runOnSelect: true,
    surfaces: GUIS,
  },
  {
    id: "hooks",
    description: "查看已配置钩子",
    runOnSelect: true,
    surfaces: GUIS,
  },
  {
    id: "rewind",
    description: "回退到之前的用户消息",
    runOnSelect: true,
    surfaces: ALL,
  },
  // `/model` 不在这里：模型入口自 2026-10-21 起是输入卡片底栏的选择器（见 spec
  // ui/model-selection.md），桌面 / IDE / 远控页都不再有这条命令；CLI 的 TUI 没有
  // 底栏，因此 `/model` 只留在它自己的命令表里（packages/code 的 AVAILABLE_COMMANDS）。
  {
    id: "resume",
    description: "恢复历史对话",
    runOnSelect: true,
    // 桌面端 / IDE 与 daemon、GUI 的 `--stdio` 子进程都能执行它；**前台 CLI 那
    // 个承接进程不能**（它只有一条会话槽位，恢复磁盘会话等于把用户正看着的那条
    // 换掉）——所以这一条是表第一次出现「入口一致、宿主再收窄」：这里给的是
    // `remote-page` 的上限，`RemoteControlCliHost` 在回包前删掉它（见
    // `remoteControlCliHost.ts` 的 `getSlashCommands`）。桌面侧栏与远控页的取数
    // 不同：侧栏只报进程内活会话，`/resume` 才是磁盘历史会话的入口。
    surfaces: ALL,
  },
  {
    id: "btw",
    description: "旁路提问（不进入聊天记录）",
    // 不标 `runOnSelect`：选中后只把 `/btw ` 插进输入框，等用户补问题
    // （spec ui/btw-command.md）。
    surfaces: ALL,
  },
  {
    id: "plan",
    description: "启用规划模式或查看当前方案",
    runOnSelect: true,
    // 页面上没有计划预览面板，计划正文渲染在 ExitPlanMode 的审批卡里。
    surfaces: GUIS,
  },
];

/** The table as one surface sees it, already in wire shape. */
export function hostSlashCommandsFor(surface: HostSurface): SlashCommandInfo[] {
  return HOST_SLASH_COMMANDS.filter((command) =>
    command.surfaces.includes(surface),
  ).map((command) => ({
    id: command.id,
    name: command.id,
    description: command.description,
    ...(command.runOnSelect ? { runOnSelect: true } : {}),
  }));
}

/**
 * An agent command as the popup's wire shape — `handler` and `immediate` do
 * not cross the wire, and `skillSource` is kept only when it is actually set
 * (the webview reads "has a source tag" off its presence).
 */
export function toSlashCommandInfo(command: {
  id: string;
  name: string;
  description: string;
  skillSource?: SlashCommandInfo["skillSource"];
}): SlashCommandInfo {
  return {
    id: command.id,
    name: command.name,
    description: command.description,
    ...(command.skillSource ? { skillSource: command.skillSource } : {}),
  };
}

/** Narrow the `surface` field a caller sent, or `undefined` when absent/unknown. */
export function parseHostSurface(value: unknown): HostSurface | undefined {
  return value === "desktop" ||
    value === "vscode" ||
    value === "jetbrains" ||
    value === "remote-page"
    ? value
    : undefined;
}
