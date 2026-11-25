/**
 * Session Management Service - JSONL Format Implementation
 *
 * OPTIMIZED IMPLEMENTATION (Phase 6 Complete):
 * - Filename-based session type identification
 * - Minimal file I/O for metadata extraction
 * - Eliminated metadata headers for cleaner session files
 * - Backward compatible with existing session files
 * - 8-10x performance improvement in session listing operations
 *
 * Key Features:
 * - Session creation without metadata headers
 * - Subagent sessions identified by filename prefix
 * - Performance-optimized session listing
 * - Full backward compatibility maintained
 */

import { createReadStream, createWriteStream, promises as fs } from "fs";
import type { Dirent } from "fs";
import { dirname, join, resolve } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";
import { pipeline } from "stream/promises";
import type { Message, Usage } from "../types/index.js";
import { execFileAsyncHidden } from "../utils/execFileHidden.js";
import { PathEncoder } from "../utils/pathEncoder.js";
import { JsonlHandler } from "../services/jsonlHandler.js";
import { METADATA_REAPPEND_THRESHOLD_BYTES } from "../constants/sessionStorage.js";
import {
  createRewindCutAccumulator,
  forEachTranscriptEntry,
  isReservedEntry,
  scanTranscriptMessages,
  type RewindCut,
} from "../services/sessionEntries.js";
import { extractLatestTotalTokens } from "../utils/tokenCalculation.js";
import { logger } from "../utils/globalLogger.js";
import { getMessageContent } from "../utils/messageOperations.js";
import {
  type RewindCheckpoint,
  toRewindCheckpoint,
} from "../utils/rewindCheckpoints.js";

export interface SessionData {
  id: string;
  /**
   * 从**最后一个压缩边界**开始的消息（含那段摘要），也就是恢复后要装进内存的
   * 那一份。压缩之前的历史留在转录里，由分页与 `/rewind` 现取现用。
   *
   * 手工构造时也可以传整条线程——`initializeFromSession` 会自己再切一次。
   */
  messages: Message[];
  metadata: {
    workdir: string;
    lastActiveAt: string;
    latestTotalTokens: number;
    /**
     * User-set title recovered from the whole-file scan (see
     * `readTranscriptForResume`). Held in memory by the host so a later
     * `reAppendSessionMetadata` can write it back at EOF even after later
     * messages pushed it out of the tail window.
     */
    customTitle?: string;
  };
  /** 完整线程里的消息条数（含压缩前）。缺席时按 `messages.length` 算。 */
  threadMessageCount?: number;
  /** 整条线程的第一个用户输入（会话标题锚定）。缺席时从 `messages` 里找。 */
  firstUserText?: string;
  /**
   * 整条线程里所有 assistant 用量，按出现顺序。用量统计要覆盖压缩前的对话，
   * 而 `messages` 只剩压缩后的尾部，所以载入时顺手收集好放在这里。
   */
  usages?: Usage[];
  /**
   * 这份转录在盘上的真实路径（载入时解析出来的）。跨目录 `wave --restore <id>`
   * 时它落在**会话自己的** project 目录下，而 `workdir` 仍是启动目录：写回、
   * 重追加标题、`/rewind` 都必须用它——按 `workdir` 重算出来的是启动目录下的
   * 路径，那里根本没有这个文件（spec `session-management.md` 验收场景 5）。
   *
   * 缺席时（手工构造的会话数据）按 `workdir` + `sessionType` 现算。
   */
  transcriptPath?: string;
}

export interface SessionMetadata {
  id: string;
  sessionType: "main" | "subagent";
  subagentType?: string;
  workdir: string;
  createdAt: Date;
  lastActiveAt: Date;
  latestTotalTokens: number;
  firstMessage?: string;
  /**
   * User-set conversation title (from a `custom-title` entry in the session
   * file). Takes precedence over `firstMessage` when rendering a label.
   */
  customTitle?: string;
  /** Git branch at session creation time (from the metadata header). */
  branch?: string;
  /**
   * Main repository root, present only when `workdir` is a linked git worktree
   * and the reporting host can tell (the daemon registry derives it from
   * `createdWorkdir`; the on-disk listing does not look). `workdir` itself is
   * never rewritten — it stays the session's real cwd — so this is the field a
   * recents list groups by when it must offer repository roots rather than
   * worktree paths. Absent means "not a worktree, or unknown".
   */
  repoRoot?: string;
  /**
   * 宿主探测结果：该会话所属目录已不存在。磁盘层永远不填——只有真的探测过
   * 且探到「不存在」的宿主才置 true；探测失败（主机不可达）必须留空，不能
   * 据此判定目录缺失（desktop-sessions.md「会话目录缺失后的恢复（换文件夹
   * 继续）」场景 1）。
   */
  folderMissing?: boolean;
}

/**
 * Generate a new session ID using Node.js native crypto.randomUUID()
 * @returns UUID string for session identification
 */
export function generateSessionId(): string {
  return randomUUID();
}

/**
 * Generate filename for subagent sessions
 * @param sessionId - UUID session identifier
 * @returns Filename with subagent prefix for subagent sessions
 */
export function generateSubagentFilename(sessionId: string): string {
  return `subagent-${sessionId}.jsonl`;
}

// Constants
export const SESSION_DIR = join(homedir(), ".wave", "projects");

/**
 * Ensure session directory exists
 */
export async function ensureSessionDir(): Promise<void> {
  try {
    await fs.mkdir(SESSION_DIR, { recursive: true });
  } catch (error) {
    throw new Error(`Failed to create session directory: ${error}`);
  }
}

/**
 * Generate session file path without creating directories
 * @param sessionId - UUID session identifier
 * @param workdir - Working directory for the session
 * @param sessionType - Type of session ("main" or "subagent", defaults to "main")
 * @returns Promise resolving to full file path for the session JSONL file
 */
export async function generateSessionFilePath(
  sessionId: string,
  workdir: string,
  sessionType: "main" | "subagent" = "main",
): Promise<string> {
  const encoder = new PathEncoder();
  const projectDir = await encoder.getProjectDirectory(workdir, SESSION_DIR);

  // Generate filename based on session type
  const jsonlHandler = new JsonlHandler();
  const filename = jsonlHandler.generateSessionFilename(sessionId, sessionType);

  return join(projectDir.encodedPath, filename);
}

/**
 * Generate session file path using project-based directory structure
 * @param sessionId - UUID session identifier
 * @param workdir - Working directory for the session
 * @param sessionType - Type of session ("main" or "subagent", defaults to "main")
 * @returns Promise resolving to full file path for the session JSONL file
 */
export async function getSessionFilePath(
  sessionId: string,
  workdir: string,
  sessionType: "main" | "subagent" = "main",
): Promise<string> {
  const encoder = new PathEncoder();
  const projectDir = await encoder.createProjectDirectory(workdir, SESSION_DIR);

  // Generate filename based on session type
  const jsonlHandler = new JsonlHandler();
  const filename = jsonlHandler.generateSessionFilename(sessionId, sessionType);

  return join(projectDir.encodedPath, filename);
}

/**
 * Resolve the current git branch for a working directory, if any.
 *
 * Returns undefined when the directory is not inside a git repo, git is
 * unavailable, or the command fails/times out — the session can still be
 * created, its metadata header just omits the branch.
 */
