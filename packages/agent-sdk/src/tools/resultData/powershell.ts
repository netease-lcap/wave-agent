import { BASH_MAX_OUTPUT_CHARS } from "../../constants/toolLimits.js";
import { READ_TOOL_NAME } from "../../constants/tools.js";
import {
  buildPersistedOutputMessage,
  generatePreview,
} from "../../utils/toolResultStorage.js";

/**
 * `PowerShell` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * 形状照 CC：`PowerShellTool.tsx:245-256` 的 outputSchema、`:637-651` 的构造点；
 * 文本照 `:383-439` 的 `mapToolResultToToolResultBlockParam`。逐字段的出处写在下
 * 面 interface 的每条注释里，这里只记四件事：
 *
 * 1. **两股流在我方工具里已经合流**。`describeOutput()`（`powershellTool.ts:321-322`）
 *    先把 stderr 用 `\n` 接在 stdout 后面才产出正文，所以 `stdout` 承载合并后的
 *    命令输出；`stderr` 只放工具自己写的那句 cwd note。这与 `bash.ts` 的同名字段
 *    是**同一口径**（CC 的 Bash 合并 fd；CC 的 PowerShell 分开取，见 `:645` 的
 *    `finalStderr = [result.stderr || '', stderrForShellReset].filter(Boolean).join('\n')`）
 *    —— 两个 shell 工具在 `data` 上保持一致，阶段 2 的读路径才不用按工具名分叉。
 * 2. **退出码不是失败，也不进正文**。命令什么都没打印时，正文只有一句
 *    `Command executed with exit code: N`（与 `bash.ts` 的 `emptyOutputSentence` 同一
 *    句）；有输出时正文就是命令自己的输出，非零退出的读法只进
 *    `data.returnCodeInterpretation`——CC 的 PowerShell 工具**不补** `Exit code N`
 *    （`1918-…PowerShellTool.js` 只有 `Ne.append(te + bn)`，与 Bash 的
 *    `be.append(\`Exit code ${code}\`)` 不同）。判定在 `tools/shellExitCode.ts`
 *    （与 `Bash` 同一张表的口径），`success` 只留给「命令根本没跑起来」。
 * 3. **长输出落盘照旧**。规则还是 `processToolResult` 那一套（正文超上限就整段写进
 *    tool-results 目录、正文换成 `<persisted-output>` 包装），但落盘是副作用，只能
 *    在工具里做（`powershellTool.ts` 的 `stashLongOutput`）；`data` 记下路径与长度，
 *    渲染器再拼出**同一个**包装。`persistedOutputPath` / `persistedOutputSize` 本来
 *    就是 CC PowerShell outputSchema 的字段（`:251-252`），不是我方新造。
 * 4. **背景任务三态与 Bash 工具共用一份措辞**（`backgroundMessage`，逐字照 CC 的
 *    `backgroundInfo`，`PowerShellTool.tsx:419-434`）：模型读到的回执不因为哪个 shell
 *    跑了命令而变。
 *
 * 四处文本口径的偏离（都是既有行为，改了会动到模型看到的字）：
 *
 * - **cwd note 排在正文最前面**：CC 把它并进 stderr，而 stderr 在正文里排最后；我方
 *   的 content 第一行就是 note（`powershellTool.ts:508-513` 的拼接顺序）。
 * - **中断**：CC 固定追加一句 `<error>Command was aborted before completion</error>`
 *   （`:414-418`）；我方三种中断原因（超时被杀、会话 abort、转后台失败）措辞各不相
 *   同，只能整句放进 `data.interruptedReason`。而且我方的中断是「先处理输出、再把原
 *   因接在后面」（`powershellTool.ts:339-347`），所以原因**不参与**落盘正文，渲染器
 *   照这个顺序拼。
 * - **非零退出**：CC 抛 `ShellError`、正文由 `Exit code N` 起头（`:584` +
 *   `utils/toolErrors.ts`）；我方不抛、也不把整份输出换掉，正文保持命令自己的输出
 *   （空输出时那句占位已经带了退出码），读法进 `data`（REPL 的 `` $`cmd` `` 按它读
 *   `stdout`）。
 * - **后台回执**：CC 的文案里有 assistant-mode 那句、输出路径由 task id 现算
 *   （`:421-433`）；我方沿用 Bash 工具的措辞，路径由 `BackgroundTaskManager` 给出，
 *   拿不到时退回 `Read tool with task_id=…` 提示。
 */

/** 落盘失败时的就地截断尾巴，与 `utils/toolResultStorage.ts` 的兜底同形。 */
const TRUNCATED_WITHOUT_FILE =
  "\n\n... (output truncated, failed to persist full output)";

