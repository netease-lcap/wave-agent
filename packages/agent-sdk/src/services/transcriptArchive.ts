/**
 * `/export` 的「可读版 + 归档」那一半：把转录渲染成 Markdown、拼出
 * `manifest.json`，并把这三样东西（可读版 / 原始字节 / 清单）一次算好。
 *
 * 为什么和 `transcriptExport.ts` 分开：那一半只回答「转录里有哪些消息」，这一半
 * 只回答「人读起来是什么样、归档里该写什么」。分开之后 CLI 的纯文本 `/export`
 * 完全不碰这里（它渲染的是自己的 Ink 组件），桌面端的归档也不会把 CLI 的渲染器
 * 拖进 SDK。
 *
 * 与 Claude Code 的差别写在 spec `commands/export-command.md` 的「对齐说明」里：
 * CC 的导出是屏幕渲染 + 剥 ANSI，桌面端的归档要能被别人（支持人员、另一个
 * 编辑器）打开，所以这里走 Markdown，且**绝不写入图片 base64**——一张 4 MB 的
 * 截图就能让归档从「能发出去」变成「发不出去」。
 */
import { open, readFile } from "fs/promises";
import type { Message, ToolBlock } from "../types/messaging.js";
import type { TranscriptExportArchive } from "../types/transcriptExport.js";
import {
  loadTranscriptForExport,
  type TranscriptExportStats,
} from "./transcriptExport.js";

/** 原始转录的导出上限；超过它只导出可读版（spec commands/export-command.md）。 */
export const TRANSCRIPT_EXPORT_MAX_JSONL_BYTES = 50 * 1024 * 1024;

/** 工具结果进代码块的行数上限——够看清结论，又不至于让人翻十屏。 */
const TOOL_RESULT_MAX_LINES = 30;

/** 一行式摘要（参数、任务结果）的字数上限。 */
const ONE_LINE_MAX_CHARS = 200;

/** 可读版顶部那段会话事实，取自转录头与调用方。 */
export interface TranscriptMarkdownMeta {
  /** 会话标题（`custom-title` 里最后一条）；缺省时用「会话记录」。 */
  title?: string;
  workdir?: string;
  gitBranch?: string;
  /** 会话创建时间（转录头的 `createdAt`）。 */
  createdAt?: string;
  /** 导出时间。 */
  exportedAt?: string;
  stats: TranscriptExportStats;
}

/**
 * 可读版全文。规则见 spec「导出内容的口径」：
 *
 * - `text` 按角色分节（`## 用户` / `## 助手`）；
 * - `compact` 自成 `## 上下文压缩` 一节；
 * - `reasoning` 一律跳过（hidden thinking 不是对话内容，`redacted` 更是只剩一个
 *   不透明载荷，写进去也读不了）；
 * - `tool` 一行调用摘要 + 结果前 30 行；
 * - `image` 只写 `[图片：WxH / mediaType]`，**不写 base64**；
 * - `notice` 用 `> [!级别]` 引用块；
 * - `file_history` / `task_notification` 一行摘要；
 * - `isMeta` 的消息**整条跳过**（与 CLI 的纯文本导出同口径）：注入的
 *   `<system-reminder>` / 技能清单动辄几百行，写进归档只会淹没真实对话。跳过多少条
 *   记在 `stats.injectedMessages` 里，规模行与 `manifest.json` 会交代。
 */
