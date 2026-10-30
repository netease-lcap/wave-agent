/**
 * 打印模式的结构化输出（spec: docs/specs/ui/print-mode.md「结构化输出」）。
 *
 * 一个采集器喂两种格式，所以 stdout 上的事件与最后的 result 不可能对不上：
 * - `json`：只在结束时写一条 envelope；
 * - `stream-json`：按行写事件流，末行是同构的 result 事件。
 *
 * **payload 语义照 stdio 通知那套**（`remote/remoteNotifications.ts` 的 `remoteWire`）：
 * 内容事件是增量不是累积快照、工具事件不带图片字节、`tool/end` 不带完整工具输出。
 * **信封不复用 JSON-RPC**：`-p` 是单会话一次运行，`method` + 每行重复 sessionId 对管道
 * 是噪音，且 stdio 没有「运行结束」与 usage 事件——那两块换哪个信封都得新造。
 *
 * envelope 骨架对齐 Claude Code 的 `--output-format json`（常用字段同名、错误版同样不带
 * `result` 而带 `errors`），但**数值口径不对齐**：我们给 OpenAI 口径的 token 数
 * （`prompt_tokens` 已含 cache_read，不等于 CC 的 `input_tokens`），也没有价目表，
 * 所以不输出 `total_cost_usd` / `costUSD`，而不是填 0 假装有值。
 */

import type {
  PermissionMode,
  ToolBlockUpdateCallbackParams,
  Usage,
} from "wave-agent-sdk";
import {
  calculateTokenSummary,
  sumUsage,
  type TokenSummary,
  type UsageTotals,
} from "./usageSummary.js";

export type OutputFormat = "text" | "json" | "stream-json";

/** 一次工具调用的序列记录。不带工具输出——一次 `Read` 就够撑爆 stdout。 */
export interface ToolCallRecord {
  id: string;
  name?: string;
  /** 参数对象（JSON 解析结果）；参数不是合法 JSON 时为原始字符串。 */
  input?: unknown;
  success?: boolean;
  error?: string;
}

/**
 * stdout 上的 result envelope。
 *
 * 成功版有 `result`、失败版没有（与 Claude Code 一致）；`errors` 仅在非空时出现，
 * 成功版里它是工具级错误的去处，属于对 CC 的**超集**——按 CC 口径解析的消费方
 * 不会因此读错。
 */
export interface PrintResult {
  type: "result";
  subtype: "success" | "error_during_execution";
  is_error: boolean;
  result?: string;
  session_id: string;
  num_turns: number;
  duration_ms: number;
  usage: UsageTotals;
  model_usage: Record<string, TokenSummary>;
  tool_calls: ToolCallRecord[];
  errors?: string[];
}

/** 首事件 `system/init` 的取值来源：建好 agent 后立刻快照一次。 */
export interface PrintSessionInit {
  sessionId: string;
  model?: string;
  cwd: string;
  permissionMode: PermissionMode;
  tools: string[];
}

export interface PrintResultInput {
  sessionId: string;
  durationMs: number;
  usages: Usage[];
  /** 运行本身失败（建 agent / 发消息抛错），不是工具级失败。 */
  isError?: boolean;
}

export interface PrintOutputOptions {
  format: OutputFormat;
  /** stdout 写入口，便于单测注入。 */
  write?: (chunk: string) => void;
}

export class PrintOutput {
  readonly format: OutputFormat;
  private readonly writeStdout: (chunk: string) => void;

  private readonly assistantTexts: string[] = [];
  private readonly toolCalls = new Map<string, ToolCallRecord>();
  private readonly errors: string[] = [];
  private numTurns = 0;
  /**
   * init 之前写出的事件先存这里，`init()` 时先写 init 再按序补上。
   *
   * `Agent.create()` 期间就可能落事件：初始化阶段加的错误块会走
   * `onErrorBlockAdded`（真机：`-r <非法 session id>` 时 `initializationService`
   * 抛错前先落了一个错误块），而 init 只能等 agent 建好才有 session/model 可报。
   * 不缓冲的话首行会是 error，按首行判类型的消费方就判错了。
   */
  private pendingBeforeInit: string[] = [];
  private initWritten = false;

  constructor(options: PrintOutputOptions) {
    this.format = options.format;
    this.writeStdout =
      options.write ?? ((chunk: string) => void process.stdout.write(chunk));
  }

  get structured(): boolean {
    return this.format !== "text";
  }

