import { describe, it, expect, vi, beforeEach } from "vitest";
import * as os from "os";
import * as path from "path";
import { app } from "electron";
import { c as createTarArchive } from "tar";
import {
  defaultSessionArchivePath,
  sessionArchiveFileName,
  writeSessionArchive,
} from "../src/main/exportSessionArchive.js";

/**
 * 桌面端 `/export` 的落盘一半：把「原始字节 + 可读版 + 清单」打成一个
 * `.tar.gz`。内容从哪儿来不归这里管（远端会话的转录根本不在本机），
 * 这里只负责**原样写下去、不静默丢东西、出错也要收拾干净**。
 */

vi.mock("fs", () => ({
  mkdtempSync: vi.fn(() => "/tmp/wave-session-export-test"),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  rmSync: vi.fn(),
}));

vi.mock("tar", () => ({ c: vi.fn(async () => undefined) }));

const fs = await import("fs");

const STAGE = path.resolve("/tmp/wave-session-export-test");
const DESKTOP = path.resolve("/fake/home/Desktop");
const TARGET = path.join(DESKTOP, "chosen.tar.gz");
const SESSION_ID = "1a2b3c4d-0000-4000-8000-000000000000";

const CONTENTS = {
  jsonl: Buffer.from('{"id":"m1","role":"user"}\n', "utf8"),
  markdown: "# 会话记录\n",
  manifestJson: '{ "messages": 1 }\n',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(app.getPath).mockImplementation((name: string) =>
    name === "desktop" ? DESKTOP : "/tmp/wave-desktop-test-userData",
  );
  vi.mocked(fs.mkdtempSync).mockReturnValue(STAGE);
});

describe("sessionArchiveFileName / defaultSessionArchivePath", () => {
  it("本地时间戳 + 会话 id 前 8 位，两次导出不会同名", () => {
    const date = new Date(2026, 9, 22, 15, 30, 12); // month is 0-based

    expect(sessionArchiveFileName(date, SESSION_ID)).toBe(
      "wave-session-20261022-153012-1a2b3c4d.tar.gz",
    );
  });

  it("默认落在桌面", () => {
    const date = new Date(2026, 0, 2, 3, 4, 5);

    expect(defaultSessionArchivePath(date, SESSION_ID)).toBe(
      path.join(DESKTOP, "wave-session-20260102-030405-1a2b3c4d.tar.gz"),
    );
  });

  it("没有桌面目录时退回 home，不让「保存」对话框打不开", () => {
    vi.mocked(app.getPath).mockImplementationOnce(() => {
      throw new Error("no desktop");
    });

    expect(
      defaultSessionArchivePath(new Date(2026, 0, 2, 3, 4, 5), SESSION_ID),
    ).toBe(
      path.join(os.homedir(), "wave-session-20260102-030405-1a2b3c4d.tar.gz"),
    );
  });
});

describe("writeSessionArchive", () => {
  it("三样东西按「原始 → 可读 → 清单」的顺序进归档，原始字节一个字节都不动", async () => {
    await expect(writeSessionArchive(TARGET, CONTENTS)).resolves.toBe(TARGET);

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      path.join(STAGE, "transcript.jsonl"),
      CONTENTS.jsonl,
    );

    const [options, entries] = vi.mocked(createTarArchive).mock
      .calls[0] as unknown as [
      { gzip?: boolean; file?: string; cwd?: string },
      string[],
    ];
    expect(options).toMatchObject({ gzip: true, file: TARGET, cwd: STAGE });
    // 归档里的路径必须相对暂存根 —— 否则包里会带上用户的名字。
    expect(entries).toEqual([
      "transcript.jsonl",
      "transcript.md",
      "manifest.json",
    ]);

    // 目标目录哪怕是从对话框里手敲出来的，也要能建出来。
    expect(fs.mkdirSync).toHaveBeenCalledWith(path.dirname(TARGET), {
      recursive: true,
    });
    expect(fs.rmSync).toHaveBeenCalledWith(STAGE, {
      recursive: true,
      force: true,
    });
  });

  it("原始转录超过上限时（jsonl 为 null）只打包可读版与清单", async () => {
    await writeSessionArchive(TARGET, { ...CONTENTS, jsonl: null });

    const [, entries] = vi.mocked(createTarArchive).mock
      .calls[0] as unknown as [unknown, string[]];
    expect(entries).toEqual(["transcript.md", "manifest.json"]);
    expect(fs.writeFileSync).not.toHaveBeenCalledWith(
      path.join(STAGE, "transcript.jsonl"),
      expect.anything(),
    );
  });

  it("打包失败也要清掉暂存目录，并把错误抛给调用方", async () => {
    vi.mocked(createTarArchive).mockRejectedValueOnce(
      new Error("EACCES: permission denied"),
    );

    await expect(writeSessionArchive(TARGET, CONTENTS)).rejects.toThrow(
      "EACCES",
    );

    expect(fs.rmSync).toHaveBeenCalledWith(STAGE, {
      recursive: true,
      force: true,
    });
  });
});
