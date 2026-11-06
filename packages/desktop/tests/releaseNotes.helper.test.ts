import { describe, it, expect } from "vitest";
import { normalizeReleaseNotes } from "../src/main/releaseNotes";

describe("normalizeReleaseNotes", () => {
  it("数组形态：只留比已装版本新的项，按版本倒序", () => {
    // stable 用户 1.5.5 → 1.6.1，中间 1.5.6 / 1.6.0 只进过 beta
    const notes = normalizeReleaseNotes(
      [
        { version: "1.5.6", note: "- 中间版本" },
        { version: "1.6.1", note: "- 最新修复" },
        { version: "1.5.5", note: "- 用户已经有的版本" },
        { version: "1.4.9", note: "- 更旧的版本" },
        { version: "1.6.0", note: "- 另一个中间版本" },
      ],
      "1.5.5",
      "1.6.1",
    );
    expect(notes).toEqual([
      { version: "1.6.1", note: "- 最新修复" },
      { version: "1.6.0", note: "- 另一个中间版本" },
      { version: "1.5.6", note: "- 中间版本" },
    ]);
  });

  it("beta 逐版用户只看到自己没装的那一版", () => {
    expect(
      normalizeReleaseNotes(
        [
          { version: "1.6.1", note: "- 新版内容" },
          { version: "1.6.0", note: "- 已经装过的" },
        ],
        "1.6.0",
        "1.6.1",
      ),
    ).toEqual([{ version: "1.6.1", note: "- 新版内容" }]);
  });

  it("跨通道用户（beta 装过 1.6.0、切回 stable 升 1.6.1）只看到 1.6.1", () => {
    expect(
      normalizeReleaseNotes(
        [
          { version: "1.6.1", note: "- 只这一条" },
          { version: "1.6.0", note: "- 已装过" },
        ],
        "1.6.0",
        "1.6.1",
      ),
    ).toEqual([{ version: "1.6.1", note: "- 只这一条" }]);
  });

  it("字符串形态（其他 provider）包成单元素数组，版本取本次更新版本", () => {
    expect(normalizeReleaseNotes("- 一条记录", "1.0.0", "1.1.0")).toEqual([
      { version: "1.1.0", note: "- 一条记录" },
    ]);
  });

  it("版本号解析不了的项、note 为空的项都丢弃", () => {
    const notes = normalizeReleaseNotes(
      [
        { version: "nightly", note: "- 版本号不认识" },
        { version: "1.2.0", note: "   " },
        { version: "1.3.0", note: "- 有效" },
        { version: "bad", note: 42 },
        { note: "- 缺版本号" },
        null,
        "not-an-object",
      ],
      "1.0.0",
      "1.3.0",
    );
    expect(notes).toEqual([{ version: "1.3.0", note: "- 有效" }]);
  });

  it("整段没有可展示条目时返回 undefined（S4 不渲染记录块）", () => {
    expect(normalizeReleaseNotes(undefined, "1.0.0", "1.1.0")).toBeUndefined();
    expect(normalizeReleaseNotes("", "1.0.0", "1.1.0")).toBeUndefined();
    expect(normalizeReleaseNotes("   ", "1.0.0", "1.1.0")).toBeUndefined();
    expect(normalizeReleaseNotes([], "1.0.0", "1.1.0")).toBeUndefined();
    // 全部是已装版本或更旧
    expect(
      normalizeReleaseNotes(
        [{ version: "1.0.0", note: "- 已装" }],
        "1.0.0",
        "1.0.0",
      ),
    ).toBeUndefined();
    // 形态不认识（数字 / 对象但字段类型不对）
    expect(normalizeReleaseNotes(42, "1.0.0", "1.1.0")).toBeUndefined();
    expect(
      normalizeReleaseNotes({ version: "1.1.0", note: "x" }, "1.0.0", "1.1.0"),
    ).toBeUndefined();
  });

  it("已装版本号本身解析不了就不下发（无法判断哪些是新的）", () => {
    expect(
      normalizeReleaseNotes(
        [{ version: "1.1.0", note: "- 一条" }],
        "unknown",
        "1.1.0",
      ),
    ).toBeUndefined();
  });

  it("note 的 CRLF 与首尾空白被规范化（多行 markdown 保持原样）", () => {
    expect(
      normalizeReleaseNotes(
        [{ version: "1.2.0", note: "\r\n- 第一条\r\n- 第二条\r\n" }],
        "1.0.0",
        "1.2.0",
      ),
    ).toEqual([{ version: "1.2.0", note: "- 第一条\n- 第二条" }]);
  });
});
