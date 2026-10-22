import * as vscode from "vscode";
import type {
  IdeContextProblem,
  IdeContextProvider,
  IdeContextResult,
} from "wave-webview-fixtures";

/**
 * IDE 上下文读取（spec `ui/ide-context-mentions.md`，VS Code 侧）。
 *
 * 只做「读数据」：终端给原始文本、诊断给结构化条目，标题/排序/上限/转义清理
 * 全在共享 webview 里做（`packages/webview/src/utils/ideContext.ts`）。两个宿主
 * 各写一份读取（IDE API 本就不同），但不各写一份格式。
 */
export class IdeContextService {
  /** 按 webview 请求的类别逐个读取；单个类别失败不影响其它类别。 */
  public async read(
    providers: IdeContextProvider[],
  ): Promise<IdeContextResult[]> {
    const results: IdeContextResult[] = [];
    for (const provider of providers) {
      results.push(
        provider === "terminal"
          ? await this.readTerminal()
          : this.readProblems(),
      );
    }
    return results;
  }

  /**
   * 活动终端最后一条命令及其输出。
   *
   * VS Code 没有公开 API 能读已执行命令的输出（`window.onDidWriteTerminalData`
   * 是 proposed，发布版扩展用不了；`Terminal.selection` 同样是 proposed），所以
   * 走内置命令 + 剪贴板中转：保存剪贴板 → 选中上一条命令 → 复制 → 读剪贴板 →
   * 还原剪贴板。剪贴板被短暂占用是这条路径的已知代价（spec 边界情况）。
   */
  private async readTerminal(): Promise<IdeContextResult> {
    const terminal = vscode.window.activeTerminal;
    if (!terminal) {
      return {
        provider: "terminal",
        ok: false,
        reason: "没有活动终端",
      };
    }

    const clipboard = vscode.env.clipboard;
    const saved = await clipboard.readText();
    try {
      await vscode.commands.executeCommand(
        "workbench.action.terminal.selectToPreviousCommand",
      );
      await vscode.commands.executeCommand(
        "workbench.action.terminal.copySelection",
      );
      await vscode.commands.executeCommand(
        "workbench.action.terminal.clearSelection",
      );
      const copied = await clipboard.readText();

      // 内置命令在「没有上一条命令」时不改选区，剪贴板内容仍是原来的值 ——
      // 与保存值相同即视为没读到（Continue 同款判据）。
      if (!copied || copied === saved) {
        return {
          provider: "terminal",
          ok: false,
          reason: "终端里没有可读的命令输出",
        };
      }

      return { provider: "terminal", ok: true, terminalText: copied };
    } catch (error) {
      return {
        provider: "terminal",
        ok: false,
        reason: `读取终端失败：${error instanceof Error ? error.message : String(error)}`,
      };
    } finally {
      // 无论成败都还原用户原来的剪贴板内容。
      await clipboard.writeText(saved);
    }
  }

  /** 活动编辑器所在文件的错误与警告（`languages.getDiagnostics` 是稳定 API）。 */
  private readProblems(): IdeContextResult {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return {
        provider: "problems",
        ok: false,
        reason: "没有活动编辑器（无法确定要读哪个文件）",
      };
    }

    const uri = editor.document.uri;
    const problems: IdeContextProblem[] = vscode.languages
      .getDiagnostics(uri)
      .filter(
        (diagnostic) =>
          diagnostic.severity === vscode.DiagnosticSeverity.Error ||
          diagnostic.severity === vscode.DiagnosticSeverity.Warning,
      )
      .map((diagnostic) => ({
        line: diagnostic.range.start.line + 1,
        column: diagnostic.range.start.character + 1,
        severity:
          diagnostic.severity === vscode.DiagnosticSeverity.Error
            ? ("error" as const)
            : ("warning" as const),
        message: diagnostic.message,
        source: diagnostic.source,
      }));

    return {
      provider: "problems",
      ok: true,
      problems,
      filePath: vscode.workspace.asRelativePath(uri, false),
    };
  }
}
