/**
 * Real-host integration suite (Part B) — 新对话里先选权限档位，再发第一条消息。
 *
 * 用户上报的现象只在「会话还没建起来」的那段窗口里出现：输入框下方那个下拉已经
 * 能用，但 `setPermissionMode` 找不到可写的 agent，选择被静默丢掉，会话于是按配置
 * 默认档建起来。这个窗口是**跨进程**的（`wave --stdio` 子进程还在 spawn、`initialize`
 * 还没回来），所以单测层（mock 掉 StdioAgent）可以全绿而真机仍然坏 —— 这里用真的
 * `DesktopHost` + 真子进程 + 真工具执行来钉住它。
 *
 * 判据落在**工具上**而不是消息文案：档位只改变「同一个工具要不要先问人」，所以让
 * 假模型请求一次 `Write`，看文件是否落盘、有没有弹确认卡 —— 这正是用户说的「第一条
 * 消息仍按修改前询问执行」。
 */

import { existsSync } from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertNoUnexpectedRejections,
  clearFakeModelEndpoint,
  createRealHost,
  resetRealHostState,
  startFakeModelServer,
  useFakeModelEndpoint,
  type FakeModelServer,
  type RealHost,
} from "./realHostHarness";

let ctx: RealHost;
let model: FakeModelServer;
let dirA: string;

beforeEach(async () => {
  const dirs = resetRealHostState();
  dirA = dirs.dirA;
  model = await startFakeModelServer();
  useFakeModelEndpoint(model.baseURL);
  ctx = createRealHost();
});

afterEach(async () => {
  await ctx.close();
  await model.close();
  clearFakeModelEndpoint();
  assertNoUnexpectedRejections();
});

/** 等第一个分屏绑上真会话（`initialize` 已经回来）。 */
async function bindSession(dir: string) {
  await ctx.host.handleWebviewMessage({ command: "desktopReady" });
  await ctx.host.handleWebviewMessage({
    command: "desktopSelectRecentWorkdir",
    path: dir,
    host: "local",
  });
  return ctx.waitFor("setInitialState", {
    predicate: (m) => Boolean(m.session),
  });
}

describe("real host · 新对话的权限档位", () => {
  it("空白态选的档位交给真会话：第一条消息里的 Write 不弹确认直接落盘", async () => {
    const target = path.join(dirA, "bypass-written.txt");

    await ctx.host.handleWebviewMessage({ command: "desktopReady" });
    // 空白态：还没有会话能承载这条命令 —— 上报里的起点。
    expect(ctx.paneSessionId()).toBeUndefined();

    await ctx.host.handleWebviewMessage({
      command: "setPermissionMode",
      mode: "bypassPermissions",
    });
    // 输入框上的档位先跟着用户走。
    expect(ctx.last("updatePermissionMode")?.mode).toBe("bypassPermissions");

    // 选完档位才真正建会话（用户挑目录 / 点新对话）。
    await ctx.host.handleWebviewMessage({
      command: "desktopSelectRecentWorkdir",
      path: dirA,
      host: "local",
    });
    const bound = await ctx.waitFor("setInitialState", {
      predicate: (m) => Boolean(m.session),
    });
    // 真 CLI 报回来的档位就是用户选的那一档。
    expect(bound.permissionMode).toBe("bypassPermissions");

    // 第一条消息：模型要求写文件 —— 跳过权限确认就该直接写。
    model.toolCall("Write", { file_path: target, content: "hello" });
    model.reply("回复：写好了");
    const turn = await ctx.turn("把 hello 写进文件");
    expect(turn.filter((m) => m.command === "showConfirmation")).toHaveLength(
      0,
    );
    expect(existsSync(target)).toBe(true);
  });

  it("没选过就跟随 permissions.defaultMode：同一条消息先弹确认、文件不落盘", async () => {
    const target = path.join(dirA, "default-pending.txt");

    const bound = await bindSession(dirA);
    // 没有手动选过 → 真 CLI 报的是配置默认档，不许被宿主的记账写死成别的值。
    expect(bound.permissionMode ?? "default").toBe("default");

    model.toolCall("Write", { file_path: target, content: "hello" });
    model.reply("回复：先问问你");
    // 不等这一轮收口：`default` 档下这条消息要等人点确认，await 会挂到天荒地老。
    void ctx.host.handleWebviewMessage({
      command: "sendMessage",
      text: "把 hello 写进文件",
    });

    const confirmation = await ctx.waitFor("showConfirmation");
    expect(confirmation.permissionMode).toBe("default");
    expect(existsSync(target)).toBe(false);

    // 拒绝掉，让这一轮收口（否则残留的确认会挂在会话上）。
    await ctx.host.handleWebviewMessage({
      command: "confirmationResponse",
      confirmationId: confirmation.confirmationId,
      approved: false,
    });
    expect(existsSync(target)).toBe(false);
  });
});
