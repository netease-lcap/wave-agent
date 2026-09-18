/**
 * Real-host integration suite (Part B) — per-pane project settings.
 *
 * `getProjectSettings` / `setBuiltinPluginEnabled` / `getAgentsContent` /
 * `setAgentsContent` are the RPCs whose workdir must follow the *focused pane*
 * (PR #2152/#2155). Here the host runs against the real CLI, so the write can
 * be verified against the real files of each project on disk.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import * as path from "path";
import {
  assertNoUnexpectedRejections,
  clearFakeModelEndpoint,
  createRealHost,
  REALHOST_HOME,
  resetRealHostState,
  startFakeModelServer,
  useFakeModelEndpoint,
  type FakeModelServer,
  type RealHost,
} from "./realHostHarness";

let ctx: RealHost;
let model: FakeModelServer;
let dirA: string;
let dirB: string;

beforeEach(async () => {
  const dirs = resetRealHostState();
  dirA = dirs.dirA;
  dirB = dirs.dirB;
  model = await startFakeModelServer();
  model.reply("OK");
  // Point the real CLI at the local model server — no real LLM, no network.
  useFakeModelEndpoint(model.baseURL);
  ctx = createRealHost();
});

afterEach(async () => {
  await ctx.close();
  await model.close();
  clearFakeModelEndpoint();
  assertNoUnexpectedRejections();
});

/** pane-1 on dirA plus a second pane on dirB (two projects side by side). */
async function twoPanes(): Promise<string> {
  await ctx.host.handleWebviewMessage({ command: "desktopReady" });
  await ctx.host.handleWebviewMessage({
    command: "desktopSelectRecentWorkdir",
    path: dirA,
    host: "local",
  });
  await ctx.waitFor("setInitialState");
  // A split only makes sense once the first pane holds a conversation
  // (`desktopNewSessionInPane` no-ops on an empty session).
  await ctx.turn("pane-1 首条");

  await ctx.host.handleWebviewMessage({ command: "desktopNewSessionInPane" });
  const panes = await ctx.waitFor("desktopPanes", {
    predicate: (m) => (m.panes as unknown[]).length === 2,
  });
  const pane2 = (panes.panes as Array<{ paneId: string }>).find(
    (p) => p.paneId !== "pane-1",
  )?.paneId as string;

  await ctx.host.handleWebviewMessage({
    command: "desktopSelectRecentWorkdir",
    path: dirB,
    host: "local",
    paneId: pane2,
  });
  await ctx.waitFor("setInitialState", {
    predicate: (m) => m.paneId === pane2,
  });
  return pane2;
}

/** Project settings as the real CLI sees them for one pane. */
async function projectSettings(paneId: string) {
  ctx.clear();
  await ctx.host.handleWebviewMessage({
    command: "getProjectSettings",
    paneId,
  });
  return ctx.waitFor("projectSettings", {
    predicate: (m) => m.paneId === paneId,
  });
}

function projectSettingsFile(dir: string): string {
  return path.join(dir, ".wave", "settings.json");
}

/** Single pane on dirA holding one conversation (an agent must exist to delete). */
async function onePane(): Promise<void> {
  await ctx.host.handleWebviewMessage({ command: "desktopReady" });
  await ctx.host.handleWebviewMessage({
    command: "desktopSelectRecentWorkdir",
    path: dirA,
    host: "local",
  });
  await ctx.waitFor("setInitialState");
  await ctx.turn("首条");
}

/**
 * Create a user-level skill copy (`~/.wave/skills/<name>/SKILL.md` by default).
 *
 * `root` 可选 `.claude` / `.agents`：同名技能可以同时物理存在于多个用户级
 * 技能目录（发现阶段会合并成一条），#2092 的后半段就是「只删了一份，下一次
 * 重扫又冒出来」。
 */
function writeUserSkill(name: string, root = ".wave"): string {
  const dir = path.join(REALHOST_HOME, root, "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} 说明\n---\n\n${name} 正文\n`,
    "utf-8",
  );
  return dir;
}

/** Skill names of one discovery type from a `skillMetadataResponse`. */
function skillNames(message: { skills?: unknown }, type?: string): string[] {
  return ((message.skills ?? []) as Array<{ name: string; type?: string }>)
    .filter((s) => type === undefined || s.type === type)
    .map((s) => s.name);
}

/**
 * 某个 pane 的 **live 会话**当前可见的技能名（经真 CLI 的 `getSkillMetadata`
 * RPC，读的是该会话 Agent 自己的技能表）。用读取前的 mark 定位本次回包，避免
 * 匹配到上一轮的旧答复。
 */