async function getGitBranch(workdir: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsyncHidden(
      "git",
      ["-C", workdir, "branch", "--show-current"],
      { timeout: 2000, windowsHide: true },
    );
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Create a new session
 * @param sessionId - UUID session identifier
 * @param workdir - Working directory for the session
 * @param sessionType - Type of session ("main" or "subagent", defaults to "main")
 */
export async function createSession(
  sessionId: string,
  workdir: string,
  sessionType: "main" | "subagent" = "main",
): Promise<void> {
  const jsonlHandler = new JsonlHandler();
  const filePath = await getSessionFilePath(sessionId, workdir, sessionType);
  // Persist creation-time metadata in the header line: the real workdir
  // (lossy via decodeSync), the real creation timestamp, and the git branch
  // at creation time. The header is append-only — written once, never
  // rewritten — so only creation-time-constant fields belong here.
  await jsonlHandler.createSession(filePath, {
    workdir,
    createdAt: new Date().toISOString(),
    gitBranch: await getGitBranch(workdir),
  });
}

/**
 * Rewrite a session file down to its first `keepMessageCount` messages.
 *
 * The only caller is `/rewind`. Unlike `appendMessages` this removes history
 * from the file, but it keeps every file-level reserved entry (metadata header,
 * `custom-title`) byte for byte — dropping them would silently turn the session
 * into the "legacy file without a header" shape, losing its creation time,
 * git branch and user-set title.
 *
 * @param sessionId - UUID session identifier
 * @param keepMessageCount - Number of leading messages to keep
 * @param workdir - Working directory for the session
 * @param sessionType - Type of session ("main" or "subagent", defaults to "main")
 * @param transcriptPath - 会话在盘上的真实路径（跨目录恢复时来自 `SessionData`）。
 *        给了就重写它，不按 `workdir` 重算。
 */
export async function truncateSession(
  sessionId: string,
  keepMessageCount: number,
  workdir: string,
  sessionType: "main" | "subagent" = "main",
  transcriptPath?: string,
): Promise<void> {
  // Do not save session files in test environment
  if (process.env.NODE_ENV === "test") {
    return;
  }

  const jsonlHandler = new JsonlHandler();
  const filePath =
    transcriptPath ??
    (await generateSessionFilePath(sessionId, workdir, sessionType));

  try {
    await fs.access(filePath);
  } catch {
    throw new Error(
      `Session file not found: ${sessionId}. Cannot rewind a session that was never persisted.`,
    );
  }

  await jsonlHandler.truncateSession(filePath, keepMessageCount);
}

/**
 * Append messages to session using JSONL format (new approach)
 *
 * @param sessionId - UUID session identifier
 * @param newMessages - Array of messages to append
 * @param workdir - Working directory for the session
 * @param sessionType - Type of session ("main" or "subagent", defaults to "main")
 * @param transcriptPath - 会话在盘上的真实路径（跨目录恢复时来自 `SessionData`）。
 *        给了就写入它，不按 `workdir` 重算。
 * @returns Bytes written (0 when nothing was written). The caller accumulates
 *          this to decide when the title needs re-appending at EOF.
 */
export async function appendMessages(
  sessionId: string,
  newMessages: Message[],
  workdir: string,
  sessionType: "main" | "subagent" = "main",
  transcriptPath?: string,
): Promise<number> {
  // Do not save session files in test environment
  if (process.env.NODE_ENV === "test") {
    return 0;
  }

  // Do not save if there are no messages
  if (newMessages.length === 0) {
    return 0;
  }

  const jsonlHandler = new JsonlHandler();

  // Generate the session file path directly using known session type
  const filePath =
    transcriptPath ??
    (await generateSessionFilePath(sessionId, workdir, sessionType));

  // Check if the session file exists
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(
      `Session file not found: ${sessionId}. Use createSession() to create a new session first.`,
    );
  }

  // Append only. Keeping the title inside the listing's tail window is the
  // job of `reAppendSessionMetadata`, which the caller drives by the bytes it
  // writes (half a tail window) plus the session's flush points — not here:
  // appending the entry on every save would cost a tail read and an extra line
  // per save, for a guarantee that only matters once the transcript has grown
  // far enough to push the previous entry out of the window.
  return jsonlHandler.append(filePath, newMessages, {
    atomic: false,
  });
}

/**
 * Set (or replace) a session's user-set title.
 *
 * The title is persisted as a `custom-title` entry appended to the session's
 * own JSONL file — never as a rewrite of the metadata header, and never in a
 * sidecar index — so every host that reads session files sees it without any
 * extra sync channel.
 *
 * A session whose transcript has not been materialized yet (only meta messages
 * so far) is created here: renaming is an explicit user action, so it is not
 * subject to the "meta-only sessions never hit disk" rule.
 *
 * An empty/blank title is a no-op — it is not a signal to clear the title.
 *
 * @param sessionId - UUID session identifier
 * @param workdir - Working directory the session belongs to
 * @param title - New title
 * @param transcriptPath - 会话在盘上的真实路径（跨目录恢复时来自 `SessionData`）。
 *        给了就先认它，不按 `workdir` 重算。
 * @returns The trimmed title that was written, or undefined for a blank no-op
 */
export async function setSessionCustomTitle(
  sessionId: string,
  workdir: string,
  title: string,
  transcriptPath?: string,
): Promise<string | undefined> {
  const trimmed = title.trim();
  if (!trimmed) {
    return undefined;
  }

  const jsonlHandler = new JsonlHandler();
  let filePath =
    transcriptPath ??
    (await generateSessionFilePath(sessionId, workdir, "main"));

  try {
    await fs.access(filePath);
  } catch {
    // The session may live in another project directory (created from a
    // different cwd, or a git worktree that no longer maps to this workdir).
    const fallback = await findSessionFileAcrossProjects(sessionId, "main");
    if (fallback) {
      filePath = fallback;
    } else {
      await createSession(sessionId, workdir, "main");
      filePath = await generateSessionFilePath(sessionId, workdir, "main");
    }
  }

  await jsonlHandler.appendCustomTitle(filePath, trimmed, sessionId);
  return trimmed;
}

/**
 * Re-append the session's reserved metadata entries at EOF.
 *
 * A listing reads only the tail window (`TAIL_WINDOW_BYTES`, 64 KB) of each
 * session file, so a `custom-title` entry that later messages pushed past that
 * window becomes invisible — the session would flip back to showing its first
 * message. Two things keep the entry inside the window (spec
 * `session-management.md` 验收场景 5):
 *
 * - the caller re-appends once the transcript has grown by
 *   `METADATA_REAPPEND_THRESHOLD_BYTES` since the last re-append (the main
 *   trigger: a live session that never exits still stays listable), and
 * - every flush point re-appends regardless of size: graceful exit,
 *   compaction, taking over a resumed session, switching away from one, and
 *   after `/rewind` rewrites the file.
 *
 * The entry is refreshed from the tail first: another process (the CLI session
 * picker, a second host) may have renamed the session while we held it, in
 * which case its value — not our stale in-memory one — is the truth. When the
 * tail holds nothing (already evicted, or never written by anyone else), the
 * caller's in-memory value stands.
 *
 * A value still visible near the tail is never written again: it is already
 * where the listing looks, so a second identical line would only grow the file
 * every time this runs. Claude Code filters its re-append payload the same way
 * (`planReAppendSessionMetadata`) — and it decides "already visible" by
 * scanning only `vE / 2`, not the whole window: accepting an entry that sits
 * 32–64 KB from EOF would let the next threshold tick push it out of the
 * listing window entirely.
 *
 * A missing transcript file is a no-op: re-appending must never materialize a
 * session that does not exist.
 *
 * @param sessionId - UUID session identifier
 * @param workdir - Working directory the session belongs to
 * @param customTitle - Title held in memory by the caller (may be undefined)
 * @param sessionType - Type of session ("main" or "subagent", defaults to "main")
 * @param transcriptPath - 会话在盘上的真实路径（跨目录恢复时来自 `SessionData`）。
 *        给了就用它，不按 `workdir` 重算、也不再跨 project 目录扫一遍。
 * @returns Whether a title entry was actually appended
 */
