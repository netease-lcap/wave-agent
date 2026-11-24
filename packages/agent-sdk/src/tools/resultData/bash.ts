import { BASH_MAX_OUTPUT_CHARS } from "../../constants/toolLimits.js";
import { READ_TOOL_NAME } from "../../constants/tools.js";
import {
  describeDiskPressure,
  describeTempDirFailure,
} from "../../utils/tempDir.js";
import {
  buildPersistedOutputMessage,
  generatePreview,
} from "../../utils/toolResultStorage.js";

/**
 * `Bash` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * 形状照 CC：`BashTool.tsx:279-294` 的 outputSchema、`:803-816` 的构造点；文本照
 * `:555-623` 的 `mapToolResultToToolResultBlockParam`。要点：
 *
 * - CC 在 spawn 时把 stderr 合进 stdout 的 fd（`:686` / `:715` 的注释「stderr is
 *   merged into stdout (merged fd)」），所以 `stdout` 里已经有命令的 stderr；
 *   `stderr` 只放工具自己写的那句 `cd` note（`:805` 的 `stderrForShellReset`）。
 * - 背景任务三态是 `backgroundTaskId` 加 `assistantAutoBackgrounded` /
 *   `backgroundedByUser` 两个开关（`:606-616`）；输出文件由 task id 现算（CC 走
 *   `getTaskOutputPath`，我方由 BackgroundTaskManager 给出路径）。
 * - 大输出落盘照 CC：正文换成 `<persisted-output>` 包装，路径与字符数进
 *   `persistedOutputPath` / `persistedOutputSize`（`:589-600`）。
 *
 * 三处文本口径的偏离（都是既有行为，改了会伤到 `REPL` 的 `` $`cmd` ``，见报告）：
 *
 * - 非零退出：照 CC 的口径分层，**不算失败**（`success` 只留给「命令根本没跑起
 *   来」）。家族内 exit 1（`grep` 无匹配之类）与 `robocopy` 的 0–7 是命令自己的答
 *   案，解释进 `data.returnCodeInterpretation`；家族内 2 起与非家族的任何非零码，
 *   由**工具**在 `data.stdout` 末尾补一行 `Exit code N`（CC 也是工具里
 *   `be.append(\`Exit code ${code}\`)`，渲染器不参与）。判定在
 *   `shellExitCode.ts`；`$` 按同一份 `data` 读 `stdout`（`src/repl/replRuntime.ts`，
 *   改这里必须同步改那边）。
 * - 静默命令：CC 的模型侧是空正文，`(No output)` / `Done` 只在 UI 里合成
 *   （`BashToolResultMessage.tsx:156`）。我方正文留着一句
 *   {@link emptyOutputSentence}，`$` 依赖它（`replRuntime.ts:775`）。
 * - `cd` note 排在命令输出**前**面（CC 的渲染器排在后面）：`$` 要求它在首行才
 *   剥得出来，见 `replRuntime.ts:800-826` 的 `SHELL_CWD_NOTE`。
 */

/**
 * 命令什么都没打印时，工具补的那句话。
 *
 * 它是空输出时正文的全部，退出码已经在里面，所以工具不再往 `stdout` 末尾补
 * `Exit code N`。`PowerShell` 也用这一句（它没有自己的一份）。
 */
export function emptyOutputSentence(exitCode: number): string {
  return `Command executed with exit code: ${exitCode}`;
}

/** 落盘失败时的就地截断尾巴，与 `utils/toolResultStorage.ts` 的兜底同形。 */
const TRUNCATED_WITHOUT_FILE =
  "\n\n... (output truncated, failed to persist full output)";

