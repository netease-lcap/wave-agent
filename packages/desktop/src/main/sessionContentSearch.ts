/**
 * 侧栏会话内容搜索（spec desktop/desktop-sessions.md「侧栏会话内容搜索」）。
 *
 * 直接扫 `~/.wave/projects/<encoded>/*.jsonl`——与会话转录同一份文件，不建索引
 * （与 Claude 桌面端同一取舍：多一份索引就要维护它与转录的一致性，而一次查询的
 * 成本在几百个会话上是可接受的）。
 *
 * 两条边界：
 *
 * - **只搜本地会话**。远端主机的转录在远端 daemon 的盘上，宿主机读不到，把它们的
 *   id 混进来只会得到「搜不到」的错觉。
 * - **按 uuid 全盘定位文件**，不用 workdir 反算目录：worktree 会话的转录落在
 *   worktree 路径对应的项目目录里，而侧栏条目的 workdir 是「会动」的那个——
 *   会话里 `cd` 过一次就会指错目录。转录定位属于「不动」的那一侧（`sessionCwd`），
 *   而按 id 找文件绕开了这一整类问题。
 */

import { promises as fs } from "fs";
import { homedir } from "os";
import { join } from "path";

/** 与 SDK 的 `SESSION_DIR` 同源（host 侧不引 SDK 运行时，避免撑大主进程包）。 */
const SESSION_DIR = join(homedir(), ".wave", "projects");

const MAX_SESSIONS = 50;
const MAX_SNIPPETS_PER_SESSION = 3;
/** 单文件最多读这么多字节：超过的尾部不参与匹配，整体标记为截断。 */
const MAX_FILE_BYTES = 6 * 1024 * 1024;
const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 60;
const READ_CONCURRENCY = 8;
const MAIN_SESSION_FILE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;

export interface SessionContentSnippet {
  text: string;
  offset: number;
  length: number;
  /** 该会话内的第几个命中（0 起）。 */
  hitIndex: number;
}

export interface SessionContentMatch {
  sessionId: string;
  hitCount: number;
  snippets: SessionContentSnippet[];
}

/**
 * 哪些会话参与正文搜索：本机 + 侧栏当前树上剩下的（`requestedIds` 是标题搜索与
 * 筛选取交集后的结果）。抽成纯函数是因为它承载两条产品判断——远端的转录读不到
 * （不能给「搜不到」的错觉），被筛掉的会话不该出现在结果里——而这两条都只在这
 * 一行里表达。
 */
export function selectLocalSessionIds(
  groups: ReadonlyArray<{
    host: string;
    sessions: ReadonlyArray<{ sessionId: string }>;
  }>,
  requestedIds?: readonly string[],
  localHost = "local",
): Set<string> {
  const requested = Array.isArray(requestedIds) ? new Set(requestedIds) : null;
  const ids = new Set<string>();
  for (const group of groups) {
    if (group.host !== localHost) continue;
    for (const session of group.sessions) {
      if (requested && !requested.has(session.sessionId)) continue;
      ids.add(session.sessionId);
    }
  }
  return ids;
}

export interface SearchSessionContentsOptions {
  /** 允许命中的会话 id（调用方只放本地会话进来）。 */
  sessionIds: ReadonlySet<string>;
  /** 已经没人要这次结果时返回 true，扫描中途放弃。 */
  isCancelled?: () => boolean;
  /** 覆盖转录根目录（测试用）。 */
  sessionDir?: string;
}

export interface SearchSessionContentsResult {
  matches: SessionContentMatch[];
  /** 有文件因过大/读失败没读全，或命中数触到上限。 */
  truncated: boolean;
}

/**
 * 一条消息里参与匹配的文本段，与 webview 的
 * `utils/transcriptFind.ts#messageSearchTexts` 同口径：屏幕上能看到的正文、思考、
 * 提示行、工具名与参数摘要 / 输出。口径一致，侧栏说「命中 3 处」与打开会话后查找
 * 条数的才对得上。
 */
const textsOfMessage = (message: Record<string, unknown>): string[] => {
  const blocks = Array.isArray(message.blocks) ? message.blocks : [];
  const texts: string[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const record = block as Record<string, unknown>;
    switch (record.type) {
      case "text":
      case "reasoning":
      case "notice":
      case "compact":
        if (typeof record.content === "string") texts.push(record.content);
        break;
      case "tool": {
        if (typeof record.name === "string") texts.push(record.name);
        const summary = record.compactParams ?? record.parameters;
        if (typeof summary === "string") texts.push(summary);
        const result = record.result ?? record.shortResult;
        if (typeof result === "string") texts.push(result);
        if (typeof record.error === "string") texts.push(record.error);
        break;
      }
      case "task_notification":
        if (typeof record.summary === "string") texts.push(record.summary);
        break;
      default:
        break;
    }
  }
  return texts;
};

/** 一行 JSONL 的文本段；不是消息（metadata / custom-title / 坏行）时返回空。 */
const textsOfLine = (line: string): string[] => {
  const trimmed = line.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    // 保留条目（metadata 头、改名记录）没有 blocks，自然被这条判据挡掉。
    return textsOfMessage(parsed);
  } catch {
    // 半截行是中断写入的残渣；不因为一行坏掉就放弃整份转录。
    return [];
  }
};