export async function reAppendSessionMetadata(
  sessionId: string,
  workdir: string,
  customTitle: string | undefined,
  sessionType: "main" | "subagent" = "main",
  transcriptPath?: string,
): Promise<boolean> {
  const jsonlHandler = new JsonlHandler();
  let filePath =
    transcriptPath ??
    (await generateSessionFilePath(sessionId, workdir, sessionType));

  try {
    await fs.access(filePath);
  } catch {
    // The session may live in another project directory (created from a
    // different cwd, or a git worktree). That sweep costs a directory walk per
    // flush point, so it runs only when there is a title to write: with no
    // in-memory title there is nothing this call could add that the entry
    // already in the file does not say.
    if (!customTitle) {
      return false;
    }
    const fallback = await findSessionFileAcrossProjects(
      sessionId,
      sessionType,
    );
    if (!fallback) {
      return false;
    }
    filePath = fallback;
  }

  // Absorb a fresher value written by another process since we last looked,
  // and use its presence as the duplicate check: if the tail still carries a
  // title, that value is what a listing reads right now.
  //
  // Look only half a window deep. The listing window is twice this, so a title
  // this close to EOF cannot be pushed out before the counter reaches the
  // threshold again; judging by the whole window would let an entry 32–64 KB
  // from EOF pass as "already visible" and then fall out of the window on the
  // next tick.
  const tailTitle = await jsonlHandler.readCustomTitle(
    filePath,
    METADATA_REAPPEND_THRESHOLD_BYTES,
  );
  if (tailTitle !== undefined) {
    return false;
  }
  if (!customTitle) {
    return false;
  }

  await jsonlHandler.appendCustomTitle(filePath, customTitle, sessionId);
  return true;
}

/**
 * Scan all project directories for a session file by ID. Used as a fallback
 * when the session is not found in the given working directory (e.g. resuming
 * a session created in another project or a sibling git worktree via
 * `wave --restore <id>`).
 *
 * @param sessionId - UUID session identifier
 * @param sessionType - Type of session ("main" or "subagent")
 * @returns Full path to the session file, or null if not found anywhere
 */
async function findSessionFileAcrossProjects(
  sessionId: string,
  sessionType: "main" | "subagent",
): Promise<string | null> {
  const targetFile =
    sessionType === "subagent"
      ? `subagent-${sessionId}.jsonl`
      : `${sessionId}.jsonl`;

  try {
    const projectDirs = await fs.readdir(SESSION_DIR);
    for (const projectDirName of projectDirs) {
      const candidate = join(SESSION_DIR, projectDirName, targetFile);
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // ENOENT/ENOTDIR — keep scanning other project dirs
      }
    }
  } catch {
    // Sessions base dir missing or unreadable — nothing to scan
  }

  return null;
}

/**
 * 会话在盘上是否存在——含跨 project 目录兜底，与 `loadSessionFromJsonl` 的
 * 「找不到文件」判据逐条对齐（ENOENT 才算不存在，别的错误如实抛出）。
 *
 * 给「只想确认这个 id 能不能恢复」的调用方用：为一个是非题把整份转录读出来
 * 解析一遍，是白付一次 `loadSessionFromJsonl` 的全部成本。
 *
 * @param sessionId - UUID session identifier
 * @param workdir - Working directory for the session
 * @param sessionType - Type of session ("main" or "subagent", defaults to "main")
 */
export async function sessionExistsAnywhere(
  sessionId: string,
  workdir: string,
  sessionType: "main" | "subagent" = "main",
): Promise<boolean> {
  const filePath = await generateSessionFilePath(
    sessionId,
    workdir,
    sessionType,
  );

  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  return (await findSessionFileAcrossProjects(sessionId, sessionType)) !== null;
}

/**
 * 会话**创建时**的工作目录，取自转录头部的 `{"type":"metadata","workdir":…}`
 * 行（`createSession` 只在创建那一刻写一次，此后只追加不重写——会话内 `cd`、
 * EnterWorktree、以及换一个 cwd 的客户端重新托管，都不会改它）。
 *
 * 给「手上的 cwd 未必是这个会话的目录」的重托管路径用（daemon 重启后
 * `status`/`send` attach、宿主自己的索引过期）：这些调用方只有 session id 是
 * 可信的，目录只能问转录。先按 `workdir` 的 project 目录找文件，找不到再跨
 * project 目录扫一遍——与 `loadSessionFromJsonl` 的查找口径一致，所以「能载入
 * 的会话」在这里也一定问得到目录。
 *
 * 尽力而为：会话不存在、无元数据头（老转录）、文件读不了、甚至 id 根本不是
 * UUID（`generateSessionFilename` 会拒绝，重托管一条乱写的 id 是正常输入）——
 * 一律返回 `undefined`，由调用方决定退回自己的 cwd，绝不把 attach 变成失败。
 *
 * @param sessionId - UUID session identifier
 * @param workdir - 调用方已知的目录（作为查找起点，不是答案）
 * @param sessionType - Type of session ("main" or "subagent", defaults to "main")
 * @returns 创建时记录的工作目录；问不到时为 undefined
 */
export async function readSessionWorkdir(
  sessionId: string,
  workdir: string,
  sessionType: "main" | "subagent" = "main",
): Promise<string | undefined> {
  try {
    let filePath = await generateSessionFilePath(
      sessionId,
      workdir,
      sessionType,
    );

    try {
      await fs.access(filePath);
    } catch {
      const fallback = await findSessionFileAcrossProjects(
        sessionId,
        sessionType,
      );
      if (!fallback) {
        return undefined;
      }
      filePath = fallback;
    }

    const header = await new JsonlHandler().readMetadata(filePath);
    return header?.workdir;
  } catch {
    // 问不到就是问不到：这张是「有没有」的问题，不是「对不对」的问题。
    return undefined;
  }
}

/**
 * 「换文件夹继续」的结果。
 */
export interface RelocateSessionResult {
  /** 真的搬了文件（from 与 to 不同且源存在）。 */
  relocated: boolean;
  /** 搬过去的文件数（正常 1；源不存在 0）。 */
  copiedFiles: number;
  /** 源转录的绝对路径（找不到时为 undefined）。 */
  from?: string;
  /** 目标转录的绝对路径。 */
  to: string;
  /**
   * 转录头 `{"type":"metadata",...}` 的 workdir 是否已改写成新目录。
   * 老转录没有 metadata 头时为 false —— 调用方据此告警「历史可能无法在重启后保留」。
   */
  headerUpdated: boolean;
}

/** 一个要跟着会话一起搬的转录文件。 */
interface TranscriptMove {
  from: string;
  to: string;
}

/** 已经写好的临时文件，等 rename 到位。 */
interface PreparedTranscript {
  move: TranscriptMove;
  tempPath: string;
  headerUpdated: boolean;
  bytesWritten: number;
}

/**
 * 把一个会话的转录从 `fromWorkdir` 搬到 `toWorkdir`（「换文件夹继续」）。
 *
 * 为什么必须改写转录头：`JsonlHandler.readMetadata` 只读第一行，而重启后
 * `readSessionWorkdir` 拿它当会话的锚点（`agentBridge.restoreWorkdirFor` 据此决定
 * 把会话恢复到哪个目录）。头不改，搬到哪都白搬——重启后会话仍然锚回旧目录，
 * 而旧目录里已经没有文件了。
 *
 * 原子性：目标目录写临时文件 → rename 到位 → 校验字节数 → 才 unlink 源。任何一步
 * 失败都清理临时文件并抛错，源文件保持原样——绝不留下"半搬"的会话（转录在新
 * 目录、索引还指着旧目录，或者反过来）。
 *
 * 老转录（没有 metadata 头）也照搬，只是 `headerUpdated` 为 false：**不补**一个头，
 * 那会改变 `listSessions` 的语义（`createdAt` / `branch` 的来源）。
 *
 * @param sessionId - UUID session identifier
 * @param fromWorkdir - 会话现在的工作目录（转录查找起点，找不到时跨 project 目录兜底）
 * @param toWorkdir - 新的工作目录
 * @returns 搬迁结果；源转录不存在时不抛错，返回 `relocated: false`
 */