export function renderTranscriptMarkdown(
  messages: readonly Message[],
  meta: TranscriptMarkdownMeta,
): string {
  const facts: string[] = [];
  if (meta.workdir) facts.push(`- 工作目录：\`${meta.workdir}\``);
  if (meta.gitBranch) facts.push(`- Git 分支：${oneLine(meta.gitBranch)}`);
  if (meta.createdAt) facts.push(`- 创建时间：${meta.createdAt}`);
  if (meta.exportedAt) facts.push(`- 导出时间：${meta.exportedAt}`);
  const scale = [
    `${meta.stats.messages} 条消息`,
    `${meta.stats.toolCalls} 次工具调用`,
  ];
  if (meta.stats.images > 0) scale.push(`${meta.stats.images} 张图片`);
  // 有跳过就把「跳了多少」顺带说一句，否则读者拿对话条数去核对转录行数会以为缺了。
  const skipped =
    meta.stats.injectedMessages > 0
      ? `（另跳过 ${meta.stats.injectedMessages} 条注入消息）`
      : "";
  facts.push(`- 规模：${scale.join(" · ")}${skipped}`);

  const sections = messages
    .filter((message) => !message.isMeta)
    .map((message) => renderMessage(message))
    .filter((section) => section.length > 0);
  const title = meta.title?.trim() || "会话记录";

  return `${[`# ${title}`, facts.join("\n"), ...sections]
    .filter((block) => block.trim().length > 0)
    .join("\n\n")
    .trimEnd()}\n`;
}

function renderMessage(message: Message): string {
  const parts: string[] = [];
  let roleHeadingDone = false;
  /** 角色标题按需插入：一条消息里第一个「属于对话内容」的块才带它。 */
  const ensureRoleHeading = () => {
    if (roleHeadingDone) return;
    roleHeadingDone = true;
    parts.push(message.role === "user" ? "## 用户" : "## 助手");
  };

  for (const block of message.blocks) {
    switch (block.type) {
      case "text": {
        const content = block.content.trim();
        if (!content) break;
        ensureRoleHeading();
        parts.push(content);
        break;
      }
      case "compact": {
        // 压缩摘要自带章节，且它总是独占一条消息——不套角色标题。
        parts.push("## 上下文压缩", block.content.trim());
        break;
      }
      case "reasoning":
        // 默认跳过；`redacted` 连正文都没有（`content` 是空串），写进来只剩噪音。
        break;
      case "tool": {
        ensureRoleHeading();
        // 块内按行接（调用行 → 空行 → 代码块），块之间才用空行分段：`renderTool`
        // 返回的数组本身已经排好了版，多插一层空行会把代码块顶散。
        parts.push(renderTool(block).join("\n"));
        break;
      }
      case "image": {
        ensureRoleHeading();
        const sources = block.imageUrls?.length
          ? block.imageUrls
          : block.imagePaths?.length
            ? block.imagePaths
            : [""];
        for (const source of sources) {
          parts.push(source ? describeImage(source) : "[图片]");
        }
        break;
      }
      case "notice": {
        ensureRoleHeading();
        const level =
          block.level === "error"
            ? "error"
            : block.level === "warning"
              ? "warning"
              : "info";
        const [first = "", ...rest] = block.content.trim().split("\n");
        // 续行同样加引用符，但中间不留空行 —— 否则一段引用会被渲染成两段。
        parts.push(
          [`> [!${level}] ${first}`, ...rest.map((line) => `> ${line}`)].join(
            "\n",
          ),
        );
        break;
      }
      case "file_history": {
        ensureRoleHeading();
        parts.push(`- 文件历史快照：${block.snapshots.length} 个文件`);
        break;
      }
      case "task_notification": {
        ensureRoleHeading();
        const summary = block.summary ? ` — ${oneLine(block.summary)}` : "";
        parts.push(
          `- 后台任务「${block.taskId}」（${block.taskType}）：${block.status}${summary}`,
        );
        break;
      }
    }
  }

  return parts.join("\n\n").trim();
}

/** 一条工具调用：一行调用摘要（+ 失败标记），结果在前 30 行的代码块里。 */
function renderTool(block: ToolBlock): string[] {
  const name = block.name ?? "工具";
  const params = oneLine(block.parameters ?? "");
  const failed = block.success === false ? " ❌ 失败" : "";
  const attachments = block.images?.length
    ? ` （附 ${block.images.length} 张图片）`
    : "";
  const out = [
    `- \`${name}\`${params ? ` — ${params}` : ""}${failed}${attachments}`,
  ];

  // 只有跑完的调用才有结果可写：`start`/`streaming`/`running` 阶段写出来的
  // 是半截参数，不是结果。
  if (block.stage !== "end") return out;
  const result =
    // 正文在 `result` 里；`shortResult` / `error` 是没写成全文时的兜底。
    (block.result ?? block.shortResult ?? errorMessageOf(block) ?? "").trim();
  if (!result) return out;

  const { text, truncated } = headLines(result, TOOL_RESULT_MAX_LINES);
  const fence = fenceFor(text);
  out.push("", fence, text, fence);
  if (truncated) {
    out.push("", `（结果已截断：只保留前 ${TOOL_RESULT_MAX_LINES} 行）`);
  }
  return out;
}

