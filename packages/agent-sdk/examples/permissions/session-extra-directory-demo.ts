#!/usr/bin/env tsx

/**
 * Session extra directory example — the「是，且允许本会话编辑 <目录名>/」option
 *
 * 三端 GUI（VS Code / JetBrains / 桌面）的确认弹窗上多了一个选项：当 `Write`/
 * `Edit` 的目标文件在安全区域之外时，用户可以一次性把该目录加进**当前会话**的
 * 安全区域（仅内存，不写任何配置文件）。本示例用真模型跑一遍那条链路：
 *
 *   agent.sendMessage → 模型发 Write → PermissionManager → canUseTool（弹窗）
 *
 * `canUseTool` 就是那个弹窗；脚本替用户回答它，并按 GUI 的规则把选项打印出来
 * （选项文本与出现条件镜像自 packages/webview/src/components/ConfirmationDialog.tsx，
 * 改那边记得同步这里）。
 *
 * 运行：
 *   cd packages/agent-sdk
 *   WAVE_FAST_MODEL=<模型> pnpm exec tsx examples/permissions/session-extra-directory-demo.ts
 *
 * 退出码 0 = 全部断言通过，1 = 有断言未通过。
 */

import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Agent } from "../../src/agent.js";
import {
  BASH_TOOL_NAME,
  EDIT_TOOL_NAME,
  WRITE_TOOL_NAME,
} from "../../src/constants/tools.js";
import type {
  PermissionDecision,
  ToolPermissionContext,
} from "../../src/types/permissions.js";

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

// ───────────────────────── 弹窗（GUI 的镜像） ─────────────────────────

interface Option {
  key: string;
  label: string;
  decision: PermissionDecision;
}

/** 目录路径的最后一段（同 ConfirmationDialog.lastPathSegment）。 */
function lastPathSegment(dirPath: string): string {
  const segments = dirPath.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? dirPath;
}

/** 镜像 GUI 的按钮集合与出现条件（ConfirmationDialog 的 confirmation-actions）。 */
function optionsFor(ctx: ToolPermissionContext): Option[] {
  const isFileEdit =
    ctx.toolName === EDIT_TOOL_NAME || ctx.toolName === WRITE_TOOL_NAME;
  const options: Option[] = [];

  if (
    ctx.toolName === BASH_TOOL_NAME ||
    isFileEdit ||
    ctx.toolName.startsWith("mcp__")
  ) {
    options.push({
      key: "feedback",
      label: "提供反馈",
      decision: { behavior: "deny", message: "（用户提供了反馈）" },
    });
  }

  if (ctx.toolName === BASH_TOOL_NAME && ctx.permissionMode !== "plan") {
    options.push({
      key: "skip-permissions",
      label: "是，并跳过权限确认",
      decision: { behavior: "allow", newPermissionMode: "bypassPermissions" },
    });
  }

  // ← 本例主角：仅当目标文件越界时出现
  if (isFileEdit && ctx.outsideSafeZoneDirectory) {
    options.push({
      key: "add-directory",
      label: `是，且允许本会话编辑 ${lastPathSegment(ctx.outsideSafeZoneDirectory)}/`,
      decision: {
        behavior: "allow",
        newAdditionalDirectory: ctx.outsideSafeZoneDirectory,
      },
    });
  }

  if (!ctx.hidePersistentOption) {
    options.push({
      key: "auto-accept",
      label:
        ctx.toolName === BASH_TOOL_NAME
          ? "是，且在此工作目录下不再询问此命令"
          : "是，且自动接受修改",
      decision: { behavior: "allow", newPermissionMode: "acceptEdits" },
    });
  }

  options.push({
    key: "allow-once",
    label: "批准并继续",
    decision: { behavior: "allow" },
  });

  return options;
}

// ───────────────────────── 运行状态 ─────────────────────────

const root = await mkdtemp(join(tmpdir(), "wave-session-extra-dir-"));
const workdir = join(root, "workspace");
const outsideDir = join(root, "shared");
const notesPath = join(outsideDir, "notes.md");
const secondPath = join(outsideDir, "second.md");
const insidePath = join(workdir, "inside.md");

await mkdir(workdir, { recursive: true });
await mkdir(outsideDir, { recursive: true });

