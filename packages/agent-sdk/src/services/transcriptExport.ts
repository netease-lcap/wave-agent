/**
 * 导出会话转录（`/export`）在 SDK 侧的那一半：**读整份转录**、去重、统计，
 * 以及默认文件名。把转录渲染成文字是宿主的事（CLI 用 Ink 组件渲染再剥 ANSI，
 * 与 Claude Code 同一条路），这里不碰显示。
 *
 * 为什么不复用 `loadFullMessageThread()`：它读不到文件时返回空数组，`/export`
 * 无法区分「这份转录已被清理」和「读失败」，而 `cleanupPeriodDays` 默认 30 天
 * 就会清掉转录（`utils/sessionCleanup.ts`），用户真会撞上。这里显式 stat 一次，
 * 把两种情况分成两个 reason 抛出去。
 */
import { stat } from "fs/promises";
import type { Message } from "../types/messaging.js";
import { forEachTranscriptEntry } from "./sessionEntries.js";

/** 导出读不到转录的两种原因；宿主据此给不同的话。 */
export type TranscriptUnavailableReason = "missing" | "unreadable";

export class TranscriptUnavailableError extends Error {
  constructor(
    public readonly reason: TranscriptUnavailableReason,
    message: string,
    /** 原始错误，宿主排查用。手写字段（本包 lib 里没有 `Error` 的 `cause` 选项）。 */
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TranscriptUnavailableError";
  }
}

/**
 * 读不到转录时给用户看的那句话。两个宿主（CLI 的 `/export`、桌面端的归档导出）
 * 共用它，所以「被 `cleanupPeriodDays` 清掉了」与「读失败」永远说成两句不同的
 * 话——前者是正常终态（等也没用），后者是用户可以报上来的问题。
 */
export function describeTranscriptUnavailable(
  error: TranscriptUnavailableError,
): string {
  return error.reason === "missing"
    ? `${error.message}. It may have been removed by cleanupPeriodDays (default 30 days).`
    : `Failed to export conversation: ${error.message}`;
}

export interface TranscriptExportStats {
  /**
   * **真实对话**的条数（去重后，不含注入消息）。两个宿主导出的正文都跳过
   * `isMeta`，所以这里是「读者在导出内容里看到的条数」。
   */
  messages: number;
  /**
   * 跳过的注入消息条数（`isMeta`：`<system-reminder>`、技能清单之类）。
   *
   * 单列而不是并进 `messages`：`messages` 是给人看的规模，几百行 system-reminder
   * 混进去会让「怎么才两条对话却写着二十条」变成一个新的疑问；但完全不提又会让
   * 拿归档排障的人以为转录缺了几条。所以两者分开算、分开写。
   */
  injectedMessages: number;
  /** 工具调用次数（每条 `tool` 块算一次；只看真实对话）。 */
  toolCalls: number;
  /** 转录里内联的图片张数（`image` 块 + 工具结果带的图；只看真实对话）。 */
  images: number;
}

export interface TranscriptExport {
  messages: Message[];
  stats: TranscriptExportStats;
  /** 转录文件的字节数（`stat` 的结果；桌面端用它判定 50 MB 上限）。 */
  bytes: number;
  /** 用户起过的会话标题（`custom-title` 条目里最后一条）。 */
  customTitle?: string;
}

export function countTranscriptStats(
  messages: readonly Message[],
): TranscriptExportStats {
  let injectedMessages = 0;
  let toolCalls = 0;
  let images = 0;
  for (const message of messages) {
    // 注入消息整条跳过：它既不是读者要看的对话，也不是这次的规模。
    if (message.isMeta) {
      injectedMessages++;
      continue;
    }
    for (const block of message.blocks) {
      if (block.type === "tool") {
        toolCalls++;
        images += block.images?.length ?? 0;
      } else if (block.type === "image") {
        images += block.imageUrls?.length ?? 1;
      }
    }
  }
  return {
    messages: messages.length - injectedMessages,
    injectedMessages,
    toolCalls,
    images,
  };
}