function errorMessageOf(block: ToolBlock): string | undefined {
  if (typeof block.error === "string") return block.error;
  if (block.error instanceof Error) return block.error.message;
  return undefined;
}

/**
 * 图片只留一个可读的占位：`[图片：1280x720 / image/png]`。尺寸取自图片容器
 * 自身的头部（PNG / GIF / WebP / JPEG），读不出来就只写格式——**绝不写
 * base64**，也绝不为了尺寸去解码整张图。
 */
function describeImage(source: string): string {
  if (!source.startsWith("data:")) {
    // 不是 data URL 就是宿主写的文件路径（CLI 粘贴的图只留文件）。
    return `[图片：${source}]`;
  }
  const comma = source.indexOf(",");
  const header = comma === -1 ? source.slice(5) : source.slice(5, comma);
  const mediaType = header.split(";")[0] || "未知格式";
  const size =
    comma === -1 ? undefined : imageSizeFromBase64(source.slice(comma + 1));
  return size
    ? `[图片：${size.width}x${size.height} / ${mediaType}]`
    : `[图片 / ${mediaType}]`;
}

/**
 * 图片尺寸。只看 base64 前缀解出来的那几十 KB：四类容器的尺寸都在文件最前面，
 * 而 JPEG 的 SOF 段可能藏在缩略图之后，所以给到 64 KiB 的余量。
 */
function imageSizeFromBase64(
  base64: string,
): { width: number; height: number } | undefined {
  // 48 KiB 的 base64 前缀 ≈ 36 KiB 原始字节。
  const head = Buffer.from(base64.slice(0, 48 * 1024), "base64");
  return pngSize(head) ?? gifSize(head) ?? webpSize(head) ?? jpegSize(head);
}

function pngSize(
  buffer: Buffer,
): { width: number; height: number } | undefined {
  // 8 字节签名 + 4 字节长度 + "IHDR"，宽高在 16..24。
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) return;
  if (buffer.toString("latin1", 12, 16) !== "IHDR") return;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function gifSize(
  buffer: Buffer,
): { width: number; height: number } | undefined {
  if (buffer.length < 10 || buffer.toString("latin1", 0, 4) !== "GIF8") return;
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
}

function webpSize(
  buffer: Buffer,
): { width: number; height: number } | undefined {
  if (buffer.length < 30) return;
  if (buffer.toString("latin1", 0, 4) !== "RIFF") return;
  if (buffer.toString("latin1", 8, 12) !== "WEBP") return;
  // 只有扩展格式（VP8X）把画布尺寸明写在头部；有损/无损两种变体的尺寸在码流里，
  // 不去猜。
  if (buffer.toString("latin1", 12, 16) !== "VP8X") return;
  return {
    width: buffer.readUIntLE(24, 3) + 1,
    height: buffer.readUIntLE(27, 3) + 1,
  };
}

function jpegSize(
  buffer: Buffer,
): { width: number; height: number } | undefined {
  if (buffer.length < 4 || buffer.readUInt16BE(0) !== 0xffd8) return;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = buffer[offset + 1];
    // SOF0-3 / SOF5-7 / SOF9-11 / SOF13-15 携带帧尺寸（SOF4/8/12 是别的段）。
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    const length = buffer.readUInt16BE(offset + 2);
    if (isSof) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    if (length < 2) return;
    offset += 2 + length;
  }
}