async function paneSkillNames(paneId: string): Promise<string[]> {
  const start = ctx.messages.length;
  await ctx.host.handleWebviewMessage({ command: "getSkillMetadata", paneId });
  const reply = ctx.messages
    .slice(start)
    .find((m) => m.command === "skillMetadataResponse");
  return reply ? skillNames(reply).sort() : [];
}

/**
 * 连续读取技能列表，返回每轮采样到的个人技能名（已排序）。
 *
 * 设置页删除技能后会立刻再拉一次列表（`useSettingsList.refresh`），这次读取与
 * SDK 的删除后收敛刷新 / 文件 watcher 重扫是并发的——#2092 正是这次读取落在
 * 「重扫先清空共享缓存」的空窗口里，于是列表整段空白。逐轮采样能覆盖删除后那
 * 一段时间内的多次读取，而不是只赌单次读取的时序。
 */
async function samplePersonalSkills(rounds: number): Promise<string[][]> {
  const samples: string[][] = [];
  for (let i = 0; i < rounds; i += 1) {
    const start = ctx.messages.length;
    await ctx.host.handleWebviewMessage({
      command: "getSkillMetadata",
      paneId: "pane-1",
    });
    const reply = ctx.messages
      .slice(start)
      .find((m) => m.command === "skillMetadataResponse");
    if (reply) samples.push(skillNames(reply, "personal").sort());
    await new Promise((r) => setTimeout(r, 5));
  }
  return samples;
}