export interface BashResultData {
  /**
   * 合并后的命令输出（stdout 在前、stderr 在后，用 `\n` 拼），CC 的同名字段。
   * 命令什么都没打印时这里是 {@link emptyOutputSentence} 那句话；非零退出且「这一格
   * 要标注」时末尾多一行 `Exit code N`（由工具写入，照 CC 把它放进 `stdout`）。
   */
  stdout: string;
  /**
   * CC 同名：只放工具写的 `cd` note（`Shell cwd was reset to …` /
   * `Shell working directory changed to …`），命令自己的 stderr 已经在 `stdout` 里。
   */
  stderr?: string;
  /** CC 同名：命令被中断（超时被 kill、会话 abort）。 */
  interrupted: boolean;
  /**
   * 我方扩展：中断时写给模型的那句话。CC 这里是固定的一句
   * `<error>Command was aborted before completion</error>`；我方的三种中断原因
   * （超时、外部 abort、转后台失败）措辞不同，只能把结论留在 `data` 里。
   */
  interruptedReason?: string;
  /**
   * 我方扩展：会话 cwd 被自动恢复（原目录被删，例如手动 `git worktree remove`）。
   * CC 没有这条恢复路径，而这段提示必须能从 `data` 重建，所以只能放这里。
   */
  cwdRecovery?: { from: string; to: string };
  /**
   * 我方扩展：临时目录不可写。只存输入，渲染器用 `describeTempDirFailure` 重建
   * 同一段文字（多行说明，不适合整段塞进 `data`）。
   */
  tempDir?: { path: string; code?: string };
  /** 我方扩展：临时卷快满/快没 inode，同理交给 `describeDiskPressure` 重建。 */
  diskPressure?: { path: string; freeBytes?: number; freeInodes?: number };
  /** CC 同名：输出落盘后的文件（正文变成 `<persisted-output>` 包装）。 */
  persistedOutputPath?: string;
  /** CC 同名：落盘那份正文的长度（字符数，CC 记的是字节）。 */
  persistedOutputSize?: number;
  /**
   * CC 同名的背景任务三态。与我方 `ToolResult` 顶层的同名字段并存：阶段 1 不减
   * 字段，而渲染器只有 `data` 这一个入参，正文里的任务 id 与输出路径得从这里来。
   */
  backgroundTaskId?: string;
  backgroundedByUser?: boolean;
  assistantAutoBackgrounded?: boolean;
  /** 背景任务的输出文件；CC 从 task id 现算，我方由 BackgroundTaskManager 给出。 */
  backgroundOutputPath?: string;
  /** 自动转后台时的超时（毫秒），正文里的 `(${timeout / 1000}s)` 用它。 */
  timeoutMs?: number;
  /**
   * 进程自己的退出码（中断档恒为 130）。非零退出**不是失败**：解释看
   * {@link returnCodeInterpretation}，要标注时那行 `Exit code N` 已经在
   * {@link stdout} 里。此外由宿主渲染卡片与 `$` 读（原来是
   * `ToolResult.metadata.exitCode`）。
   */
  exitCode?: number;
  /**
   * CC 同名：非零退出的语义解释——家族内 exit 1 / `robocopy` 0–7 的读法，或家族外/
   * 码段外的兜底句 `Command failed with exit code: N`。家族内 2 起照 CC 的 `fU`
   * **没有**解释句。判定在 `tools/shellExitCode.ts`，`$` 的 `note` 直接读它（兜底句
   * 不重复进 note），不再自己解析命令名。
   */
  returnCodeInterpretation?: string;
}

/**
 * 会话 cwd 被自动恢复时那句提示，结尾带换行（它就是正文的第一段）。
 *
 * 也导出给工具自己的 spawn 失败分支用：那条分支的 `content` 是空串，提示只能跟在
 * `error` 里（`aiManager` 会用 `Error: ${error}` 兜底），所以它得能单独取到这一句。
 */
export function cwdRecoveryNote(recovery: {
  from: string;
  to: string;
}): string {
  return `Note: working directory ${recovery.from} no longer exists; session working directory recovered to ${recovery.to}.\n`;
}

/** 背景任务三态的正文，逐字照 CC 的 `backgroundInfo`（`BashTool.tsx:606-616`）。 */
function backgroundMessage(data: BashResultData): string {
  const taskId = data.backgroundTaskId ?? "";
  const outputPath = data.backgroundOutputPath;
  const written = outputPath
    ? ` Output is being written to: ${outputPath}`
    : "";

  if (data.assistantAutoBackgrounded) {
    const seconds = (data.timeoutMs ?? 0) / 1000;
    return `Command exceeded the timeout (${seconds}s) and was moved to the background with ID: ${taskId}. It is still running — you will be notified when it completes.${written}`;
  }
  if (data.backgroundedByUser) {
    return `Command was manually backgrounded by user with ID: ${taskId}.${written}`;
  }
  return outputPath
    ? `Command running in background with ID: ${taskId}. Output is being written to: ${outputPath}`
    : `Command running in background with ID: ${taskId}. Use ${READ_TOOL_NAME} tool with task_id="${taskId}" to read the output.`;
}