/**
 * 读一份完整转录，交给宿主导出。
 *
 * 与恢复（`loadSessionFromJsonl`）的口径不同：导出要**整条线程**，压缩之前的
 * 轮次也在里面——那正是用户导出时想看的东西。所以这里不切压缩边界。
 *
 * 老转录在每个压缩点会把保留的轮次重写一遍（append-only 修复前），同一个 id
 * 因此在文件里出现两次；内容取**最后一次**（用户看到的是那一份，与分页读
 * `utils/transcriptPage.ts` 的判据一致），位置留在首次出现处——重写是同样顺序
 * 的整段重放，两者本就等价。
 */
export async function loadTranscriptForExport(
  filePath: string,
): Promise<TranscriptExport> {
  let bytes = 0;
  try {
    bytes = (await stat(filePath)).size;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new TranscriptUnavailableError(
        "missing",
        `Session transcript not found: ${filePath}`,
        error,
      );
    }
    throw new TranscriptUnavailableError(
      "unreadable",
      `Failed to read session transcript: ${
        error instanceof Error ? error.message : String(error)
      }`,
      error,
    );
  }

  const messages: Message[] = [];
  const indexById = new Map<string, number>();
  let customTitle: string | undefined;
  try {
    await forEachTranscriptEntry(filePath, (entry) => {
      if (entry.kind === "custom-title") {
        // 重命名是追加：最后一条才是用户当前看到的标题。
        customTitle = entry.customTitle;
        return;
      }
      if (entry.kind !== "message") return;
      const { message } = entry;
      const id = message.id;
      if (!id) {
        messages.push(message);
        return;
      }
      const existing = indexById.get(id);
      if (existing !== undefined) {
        messages[existing] = message;
        return;
      }
      indexById.set(id, messages.length);
      messages.push(message);
    });
  } catch (error) {
    throw new TranscriptUnavailableError(
      "unreadable",
      `Failed to read session transcript: ${
        error instanceof Error ? error.message : String(error)
      }`,
      error,
    );
  }

  return {
    messages,
    stats: countTranscriptStats(messages),
    bytes,
    ...(customTitle === undefined ? {} : { customTitle }),
  };
}

/**
 * 导出文件名的日期部分：`yyyy-MM-ddHHmmss`（时分秒之间没有分隔符，与 Claude
 * Code 的 `formatTimestamp` 逐字对齐）。
 */
export function formatExportTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}-${hours}${minutes}${seconds}`;
}

/**
 * 首条用户输入（默认文件名的主语）：只取首行，超过 50 字符截断加省略号
 * （Claude Code 的 `extractFirstPrompt`）。
 */
export function extractFirstPrompt(messages: readonly Message[]): string {
  const firstUserMessage = messages.find(
    (message) => message.role === "user" && !message.isMeta,
  );
  if (!firstUserMessage) return "";
  const textBlock = firstUserMessage.blocks.find(
    (block) => block.type === "text",
  );
  const raw = textBlock?.type === "text" ? textBlock.content.trim() : "";
  // 只留首行，再限长。
  let result = raw.split("\n")[0] ?? "";
  if (result.length > 50) {
    result = result.substring(0, 49) + "…";
  }
  return result;
}

/**
 * 文件名净化（Claude Code 的 `sanitizeFilename` 逐字对齐）：转小写、去掉
 * `a-z0-9`/空白/连字符以外的一切、空白与连续连字符都收成一个连字符。中文标题
 * 因此会被清空——调用方回退到 `conversation-<timestamp>.txt`。
 */
export function sanitizeFilename(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** 默认文件名：`<timestamp>-<首条输入的 slug>.txt`，取不到 slug 时 `conversation-<timestamp>.txt`。 */
export function buildExportFilename(
  messages: readonly Message[],
  date: Date,
): string {
  const timestamp = formatExportTimestamp(date);
  const sanitized = sanitizeFilename(extractFirstPrompt(messages));
  return sanitized
    ? `${timestamp}-${sanitized}.txt`
    : `conversation-${timestamp}.txt`;
}

/**
 * 后缀强制为 `.txt`：已经是 `.txt` 就不动，别的后缀（含没有后缀）都换掉
 * （Claude Code 的 `filename.endsWith('.txt') ? … : filename.replace(/\.[^.]+$/, '') + '.txt'`）。
 */
export function ensureTxtExtension(filename: string): string {
  return filename.endsWith(".txt")
    ? filename
    : filename.replace(/\.[^.]+$/, "") + ".txt";
}
