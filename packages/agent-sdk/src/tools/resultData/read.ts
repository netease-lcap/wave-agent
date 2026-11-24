import { memoryFreshnessNote } from "../../utils/memoryAge.js";

/**
 * `Read` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * 形状与渲染都照 CC：`FileReadTool.ts:248-333` 的 outputSchema、
 * `:652-722` 的 `mapToolResultToToolResultBlockParam`。要点：
 *
 * - 文本就是「行号 + 正文」，**没有页眉**（CC 不渲染 `File:` / `Total lines:` /
 *   分隔线 / 剩余行数提示）。
 * - 空文件与「offset 越过文件尾」不是错误，而是同一份空正文 + 一句 warning，
 *   模型自己看得出为什么没内容。
 * - 超 token 预算在工具里就拒了（CC 抛 `MaxFileReadTokenExceededError`），所以
 *   `data` 里不需要任何预算字段。
 */

export interface ReadTextResultData {
  type: "text";
  /**
   * 原来 `ToolResult.metadata` 里的那组渲染信息就在这里（`type: "text"` /
   * `totalLines` / `startLine`），不再另存一份：宿主渲染「第 N–M 行 / 共 K 行」的
   * 卡片时读 `file.startLine`、`file.numLines` 与 `file.totalLines`（末行 =
   * `startLine + numLines - 1`，空正文时 `numLines` 为 0）。
   */
  file: {
    /** 解析后的绝对路径，脚本可直接使用。 */
    filePath: string;
    /** 这次读到的正文，不含行号前缀。 */
    content: string;
    /** `content` 的行数。 */
    numLines: number;
    /** 1-indexed 起始行。 */
    startLine: number;
    /** 文件总行数；空文件为 0。 */
    totalLines: number;
  };
}

export interface ReadImageResultData {
  type: "image";
  file: {
    base64: string;
    /** MIME type，CC 里字段名就叫 `type`。宿主卡片显示格式时读它。 */
    type: string;
    originalSize: number;
    dimensions?: {
      originalWidth?: number;
      originalHeight?: number;
      displayWidth?: number;
      displayHeight?: number;
    };
  };
}

/**
 * 读不了的文件：PDF 与其它二进制文档。没有正文（`content` 是空串、失败原因在
 * `error` 里），`type` 只给宿主卡片区分两种提示。
 */
export interface ReadUnreadableResultData {
  type: "pdf" | "binary";
}

/**
 * 超 token 预算被拒的调用。`data` 里只有诊断数：正文没读（工具拒绝而不是截断），
 * 宿主卡片据此说「有多少 token、上限多少」。
 */
export interface ReadTokenLimitResultData {
  type: "error_token_limit_exceeded";
  estimatedTokens: number;
  maxTokens: number;
}

export type ReadResultData =
  | ReadTextResultData
  | ReadImageResultData
  | ReadUnreadableResultData
  | ReadTokenLimitResultData;

/**
 * 展示专用信息走侧信道，不进 `data`——照抄 CC 的 `memoryFileMtimes`
 * （`FileReadTool.ts:741-753`）：那条注释明写「避免把 presentation-only 字段塞进
 * output schema，它会流进 SDK 类型」。
 *
 * 代价也照抄：重放历史会话时 WeakMap 是空的，这条时效提示会丢。
 */
const memoryMtimes = new WeakMap<object, number>();

export function recordReadMemoryMtime(data: object, mtimeMs: number): void {
  memoryMtimes.set(data, mtimeMs);
}

/** cat -n 的紧凑形态：`${行号}\t${正文}`，CC 的默认档（`utils/file.ts:302-307`）。 */
function addLineNumbers(file: { content: string; startLine: number }): string {
  if (!file.content) return "";
  return file.content
    .split(/\r?\n/)
    .map((line, index) => `${index + file.startLine}\t${line}`)
    .join("\n");
}

export function renderReadTextResultData(data: ReadTextResultData): string {
  const mtimeMs = memoryMtimes.get(data);
  const prefix = mtimeMs === undefined ? "" : memoryFreshnessNote(mtimeMs);

  if (!data.file.content) {
    return data.file.totalLines === 0
      ? "<system-reminder>Warning: the file exists but the contents are empty.</system-reminder>"
      : `<system-reminder>Warning: the file exists but is shorter than the provided offset (${data.file.startLine}). The file has ${data.file.totalLines} lines.</system-reminder>`;
  }

  return prefix + addLineNumbers(data.file);
}

/**
 * 按名字查表时用这个：只有 `text` 有文本形态，`image` 在 CC 里渲成一个 image
 * block、没有文本（我方那行说明来自工具自己，见 readTool 的图片分支）。失败档
 * （`pdf` / `binary` / `error_token_limit_exceeded`）的 `content` 是空串、原因在
 * `error` 里，同样没有可渲染的正文。
 */
export function renderReadResultData(data: ReadResultData): string | undefined {
  return data.type === "text" ? renderReadTextResultData(data) : undefined;
}
