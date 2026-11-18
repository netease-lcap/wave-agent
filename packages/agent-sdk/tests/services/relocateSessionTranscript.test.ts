/**
 * 「换文件夹继续」的转录搬迁：`relocateSessionTranscript`，外加两条「目录缺失时
 * 尽力而为」的探针（桌面端「点击缺失会话仍能进入」的前提）。
 *
 * 隔离：`setup.ts` 把 `os.homedir()` 固定成 `/tmp`，这里在**本文件**重新 mock 成
 * 一次性的临时 HOME，于是 `SESSION_DIR` 落在假 HOME 下的 `.wave/projects` 里，
 * 用例之间不互相踩、也不碰真实用户的会话目录。
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import { dirname, join } from "path";
import type { Message } from "../../src/types/index.js";

const fakeHome = vi.hoisted(() => ({ dir: "" }));

async function mockedOs(moduleId: "os" | "node:os") {
  const actual = await vi.importActual<typeof import("os")>(moduleId);
  if (!fakeHome.dir) {
    const { mkdtemp } = await import("fs/promises");
    const { join: joinPath } = await import("path");
    fakeHome.dir = await mkdtemp(
      joinPath(actual.tmpdir(), "wave-relocate-home-"),
    );
  }
  const homedir = () => fakeHome.dir;
  return { ...actual, homedir, default: { ...actual, homedir } };
}

vi.mock("os", () => mockedOs("os"));
vi.mock("node:os", () => mockedOs("node:os"));

const {
  SESSION_DIR,
  generateSessionFilePath,
  relocateSessionTranscript,
  readSessionWorkdir,
  loadSessionFromJsonl,
} = await import("../../src/services/session.js");

const scratchDirs: string[] = [];

/** 造一个临时工作目录；返回 realpath，于是「传进去的字符串」就是它的真实路径。 */
async function makeWorkdir(name: string): Promise<string> {
  const dir = await fs.mkdtemp(join(fakeHome.dir, `wd-${name}-`));
  const real = await fs.realpath(dir);
  scratchDirs.push(real, dir);
  return real;
}

function messageLine(id: string, role: "user" | "assistant", text: string) {
  const message: Message = {
    id,
    role,
    blocks: [{ type: "text", content: text }],
    timestamp: new Date().toISOString(),
  };
  return `${JSON.stringify(message)}\n`;
}