/**
 * 未包装的正文：提示段在前、命令输出居中、诊断段在后。
 *
 * 落盘判断要用它（`Bash` 先看重不重，再决定整段要不要写进文件），所以它和
 * {@link renderBashResultData} 分成两个出口，免得把「再拼一遍正文」抄进工具里。
 */
export function composeBashResultText(data: BashResultData): string {
  const prefix = data.cwdRecovery ? cwdRecoveryNote(data.cwdRecovery) : "";

  if (data.backgroundTaskId) {
    return prefix + backgroundMessage(data);
  }

  if (data.interrupted) {
    // 中断分支的三种拼法（与既有行为逐字一致）：原因替代空输出，或接在输出之后。
    const reason = data.interruptedReason ?? "";
    if (prefix) return prefix + (data.stdout || reason);
    return data.stdout ? `${data.stdout}\n\n${reason}` : reason;
  }

  const tempDir = data.tempDir
    ? describeTempDirFailure(data.tempDir.path, data.tempDir.code) + "\n"
    : "";
  const cwdNote = data.stderr ? data.stderr + "\n" : "";
  const pressure = data.diskPressure
    ? describeDiskPressure(data.diskPressure.path, {
        freeBytes: data.diskPressure.freeBytes,
        freeInodes: data.diskPressure.freeInodes,
      })
    : undefined;

  return (
    prefix +
    tempDir +
    cwdNote +
    data.stdout +
    (pressure ? "\n\n" + pressure : "")
  );
}

export function renderBashResultData(data: BashResultData): string {
  const body = composeBashResultText(data);

  // 已经落盘过：正文换成包装，预览取「未包装正文」的前 2048 字符。
  if (data.persistedOutputPath) {
    return buildPersistedOutputMessage(
      data.persistedOutputSize ?? body.length,
      data.persistedOutputPath,
      generatePreview(body),
    );
  }
  if (body.length <= BASH_MAX_OUTPUT_CHARS) return body;
  // 该落盘但没落成（写不进去）：就地截断，与 `processToolResult` 的兜底同形。
  return body.substring(0, BASH_MAX_OUTPUT_CHARS) + TRUNCATED_WITHOUT_FILE;
}

/**
 * `Bash` 的 `data` 形状（JSON Schema），供 REPL 把签名渲染成真实返回类型
 * （spec core/repl-tool.md「公告分档呈现」）。与 {@link BashResultData} 逐字段对应，
 * 改一处必须改另一处。`PowerShell` 用的是同一份 `data`，也复用它。
 *
 * 正文那三处提示（`cd` 恢复、临时目录不可写、临时卷告急）只在这里留输入，措辞由
 * 渲染器重建，所以 schema 里是输入字段而不是文案字段。
 */
export const bashOutputSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    stdout: {
      type: "string",
      description:
        "Merged output (stdout then stderr); a placeholder sentence when nothing was printed.",
    },
    stderr: {
      type: "string",
      description:
        "The tool's own `cd` note only — the command's stderr is inside `stdout`.",
    },
    interrupted: { type: "boolean" },
    interruptedReason: { type: "string" },
    cwdRecovery: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      required: ["from", "to"],
    },
    tempDir: {
      type: "object",
      properties: { path: { type: "string" }, code: { type: "string" } },
      required: ["path"],
    },
    diskPressure: {
      type: "object",
      properties: {
        path: { type: "string" },
        freeBytes: { type: "number" },
        freeInodes: { type: "number" },
      },
      required: ["path"],
    },
    persistedOutputPath: {
      type: "string",
      description:
        "Full output on disk when too large; read it back with Read.",
    },
    persistedOutputSize: { type: "number" },
    backgroundTaskId: { type: "string" },
    backgroundedByUser: { type: "boolean" },
    assistantAutoBackgrounded: { type: "boolean" },
    backgroundOutputPath: { type: "string" },
    timeoutMs: { type: "number" },
    exitCode: {
      type: "number",
      description:
        "Process exit code; absent when it was killed before exiting.",
    },
    returnCodeInterpretation: {
      type: "string",
      description:
        "Reading of a non-zero exit: the command's own answer (No matches found, Files differ, Condition is false) or the fallback 'Command failed with exit code: N'. A non-zero exit is the answer, never a failed call.",
    },
  },
  required: ["stdout", "interrupted"],
  additionalProperties: false,
};
