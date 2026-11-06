#!/usr/bin/env node
/**
 * release-notes.mjs — 生成桌面端某个版本的「变更记录」（Release Notes）。
 *
 * 规格：docs/specs/desktop/desktop-distribution.md「更新内容（Release Notes）」。
 *
 * 输入是两个 `wave-desktop@*` tag（上一个 → 当前），输出是**该版本的增量**：
 * 平铺 markdown 列表，不加分组 / 排序 / 图标 / 作者 / 链接。与分发通道无关 ——
 * stable 与 beta 共用同一份文本，跨版本合并由客户端按「已装版本」过滤后完成
 * （feed 里下发最近若干版本的数组，见 desktop-distribution.md 场景 4–6）。
 *
 * 免责边界：产物是**提交摘要**，不是成品文案。同一功能在发布窗口内被多个 PR
 * 迭代时会同时出现几条，这是设计内的噪声；不提供人工覆盖入口。
 *
 * 用法：
 *   node packages/desktop/scripts/release-notes.mjs \
 *     --since wave-desktop@1.6.0 --to wave-desktop@1.6.1 [--out <file>]
 *
 * 无任何条目时**不产出文件**（不写空文件冒充「有记录」），退出码 0。
 * `--since` 缺省/为空（命名空间里的第一个 tag）时同样什么都不产出。
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** 这些类型的提交不进变更记录：对用户没有可感知的变化。 */
const DROPPED_TYPES = new Set([
  "chore",
  "docs",
  "style",
  "test",
  "tests",
  "ci",
  "build",
]);

/**
 * 一条 commit 标题 → 变更记录里的那一行（不含 `- ` 前缀）；返回 null 表示丢弃。
 *
 * - 丢弃 merge 提交、`chore/docs/style/test/ci/build` 类型、以及 bump 版本号提交；
 * - 其余去掉 `type(scope)!:` 前缀（保留正文，不保留 type 与 scope）；
 * - 去掉尾部的 PR 号（可重复出现：`(#2769) (#2778)`）。
 */
export function formatSubject(subject) {
  let text = String(subject ?? "")
    .replace(/\r/g, "")
    .trim();
  if (!text) return null;

  // merge 提交不进记录（squash 工作流下很少，但 workflow_dispatch 的合并态会有）
  if (/^merge\b/i.test(text)) return null;

  const conventional = /^([a-z]+)(?:\(([^)]*)\))?(!)?:\s*(.*)$/i.exec(text);
  if (conventional) {
    const type = conventional[1].toLowerCase();
    if (DROPPED_TYPES.has(type)) return null;
    text = conventional[4];
  }

  // 版本号 bump（`chore: bump …` 已被类型丢弃，这里兜住没有 type 前缀的变体）
  if (/^bump\b/i.test(text)) return null;

  // 尾部 PR 号：`(#2769) (#2778)` 这种重复后缀也要一次剥干净
  text = text.replace(/(?:\s*\(#\d+\))+\s*$/, "").trim();
  return text || null;
}

/** commit 标题数组 → 记录正文（每行 `- xxx`，保持 git log 的顺序）。 */
export function buildReleaseNotes(subjects) {
  const lines = [];
  for (const subject of subjects) {
    const line = formatSubject(subject);
    if (line) lines.push(`- ${line}`);
  }
  return lines.join("\n");
}

/** 取 `<since>..<to>` 之间的提交标题（不含 since 本身，不含 merge）。 */
export function readCommitSubjects(since, to, cwd = process.cwd()) {
  const out = execFileSync(
    "git",
    ["log", "--no-merges", "--pretty=format:%s", `${since}..${to}`],
    { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  return out.split("\n").filter((line) => line.trim() !== "");
}

/** 生成某个版本的记录文本；`since` 为空（命名空间第一个 tag）时返回空串。 */
export function generateReleaseNotes(since, to = "HEAD", cwd = process.cwd()) {
  if (!since) return "";
  return buildReleaseNotes(readCommitSubjects(since, to, cwd));
}

/** 写记录文件；没有任何条目时**不写**（返回 false），不产出空文件冒充有记录。 */
export function writeNotesFile(outPath, notes) {
  if (!notes) return false;
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, `${notes}\n`, "utf8");
  return true;
}

function parseArgs(argv) {
  const args = { since: "", to: "HEAD", out: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--since") args.since = argv[++i] ?? "";
    else if (flag === "--to") args.to = argv[++i] ?? "HEAD";
    else if (flag === "--out") args.out = argv[++i] ?? "";
    else if (flag === "--help" || flag === "-h") args.help = true;
    else throw new Error(`未知参数：${flag}`);
  }
  return args;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(
      "用法: release-notes.mjs --since <tag> [--to <tag>] [--out <file>]",
    );
    return;
  }
  // 第一个 tag：没有可比的上一个版本，不产出记录
  if (!args.since) {
    console.error("没有上一个 tag，跳过变更记录生成");
    return;
  }

  const notes = generateReleaseNotes(args.since, args.to);
  if (!notes) {
    console.error(`${args.since}..${args.to} 没有可写进记录的提交`);
    return;
  }

  if (args.out) {
    writeNotesFile(args.out, notes);
    console.log(`变更记录已写入 ${args.out}（${notes.split("\n").length} 条）`);
  } else {
    console.log(notes);
  }
}

// 直跑才进 CLI（被测试 import 时不加副作用 —— 与 SDK 的 host 边界同一条规矩）
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