  /** 首事件（只有 stream-json 有）。必须在创建阶段的输出之后、运行输出之前调用。 */
  init(snapshot: PrintSessionInit): void {
    if (this.format !== "stream-json") return;
    this.initWritten = true;
    this.writeStdout(
      JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: snapshot.sessionId,
        model: snapshot.model,
        cwd: snapshot.cwd,
        permission_mode: snapshot.permissionMode,
        tools: snapshot.tools,
      }) + "\n",
    );
    for (const line of this.pendingBeforeInit) this.writeStdout(line);
    this.pendingBeforeInit = [];
  }

  /** 人读输出：text 模式写 stdout，结构化模式丢弃（信息已在事件里）。 */
  human(text: string): void {
    if (this.structured) return;
    this.writeStdout(text);
  }

  /** 诊断信息：text 模式跟随人读输出，结构化模式转 stderr，绝不污染 stdout。 */
  diag(text: string): void {
    if (this.structured) {
      process.stderr.write(text);
      return;
    }
    this.writeStdout(text);
  }

  assistantMessageAdded(): void {
    this.numTurns += 1;
    this.assistantTexts.push("");
  }

  /** 流式降级的半截消息作废：文本与轮次都不计入结果。 */
  assistantMessageDiscarded(): void {
    if (this.assistantTexts.length === 0) return;
    this.assistantTexts.pop();
    this.numTurns -= 1;
  }

  reasoningDelta(messageId: string, delta: string): void {
    if (this.format !== "stream-json" || !delta) return;
    this.writeEvent({
      type: "assistant",
      subtype: "reasoning_delta",
      message_id: messageId,
      delta,
    });
  }

  contentDelta(messageId: string, delta: string): void {
    if (!delta) return;
    // 有的路径可能不走 assistantMessageAdded（例如恢复会话后直接出内容），
    // 那就补一个槽位，别把文本丢掉。
    if (this.assistantTexts.length === 0) this.assistantTexts.push("");
    this.assistantTexts[this.assistantTexts.length - 1] += delta;
    if (this.format !== "stream-json") return;
    this.writeEvent({
      type: "assistant",
      subtype: "content_delta",
      message_id: messageId,
      delta,
    });
  }

  /**
   * 工具事件。
   *
   * 只看两个阶段：
   * - `running`：执行开始，参数已完整。**按 id 去重**——`onShortResultUpdate`
   *   会带着 `running` 再发一次，不去重就会重复记一条调用。
   * - `end`：拿到最终成功/失败。权限拒绝的路径**只有 end 没有 running**，
   *   所以条目必须在两个阶段都能建立，否则被拒的工具会从序列里消失。
   */
  toolUpdate(params: ToolBlockUpdateCallbackParams): void {
    const { id, stage } = params;
    if (!id) return;

    if (stage === "running") {
      if (this.toolCalls.has(id)) return;
      const record = this.upsertToolCall(id, params);
      if (this.format === "stream-json") {
        this.writeEvent({
          type: "tool",
          subtype: "start",
          message_id: params.messageId,
          tool_use_id: id,
          name: record.name,
          input: record.input,
        });
      }
      return;
    }

    if (stage === "end") {
      const record = this.upsertToolCall(id, params);
      record.success = params.success;
      if (params.error) record.error = params.error;
      if (this.format === "stream-json") {
        this.writeEvent({
          type: "tool",
          subtype: "end",
          message_id: params.messageId,
          tool_use_id: id,
          name: record.name,
          success: record.success,
          error: record.error,
        });
      }
    }
    // start / streaming：参数还在流里（start 无完整参数、streaming 是增量片段），
    // 都不构成一条可读的工具调用记录。
  }

  /** 错误块：进 `errors`，不改 `is_error`——工具失败不等于本次运行失败。 */
  error(message: string): void {
    this.errors.push(message);
    if (this.format !== "stream-json") return;
    this.writeEvent({ type: "error", message });
  }

  /** 生成 envelope；结构化模式下同时写出去（json 单条 / stream-json 末行）。 */
  result(input: PrintResultInput): PrintResult {
    const errors = [...this.errors];
    const resultText = this.finalText();
    // 除了「抛错」，还有一类运行失败不会抛出：模型不可用 / 鉴权失败这类请求级
    // 错误只落一个错误块，循环正常收尾。判据取「有错且一句话正文都没产出」——
    // 压缩失败、hook 报错这类可恢复错误后面还跟着回答，不会被算成失败。
    const isError =
      (input.isError ?? false) || (errors.length > 0 && resultText === "");
    const envelope: PrintResult = {
      type: "result",
      subtype: isError ? "error_during_execution" : "success",
      is_error: isError,
      session_id: input.sessionId,
      num_turns: this.numTurns,
      duration_ms: input.durationMs,
      usage: sumUsage(input.usages),
      model_usage: calculateTokenSummary(input.usages),
      tool_calls: [...this.toolCalls.values()],
      ...(errors.length > 0 ? { errors } : {}),
      // 失败版没有 result（对齐 CC 的错误版）；成功版即使为空也给空串
      ...(isError ? {} : { result: resultText }),
    };
    if (this.structured) this.writeEvent(envelope, false);
    return envelope;
  }

  /** 最后一条助手消息的文本；`result` 取它（不是整个会话）。 */
  private finalText(): string {
    return this.assistantTexts[this.assistantTexts.length - 1] ?? "";
  }

  private upsertToolCall(
    id: string,
    params: ToolBlockUpdateCallbackParams,
  ): ToolCallRecord {
    let record = this.toolCalls.get(id);
    if (!record) {
      record = {
        id,
        name: params.name,
        input: parseToolInput(params.parameters),
      };
      this.toolCalls.set(id, record);
      return record;
    }
    if (record.name === undefined && params.name) record.name = params.name;
    if (record.input === undefined && params.parameters) {
      record.input = parseToolInput(params.parameters);
    }
    return record;
  }

  private writeEvent(event: object, bufferable = true): void {
    const line = JSON.stringify(event) + "\n";
    // 只有 stream-json 有 init，也只有它需要等 init 排在前面。
    if (this.format === "stream-json" && !this.initWritten) {
      if (bufferable) {
        this.pendingBeforeInit.push(line);
        return;
      }
      // 不会再等 init 了（建 agent 就失败）：把押后的事件按序放出来，别丢。
      for (const pending of this.pendingBeforeInit) this.writeStdout(pending);
      this.pendingBeforeInit = [];
    }
    this.writeStdout(line);
  }
}