/** `manifest.json` 的输入：会话事实（来自转录）+ 宿主事实（应用版本、平台）。 */
export interface TranscriptManifestInput {
  workdir?: string;
  createdAt?: string;
  gitBranch?: string;
  customTitle?: string;
  model?: string;
  stats: TranscriptExportStats;
  exportedAt: Date;
  appVersion?: string;
  platform: string;
  /** 原始转录字节数。 */
  transcriptBytes: number;
  /** 原始转录是否进了归档（超过上限时为 false）。 */
  jsonlIncluded: boolean;
}

/** 归档里那份 `manifest.json`：给「拿到一个 tar.gz 的人」足够认出这是哪次会话。 */
export interface TranscriptManifest {
  workdir?: string;
  createdAt?: string;
  gitBranch?: string;
  customTitle?: string;
  model?: string;
  /**
   * 真实对话条数（不含注入消息）。与 `injectedMessages` 相加才是转录里的总条数——
   * 支持人员拿它对 `transcript.jsonl` 的行数时，这两个数得分开看。
   */
  messages: number;
  /** 被跳过的注入消息条数（`isMeta`），既不进可读版也不进 `messages`。 */
  injectedMessages: number;
  toolCalls: number;
  images: number;
  exportedAt: string;
  appVersion?: string;
  platform: string;
  transcriptBytes: number;
  jsonlIncluded: boolean;
  /**
   * 子会话（subagent）的转录**没有**进这个归档。写成一个字段而不是省略不提：
   * 支持人员看到它就不用再问「是不是漏打包了」。
   */
  subagentTranscripts: "unlinked";
}

export function buildTranscriptManifest(
  input: TranscriptManifestInput,
): TranscriptManifest {
  return {
    ...(input.workdir ? { workdir: input.workdir } : {}),
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    ...(input.gitBranch ? { gitBranch: input.gitBranch } : {}),
    ...(input.customTitle ? { customTitle: input.customTitle } : {}),
    ...(input.model ? { model: input.model } : {}),
    messages: input.stats.messages,
    injectedMessages: input.stats.injectedMessages,
    toolCalls: input.stats.toolCalls,
    images: input.stats.images,
    exportedAt: input.exportedAt.toISOString(),
    ...(input.appVersion ? { appVersion: input.appVersion } : {}),
    platform: input.platform,
    transcriptBytes: input.transcriptBytes,
    jsonlIncluded: input.jsonlIncluded,
    subagentTranscripts: "unlinked",
  };
}

export interface TranscriptArchiveOptions {
  /** 转录文件路径**在拥有它的那台机器上**（远端会话就是远端路径）。 */
  transcriptPath: string;
  /** 转录头没写工作目录时的兜底（会话起点）。 */
  workdir?: string;
  model?: string;
  appVersion?: string;
  platform?: string;
  exportedAt?: Date;
}

/**
 * 一次算好归档要的三样东西。读失败（含「已被清理」）按
 * `TranscriptUnavailableError` 抛出，宿主据此给不同的话。
 *
 * 原始字节**原样**转 base64，不重新序列化：`transcript.jsonl` 在归档里必须是
 * 那份文件本身的拷贝，否则它就不再是取证意义上的原始转录。
 */