export interface PowerShellResultData {
  /**
   * CC 同名（`PowerShellTool.tsx:246`，`The standard output of the command`）。
   *
   * 我方口径：命令的 stdout 与 stderr 已按 `\n` 合流（`describeOutput()`）；命令什么
   * 都没打印时这里是 `Command executed with exit code: N` 那句话（同 `bash.ts` 的
   * `emptyOutputSentence`，退出码因此不需要单独字段）。
   */
  stdout: string;
  /**
   * CC 同名（`:247`）。但我方的命令 stderr 已经进了 `stdout`，所以这个字段只放工具
   * 自己写的一句 `Shell cwd was reset to …` / `Shell working directory changed to …`
   * （`powershellTool.ts:501-504`），与 `bash.ts` 的 `stderr` 同理。
   */
  stderr?: string;
  /** CC 同名（`:248`）：命令被中断（超时被 kill、会话 abort、转后台失败）。 */
  interrupted: boolean;
  /**
   * 我方扩展：中断时写给模型的那整句话（含秒数与建议）。CC 这里固定是
   * `<error>Command was aborted before completion</error>`（`:414-418`），我方的三种
   * 原因措辞不同，只能把它整句留在 `data` 里。
   */
  interruptedReason?: string;
  /** CC 同名（`:251`）：输出落盘后的文件（正文变成 `<persisted-output>` 包装）。 */
  persistedOutputPath?: string;
  /** CC 同名（`:252`）：落盘那份正文的长度（字符数，CC 记的是字节）。 */
  persistedOutputSize?: number;
  /**
   * CC 同名的背景任务三态（`:253-255`）。与 `ToolResult` 顶层的同名字段并存：阶段 1
   * 不减字段，而渲染器只有 `data` 这一个入参，正文里的任务 id 与输出路径得从这里来。
   */
  backgroundTaskId?: string;
  backgroundedByUser?: boolean;
  assistantAutoBackgrounded?: boolean;
  /** 背景任务的输出文件；CC 从 task id 现算（`:421`），我方由 BackgroundTaskManager 给出。 */
  backgroundOutputPath?: string;
  /** 自动转后台时的超时（毫秒），正文里的 `(${timeout / 1000}s)` 用它。 */
  timeoutMs?: number;
  /**
   * 进程自己的退出码（中断档恒为 130）。非零退出不是失败，也不进正文（空输出时那句
   * 占位已经带了它）：读法看 {@link returnCodeInterpretation}，此外由宿主渲染卡片与
   * `$` 读（原来是 `ToolResult.metadata.exitCode`）。
   */
  exitCode?: number;
  /**
   * CC 同名：非零退出的语义解释——家族内 exit 1 / `robocopy` 0–7 的读法，或其余非
   * 零退出的兜底句 `Command failed with exit code: N`。
   */
  returnCodeInterpretation?: string;
}

/** 背景任务三态的正文，逐字照 CC 的 `backgroundInfo`（`PowerShellTool.tsx:419-434`）。 */
function backgroundMessage(data: PowerShellResultData): string {
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
 * 落盘/截断**之前**的正文：cwd note 一段、命令输出一段。
 *
 * 工具用它决定「这段要不要落盘」（超过上限才写文件），所以和
 * {@link renderPowerShellResultData} 分成两个出口，免得把「再拼一遍正文」抄进工具
 * 里。背景任务的回执没有落盘这回事，直接给回执本身。
 */
export function composePowerShellResultText(
  data: PowerShellResultData,
): string {
  if (data.backgroundTaskId) return backgroundMessage(data);
  return (data.stderr ? data.stderr + "\n" : "") + data.stdout;
}

export function renderPowerShellResultData(data: PowerShellResultData): string {
  if (data.backgroundTaskId) return backgroundMessage(data);

  const body = composePowerShellResultText(data);
  // 已经落盘过：正文换成包装，预览取「未包装正文」的前 2048 字符。
  const persisted = data.persistedOutputPath
    ? buildPersistedOutputMessage(
        data.persistedOutputSize ?? body.length,
        data.persistedOutputPath,
        generatePreview(body),
      )
    : body.length > BASH_MAX_OUTPUT_CHARS
      ? // 该落盘但没落成（写不进去）：就地截断，与 `processToolResult` 的兜底同形。
        body.substring(0, BASH_MAX_OUTPUT_CHARS) + TRUNCATED_WITHOUT_FILE
      : body;

  if (!data.interrupted) return persisted;
  // 中断的既有顺序：落盘/截断只管命令输出，原因接在它后面（没输出时原因就是全文）。
  const reason = data.interruptedReason ?? "";
  return persisted ? `${persisted}\n\n${reason}` : reason;
}

/**
 * `PowerShell` 的 `data` 形状（JSON Schema），供 REPL 把签名渲染成真实返回类型
 * （spec core/repl-tool.md「公告分档呈现」）。与 {@link PowerShellResultData} 逐字段
 * 对应，改一处必须改另一处。
 *
 * 比 `Bash` 少三个字段：我们的 PowerShell 没有 `cd` 恢复、临时目录与临时卷这三条
 * 提示通道（它们只存在于 bash 侧），所以不在这里声明不存在的字段。
 */
export const powershellOutputSchema: Record<string, unknown> = {
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
        "Reading of a non-zero exit: the command's own answer (No matches found, Files differ, robocopy 0-7) or the fallback 'Command failed with exit code: N'. A non-zero exit is the answer, never a failed call.",
    },
  },
  required: ["stdout", "interrupted"],
  additionalProperties: false,
};