export async function relocateSessionTranscript(
  sessionId: string,
  fromWorkdir: string,
  toWorkdir: string,
): Promise<RelocateSessionResult> {
  const to = await generateSessionFilePath(sessionId, toWorkdir);

  const [resolvedFrom, resolvedTo] = await Promise.all([
    resolveWorkdirForComparison(fromWorkdir),
    resolveWorkdirForComparison(toWorkdir),
  ]);
  if (resolvedFrom === resolvedTo) {
    // 同一个目录：一个字节都不动（连头也不改——它已经指向这个目录了，
    // 只是字符串写法可能不同）。
    return { relocated: false, copiedFiles: 0, to, headerUpdated: true };
  }

  // 源定位与 `loadSessionFromJsonl` 同口径：先按 fromWorkdir 的 project 目录找，
  // 找不到再跨 project 目录扫一遍（会话可能是在别的 cwd / 兄弟 worktree 里建的）。
  let from: string | null = await generateSessionFilePath(
    sessionId,
    fromWorkdir,
  );
  if (!(await pathExists(from))) {
    from = await findSessionFileAcrossProjects(sessionId, "main");
  }
  if (!from) {
    return { relocated: false, copiedFiles: 0, to, headerUpdated: false };
  }

  // 两个不同的 workdir 可能编码到同一个 project 目录（编码是有损的）。此时目标
  // 就是源文件本身：改头就地重写，不搬、更不能 unlink 源。
  const inPlace = resolve(from) === resolve(to);
  if (!inPlace && (await pathExists(to))) {
    throw new Error(
      `Failed to relocate session ${sessionId}: target already exists at ${to}`,
    );
  }

  // 伴随转录排在前面：主转录的 unlink 是这次搬迁的"不可回头点"，它放最后。
  const moves: TranscriptMove[] = inPlace
    ? []
    : await findCompanionTranscripts(dirname(from), dirname(to), sessionId);
  const allMoves = [...moves, { from, to }];
  const targetPaths = inPlace ? [] : [to, ...moves.map((move) => move.to)];

  const prepared: PreparedTranscript[] = [];
  const placed: string[] = [];
  // 临时文件在建之前就登记：写入本身失败时那份**已经建出来**的临时文件也必须被清掉。
  const tempPaths: string[] = [];
  try {
    // 阶段 1：全部先写成目标目录里的临时文件（源一个字节都还没动）。
    for (const move of allMoves) {
      await fs.mkdir(dirname(move.to), { recursive: true });
      const tempPath = `${move.to}.tmp.${process.pid}.${randomUUID()}`;
      tempPaths.push(tempPath);
      const copied = await copyTranscriptWithWorkdir(
        move.from,
        tempPath,
        toWorkdir,
      );
      // 落盘字节数与复制的记账必须一致：短写（磁盘满、被截断）就在这里停下。
      const stat = await fs.stat(tempPath);
      if (stat.size !== copied.bytesWritten) {
        throw new Error(
          `short write for ${tempPath}: expected ${copied.bytesWritten} bytes, wrote ${stat.size}`,
        );
      }
      prepared.push({ move, tempPath, ...copied });
    }

    // 阶段 2：全部 rename 到位（同目录 rename 是原子的，读者看不到半份文件）。
    for (const entry of prepared) {
      await fs.rename(entry.tempPath, entry.move.to);
      placed.push(entry.move.to);
    }
  } catch (error) {
    // 源一个都还没删 ⇒ 把落地的目标与残留的临时文件清掉，就回到了搬前的状态。
    await removeFilesQuietly([...tempPaths, ...targetPaths]);
    throw new Error(
      `Failed to relocate session ${sessionId} from ${from} to ${to}: ${errorMessageOf(error)}`,
    );
  }

  const mainMove = prepared[prepared.length - 1];

  if (inPlace) {
    // 就地改头：文件没换位置，也就没有"搬过去的文件数"。
    return {
      relocated: false,
      copiedFiles: 0,
      from,
      to,
      headerUpdated: mainMove.headerUpdated,
    };
  }

  // 阶段 3：删源（主转录先删——它才是"搬完了"的那个判据；删不掉说明源还在，
  // 那就把已放好的目标全部撤掉，回到原状再报错）。
  try {
    await fs.unlink(from);
  } catch (error) {
    await removeFilesQuietly(placed);
    throw new Error(
      `Failed to relocate session ${sessionId}: could not remove ${from}: ${errorMessageOf(error)}`,
    );
  }

  // 伴随转录的旧副本删不掉只是留了一份多余的子代理转录，不影响这场对话本身，
  // 记一条 warn 继续。
  for (const move of moves) {
    try {
      await fs.unlink(move.from);
    } catch (error) {
      logger.warn(
        `Relocated session ${sessionId}: could not remove companion transcript ${move.from}: ${errorMessageOf(error)}`,
      );
    }
  }

  return {
    relocated: true,
    copiedFiles: allMoves.length,
    from,
    to,
    headerUpdated: mainMove.headerUpdated,
  };
}

/**
 * 用于比较两个 workdir 是不是同一个目录：realpath（解开符号链接、抹平 `..` 与
 * 结尾斜杠），目录已不存在时退回 `resolve`。
 */
async function resolveWorkdirForComparison(workdir: string): Promise<string> {
  try {
    return await fs.realpath(workdir);
  } catch {
    return resolve(workdir);
  }
}

/** 路径上是否有东西（只有 ENOENT 算没有，其余错误如实抛出）。 */
async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function errorMessageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 尽力而为地删一串文件：清理失败不能盖住真正的错误。 */
async function removeFilesQuietly(paths: readonly (string | undefined)[]) {
  for (const targetPath of paths) {
    if (!targetPath) continue;
    try {
      await fs.unlink(targetPath);
    } catch {
      // 清理是尽力而为——原始错误更重要。
    }
  }
}

/**
 * 同 project 目录下**可归属**给 `sessionId` 的伴随转录（子代理的转录）。
 *
 * 仓库现有的命名约定里只有两处把文件归到某个会话：
 * - `subagent-<sessionId>.jsonl`：文件名里带着这个会话 id（`generateSubagentFilename`）；
 * - 以会话 id 命名的目录 `<sessionId>/`：目录名即归属声明，只搬它**顶层**的
 *   `.jsonl`（更深层次没有既有语义，不猜）。
 *
 * 子代理自己的 session id 是独立生成的（`subagentManager` 用 `randomUUID()`），
 * 所以同目录下别的 `subagent-*.jsonl` 归不到这个会话——一律不碰，绝不搬别人的文件。
 */
