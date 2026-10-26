import * as vscode from "vscode";
import type { ChatProvider } from "../chatProvider.js";
import {
  COMPLETION_OPTIONS,
  InlineCompletionService,
} from "./inlineCompletionService.js";
import { NEXT_EDIT_OPTIONS, NextEditService } from "./nextEditService.js";
import type { NextEditRender } from "./nextEditService.js";
import { NextEditHistory } from "./nextEditHistory.js";
import {
  JUMP_TO_NEXT_EDIT_COMMAND,
  NextEditPresenter,
} from "./nextEditPresenter.js";

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

/**
 * Whether VS Code can draw this render itself.
 *
 * The inline completion API shows an item only when it inserts at the caret: one
 * with a non-empty range is accepted and then silently not rendered. That is a
 * property of the editor, not of the suggestion, so everything else is drawn by
 * [NextEditPresenter] and applied by the accept command.
 */
function isGhostRenderable(
  render: NextEditRender,
  position: vscode.Position,
): boolean {
  const { start, end } = render.range;
  return (
    start.line === position.line &&
    start.character === position.character &&
    end.line === position.line &&
    end.character === position.character
  );
}

/**
 * The user-facing accept chord for a suggestion VS Code could not draw itself
 * (its inline completion API only renders insertions at the caret). Applies the
 * pending render as one edit and counts as an acceptance.
 */
export const NEXT_EDIT_APPLY_COMMAND = "wave.applyNextEditSuggestion";

/**
 * The accept hook for a next-edit suggestion. A separate command because the two
 * outcomes land in separate metric series: one counts text inserted at a caret,
 * the other a rewrite of lines the user already wrote (spec 故事 7).
 */
export const ACCEPT_NEXT_EDIT_COMMAND = "wave.acceptNextEditSuggestion";

/**
 * Reports what happened to a suggestion to the CLI (`wave.completion.outcome`).
 */
export type CompletionOutcomeReporter = (
  outcome: "displayed" | "accepted",
) => void;

/** Same signal, for the next-edit series. */
export type NextEditOutcomeReporter = (
  outcome: "displayed" | "accepted",
) => void;