/** 造一份带 metadata 头的转录（与 `createSession` 写的头同形状），返回它的路径。 */
async function seedTranscript(
  sessionId: string,
  workdir: string,
  extraLines: string[] = [],
): Promise<string> {
  const filePath = await generateSessionFilePath(sessionId, workdir);
  await fs.mkdir(dirname(filePath), { recursive: true });
  const header = {
    type: "metadata",
    workdir,
    createdAt: new Date().toISOString(),
    gitBranch: "main",
  };
  await fs.writeFile(
    filePath,
    [JSON.stringify(header), ...extraLines].map((line) => `${line}\n`).join(""),
    "utf8",
  );
  return filePath;
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

afterAll(async () => {
  for (const dir of scratchDirs) {
    await fs.rm(dir, { recursive: true, force: true });
  }
  if (fakeHome.dir) {
    await fs.rm(fakeHome.dir, { recursive: true, force: true });
  }
});

describe("relocateSessionTranscript", () => {
  it("把转录搬到新目录：源移除、目标生成、头里的 workdir 换成新目录、其余字节不变", async () => {
    const sessionId = randomUUID();
    const fromWorkdir = await makeWorkdir("from");
    const toWorkdir = await makeWorkdir("to");
    const sourcePath = await seedTranscript(sessionId, fromWorkdir, [
      messageLine("m1", "user", "第一句"),
      messageLine("m2", "assistant", "第二句"),
    ]);
    const sourceBytes = await fs.readFile(sourcePath, "utf8");
    const sourceSize = (await fs.stat(sourcePath)).size;

    const result = await relocateSessionTranscript(
      sessionId,
      fromWorkdir,
      toWorkdir,
    );

    const expectedTarget = await generateSessionFilePath(sessionId, toWorkdir);
    expect(result.relocated).toBe(true);
    expect(result.copiedFiles).toBe(1);
    expect(result.headerUpdated).toBe(true);
    expect(result.from).toBe(sourcePath);
    expect(result.to).toBe(expectedTarget);

    // 源没了、目标在 —— 原位置不得留下同一会话的第二份。
    expect(await exists(sourcePath)).toBe(false);
    expect(await exists(expectedTarget)).toBe(true);

    const targetBytes = await fs.readFile(expectedTarget, "utf8");
    const [targetHeader] = targetBytes.split("\n");
    const parsedHeader = JSON.parse(targetHeader) as Record<string, unknown>;
    expect(parsedHeader.workdir).toBe(toWorkdir);
    // 其余字段逐字保留（`createdAt` / `gitBranch` 与消息一行不差）。
    expect(parsedHeader.createdAt).toBeTruthy();
    expect(parsedHeader.gitBranch).toBe("main");
    expect(targetBytes.slice(targetBytes.indexOf("\n"))).toBe(
      sourceBytes.slice(sourceBytes.indexOf("\n")),
    );
    // 字节数 = 源字节数 + 头行长度差：除头以外没有丢字节。
    const sizeDelta =
      Buffer.byteLength(targetHeader, "utf8") -
      Buffer.byteLength(
        sourceBytes.slice(0, sourceBytes.indexOf("\n")),
        "utf8",
      );
    expect((await fs.stat(expectedTarget)).size).toBe(sourceSize + sizeDelta);
  });

  it("搬迁后 readSessionWorkdir 从一个无关目录也能答出新目录（跨 project 兜底）", async () => {
    const sessionId = randomUUID();
    const fromWorkdir = await makeWorkdir("from");
    const toWorkdir = await makeWorkdir("to");
    const unrelated = await makeWorkdir("unrelated");
    await seedTranscript(sessionId, fromWorkdir, [
      messageLine("m1", "user", "hi"),
    ]);

    expect(await readSessionWorkdir(sessionId, unrelated)).toBe(fromWorkdir);

    await relocateSessionTranscript(sessionId, fromWorkdir, toWorkdir);

    expect(await readSessionWorkdir(sessionId, unrelated)).toBe(toWorkdir);
  });

  it("源转录不存在时不抛错：relocated:false，to 仍按目标口径算出来", async () => {
    const sessionId = randomUUID();
    const fromWorkdir = await makeWorkdir("gone");
    const toWorkdir = await makeWorkdir("to");

    const result = await relocateSessionTranscript(
      sessionId,
      fromWorkdir,
      toWorkdir,
    );

    expect(result).toEqual({
      relocated: false,
      copiedFiles: 0,
      to: await generateSessionFilePath(sessionId, toWorkdir),
      headerUpdated: false,
    });
    expect(await exists(result.to)).toBe(false);
  });

  it("转录在别的 project 目录里（fromWorkdir 只是查找起点）时也能找到并搬走", async () => {
    const sessionId = randomUUID();
    const originalWorkdir = await makeWorkdir("original");
    const staleWorkdir = await makeWorkdir("stale");
    const toWorkdir = await makeWorkdir("to");
    const sourcePath = await seedTranscript(sessionId, originalWorkdir);

    const result = await relocateSessionTranscript(
      sessionId,
      staleWorkdir,
      toWorkdir,
    );

    expect(result.relocated).toBe(true);
    expect(result.from).toBe(sourcePath);
    expect(await exists(sourcePath)).toBe(false);
    expect(await exists(result.to)).toBe(true);
  });

  it("fromWorkdir 与 toWorkdir 解析后相同：一个字节都不动", async () => {
    const sessionId = randomUUID();
    const workdir = await makeWorkdir("same");
    const sourcePath = await seedTranscript(sessionId, workdir, [
      messageLine("m1", "user", "别动我"),
    ]);
    const before = await fs.readFile(sourcePath);
    const beforeStat = await fs.stat(sourcePath);

    const result = await relocateSessionTranscript(
      sessionId,
      workdir,
      `${workdir}/`,
    );

    expect(result.relocated).toBe(false);
    expect(result.copiedFiles).toBe(0);
    expect(result.headerUpdated).toBe(true);
    expect(result.to).toBe(sourcePath);
    expect((await fs.readFile(sourcePath)).equals(before)).toBe(true);
    expect((await fs.stat(sourcePath)).mtimeMs).toBe(beforeStat.mtimeMs);
  });

  it("目标 project 目录不存在时自动创建", async () => {
    const sessionId = randomUUID();
    const fromWorkdir = await makeWorkdir("from");
    const toWorkdir = await makeWorkdir("to");
    const expectedTarget = await generateSessionFilePath(sessionId, toWorkdir);
    expect(await exists(dirname(expectedTarget))).toBe(false);

    const sourcePath = await seedTranscript(sessionId, fromWorkdir);
    const result = await relocateSessionTranscript(
      sessionId,
      fromWorkdir,
      toWorkdir,
    );

    expect(result.relocated).toBe(true);
    expect(await exists(expectedTarget)).toBe(true);
    expect(await exists(sourcePath)).toBe(false);
    expect(SESSION_DIR.startsWith(fakeHome.dir)).toBe(true);
  });

  it("老转录没有 metadata 头：headerUpdated:false，内容逐字节照搬、不补头", async () => {
    const sessionId = randomUUID();
    const fromWorkdir = await makeWorkdir("legacy-from");
    const toWorkdir = await makeWorkdir("legacy-to");
    const sourcePath = await generateSessionFilePath(sessionId, fromWorkdir);
    await fs.mkdir(dirname(sourcePath), { recursive: true });
    const legacyContent = `${messageLine("m1", "user", "老会话")}${messageLine("m2", "assistant", "老回答")}`;
    await fs.writeFile(sourcePath, legacyContent, "utf8");

    const result = await relocateSessionTranscript(
      sessionId,
      fromWorkdir,
      toWorkdir,
    );

    expect(result.relocated).toBe(true);
    expect(result.copiedFiles).toBe(1);
    expect(result.headerUpdated).toBe(false);
    expect(await fs.readFile(result.to, "utf8")).toBe(legacyContent);
    // 不补头 ⇒ 重启后 readSessionWorkdir 仍然问不到目录（调用方据此告警）。
    expect(await readSessionWorkdir(sessionId, toWorkdir)).toBeUndefined();
  });

  it("目标位置已有同名转录时抛错，源与目标都不动", async () => {
    const sessionId = randomUUID();
    const fromWorkdir = await makeWorkdir("from");
    const toWorkdir = await makeWorkdir("to");
    const sourcePath = await seedTranscript(sessionId, fromWorkdir, [
      messageLine("m1", "user", "源"),
    ]);
    const targetPath = await seedTranscript(sessionId, toWorkdir, [
      messageLine("m0", "user", "目标里已有的那份"),
    ]);
    const sourceBefore = await fs.readFile(sourcePath, "utf8");
    const targetBefore = await fs.readFile(targetPath, "utf8");

    await expect(
      relocateSessionTranscript(sessionId, fromWorkdir, toWorkdir),
    ).rejects.toThrow(/target already exists/);

    expect(await fs.readFile(sourcePath, "utf8")).toBe(sourceBefore);
    expect(await fs.readFile(targetPath, "utf8")).toBe(targetBefore);
  });

  it("目标落点被同名目录占住时回滚：源不动、目标不落地、临时文件清空", async () => {
    const sessionId = randomUUID();
    const fromWorkdir = await makeWorkdir("from");
    const toWorkdir = await makeWorkdir("to");
    const sourcePath = await seedTranscript(sessionId, fromWorkdir, [
      messageLine("m1", "user", "源"),
    ]);
    const sourceBefore = await fs.readFile(sourcePath, "utf8");
    // 子代理转录排在建搬名单前面，于是"第一个撞墙的"是它。
    const companionSource = join(
      dirname(sourcePath),
      `subagent-${sessionId}.jsonl`,
    );
    const companionLine = messageLine("s1", "user", "子代理");
    await fs.writeFile(companionSource, companionLine, "utf8");

    const expectedTarget = await generateSessionFilePath(sessionId, toWorkdir);
    const targetDir = dirname(expectedTarget);
    const blockedTarget = join(targetDir, `subagent-${sessionId}.jsonl`);
    // 在**目标**一侧的伴随转录落点放一个同名目录：实现只检查源侧有没有这份伴随
    // 转录（`findCompanionTranscripts` 不看目标侧），所以阶段 1 会把两份临时
    // 文件都写出来，直到阶段 2 的 `rename` 才撞上它。Windows 上 `rename`
    // 文件到已存在目录报 EPERM、POSIX 报 EISDIR —— 都是失败，只是码不同。
    // 不用目录权限造这个失败：Windows 上权限位不拦人（`chmod 0o500` 的目录里
    // 照样能建文件），那样搬迁会一路成功，连源都被删掉。
    await fs.mkdir(blockedTarget, { recursive: true });

    await expect(
      relocateSessionTranscript(sessionId, fromWorkdir, toWorkdir),
    ).rejects.toThrow(/Failed to relocate session/);

    // 一份源都没删：主转录与子代理转录都还在，一个字节都没动。
    expect(await fs.readFile(sourcePath, "utf8")).toBe(sourceBefore);
    expect(await fs.readFile(companionSource, "utf8")).toBe(companionLine);
    // 主转录的落点没留下文件，占位目录里也没被塞进东西。
    expect(await exists(expectedTarget)).toBe(false);
    expect(await fs.readdir(blockedTarget)).toEqual([]);
    // 阶段 1 已经写出的临时文件必须被回滚清掉。
    expect(
      (await fs.readdir(targetDir)).filter((name) => name.includes(".tmp.")),
    ).toEqual([]);
  });

  it("源读不出来（源位置是个同名目录）时清掉临时文件、源保持原样", async () => {
    const sessionId = randomUUID();
    const fromWorkdir = await makeWorkdir("from");
    const toWorkdir = await makeWorkdir("to");
    const expectedTarget = await generateSessionFilePath(sessionId, toWorkdir);
    const targetDir = dirname(expectedTarget);
    // 源位置放一个同名**目录**：`pathExists(from)` 照样为真（实现靠它定位源），
    // 而 `createReadStream(dir)` 在 open 之后读取时抛 EISDIR —— Windows 与
    // POSIX 都是这个行为（实测过，不是靠权限位造的：Windows 上 `chmod 0o000`
    // 的文件照样读得出来）。于是失败发生在 `createWriteStream` 已经把临时文件
    // 建出来之后，正是这条用例要测的顺序。
    const sourcePath = await generateSessionFilePath(sessionId, fromWorkdir);
    await fs.mkdir(sourcePath, { recursive: true });
    const sourceSentinel = join(sourcePath, "keep.txt");
    await fs.writeFile(sourceSentinel, "源仍在", "utf8");

    // `EISDIR` 出现在消息里 = 失败确实发生在「读源」这一步，而不是后面
    // 「删源」那一步（后者是 `could not remove ...`：源是个目录，删它也会失败，
    // 但那时临时文件已经被 rename 走了，断言会一起空转）。
    await expect(
      relocateSessionTranscript(sessionId, fromWorkdir, toWorkdir),
    ).rejects.toThrow(/Failed to relocate session[\s\S]*EISDIR/);

    // 临时文件已经建出来了（`createWriteStream` 先开文件）⇒ 搬家失败必须把它清掉。
    expect(
      (await fs.readdir(targetDir)).filter((name) => name.includes(".tmp.")),
    ).toEqual([]);
    expect(await exists(expectedTarget)).toBe(false);
    // 源一个字节都还没动：它还在、里面的东西也还在。
    expect((await fs.stat(sourcePath)).isDirectory()).toBe(true);
    expect(await fs.readFile(sourceSentinel, "utf8")).toBe("源仍在");
  });

  it("可归属的子代理转录一起搬；归不了的同目录子代理转录不碰", async () => {
    const sessionId = randomUUID();
    const otherSessionId = randomUUID();
    const fromWorkdir = await makeWorkdir("from");
    const toWorkdir = await makeWorkdir("to");
    const sourcePath = await seedTranscript(sessionId, fromWorkdir, [
      messageLine("m1", "user", "主会话"),
    ]);
    const sourceProjectDir = dirname(sourcePath);
    const ownSubagent = join(sourceProjectDir, `subagent-${sessionId}.jsonl`);
    const foreignSubagent = join(
      sourceProjectDir,
      `subagent-${otherSessionId}.jsonl`,
    );
    // 子代理的 id 是独立生成的 ⇒ 只有文件名里带本会话 id 的那份能归属。
    await fs.writeFile(ownSubagent, messageLine("s1", "user", "子代理"));
    await fs.writeFile(
      foreignSubagent,
      messageLine("s2", "user", "别人的子代理"),
    );

    const result = await relocateSessionTranscript(
      sessionId,
      fromWorkdir,
      toWorkdir,
    );

    const targetProjectDir = dirname(result.to);
    expect(result.relocated).toBe(true);
    expect(result.copiedFiles).toBe(2);
    expect(await exists(sourcePath)).toBe(false);
    expect(await exists(ownSubagent)).toBe(false);
    expect(
      await exists(join(targetProjectDir, `subagent-${sessionId}.jsonl`)),
    ).toBe(true);
    // 归不了的那份原地不动，也没有被复制过去。
    expect(await exists(foreignSubagent)).toBe(true);
    expect(
      await exists(join(targetProjectDir, `subagent-${otherSessionId}.jsonl`)),
    ).toBe(false);
  });
});

describe("目录缺失时的尽力而为（桌面端「点击缺失会话仍能进入」的前提）", () => {
  it("用一个已被删除的工作目录恢复会话不抛错，历史照常读到", async () => {
    const sessionId = randomUUID();
    const workdir = await makeWorkdir("deleted");
    await seedTranscript(sessionId, workdir, [
      messageLine("m1", "user", "目录还在时的第一句"),
      messageLine("m2", "assistant", "目录还在时的第二句"),
    ]);
    await fs.rm(workdir, { recursive: true, force: true });
    expect(await exists(workdir)).toBe(false);

    const sessionData = await loadSessionFromJsonl(sessionId, workdir);

    expect(sessionData).not.toBeNull();
    expect(sessionData?.messages.map((message) => message.id)).toEqual([
      "m1",
      "m2",
    ]);
    // 目录问得到（只是那个目录已经不在了）：`readSessionWorkdir` 也不抛错。
    expect(await readSessionWorkdir(sessionId, workdir)).toBe(workdir);

    // 搬到新目录后再用同一个（已删除的）目录当起点：仍然能载入，且锚点已换新。
    const toWorkdir = await makeWorkdir("after-relocate");
    await relocateSessionTranscript(sessionId, workdir, toWorkdir);
    const relocated = await loadSessionFromJsonl(sessionId, workdir);
    expect(relocated?.messages.map((message) => message.id)).toEqual([
      "m1",
      "m2",
    ]);
    expect(await readSessionWorkdir(sessionId, workdir)).toBe(toWorkdir);
  });
});