async function findCompanionTranscripts(
  sourceProjectDir: string,
  targetProjectDir: string,
  sessionId: string,
): Promise<TranscriptMove[]> {
  const moves: TranscriptMove[] = [];

  const subagentName = generateSubagentFilename(sessionId);
  const subagentPath = join(sourceProjectDir, subagentName);
  if (await pathExists(subagentPath)) {
    moves.push({
      from: subagentPath,
      to: join(targetProjectDir, subagentName),
    });
  }

  const companionDir = join(sourceProjectDir, sessionId);
  let entries: Dirent[];
  try {
    entries = await fs.readdir(companionDir, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // 没有这个目录（或同名的是个文件）就是没有伴随转录。
    if (code === "ENOENT" || code === "ENOTDIR") {
      return moves;
    }
    throw error;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    moves.push({
      from: join(companionDir, entry.name),
      to: join(targetProjectDir, sessionId, entry.name),
    });
  }

  return moves;
}

/**
 * 逐字节复制一份转录，顺手把首行 metadata 头里的 `workdir` 换成新目录。
 *
 * 流式：转录是只增不减的（线上见过 40 MB 以上的文件），整份读进内存的峰值是
 * 文件大小的好几倍，这里只把第一行攒起来解析，其余按块原样搬运。
 *
 * 不是 metadata 头（老转录）就整份原样复制，`headerUpdated: false`。
 */
async function copyTranscriptWithWorkdir(
  sourcePath: string,
  targetPath: string,
  workdir: string,
): Promise<{ headerUpdated: boolean; bytesWritten: number }> {
  const state = { headerUpdated: false, bytesWritten: 0 };
  await pipeline(
    transcriptChunksWithRewrittenHeader(sourcePath, workdir, state),
    createWriteStream(targetPath),
  );
  return state;
}

async function* transcriptChunksWithRewrittenHeader(
  sourcePath: string,
  workdir: string,
  state: { headerUpdated: boolean; bytesWritten: number },
): AsyncGenerator<Buffer> {
  let pending: Buffer = Buffer.alloc(0);
  let headerHandled = false;

  for await (const chunk of createReadStream(sourcePath)) {
    const buffer = chunk as Buffer;
    if (headerHandled) {
      state.bytesWritten += buffer.length;
      yield buffer;
      continue;
    }

    pending = pending.length === 0 ? buffer : Buffer.concat([pending, buffer]);
    const newlineIndex = pending.indexOf(0x0a);
    if (newlineIndex === -1) {
      // 第一行还没读完（或者这份文件根本没有换行）。
      continue;
    }

    const rawHeader = pending.subarray(0, newlineIndex).toString("utf8");
    const rewritten = rewriteMetadataHeaderWorkdir(rawHeader, workdir);
    state.headerUpdated = rewritten !== null;
    const header = Buffer.from(rewritten ?? rawHeader, "utf8");
    // 换行之后的部分逐字节照搬。
    const output = Buffer.concat([header, pending.subarray(newlineIndex)]);
    pending = Buffer.alloc(0);
    headerHandled = true;
    state.bytesWritten += output.length;
    yield output;
  }

  if (!headerHandled && pending.length > 0) {
    // 整个文件就一行、且没有结尾换行（中断的写入留下的残片）：原样搬过去。
    state.bytesWritten += pending.length;
    yield pending;
  }
}

/**
 * 把 metadata 头那一行的 `workdir` 换成 `workdir`，其余字段原样保留。
 *
 * 只有 `{"type":"metadata",...}` 才算头；老转录的第一行是消息，返回 null 表示
 * "没改"（调用方据此报 `headerUpdated: false`）。
 */
function rewriteMetadataHeaderWorkdir(
  line: string,
  workdir: string,
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const header = parsed as Record<string, unknown>;
  if (header.type !== "metadata") {
    return null;
  }

  // 给已有键赋新值是保序的，所以 `createdAt` / `gitBranch`（以及将来新增的字段）
  // 的键序与取值都不变。
  header.workdir = workdir;
  return JSON.stringify(header);
}

/**
 * Load session data from JSONL file (new approach)
 *
 * @param sessionId - UUID session identifier
 * @param workdir - Working directory for the session
 * @param sessionType - Type of session ("main" or "subagent", defaults to "main")
 * @returns Promise that resolves to session data or null if session doesn't exist
 */
export async function loadSessionFromJsonl(
  sessionId: string,
  workdir: string,
  sessionType: "main" | "subagent" = "main",
): Promise<SessionData | null> {
  try {
    // Generate the session file path directly using known session type
    const filePath = await generateSessionFilePath(
      sessionId,
      workdir,
      sessionType,
    );

    // Check if file exists
    let resolvedPath = filePath;
    try {
      await fs.access(resolvedPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        // Cross-project fallback: the session may live in a different project
        // directory (e.g. `wave --restore <id>` run from another cwd).
        const fallbackPath = await findSessionFileAcrossProjects(
          sessionId,
          sessionType,
        );
        if (!fallbackPath) {
          return null;
        }
        resolvedPath = fallbackPath;
      } else {
        throw error;
      }
    }

    const snapshot = await new JsonlHandler().readTranscriptForResume(
      resolvedPath,
    );

    const sessionData: SessionData = {
      id: sessionId,
      // The file this session actually lives in — possibly in another project
      // directory (the cross-project fallback above). Everything that writes
      // this session back must use it rather than a path re-derived from
      // `workdir`, which is the directory the caller happened to start in.
      transcriptPath: resolvedPath,
      messages: snapshot.messages,
      metadata: {
        workdir,
        lastActiveAt: snapshot.lastActiveAt ?? new Date().toISOString(),
        // Scan backwards for the last usage-bearing message instead of only
        // testing the tail: a resumed conversation gets usage-less meta
        // messages appended (SessionStart hooks), which would otherwise report
        // 0 and blank the context-usage indicator for that conversation.
        latestTotalTokens: extractLatestTotalTokens(snapshot.messages),
        // Recovered from the whole-file scan, not the tail window: a title the
        // conversation has long outgrown is only reachable this way. The host
        // holds it in memory so `reAppendSessionMetadata` puts it back at EOF.
        customTitle: snapshot.customTitle,
      },
      threadMessageCount: snapshot.threadMessageCount,
      firstUserText: snapshot.firstUserText,
      usages: snapshot.usages,
    };

    return sessionData;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check if the underlying error is ENOENT (file doesn't exist)
    if (
      errorMessage.includes("ENOENT") ||
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null; // Session file does not exist
    }

    // Check for JSON parsing errors (corrupted files)
    if (
      errorMessage.includes("Invalid JSON") ||
      errorMessage.includes("Unexpected token")
    ) {
      return null; // Treat corrupted files as non-existent
    }

    throw new Error(`Failed to load session ${sessionId}: ${error}`);
  }
}

/**
 * Get the most recently active session for a specific working directory (new JSONL approach)
 * Only returns main sessions, skips subagent sessions
 * Uses listSessionsFromJsonl which already sorts sessions by last active time (most recent first)
 *
 * @param workdir - Working directory to find the most recently active session for
 * @returns Promise that resolves to the most recently active session data or null if no sessions exist
 */
export async function getLatestSessionFromJsonl(
  workdir: string,
): Promise<SessionData | null> {
  const sessions = await listSessionsFromJsonl(workdir); // Excludes subagent sessions by default

  if (sessions.length === 0) {
    return null;
  }

  // Sessions are already sorted by lastActiveAt from listSessionsFromJsonl (most recent first)
  const latestSession = sessions[0];
  return loadSessionFromJsonl(latestSession.id, workdir);
}

/**
 * List all sessions for a specific working directory (convenience wrapper)
 * Only returns main sessions, skips subagent sessions
 *
 * @param workdir - Working directory to filter sessions by
 * @returns Promise that resolves to array of session metadata objects
 */
export async function listSessions(
  workdir: string,
): Promise<SessionMetadata[]> {
  return listSessionsFromJsonl(workdir); // Excludes subagent sessions by default
}

/**
 * List all sessions for a specific working directory using JSONL format (optimized approach)
 *
 * PERFORMANCE OPTIMIZATION:
 * - Uses filename parsing exclusively for session metadata
 * - Only reads last message for timestamps and token counts
 * - Eliminates O(n*2) file operations, achieving O(n) performance
 * - Returns simplified session metadata objects
 * - Only includes main sessions, excludes subagent sessions
 *
 * @param workdir - Working directory to filter sessions by
 * @returns Promise that resolves to array of session metadata objects
 */
export async function listSessionsFromJsonl(
  workdir: string,
): Promise<SessionMetadata[]> {
  try {
    const encoder = new PathEncoder();
    const baseDir = SESSION_DIR;

    const projectDir = await encoder.getProjectDirectory(workdir, baseDir);

    let files: string[];
    try {
      files = await fs.readdir(projectDir.encodedPath);
    } catch (error) {
      // If project directory doesn't exist, return empty array
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const sessions: SessionMetadata[] = [];

    for (const file of files) {
      if (!file.endsWith(".jsonl")) {
        continue;
      }

      // EARLY FILTERING: Skip subagent sessions by filename prefix for maximum performance
      if (file.startsWith("subagent-")) {
        continue;
      }

      try {
        const filePath = join(projectDir.encodedPath, file);

        // Validate main session filename format (UUID.jsonl)
        const uuidMatch = file.match(
          /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/,
        );
        if (!uuidMatch) {
          continue; // Skip invalid filenames
        }

        const sessionId = uuidMatch[1];

        // PERFORMANCE OPTIMIZATION: Only read the last message for timestamps and tokens
        const jsonlHandler = new JsonlHandler();
        const lastMessage = await jsonlHandler.getLastMessage(filePath);

        // Creation-time metadata (workdir is not needed here — the project
        // dir gives the original path — but createdAt / branch are).
        const header = await jsonlHandler.readMetadata(filePath);

        // Handle timing information efficiently
        let lastActiveAt: Date;

        if (lastMessage) {
          lastActiveAt = new Date(lastMessage.timestamp);
        } else {
          // Empty session file - use file modification time
          const stats = await fs.stat(filePath);
          lastActiveAt = stats.mtime;
        }

        // Return inline object for performance (no interface instantiation overhead)
        const sessionMeta: SessionMetadata = {
          id: sessionId,
          sessionType: "main",
          subagentType: undefined,
          workdir: projectDir.originalPath,
          createdAt: header?.createdAt
            ? new Date(header.createdAt)
            : new Date(),
          lastActiveAt,
          // Scans the file tail: a resumed session's last line is a usage-less
          // hook message, so the line alone would report 0 tokens here.
          latestTotalTokens: await jsonlHandler.getLatestTotalTokens(filePath),
          branch: header?.gitBranch,
        };

        // Try to get first message content for display
        try {
          const firstContent = await getFirstMessageContent(sessionId, workdir);
          if (firstContent) {
            sessionMeta.firstMessage = firstContent;
          }
        } catch {
          // Ignore errors getting first message
        }

        // A user-set title, when present, wins over the first-message label.
        sessionMeta.customTitle = await jsonlHandler.readCustomTitle(filePath);

        sessions.push(sessionMeta);
      } catch {
        // Skip corrupted session files
        continue;
      }
    }

    // Sort by last active time (most recently active first)
    return sessions.sort(
      (a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime(),
    );
  } catch (error) {
    throw new Error(`Failed to list sessions: ${error}`);
  }
}

/**
 * List all sessions across all project directories.
 *
 * When `worktreePaths` is provided, only project directories that match a
 * same-repo git worktree (plus the current working directory's own project
 * dir) are scanned — used by the `wave -r` picker's worktree aggregation
 * (`Ctrl+W`). When omitted, every project directory under the sessions dir
 * is scanned (all-projects mode, `Ctrl+A`).
 *
 * No time-based filtering is applied — all sessions whose files still exist
 * are listed, regardless of how long ago they were last active.
 *
 * @param options.worktreePaths - Absolute paths of same-repo worktrees
 *   (from `git worktree list`). When provided, scanning is limited to
 *   matching project directories.
 * @param options.workdir - Current working directory. Its own project dir is
 *   always included in worktree mode so sessions created from a subdirectory
 *   inside a worktree are not missed.
 * @returns Promise that resolves to array of session metadata objects,
 *   deduplicated by sessionId (newest lastActiveAt wins), sorted by
 *   lastActiveAt descending.
 */
export async function listAllSessions(options?: {
  worktreePaths?: string[];
  workdir?: string;
}): Promise<SessionMetadata[]> {
  try {
    const { worktreePaths, workdir } = options ?? {};
    const baseDir = SESSION_DIR;
    let projectDirs: string[];
    try {
      projectDirs = await fs.readdir(baseDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }

    // Worktree-aware mode: only scan project dirs that match a same-repo
    // worktree path. Prefixes are sorted longest-first so a short prefix like
    // "home-user-repo" cannot swallow "home-user-repo-wt" (short paths require
    // exact match; prefix + "-" matching only kicks in for paths truncated by
    // the 200-char encoding limit, mirroring Claude Code's session listing).
    // Each entry also carries the real path so matching dirs can display it
    // instead of the lossy decodeSync of the encoded name.
    const encoder = new PathEncoder();
    const caseInsensitive = process.platform === "win32";
    let indexed: { prefix: string; path?: string }[] | null = null;
    if (worktreePaths && worktreePaths.length > 0) {
      indexed = [];
      const seen = new Set<string>();
      for (const wt of worktreePaths) {
        let encoded: string;
        try {
          encoded = await encoder.encode(wt);
        } catch {
          encoded = encoder.encodeSync(wt);
        }
        const prefix = caseInsensitive ? encoded.toLowerCase() : encoded;
        if (seen.has(prefix)) continue;
        seen.add(prefix);
        indexed.push({ prefix, path: wt });
      }
      indexed.sort((a, b) => b.prefix.length - a.prefix.length);
      // Always include the current working directory's own project dir —
      // the cwd may be a subdirectory inside a worktree whose root prefix
      // does not match (short-path matching is exact-only).
      if (workdir) {
        let encodedCwd: string;
        try {
          encodedCwd = await encoder.encode(workdir);
        } catch {
          encodedCwd = encoder.encodeSync(workdir);
        }
        const prefix = caseInsensitive ? encodedCwd.toLowerCase() : encodedCwd;
        if (!seen.has(prefix)) {
          seen.add(prefix);
          indexed.push({ prefix, path: workdir });
        }
      }
    }

    const allSessions: SessionMetadata[] = [];
    const MAX_ENCODED_PREFIX_LENGTH = 200;

    for (const projectDirName of projectDirs) {
      const projectPath = join(baseDir, projectDirName);
      try {
        const stat = await fs.stat(projectPath);
        if (!stat.isDirectory()) {
          continue;
        }

        // The indexed match (worktree mode) carries the real path of the
        // worktree / cwd that encoded to this dir name.
        let matchedIndexed: { prefix: string; path?: string } | undefined;
        if (indexed) {
          const dirName = caseInsensitive
            ? projectDirName.toLowerCase()
            : projectDirName;
          matchedIndexed = indexed.find(
            ({ prefix }) =>
              dirName === prefix ||
              (prefix.length >= MAX_ENCODED_PREFIX_LENGTH &&
                dirName.startsWith(prefix + "-")),
          );
          if (!matchedIndexed) continue;
        }

        // Decode the encoded directory name back to the original project
        // path for display; fall back to the encoded name when the path was
        // truncated with a hash suffix (lossy, cannot be reliably reversed).
        const decodedWorkdir =
          encoder.decodeSync(projectDirName) ?? projectDirName;

        // Scan .jsonl files in the project directory
        const files = await fs.readdir(projectPath);

        for (const file of files) {
          if (!file.endsWith(".jsonl") || file.startsWith("subagent-")) {
            continue;
          }

          try {
            const filePath = join(projectPath, file);
            const uuidMatch = file.match(
              /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/,
            );
            if (!uuidMatch) continue;

            const sessionId = uuidMatch[1];
            const jsonlHandler = new JsonlHandler();
            const lastMessage = await jsonlHandler.getLastMessage(filePath);

            // Creation-time metadata — read per file: branch can differ
            // between sessions created in the same directory over time.
            const header = await jsonlHandler.readMetadata(filePath);

            let lastActiveAt: Date;
            if (lastMessage) {
              lastActiveAt = new Date(lastMessage.timestamp);
            } else {
              const stats = await fs.stat(filePath);
              lastActiveAt = stats.mtime;
            }

            // Populate the first-message preview like listSessionsFromJsonl
            // does, so aggregated modes (Ctrl+A / Ctrl+W) show real content
            // instead of the "No content" fallback.
            let firstMessage: string | undefined;
            try {
              const firstContent =
                await getFirstMessageContentFromFile(filePath);
              if (firstContent) {
                firstMessage = firstContent;
              }
            } catch {
              // Ignore errors getting first message
            }

            // Prefer the real worktree path, then the persisted metadata
            // header, then the lossy decodeSync fallback for legacy files.
            const workdir =
              matchedIndexed?.path ?? header?.workdir ?? decodedWorkdir;

            allSessions.push({
              id: sessionId,
              sessionType: "main" as const,
              subagentType: undefined,
              workdir,
              createdAt: header?.createdAt
                ? new Date(header.createdAt)
                : new Date(),
              lastActiveAt,
              // Scans the file tail: a resumed session's last line is a
              // usage-less hook message, so the line alone would report 0.
              latestTotalTokens:
                await jsonlHandler.getLatestTotalTokens(filePath),
              firstMessage,
              customTitle: await jsonlHandler.readCustomTitle(filePath),
              branch: header?.gitBranch,
            });
          } catch {
            continue;
          }
        }
      } catch {
        // Skip if stat/readdir fails
      }
    }

    // Deduplicate by sessionId — the same session can appear in multiple
    // project dirs (e.g. worktree branches). Keep the newest lastActiveAt.
    const byId = new Map<string, SessionMetadata>();
    for (const session of allSessions) {
      const existing = byId.get(session.id);
      if (
        !existing ||
        session.lastActiveAt.getTime() > existing.lastActiveAt.getTime()
      ) {
        byId.set(session.id, session);
      }
    }

    return [...byId.values()].sort(
      (a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime(),
    );
  } catch (error) {
    throw new Error(`Failed to list all sessions: ${error}`);
  }
}

/**
 * Clean up empty project directories in the session directory
 */
export async function cleanupEmptyProjectDirectories(): Promise<void> {
  // Do not perform cleanup operations in test environment
  if (process.env.NODE_ENV === "test") {
    return;
  }

  try {
    const baseDir = SESSION_DIR;
    const projectDirs = await fs.readdir(baseDir);

    for (const projectDirName of projectDirs) {
      const projectPath = join(baseDir, projectDirName);
      const stat = await fs.stat(projectPath);

      if (stat.isDirectory()) {
        try {
          const files = await fs.readdir(projectPath);

          // If directory is empty, remove it
          if (files.length === 0) {
            await fs.rmdir(projectPath);
          }
        } catch {
          // Skip errors for directories we can't read or remove
          continue;
        }
      }
    }
  } catch {
    // Ignore errors if base directory doesn't exist or can't be accessed
  }
}

/**
 * Completion marker for the one-time meta-only sweep. Once it exists, no further
 * sweep runs on this machine (see `cleanupMetaOnlySessions`).
 */
export const META_ONLY_SWEEP_MARKER = join(
  homedir(),
  ".wave",
  ".meta-only-sweep-done",
);

/**
 * Clean up "ghost" session files that contain only meta messages
 * (isMeta: true) — e.g. sessions where a SessionStart hook injected a
 * system-reminder but no real user/assistant message was ever sent.
 *
 * Such sessions are no longer created thanks to lazy materialization in
 * saveSession(); this **one-time** sweep removes files that predate that change
 * so they stop showing up as "0 tokens / No content" entries in the resume
 * list. It writes `META_ONLY_SWEEP_MARKER` on the first run and returns 0 on
 * every run after it.
 *
 * Being one-time is not an optimization, it is what keeps it from eating real
 * sessions: a session that legitimately has no messages any more — `/rewind`
 * back to the first user message leaves the file holding just the metadata
 * header plus the SessionStart reminder — is indistinguishable from an old
 * ghost. Sweeping on every agent init deleted exactly that file while the
 * desktop sidebar kept listing it (spec ui/session-management.md「会话延迟物化」
 * 验收场景 6).
 *
 * @returns Promise that resolves to the number of files deleted
 */
export async function cleanupMetaOnlySessions(): Promise<number> {
  // Do not perform cleanup operations in test environment
  if (process.env.NODE_ENV === "test") {
    return 0;
  }

  // Already swept on this machine — a later meta-only file is not a legacy
  // ghost (see the doc comment).
  try {
    await fs.access(META_ONLY_SWEEP_MARKER);
    return 0;
  } catch {
    // No marker yet: this is the first run, sweep below.
  }

  let deletedCount = 0;
  try {
    const projectDirs = await fs.readdir(SESSION_DIR);

    for (const projectDirName of projectDirs) {
      const projectPath = join(SESSION_DIR, projectDirName);
      try {
        const stat = await fs.stat(projectPath);
        if (!stat.isDirectory()) {
          continue;
        }

        const files = await fs.readdir(projectPath);
        for (const file of files) {
          if (!file.endsWith(".jsonl")) {
            continue;
          }

          const filePath = join(projectPath, file);
          try {
            // Fast path: a file whose last message is not meta contains a
            // real message, so it can never be meta-only.
            const jsonlHandler = new JsonlHandler();
            const lastMessage = await jsonlHandler.getLastMessage(filePath);
            if (!lastMessage?.isMeta) {
              continue;
            }

            const messages = await jsonlHandler.read(filePath);
            if (messages.length > 0 && messages.every((m) => m.isMeta)) {
              await fs.unlink(filePath);
              deletedCount++;
            }
          } catch {
            // Skip corrupted or unreadable files
            continue;
          }
        }
      } catch {
        // Skip directories we can't access
        continue;
      }
    }
  } catch {
    // Ignore errors if base directory doesn't exist or can't be accessed
  }

  // Written even when nothing was deleted: the point is "this machine has been
  // swept", and a half-scanned retry would re-open the door to deleting real
  // empty sessions later.
  try {
    await fs.mkdir(join(homedir(), ".wave"), { recursive: true });
  } catch {
    // ~/.wave essentially always exists; if it cannot be created the write
    // below reports the real error.
  }
  try {
    await fs.writeFile(
      META_ONLY_SWEEP_MARKER,
      new Date().toISOString(),
      "utf8",
    );
  } catch (error) {
    logger.warn("Failed to write the meta-only sweep marker:", error);
  }

  return deletedCount;
}

/**
 * Check if a session exists in JSONL storage (new approach)
 *
 * @param sessionId - UUID session identifier
 * @param workdir - Working directory for the session
 * @param sessionType - Type of session ("main" or "subagent"). If not provided, checks both types.
 * @returns Promise that resolves to true if session exists, false otherwise
 */
export async function sessionExistsInJsonl(
  sessionId: string,
  workdir: string,
  sessionType?: "main" | "subagent",
): Promise<boolean> {
  try {
    if (sessionType) {
      // If session type is known, check directly
      const filePath = await generateSessionFilePath(
        sessionId,
        workdir,
        sessionType,
      );
      await fs.access(filePath);
      return true;
    } else {
      // If session type is unknown, try both
      const mainPath = await generateSessionFilePath(
        sessionId,
        workdir,
        "main",
      );
      try {
        await fs.access(mainPath);
        return true;
      } catch {
        const subagentPath = await generateSessionFilePath(
          sessionId,
          workdir,
          "subagent",
        );
        try {
          await fs.access(subagentPath);
          return true;
        } catch {
          return false;
        }
      }
    }
  } catch {
    return false;
  }
}

/**
 * Get the content of the first non-meta message in a session file
 * For user role: get text block content
 * For assistant role: get compact block content
 * Skips meta messages (isMeta: true) to find the first meaningful message
 * @param filePath - Path to the session JSONL file
 * @returns Promise that resolves to the first non-meta message content or null if not found
 */
export async function getFirstMessageContentFromFile(
  filePath: string,
): Promise<string | null> {
  try {
    // Read first N lines to skip meta messages
    const { readFirstNLines } = await import("../utils/fileUtils.js");
    const lines = await readFirstNLines(filePath, 10);

    for (const line of lines) {
      try {
        const message = JSON.parse(line) as Message & { type?: string };

        // Skip reserved entries (metadata header, custom-title) and meta messages
        if (isReservedEntry(message.type) || message.isMeta) {
          continue;
        }

        const content = getMessageContent(message);
        if (content) {
          return content;
        }
      } catch (error) {
        logger.warn(
          `Failed to parse message in session file ${filePath}:`,
          error,
        );
      }
    }

    return null;
  } catch (error) {
    logger.warn(`Failed to get first message content from ${filePath}:`, error);
    return null;
  }
}

/**
 * Get the content of the first non-meta message in a session
 * For user role: get text block content
 * For assistant role: get compact block content
 * Skips meta messages (isMeta: true) to find the first meaningful message
 * @param sessionId - Session ID to get first message from
 * @param workdir - Working directory for session operations
 * @returns Promise that resolves to the first non-meta message content or null if not found
 */
export async function getFirstMessageContent(
  sessionId: string,
  workdir: string,
): Promise<string | null> {
  try {
    const encoder = new PathEncoder();
    const baseDir = SESSION_DIR;

    const projectDir = await encoder.getProjectDirectory(workdir, baseDir);
    const filePath = join(projectDir.encodedPath, `${sessionId}.jsonl`);

    return getFirstMessageContentFromFile(filePath);
  } catch (error) {
    logger.warn(
      `Failed to get first message content for session ${sessionId}:`,
      error,
    );
    return null;
  }
}

/**
 * Delete a session
 * @param sessionId - UUID session identifier
 * @param workdir - Working directory for the session
 * @param sessionType - Type of session ("main" or "subagent", defaults to "main")
 */
export async function deleteSession(
  sessionId: string,
  workdir: string,
  sessionType: "main" | "subagent" = "main",
): Promise<void> {
  const filePath = await generateSessionFilePath(
    sessionId,
    workdir,
    sessionType,
  );
  try {
    await fs.unlink(filePath);
  } catch (error) {
    // Ignore if file doesn't exist
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

/**
 * Truncate content to a maximum length, adding ellipsis if truncated.
 * Also replaces real newlines with the literal string "\n".
 * @param content - The content to truncate
 * @param maxLength - Maximum length before truncation (default: 100)
 * @returns Truncated content with ellipsis if needed
 */
export function truncateContent(
  content: string,
  maxLength: number = 100,
): string {
  // Replace real newlines with literal "\n"
  const singleLineContent = content.replace(/\n/g, "\\n");

  if (singleLineContent.length <= maxLength) {
    return singleLineContent;
  }
  return singleLineContent.substring(0, maxLength) + "...";
}

/**
 * Handle session restoration logic
 * @param restoreSessionId - Specific session ID to restore
 * @param continueLastSession - Whether to continue the most recent session
 * @param workdir - Working directory for session restoration
 * @returns Promise that resolves to session data or undefined
 */
export async function handleSessionRestoration(
  restoreSessionId?: string,
  continueLastSession?: boolean,
  workdir?: string,
): Promise<SessionData | undefined> {
  if (!workdir) {
    throw new Error("Working directory is required for session restoration");
  }

  if (!restoreSessionId && !continueLastSession) {
    return;
  }

  try {
    let sessionToRestore: SessionData | null = null;

    if (restoreSessionId) {
      // Use only JSONL format - no legacy support
      sessionToRestore = await loadSessionFromJsonl(restoreSessionId, workdir);
      if (!sessionToRestore) {
        // loadSessionFromJsonl already scans every project directory as a
        // fallback — reaching here means the session does not exist anywhere.
        // Surface a clear error instead of silently starting a fresh session.
        throw new Error(`Session ${restoreSessionId} not found on disk`);
      }
    } else if (continueLastSession) {
      // Use only JSONL format - no legacy support
      sessionToRestore = await getLatestSessionFromJsonl(workdir);
      if (!sessionToRestore) {
        throw new Error(`No previous session found for workdir: ${workdir}`);
      }
    }

    if (sessionToRestore) {
      // Debug only — never stdout: `wave --stdio`'s stdout carries the JSON-RPC
      // channel, and a stray line there makes the host log a parse failure for
      // every restore (the logger writes to the log file). Kept at debug so a
      // restore of a long-lived session does not add a line to every startup.
      logger.debug(`Restoring session: ${sessionToRestore.id}`);

      // // Initialize from session data
      // this.initializeFromSession();
      return sessionToRestore;
    }
  } catch (error) {
    console.error("Failed to restore session:", error);
    throw error;
  }
}

/**
 * Load the full message thread for a session.
 * With append-only compaction, all messages are in a single file.
 * Unlike loadSessionFromJsonl, this returns every message in the file,
 * including those before the last compact boundary — rewind needs the
 * complete history to allow rewinding past compaction points.
 * @param currentSessionId - The ID of the current session
 * @param workdir - Working directory for the session
 * @returns Promise that resolves to an array of all messages in the thread
 */
export async function loadFullMessageThread(
  currentSessionId: string,
  workdir: string,
): Promise<{ messages: Message[]; sessionIds: string[] }> {
  const jsonlHandler = new JsonlHandler();
  const filePath = await generateSessionFilePath(
    currentSessionId,
    workdir,
    "main",
  );

  try {
    await fs.access(filePath);
  } catch {
    return { messages: [], sessionIds: [] };
  }

  const messages = await jsonlHandler.read(filePath);
  return { messages, sessionIds: [currentSessionId] };
}

/**
 * 取 `/rewind` 的检查点表：扫一遍转录，每个候选只投影成
 * `{id, content, index}`，整份线程一个对象都不留。
 *
 * 与 `loadFullMessageThread` 的差别只是「要什么」：那边要每条消息的完整内容
 * （回滚后还要把消息重新发给模型），这边只列选择器上的几行——读同一条转录，
 * 峰值差着工具结果里那些 base64 图片。
 *
 * 压缩是 append-only：同 id 的消息可能写了两次（压缩前历史 + 压缩后 append 的
 * 重复），用户看到的折叠视图对应**最后一次出现**，所以按 id 去重保留后者。
 */
export async function loadRewindCheckpoints(
  currentSessionId: string,
  workdir: string,
): Promise<RewindCheckpoint[]> {
  const filePath = await generateSessionFilePath(
    currentSessionId,
    workdir,
    "main",
  );

  try {
    await fs.access(filePath);
  } catch {
    return [];
  }

  const byId = new Map<string, RewindCheckpoint>();
  await scanTranscriptMessages(filePath, (message, index) => {
    const checkpoint = toRewindCheckpoint(message, index);
    if (!checkpoint) return;
    byId.delete(checkpoint.id);
    byId.set(checkpoint.id, checkpoint);
  });
  return [...byId.values()];
}

/**
 * 按 id 找一个回滚目标：给出它在完整线程里的位置与文本（`/rewind` 选中后要
 * 沿着 `index` 截断，并把那段文本放回输入框）。
 *
 * 与 `loadRewindCheckpoints` 同一手法：扫一遍转录、只留命中项，不为一条消息的
 * 下标与一段文本读整份线程。同 id 多次出现时取最后一次（与检查点表口径一致）。
 */
export async function findRewindTarget(
  currentSessionId: string,
  workdir: string,
  messageId: string,
): Promise<{ index: number; content: string } | undefined> {
  const filePath = await generateSessionFilePath(
    currentSessionId,
    workdir,
    "main",
  );

  try {
    await fs.access(filePath);
  } catch {
    return undefined;
  }

  let found: { index: number; content: string } | undefined;
  await scanTranscriptMessages(filePath, (message, index) => {
    if (message.id !== messageId) return;
    found = { index, content: getMessageContent(message) };
  });
  return found;
}

/**
 * 扫一遍转录，切出一次回滚要的两段（`kept` / `removed`）与两条计数。
 *
 * 与 `loadFullMessageThread` 的差别是「要什么」：那边把整条线程的消息对象全给
 * 调用方，而回滚真正需要的是「压缩后留下的那一段」+「真被裁掉的那一段的文件
 * 快照来源」——中间那一大段（压缩前的历史里、index 之前的部分）造出来就为了
 * 被扔掉。
 *
 * 文件不存在时返回空切分（`threadMessageCount: 0`），调用方据此报 index 越界，
 * 与「会话从未落盘」的既有行为一致。
 */
export async function loadRewindCut(
  currentSessionId: string,
  workdir: string,
  index: number,
  transcriptPath?: string,
): Promise<RewindCut> {
  const filePath =
    transcriptPath ??
    (await generateSessionFilePath(currentSessionId, workdir, "main"));

  try {
    await fs.access(filePath);
  } catch {
    return { kept: [], removed: [], threadMessageCount: 0 };
  }

  const accumulator = createRewindCutAccumulator(index);
  await forEachTranscriptEntry(filePath, accumulator.push);
  return accumulator.cut();
}