export class WaveInlineCompletionProvider
  implements vscode.InlineCompletionItemProvider
{
  constructor(
    private readonly service: InlineCompletionService,
    private readonly report: CompletionOutcomeReporter = () => {},
    /**
     * Next-edit rides the same provider on purpose: VS Code merges the results
     * of every registered provider, so two providers would put both kinds of
     * suggestion on screen at once — and the CLI is only allowed one in-flight
     * request per session (spec 边界情况, 互斥).
     */
    private readonly nextEdit?: NextEditService,
    /**
     * Draws what ghost text cannot: the lines a next-edit suggestion removes and,
     * when the suggestion is off screen, the "jump there" hint.
     */
    private readonly presenter?: NextEditPresenter,
    /** `wave.next_edit.outcome` reporter; default is a no-op for tests. */
    private readonly reportNextEdit: NextEditOutcomeReporter = () => {},
  ) {}

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionList | undefined> {
    // Whatever was drawn belongs to the previous suggestion; VS Code re-invokes
    // us for every trigger, so this is the moment the overlay is either replaced
    // or taken down.
    this.presenter?.clear(vscode.window.activeTextEditor);

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

    // Next edit gets first refusal: it only speaks up right after the user edited
    // this file, and the CLI answers "no suggestion" without a model call when
    // the capability is switched off (default off).
    const nextEditItem = await this.provideNextEdit(
      document,
      position,
      token,
      manual,
    );
    if (nextEditItem) return nextEditItem;

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

  /**
   * Renders a next-edit suggestion as a *replacement* of the lines the model
   * rewrote, or `undefined` when there is nothing to show (which also means
   * "let completion have this turn").
   */
  private async provideNextEdit(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    manual: boolean,
  ): Promise<vscode.InlineCompletionList | undefined> {
    if (!this.nextEdit || !this.nextEdit.hasFreshTrajectory(document)) {
      return undefined;
    }
    const render = await this.nextEdit.getSuggestion(
      document,
      position,
      token,
      manual,
    );
    if (!render || token.isCancellationRequested || document.isClosed) {
      return undefined;
    }

    const editor = vscode.window.activeTextEditor;
    // VS Code can only show an insertion at the caret. Everything else — a
    // rewrite, a deletion, an insertion elsewhere — is drawn here and taken with
    // the accept command (spec 故事 1 场景 4、故事 2).
    const ghostText = isGhostRenderable(render, position);
    if (editor) this.presenter?.show(editor, render, ghostText);
    // The only side that knows this reached the user, in either form.
    this.reportNextEdit("displayed");
    if (!ghostText) return undefined;

    const item = new vscode.InlineCompletionItem(render.text, render.range);
    item.command = {
      command: ACCEPT_NEXT_EDIT_COMMAND,
      title: "Wave: accept next edit suggestion",
    };

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
  // One tracker, wired to the editor here and read by the service: the provider
  // is stateless per call, the trajectory is not.
  const reportNextEdit: NextEditOutcomeReporter = (outcome) =>
    chatProvider.reportNextEditOutcome?.(outcome);
  const history = new NextEditHistory();
  const nextEdit = new NextEditService(
    (params) =>
      chatProvider.requestNextEdit?.(params) ?? Promise.resolve(undefined),
    history,
    NEXT_EDIT_OPTIONS,
  );
  const presenter = new NextEditPresenter();
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.contentChanges.length > 0)
        history.record(event.document, event);
    }),
    vscode.workspace.onDidOpenTextDocument((document) =>
      history.prime(document),
    ),
    vscode.workspace.onDidCloseTextDocument((document) =>
      history.forget(document),
    ),
    vscode.languages.registerInlineCompletionItemProvider(
      { pattern: "**" },
      new WaveInlineCompletionProvider(
        service,
        report,
        nextEdit,
        presenter,
        reportNextEdit,
      ),
    ),
    // The accept hook: VS Code runs this command when the user takes the item
    // the provider handed it.
    vscode.commands.registerCommand(ACCEPT_COMPLETION_COMMAND, () =>
      report("accepted"),
    ),
    vscode.commands.registerCommand(ACCEPT_NEXT_EDIT_COMMAND, () =>
      reportNextEdit("accepted"),
    ),
    // Taking a suggestion VS Code could not draw itself: one edit, one undo step,
    // caret on the last line it wrote (spec 故事 2).
    vscode.commands.registerCommand(NEXT_EDIT_APPLY_COMMAND, async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const render = nextEdit.takePending(editor.document);
      if (!render) return;
      presenter.clear(editor);
      const applied = await editor.edit((builder) =>
        builder.replace(render.range, render.text),
      );
      if (!applied) return;
      const lines = render.text.split("\n");
      const caret = new vscode.Position(
        render.range.start.line + lines.length - 1,
        lines.length === 1
          ? render.range.start.character + lines[0].length
          : lines[lines.length - 1].length,
      );
      editor.selection = new vscode.Selection(caret, caret);
      reportNextEdit("accepted");
    }),
    // Jumping is the user's move (spec 故事 4 场景 3): nothing scrolls by itself.
    vscode.commands.registerCommand(JUMP_TO_NEXT_EDIT_COMMAND, async () => {
      const editor = vscode.window.activeTextEditor;
      const document = editor?.document;
      if (!editor || !document) return;
      // A document that changed since the suggestion was computed has shifted
      // line numbers; going there would land on the wrong code.
      const target = nextEdit.pendingRange(document);
      if (!target) return;
      editor.revealRange(
        target,
        vscode.TextEditorRevealType.InCenterIfOutsideViewport,
      );
      editor.selection = new vscode.Selection(target.start, target.start);
      // Moving the caret dropped VS Code's suggestion; ask again at the new
      // position. The service replays what it already has for this document
      // version, so this costs no model call.
      await vscode.commands.executeCommand(
        "editor.action.inlineSuggest.trigger",
      );
    }),
    presenter,
  );
  for (const document of vscode.workspace.textDocuments)
    history.prime(document);
}
