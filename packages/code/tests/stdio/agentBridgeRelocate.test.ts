/**
 * 「换文件夹继续」的**真 SDK** 侧证明：搬完目录、改写转录头之后，会话确实被重新
 * 锚定到新目录 —— 也就是 `AgentBridge.restoreWorkdirFor` 用新目录作
 * `params.workdir` 恢复同一会话时原样返回新目录，而不是退回调用方目录。
 *
 * 为什么单独一个文件：`tests/stdio/agentBridge.test.ts` 整个 `wave-agent-sdk`
 * 都被 mock 掉了，那里的 `readSessionWorkdir` / `relocateSessionTranscript` 都是
 * 回放测试给定的值——用它证明「头改写生效」等于用 mock 证明 mock。这里跑真实现：
 * 真的往 `<SESSION_DIR>/<encodeWorkdir>/` 写一份带 metadata 头的转录，真的搬，
 * 再真的按头里的目录决定锚点。
 *
 * 隔离：本文件把 `os.homedir()` 固定成一次性的临时 HOME，于是 SDK 的 `SESSION_DIR`
 * 落在假 HOME 下的 `.wave/projects` 里，不碰真实用户的会话目录（同
 * `packages/agent-sdk/tests/services/relocateSessionTranscript.test.ts` 的手法）。
 *
 * 只碰 `restoreWorkdirFor` 这一个私有方法、不调 `initialize`：后者会真的建 Agent
 * （模型客户端、工具注册、配置读盘），而这条链要验的只是「按转录头选目录」这一步。
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { readSessionWorkdir, relocateSessionTranscript } from "wave-agent-sdk";

const fakeHome = vi.hoisted(() => ({ dir: "" }));

async function mockedOs(moduleId: "os" | "node:os") {
  const actual = await vi.importActual<typeof import("node:os")>(moduleId);
  if (!fakeHome.dir) {
    const { mkdtemp } = await import("node:fs/promises");
    const { join: joinPath } = await import("node:path");
    fakeHome.dir = await mkdtemp(
      joinPath(actual.tmpdir(), "wave-bridge-relocate-home-"),
    );
  }
  const homedir = () => fakeHome.dir;
  return { ...actual, homedir, default: { ...actual, homedir } };
}

vi.mock("os", () => mockedOs("os"));
vi.mock("node:os", () => mockedOs("node:os"));

const { AgentBridge } = await import("../../src/stdio/agentBridge.js");
const { logger } = await import("../../src/utils/logger.js");

type RestoreWorkdirFor = (
  params: { workdir?: string },
  restoreSessionId: string,
) => Promise<string | undefined>;

function createBridge(): InstanceType<typeof AgentBridge> {
  return new AgentBridge({ emit: () => {} });
}

/** `restoreWorkdirFor` 是私有的：这里只借它一步判定，不为测试改可见性。 */
function restoreWorkdirForOf(
  bridge: InstanceType<typeof AgentBridge>,
): RestoreWorkdirFor {
  return (
    bridge as unknown as { restoreWorkdirFor: RestoreWorkdirFor }
  ).restoreWorkdirFor.bind(bridge);
}

/** 造一个真的工作目录，返回 realpath —— 传进去的字符串就是它的真实路径。 */
async function makeWorkdir(name: string): Promise<string> {
  const dir = await fs.mkdtemp(join(fakeHome.dir, `wd-${name}-`));
  return fs.realpath(dir);
}

/**
 * 转录应当落在哪个绝对路径上。
 *
 * `generateSessionFilePath`（编码 workdir 的 project 目录）不在 SDK 公共面上，而
 * 本文件只用公共 API —— 于是用搬迁函数自己的返回值当探针：`fromWorkdir` 与
 * `toWorkdir` 相同时它不动文件，但照样算出 `to`。
 */
async function transcriptPathFor(
  sessionId: string,
  workdir: string,
): Promise<string> {
  const probe = await relocateSessionTranscript(sessionId, workdir, workdir);
  return probe.to;
}

