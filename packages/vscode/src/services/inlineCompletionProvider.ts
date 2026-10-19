import * as vscode from "vscode";
import type { ChatProvider } from "../chatProvider.js";
import {
  COMPLETION_OPTIONS,
  InlineCompletionService,
} from "./inlineCompletionService.js";

/**
 * Whether this document may take completions at all. Cheap, synchronous gates
 * only — every one of these is "do not even ask", per
 * `docs/specs/ui/code-completion.md`.
 */
function isCompletionCandidate(document: vscode.TextDocument): boolean {
  // `file` only: untitled buffers, the settings/plan virtual documents, notebook
  // cells and SCM/diff views all report another scheme.
  if (document.uri.scheme !== "file") return false;
  if (document.lineCount > COMPLETION_OPTIONS.maxFileLines) return false;
  return document.getText().length <= COMPLETION_OPTIONS.maxFileChars;
}

/**
 * Whether the focused editor should render a suggestion where the caret is: a
 * single empty selection. With a real selection or multiple cursors there is no
 * one place to insert into.
 */
function isEditableCaret(
  editor: vscode.TextEditor | undefined,
  document: vscode.TextDocument,
): boolean {
  if (!editor || editor.document !== document) return false;
  if (editor.selections.length > 1) return false;
  return editor.selection.isEmpty;
}

/** Command VS Code runs when the user takes a suggestion — the accept hook. */
export const ACCEPT_COMPLETION_COMMAND = "wave.acceptInlineCompletion";

/** Reports what happened to a suggestion to the CLI (`wave.completion.outcome`). */
export type CompletionOutcomeReporter = (
  outcome: "displayed" | "accepted",
) => void;

export class WaveInlineCompletionProvider
  implements vscode.InlineCompletionItemProvider
{
  constructor(
    private readonly service: InlineCompletionService,
    private readonly report: CompletionOutcomeReporter = () => {},
  ) {}

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionList | undefined> {
    if (!isCompletionCandidate(document)) return undefined;
    if (!isEditableCaret(vscode.window.activeTextEditor, document)) {
      return undefined;
    }
    // A read-only file system reports undefined when it cannot tell — only an
    // explicit false is a reason to stay quiet.
    if (
      (await vscode.workspace.fs.isWritableFileSystem(document.uri.scheme)) ===
      false
    ) {
      return undefined;
    }

    const manual =
      context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke;
    const text = await this.service.getCompletion(
      document,
      position,
      token,
      manual,
    );

    // The caret may have moved past this position while the model was thinking;
    // inserting there would be wrong (spec: 响应返回时若文档已变化则丢弃).
    if (!text || token.isCancellationRequested || document.isClosed) {
      return undefined;
    }

    // About to render: this is the only side that knows a suggestion was
    // actually shown, so it is also the only side that can report it.
    const item = new vscode.InlineCompletionItem(
      text,
      new vscode.Range(position, position),
    );
    // The command is VS Code's accept hook; it runs when the user takes the
    // suggestion. Not every path fires it (whole-line insert, Tab on an
    // auto-trigger), which is why acceptance is measured as a share of what was
    // shown rather than as an absolute count.
    item.command = {
      command: ACCEPT_COMPLETION_COMMAND,
      title: "Wave: accept inline completion",
    };
    this.report("displayed");

    return new vscode.InlineCompletionList([item]);
  }
}

/**
 * Registers ghost-text completion for every file. The provider reads the model
 * and the credentials off the session inside the CLI (never from a second
 * configuration source here), so a missing or not-yet-started session simply
 * yields no suggestion.
 */
export function registerInlineCompletion(
  context: vscode.ExtensionContext,
  chatProvider: ChatProvider,
): void {
  const report: CompletionOutcomeReporter = (outcome) =>
    chatProvider.reportCompletionOutcome?.(outcome);
  const service = new InlineCompletionService((params) =>
    chatProvider.requestInlineCompletion(params),
  );
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(
      { pattern: "**" },
      new WaveInlineCompletionProvider(service, report),
    ),
    // The accept hook: VS Code runs this command when the user takes the item
    // the provider handed it.
    vscode.commands.registerCommand(ACCEPT_COMPLETION_COMMAND, () =>
      report("accepted"),
    ),
  );
}