export async function exportTranscriptArchive(
  options: TranscriptArchiveOptions,
): Promise<TranscriptExportArchive> {
  const exported = await loadTranscriptForExport(options.transcriptPath);
  const header = await readTranscriptHeaderFacts(options.transcriptPath);
  const exportedAt = options.exportedAt ?? new Date();
  const workdir = header.workdir ?? options.workdir;

  const markdown = renderTranscriptMarkdown(exported.messages, {
    ...(exported.customTitle ? { title: exported.customTitle } : {}),
    ...(workdir ? { workdir } : {}),
    ...(header.gitBranch ? { gitBranch: header.gitBranch } : {}),
    ...(header.createdAt ? { createdAt: header.createdAt } : {}),
    exportedAt: exportedAt.toISOString(),
    stats: exported.stats,
  });

  const jsonlTooLarge = exported.bytes > TRANSCRIPT_EXPORT_MAX_JSONL_BYTES;
  const jsonlBase64 = jsonlTooLarge
    ? undefined
    : (await readFile(options.transcriptPath)).toString("base64");

  const manifest = buildTranscriptManifest({
    ...(workdir ? { workdir } : {}),
    ...(header.createdAt ? { createdAt: header.createdAt } : {}),
    ...(header.gitBranch ? { gitBranch: header.gitBranch } : {}),
    ...(exported.customTitle ? { customTitle: exported.customTitle } : {}),
    ...(options.model ? { model: options.model } : {}),
    stats: exported.stats,
    exportedAt,
    ...(options.appVersion ? { appVersion: options.appVersion } : {}),
    platform: options.platform ?? process.platform,
    transcriptBytes: exported.bytes,
    jsonlIncluded: !jsonlTooLarge,
  });

  return {
    markdown,
    manifestJson: `${JSON.stringify(manifest, null, 2)}\n`,
    ...(jsonlBase64 === undefined ? {} : { jsonlBase64 }),
    jsonlBytes: exported.bytes,
    jsonlTooLarge,
  };
}

/**
 * 转录头（第一行 `{"type":"metadata",…}`）里的创建期事实。头是 append-only 的，
 * 所以即使会话里 `cd` 过、或 daemon 重启后重新锚定过，这里记的仍是「这个会话是在
 * 哪儿、哪条分支上开的」。只读首行（转录可能很大，4 KiB 足够覆盖任何真实的头）。
 */
async function readTranscriptHeaderFacts(filePath: string): Promise<{
  workdir?: string;
  createdAt?: string;
  gitBranch?: string;
}> {
  try {
    const handle = await open(filePath, "r");
    try {
      const buffer = Buffer.alloc(4096);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead === 0) return {};
      const newline = buffer.indexOf(0x0a);
      const firstLine = buffer
        .subarray(0, newline === -1 ? bytesRead : newline)
        .toString("utf8");
      const header = JSON.parse(firstLine) as {
        type?: unknown;
        workdir?: unknown;
        createdAt?: unknown;
        gitBranch?: unknown;
      };
      if (header.type !== "metadata") return {};
      return {
        ...(typeof header.workdir === "string" && header.workdir
          ? { workdir: header.workdir }
          : {}),
        ...(typeof header.createdAt === "string" && header.createdAt
          ? { createdAt: header.createdAt }
          : {}),
        ...(typeof header.gitBranch === "string" && header.gitBranch
          ? { gitBranch: header.gitBranch }
          : {}),
      };
    } finally {
      await handle.close();
    }
  } catch {
    // 头读不出来不影响导出：清单里少几个字段，比整个导出失败划算。
    return {};
  }
}

/** 压成一行：折掉换行与连续空白，过长时截断加省略号。 */
function oneLine(text: string, max = ONE_LINE_MAX_CHARS): string {
  const line = (text.split("\n")[0] ?? "").replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** 取前 `max` 行，并告诉调用方是不是被截断了。 */
function headLines(
  text: string,
  max: number,
): { text: string; truncated: boolean } {
  const lines = text.split("\n");
  if (lines.length <= max) return { text, truncated: false };
  return { text: lines.slice(0, max).join("\n"), truncated: true };
}

/**
 * 围栏长度按内容里最长的反引号串决定：结果里本来就有 ``` 时（比如模型贴了一段
 * Markdown），三反引号围栏会被提前闭合成一段乱码。
 */
function fenceFor(text: string): string {
  const longest = (text.match(/`+/g) ?? []).reduce(
    (max, run) => Math.max(max, run.length),
    0,
  );
  return "`".repeat(Math.max(3, longest + 1));
}