/** 参数详情：能解析就给对象，解析不了保留原始串（不为难消费方猜）。 */
function parseToolInput(parameters?: string): unknown {
  if (!parameters) return undefined;
  try {
    return JSON.parse(parameters);
  } catch {
    return parameters;
  }
}

// ── stdout 守卫 ────────────────────────────────────────────────
// 手写路由只管得住我们自己的写点；依赖库里的零散 `console.log`、漏删的调试输出照样
// 会撕开 NDJSON 流，而按行解析的消费方一旦遇到脏行就整个崩掉。所以结构化模式下把
// stdout 整体包一层：合法的 JSON 行放行，其余整行转 stderr 并带标记（与 Claude Code
// 的 streamJsonStdoutGuard 同思路，范围只限本次运行）。

export const STDOUT_GUARD_MARKER = "[stdout-guard]";

let originalWrite: typeof process.stdout.write | null = null;
let pendingLine = "";

function isJsonLine(line: string): boolean {
  // 空行在 NDJSON 里是容忍的（末尾换行、分隔空行），不当作脏数据
  if (line.length === 0) return true;
  try {
    JSON.parse(line);
    return true;
  } catch {
    return false;
  }
}

/** 安装守卫。重复调用是空操作。 */
export function installStdoutGuard(): void {
  if (originalWrite) return;
  originalWrite = process.stdout.write.bind(
    process.stdout,
  ) as typeof process.stdout.write;

  process.stdout.write = function (
    chunk: string | Uint8Array,
    encodingOrCb?: BufferEncoding | ((err?: Error) => void),
    cb?: (err?: Error) => void,
  ): boolean {
    const text =
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8");
    pendingLine += text;
    let wrote = true;
    let newlineIndex: number;
    while ((newlineIndex = pendingLine.indexOf("\n")) !== -1) {
      const line = pendingLine.slice(0, newlineIndex);
      pendingLine = pendingLine.slice(newlineIndex + 1);
      if (isJsonLine(line)) {
        wrote = originalWrite!(line + "\n") && wrote;
      } else {
        process.stderr.write(`${STDOUT_GUARD_MARKER} ${line}\n`);
      }
    }
    const callback = typeof encodingOrCb === "function" ? encodingOrCb : cb;
    // 回调按写入完成报，即便某行被转到 stderr——调用方的意图（写出去）已被执行
    if (callback) queueMicrotask(() => callback());
    return wrote;
  } as typeof process.stdout.write;
}

/** 卸载守卫并处理缓冲区残余（退出前调用）：合法放行，非法转 stderr。 */
export function uninstallStdoutGuard(): void {
  if (!originalWrite) return;
  const rest = pendingLine;
  pendingLine = "";
  if (rest.length > 0) {
    if (isJsonLine(rest)) {
      originalWrite(rest + "\n");
    } else {
      process.stderr.write(`${STDOUT_GUARD_MARKER} ${rest}\n`);
    }
  }
  process.stdout.write = originalWrite;
  originalWrite = null;
}

/**
 * 等 stdout 排空再退出。
 *
 * `process.exit()` 会截断管道上还没 flush 的写——消费方读到的末行可能少一截。
 * 用一次空写拿回调，回调即「此前排队的写都出完了」（Node 在管道上的语义）。
 */
export function drainStdout(): Promise<void> {
  return new Promise<void>((resolve) => {
    process.stdout.write("", () => resolve());
  });
}