/** 每个弹窗的选择，按顺序消耗；用完之后默认「批准并继续」。 */
const scriptedChoices: string[] = ["add-directory"];
const dialogs: { ctx: ToolPermissionContext }[] = [];

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? green("✓") : red("✗")} ${label}${detail ? dim(`  ${detail}`) : ""}`,
  );
}

function printDialog(ctx: ToolPermissionContext): void {
  const options = optionsFor(ctx);
  const index = dialogs.length;
  const picked = scriptedChoices[index - 1] ?? "allow-once";
  const target =
    ctx.toolName === BASH_TOOL_NAME
      ? String(ctx.toolInput?.command ?? "")
      : String(ctx.toolInput?.file_path ?? "");

  console.log(`  ${bold(`弹窗 #${index}`)}  ${ctx.toolName} → ${dim(target)}`);
  console.log(
    `  ${dim(`权限模式 ${ctx.permissionMode} · hidePersistentOption ${String(ctx.hidePersistentOption)}`)}`,
  );
  for (const option of options) {
    console.log(
      `    [${option.key}] ${option.label}${option.key === picked ? green("   ← 用户选择") : ""}`,
    );
  }
  console.log();
}

const agent = await Agent.create({
  workdir,
  model: process.env.WAVE_FAST_MODEL,
  permissionMode: "default",
  canUseTool: async (context) => {
    dialogs.push({ ctx: context });
    printDialog(context);
    const options = optionsFor(context);
    const picked = scriptedChoices.shift() ?? "allow-once";
    return (
      options.find((option) => option.key === picked)?.decision ?? {
        behavior: "allow",
      }
    );
  },
});

async function main() {
  console.log(bold("\n会话级附加目录（确认弹窗新增选项）示例"));
  console.log(dim(`  工作目录: ${workdir}`));
  console.log(dim(`  越界目录: ${outsideDir}\n`));

  try {
    // ── 场景 1：越界写文件 → 弹窗上出现新选项，用户选它 ────────────────
    console.log(bold("场景 1：写工作目录之外的文件，并选择新选项"));
    await agent.sendMessage(
      `请用 Write 工具创建文件 ${notesPath}，内容为 "# notes"。只做这一件事。`,
    );
    if (dialogs.length === 0) {
      throw new Error("模型没有发起任何需要确认的工具调用，示例无法继续");
    }

    const firstOptions = optionsFor(dialogs[0].ctx);
    const addDirOption = firstOptions.find((o) => o.key === "add-directory");
    check("弹窗出现了新选项", !!addDirOption, addDirOption?.label ?? "");
    check(
      "越界时不提供「是，且自动接受修改」",
      !firstOptions.some((o) => o.key === "auto-accept"),
      "hidePersistentOption = true",
    );
    check(
      "目录进入本会话安全区域",
      agent.getAdditionalDirectories().includes(outsideDir),
      JSON.stringify(agent.getAdditionalDirectories()),
    );
    const persisted = await readFile(
      join(workdir, ".wave", "settings.local.json"),
      "utf-8",
    ).catch(() => "");
    check(
      "未写入配置文件（仅内存）",
      !persisted.includes(outsideDir),
      persisted
        ? "settings.local.json 存在，但不含该目录"
        : "settings.local.json 不存在",
    );
    console.log();

    // ── 场景 2：再写同一目录 → 选项承诺「允许本会话编辑」，应不再弹窗 ──
    console.log(bold("场景 2：再写同一目录下的另一个文件"));
    const beforeSecond = dialogs.length;
    await agent.sendMessage(
      `请用 Write 工具创建文件 ${secondPath}，内容为 "# second"。只做这一件事。`,
    );
    const secondPrompted = dialogs.length > beforeSecond;
    check(
      "该目录下的后续 Write 不再触发确认",
      !secondPrompted,
      secondPrompted
        ? yellow("仍然弹窗 —— default 模式下 Edit/Write 一律要确认")
        : "未弹窗",
    );
    console.log();

    // ── 场景 3：该目录下的只读 Bash → 安全区域也会影响命令判定 ──────────
    console.log(bold("场景 3：用 Bash 读该目录下的文件"));
    const beforeBash = dialogs.length;
    await agent.sendMessage(
      `请用 Bash 工具执行 cat ${notesPath}。只做这一件事。`,
    );
    check(
      "该目录下的只读 Bash 不再触发确认",
      dialogs.length === beforeBash,
      dialogs.length === beforeBash ? "未弹窗" : "仍然弹窗",
    );
    console.log();

    // ── 场景 4：安全区域内的写 → 仍然弹窗，但不给新选项 ────────────────
    console.log(bold("场景 4：写回工作目录内的文件（安全区域内）"));
    const beforeInside = dialogs.length;
    await agent.sendMessage(
      `请用 Write 工具创建文件 ${insidePath}，内容为 "# inside"。只做这一件事。`,
    );
    const insideCtx = dialogs[dialogs.length - 1]?.ctx;
    check(
      "安全区域内不提供新选项",
      dialogs.length > beforeInside &&
        !!insideCtx &&
        !insideCtx.outsideSafeZoneDirectory,
      insideCtx?.outsideSafeZoneDirectory
        ? `outsideSafeZoneDirectory = ${insideCtx.outsideSafeZoneDirectory}`
        : "default 模式下仍然弹窗（wave 既有行为），但无新选项",
    );
    console.log();

    console.log(bold("汇总"));
    console.log(`  弹窗次数: ${dialogs.length}`);
    console.log(
      `  ${failures === 0 ? green("全部断言通过") : red(`${failures} 条断言未通过`)}`,
    );
    console.log(
      dim(`  安全区域: ${JSON.stringify(agent.getAdditionalDirectories())}\n`),
    );
  } catch (error) {
    failures += 1;
    console.error(red("\n💥 运行出错:"), error);
  } finally {
    await agent.destroy();
    await rm(root, { recursive: true, force: true });
    console.log("Cleanup complete.");
    process.exit(failures === 0 ? 0 : 1);
  }
}

main().catch(async (error) => {
  console.error("💥 Unhandled error:", error);
  await agent.destroy();
  process.exit(1);
});