/** 造一份带 metadata 头的转录（与 `createSession` 写的头同形状），返回路径。 */
async function seedTranscript(
  sessionId: string,
  workdir: string,
): Promise<string> {
  const filePath = await transcriptPathFor(sessionId, workdir);
  await fs.mkdir(dirname(filePath), { recursive: true });
  const header = {
    type: "metadata",
    workdir,
    createdAt: new Date().toISOString(),
    gitBranch: "main",
  };
  const message = {
    id: "msg-1",
    role: "user",
    blocks: [{ type: "text", content: "hello" }],
    timestamp: new Date().toISOString(),
  };
  await fs.writeFile(
    filePath,
    `${JSON.stringify(header)}\n${JSON.stringify(message)}\n`,
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

async function readLines(filePath: string): Promise<string[]> {
  const raw = await fs.readFile(filePath, "utf8");
  return raw.split("\n").filter((line) => line.length > 0);
}

afterAll(async () => {
  if (fakeHome.dir) await fs.rm(fakeHome.dir, { recursive: true, force: true });
});

describe("relocateSessionTranscript over the real SDK", () => {
  it("moves the transcript into the new project dir and rewrites the header", async () => {
    const oldDir = await makeWorkdir("old");
    const newDir = await makeWorkdir("new");
    const sessionId = randomUUID();
    const from = await seedTranscript(sessionId, oldDir);
    const to = await transcriptPathFor(sessionId, newDir);
    expect(to).not.toBe(from);

    const bridge = createBridge();
    const result = await bridge.handleRequest("relocateSessionTranscript", {
      sessionId,
      fromWorkdir: oldDir,
      toWorkdir: newDir,
    });

    // The bridge adds no fields and drops none: this is the SDK's answer.
    expect(result).toMatchObject({
      relocated: true,
      copiedFiles: 1,
      from,
      to,
      headerUpdated: true,
    });
    expect(await exists(from)).toBe(false);
    // Only the header line changed; the conversation bytes travelled verbatim.
    const lines = await readLines(to);
    expect(JSON.parse(lines[0])).toMatchObject({
      type: "metadata",
      workdir: newDir,
      gitBranch: "main",
    });
    expect(JSON.parse(lines[1])).toMatchObject({
      id: "msg-1",
      role: "user",
    });
  });

  it("re-anchors the session on the new directory: restoreWorkdirFor answers the new dir", async () => {
    const oldDir = await makeWorkdir("anchor-old");
    const newDir = await makeWorkdir("anchor-new");
    // A third, unrelated directory: the caller's cwd. It is what must NOT win —
    // without the header rewrite this is exactly where the session would land.
    const callerDir = await makeWorkdir("anchor-caller");
    const sessionId = randomUUID();
    await seedTranscript(sessionId, oldDir);
    const bridge = createBridge();
    await bridge.handleRequest("relocateSessionTranscript", {
      sessionId,
      fromWorkdir: oldDir,
      toWorkdir: newDir,
    });

    // The header really holds the new dir (this is what survives a restart).
    await expect(readSessionWorkdir(sessionId, callerDir)).resolves.toBe(
      newDir,
    );

    const restoreWorkdirFor = restoreWorkdirForOf(bridge);
    // The literal question: restoring with the new dir as params.workdir answers
    // the same dir back, not the old one and not the caller's.
    await expect(
      restoreWorkdirFor({ workdir: newDir }, sessionId),
    ).resolves.toBe(newDir);
    // And from a caller whose cwd is unrelated: the recorded dir is the answer,
    // so no fallback happens even though it is the caller that is "wrong".
    const warn = vi.spyOn(logger, "warn").mockReturnValue();
    try {
      await expect(
        restoreWorkdirFor({ workdir: callerDir }, sessionId),
      ).resolves.toBe(newDir);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("control: a transcript moved WITHOUT the header rewrite is exactly what falls back and warns", async () => {
    // Proves the assertions above are not vacuous: same file layout, same
    // directory, old workdir still in the header — and `restoreWorkdirFor` does
    // the thing the relocation exists to prevent (anchor at the caller's cwd,
    // because the recorded dir is gone).
    const oldDir = await makeWorkdir("control-old");
    const newDir = await makeWorkdir("control-new");
    const callerDir = await makeWorkdir("control-caller");
    const sessionId = randomUUID();
    const to = await seedTranscript(sessionId, newDir);
    const [header, ...rest] = await readLines(to);
    const rewritten = JSON.parse(header) as { workdir: string };
    rewritten.workdir = oldDir;
    await fs.writeFile(
      to,
      [`${JSON.stringify(rewritten)}\n`, ...rest.map((l) => `${l}\n`)].join(""),
      "utf8",
    );
    await fs.rm(oldDir, { recursive: true, force: true });

    const bridge = createBridge();
    const warn = vi.spyOn(logger, "warn").mockReturnValue();
    try {
      await expect(
        restoreWorkdirForOf(bridge)({ workdir: callerDir }, sessionId),
      ).resolves.toBe(callerDir);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(oldDir));
    } finally {
      warn.mockRestore();
    }
  });

  it("answers not_found when no transcript exists in any project dir", async () => {
    const newDir = await makeWorkdir("nowhere");
    const bridge = createBridge();

    const result = await bridge.handleRequest("relocateSessionTranscript", {
      sessionId: randomUUID(),
      fromWorkdir: await makeWorkdir("nowhere-src"),
      toWorkdir: newDir,
    });

    expect(result).toEqual({ ok: false, reason: "not_found" });
  });
});