const collapseWhitespace = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * 命中处前后各截一段上下文。折叠空白会改变长度，所以折叠后重新定位关键词——
 * 关键词本身跨了换行时找不到，此时把偏移归零（只丢高亮，不丢这一条命中）。
 *
 * `charIndex` 是命中在这段文本里的字符偏移（用来截窗口），`hitIndex` 是它在整个
 * 会话里的序号（用来跳转），两者不是一个东西。
 */
const makeSnippet = (
  text: string,
  charIndex: number,
  length: number,
  query: string,
  hitIndex: number,
): SessionContentSnippet => {
  const from = Math.max(0, charIndex - SNIPPET_BEFORE);
  const to = Math.min(text.length, charIndex + length + SNIPPET_AFTER);
  const raw = text.slice(from, to);
  const snippet = collapseWhitespace(raw);
  const loweredQuery = query.toLowerCase();
  const offset = snippet.toLowerCase().indexOf(loweredQuery);
  return {
    text: snippet,
    offset: offset < 0 ? 0 : offset,
    length: offset < 0 ? 0 : query.length,
    hitIndex,
  };
};

/** 读一份转录，返回它贡献的命中（可能为空）。 */
const searchOneFile = async (
  filePath: string,
  sessionId: string,
  query: string,
  loweredQuery: string,
): Promise<{ match: SessionContentMatch | null; truncated: boolean }> => {
  let content: string;
  let truncated = false;
  try {
    const stats = await fs.stat(filePath);
    if (stats.size > MAX_FILE_BYTES) {
      truncated = true;
      const handle = await fs.open(filePath, "r");
      try {
        const buffer = Buffer.alloc(MAX_FILE_BYTES);
        const { bytesRead } = await handle.read(buffer, 0, MAX_FILE_BYTES, 0);
        content = buffer.subarray(0, bytesRead).toString("utf8");
      } finally {
        await handle.close();
      }
    } else {
      content = await fs.readFile(filePath, "utf8");
    }
  } catch {
    return { match: null, truncated: false };
  }

  let hitIndex = 0;
  const snippets: SessionContentSnippet[] = [];
  // 片段够数后仍然扫完：命中总数要真实，侧栏显示的是「这条会话里有几处」（场景 6
  // 的上限只约束片段条数）。
  for (const line of content.split("\n")) {
    for (const text of textsOfLine(line)) {
      const lowered = text.toLowerCase();
      let from = 0;
      let found = lowered.indexOf(loweredQuery, from);
      while (found >= 0) {
        if (snippets.length < MAX_SNIPPETS_PER_SESSION) {
          snippets.push(
            makeSnippet(text, found, query.length, query, hitIndex),
          );
        }
        hitIndex += 1;
        from = found + Math.max(1, loweredQuery.length);
        found = lowered.indexOf(loweredQuery, from);
      }
    }
  }

  if (hitIndex === 0) return { match: null, truncated };
  return {
    match: { sessionId, hitCount: hitIndex, snippets },
    truncated,
  };
};

/** uuid → jsonl 路径。一次 readdir 建索引，避免每个会话都去试一遍目录。 */
const indexSessionFiles = async (
  sessionDir: string,
  wanted: ReadonlySet<string>,
): Promise<Map<string, string>> => {
  const index = new Map<string, string>();
  let dirs: string[];
  try {
    dirs = await fs.readdir(sessionDir);
  } catch {
    return index;
  }
  for (const dir of dirs) {
    if (wanted.size === index.size) break;
    let files: string[];
    try {
      files = await fs.readdir(join(sessionDir, dir));
    } catch {
      continue;
    }
    for (const file of files) {
      const match = MAIN_SESSION_FILE.exec(file);
      if (!match) continue;
      if (!wanted.has(match[1]) || index.has(match[1])) continue;
      index.set(match[1], join(sessionDir, dir, file));
    }
  }
  return index;
};

/**
 * 全库搜索。并发读受限、会话数与片段数都有上限；`isCancelled` 在每批之间检查，
 * 用户接着打字时上一轮会尽快退出而不是继续读完。
 */
export async function searchSessionContents(
  query: string,
  options: SearchSessionContentsOptions,
): Promise<SearchSessionContentsResult> {
  const trimmed = query.trim();
  if (trimmed.length < 2 || options.sessionIds.size === 0) {
    return { matches: [], truncated: false };
  }
  const loweredQuery = trimmed.toLowerCase();
  const sessionDir = options.sessionDir ?? SESSION_DIR;
  const files = await indexSessionFiles(sessionDir, options.sessionIds);

  const entries = [...files.entries()];
  const matches: SessionContentMatch[] = [];
  let truncated = false;

  for (let i = 0; i < entries.length; i += READ_CONCURRENCY) {
    if (options.isCancelled?.()) break;
    if (matches.length >= MAX_SESSIONS) {
      truncated = true;
      break;
    }
    const batch = entries.slice(i, i + READ_CONCURRENCY);
    const results = await Promise.all(
      batch.map(([sessionId, filePath]) =>
        searchOneFile(filePath, sessionId, trimmed, loweredQuery),
      ),
    );
    for (const result of results) {
      if (result.truncated) truncated = true;
      if (result.match) matches.push(result.match);
    }
  }

  return {
    matches: matches.slice(0, MAX_SESSIONS),
    truncated: truncated || matches.length > MAX_SESSIONS,
  };
}