describe("real host · project settings follow the pane's project", () => {
  it("reads each pane's own project settings", async () => {
    const pane2 = await twoPanes();

    const a = await projectSettings("pane-1");
    const b = await projectSettings(pane2);

    expect(a.workdir).toBe(dirA);
    expect(b.workdir).toBe(dirB);
    expect(a.enabledPlugins).toEqual({});
    expect(b.enabledPlugins).toEqual({});
  });

  it("writes the setting into the focused pane's project only", async () => {
    const pane2 = await twoPanes();

    ctx.clear();
    await ctx.host.handleWebviewMessage({
      command: "setBuiltinPluginEnabled",
      paneId: pane2,
      pluginId: "sdd@builtin",
      enabled: true,
      scope: "project",
    });
    const written = await ctx.waitFor("projectSettings", {
      predicate: (m) => m.paneId === pane2,
    });

    expect(written.workdir).toBe(dirB);
    expect(written.enabledPlugins).toEqual({ "sdd@builtin": true });

    // The real project file of the focused pane's project changed…
    expect(
      JSON.parse(readFileSync(projectSettingsFile(dirB), "utf-8")),
    ).toEqual({ enabledPlugins: { "sdd@builtin": true } });
    // …and the other project was left untouched.
    expect(existsSync(projectSettingsFile(dirA))).toBe(false);

    // The other pane still reports its own project's (empty) settings.
    const a = await projectSettings("pane-1");
    expect(a.workdir).toBe(dirA);
    expect(a.enabledPlugins).toEqual({});
  });

  it("keeps both panes usable after the plugin change + /reload-plugins (no rebuild)", async () => {
    const pane2 = await twoPanes();
    const sessionsBefore = [
      ctx.paneSessionId("pane-1"),
      ctx.paneSessionId(pane2),
    ];

    await ctx.host.handleWebviewMessage({
      command: "setBuiltinPluginEnabled",
      paneId: pane2,
      pluginId: "sdd@builtin",
      enabled: true,
      scope: "project",
    });
    await ctx.waitFor("projectSettings", {
      predicate: (m) => m.paneId === pane2,
    });
    // 插件落盘不重建任何会话：只出现一次「待应用」提示（spec plugin
    //「插件变更的就地重载」场景 1）。
    const pending = await ctx.waitFor("showToast", {
      predicate: (m) =>
        JSON.stringify(m.toast).includes(
          "插件已变更。运行 /reload-plugins 使其生效。",
        ),
    });
    expect(pending).toBeTruthy();
    expect(ctx.paneSessionId("pane-1")).toBe(sessionsBefore[0]);
    expect(ctx.paneSessionId(pane2)).toBe(sessionsBefore[1]);

    // 换装前：pane-2 的 live 会话还没有插件技能（落盘只置了「待应用」信号，
    // 不换装——见上一个用例）。
    expect(await paneSkillNames(pane2)).not.toContain("sdd:specify");

    // 敲 /reload-plugins 就地换装：不重建 agent，只在同一 CLI 进程内把磁盘上的
    // 插件状态换进两个 live 会话。
    //
    // 注意这里不能 `ctx.clear()`：harness 的 `turn()` 把缓冲里那条 pane 的
    // `setInitialState` 当作「该 pane 已绑定会话、可以发消息」的就绪闸门（同款
    // 约束见 realHostCredentialWire.integration.test.ts 的 readBack 注释），而就地
    // 重载不重建会话 ⇒ 不会再补发一条 `setInitialState`。清空缓冲等于拆掉闸门，
    // 下面的 `turn()` 只能等到超时（此时缓冲里唯一匹配得到的消息就是那条 toast）。
    // 两处 toast 断言靠 predicate 的文案区分，本来就不需要清空缓冲。
    await ctx.host.handleWebviewMessage({ command: "reloadPlugins" });
    await ctx.waitFor("showToast", {
      predicate: (m) => JSON.stringify(m.toast).includes("插件已重载。"),
    });

    // 换装的真实信号（不只是 toast）：重载把磁盘上的启用记录换进了 **pane-2 那个
    // live 会话** —— 同一个 sessionId 下它的技能表多出 sdd@builtin 提供的
    // `sdd:specify`；而未启用该插件的 pane-1 会话不受影响（换装按各会话自己
    // workdir 的配置链读，不是给所有会话塞同一份）。只断言 toast 的话，把
    // handleReloadPlugins 改成「不调 CLI、只弹提示」也照样绿。
    expect(await paneSkillNames(pane2)).toContain("sdd:specify");
    expect(await paneSkillNames("pane-1")).not.toContain("sdd:specify");

    // 真 CLI 上项目文件已改（插件变更本身已生效），且两个 pane 的 sessionId 不变。
    expect(
      JSON.parse(readFileSync(projectSettingsFile(dirB), "utf-8")),
    ).toEqual({ enabledPlugins: { "sdd@builtin": true } });
    model.reply("重载后仍可用");
    const first = await ctx.turn("重载后 pane-1 消息");
    const second = await ctx.turn("重载后 pane-2 消息", pane2);

    expect(JSON.stringify(first)).toContain("重载后仍可用");
    expect(JSON.stringify(second)).toContain("重载后仍可用");
    expect(ctx.paneSessionId("pane-1")).toBe(sessionsBefore[0]);
    expect(ctx.paneSessionId(pane2)).toBe(sessionsBefore[1]);
  });

  it("插件变更只落盘 + 提示，本次不换装：两 pane 仍用原会话继续", async () => {
    const pane2 = await twoPanes();
    const sessionsBefore = [
      ctx.paneSessionId("pane-1"),
      ctx.paneSessionId(pane2),
    ];

    await ctx.host.handleWebviewMessage({
      command: "setBuiltinPluginEnabled",
      paneId: pane2,
      pluginId: "sdd@builtin",
      enabled: true,
      scope: "project",
    });
    await ctx.waitFor("projectSettings", {
      predicate: (m) => m.paneId === pane2,
    });
    await ctx.waitFor("showToast", {
      predicate: (m) =>
        JSON.stringify(m.toast).includes(
          "插件已变更。运行 /reload-plugins 使其生效。",
        ),
    });

    // 待应用信号没有任何「延迟重建」：两个 pane 的会话 id 原样保留。
    expect(ctx.paneSessionId("pane-1")).toBe(sessionsBefore[0]);
    expect(ctx.paneSessionId(pane2)).toBe(sessionsBefore[1]);
    // 真 CLI 上项目文件已改（变更落盘本身已生效），只是本会话还没换装。
    expect(
      JSON.parse(readFileSync(projectSettingsFile(dirB), "utf-8")),
    ).toEqual({ enabledPlugins: { "sdd@builtin": true } });

    model.reply("旧会话仍可用");
    expect(JSON.stringify(await ctx.turn("稍后重载前 pane-1 消息"))).toContain(
      "旧会话仍可用",
    );
  });

  it("reads and writes project-level AGENTS.md per pane", async () => {
    writeFileSync(path.join(dirA, "AGENTS.md"), "A 项目规则\n", "utf-8");
    const pane2 = await twoPanes();

    ctx.clear();
    await ctx.host.handleWebviewMessage({
      command: "getAgentsContent",
      scope: "project",
      paneId: "pane-1",
    });
    const read = await ctx.waitFor("agentsContentResponse", {
      predicate: (m) => m.scope === "project",
    });
    expect(read.content).toBe("A 项目规则\n");

    // Save from the *other* pane → the other project's file.
    ctx.clear();
    await ctx.host.handleWebviewMessage({
      command: "setAgentsContent",
      scope: "project",
      paneId: pane2,
      content: "B 项目规则\n",
    });
    await ctx.waitFor("agentsContentSaved", {
      predicate: (m) => m.scope === "project",
    });

    expect(readFileSync(path.join(dirB, "AGENTS.md"), "utf-8")).toBe(
      "B 项目规则\n",
    );
    expect(readFileSync(path.join(dirA, "AGENTS.md"), "utf-8")).toBe(
      "A 项目规则\n",
    );
    expect(
      ctx
        .of("showToast")
        .some((m) => JSON.stringify(m.toast).includes("保存成功")),
    ).toBe(true);

    // Read back through the same pane — the CLI serves the project file.
    ctx.clear();
    await ctx.host.handleWebviewMessage({
      command: "getAgentsContent",
      scope: "project",
      paneId: pane2,
    });
    const reread = await ctx.waitFor("agentsContentResponse", {
      predicate: (m) => m.scope === "project",
    });
    expect(reread.content).toBe("B 项目规则\n");
  });

  /**
   * Regression（Bug #2092「删除技能后列表显示为空，切 tab 才恢复」）：
   *
   * 旧实现两条缺陷都在本用例的观测点上：①重扫先清空共享缓存再异步 discover
   * （`refreshSkills` 非原子），删除后的回读会落在空窗口里 —— 列表整段空白；
   * ②同名技能分布在多个用户级技能目录时只删一份，下一次重扫又冒出来（表现为
   * 「切 tab 才恢复」的另一面：删不掉）。修复（b7c0899a）让重扫原子交换缓存、
   * 删除后 await 收敛，并按作用域把同名副本一次删净。
   *
   * 本用例在**真 host + 真 CLI**上跑：同名技能同时放在 `~/.wave` 与 `~/.claude`
   * 两个用户级技能目录，断言删除后 ①回发列表非空且不含该技能 ②删除后一段时间
   * 内的连续读取都不含该技能、末轮恰好只剩另一个 ③两份目录都已从磁盘删除。
   */
  it("does not blank or resurrect the skill list after a delete (#2092)", async () => {
    const skillAWave = writeUserSkill("skill-a");
    const skillAClaude = writeUserSkill("skill-a", ".claude");
    writeUserSkill("skill-b");
    await onePane();

    ctx.clear();
    await ctx.host.handleWebviewMessage({
      command: "getSkillMetadata",
      paneId: "pane-1",
    });
    const before = await ctx.waitFor("skillMetadataResponse", {
      predicate: (m) => m.paneId === "pane-1",
    });
    expect(skillNames(before, "personal").sort()).toEqual([
      "skill-a",
      "skill-b",
    ]);

    ctx.clear();
    await ctx.host.handleWebviewMessage({
      command: "deleteSkill",
      paneId: "pane-1",
      name: "skill-a",
    });
    const after = await ctx.waitFor("skillMetadataResponse", {
      predicate: (m) => m.paneId === "pane-1",
    });

    // 删除后回发的列表必须已经反映删除结果，而不是瞬时空列表：
    // 非空 + 不含已删技能 + 仍含剩余技能。
    expect(after.skills as unknown[]).not.toHaveLength(0);
    expect(skillNames(after, "personal")).toEqual(["skill-b"]);

    // 删除后一段时间内连续读取（覆盖删除后重扫 / 文件 watcher 那一轮）：
    // 任何一轮都不得为空，也不得让被删技能复活，末轮必须已收敛为只剩 skill-b。
    const samples = await samplePersonalSkills(30);
    expect(samples.filter((s) => s.length === 0)).toEqual([]);
    expect(samples.filter((s) => s.includes("skill-a"))).toEqual([]);
    expect(samples.at(-1)).toEqual(["skill-b"]);

    // 磁盘上同名技能的所有副本都被删除（不是只从内存列表里消失，也不是只删一份）
    expect(existsSync(skillAWave)).toBe(false);
    expect(existsSync(skillAClaude)).toBe(false);
    // 删除成功经全局 toast 提示（spec「设置页反馈语义」）
    expect(
      ctx
        .of("showToast")
        .some((m) => JSON.stringify(m.toast).includes("已删除技能「skill-a」")),
    ).toBe(true);
  });
});
