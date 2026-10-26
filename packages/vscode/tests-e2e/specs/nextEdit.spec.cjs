// Real-VS-Code end-to-end test for next-edit suggestions (下一步编辑建议).
//
// The scenario is the one from the spec: the user renames a field in the first
// function; the next occurrence of that field sits in another function further
// down. With the caret parked at the end of the file (where completion could
// only append), a next-edit suggestion must rewrite *that other function*, and
// taking it must leave the rest of the file intact.
//
// VS Code draws an inline suggestion at the caret, so a suggestion on other
// lines shows up as "these lines would go, press the chord to go there" — the
// test walks that whole path: hint, no write, jump, accept.
//
// Why the document and not the ghost text: VS Code exposes no API to read an
// inline suggestion (`editor.action.inlineSuggest.commit` is the only observable
// hook), so "the range I meant got rewritten and nothing else did" is the
// strongest black-box assertion available.
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vscode = require("vscode");

const EXTENSION_ID = "wave-codechat.wave-vscode";
const FIELD = "item.price";
const RENAMED = "item.unitPrice";
/** The command the user runs to go to a suggestion that is not at the caret. */
const JUMP_TO_NEXT_EDIT_COMMAND = "wave.nextEdit.jump";
/** The chord that takes a suggestion VS Code cannot draw as ghost text. */
const APPLY_COMMAND = "wave.applyNextEditSuggestion";
const SAMPLE = [
  "export interface Price {",
  "  unitPrice: number;",
  "  qty: number;",
  "}",
  "",
  "export function lineTotal(item: Price): number {",
  "  return item.price * item.qty;",
  "}",
  "",
  "export function cheapest(items: Price[]): Price {",
  "  return items.reduce((min, item) =>",
  "    item.price < min.price ? item : min,",
  "  );",
  "}",
  "",
].join("\n");
/** CLI spawn + first RPC round-trip (login PATH probe, session handshake). */
const SESSION_READY_MS = 12000;
/** The provider gives up after 3s; leave room for debounce + delivery. */
const SUGGESTION_WINDOW_MS = 30000;
/** Optional: capture the ghost text so a human can look at the real rendering. */
const SHOT_DIR = process.env.WAVE_E2E_SHOT_DIR;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function caretAtEnd(document) {
  const line = document.lineCount - 1;
  return new vscode.Position(line, document.lineAt(line).text.length);
}

async function focusEditor() {
  await vscode.commands.executeCommand(
    "workbench.action.focusFirstEditorGroup",
  );
  await sleep(300);
}

/** Replaces the whole buffer, so the next attempt starts from the same prompt. */
async function resetTo(editor, document, text) {
  const lastLine = document.lineCount - 1;
  await editor.edit((builder) =>
    builder.replace(
      new vscode.Range(
        new vscode.Position(0, 0),
        new vscode.Position(lastLine, document.lineAt(lastLine).text.length),
      ),
      text,
    ),
  );
  await sleep(1200);
  await focusEditor();
}

/** The user's edit that seeds the trajectory: rename inside `lineTotal`. */
async function renameInFirstFunction(editor, document) {
  const line = Array.from(
    { length: document.lineCount },
    (_, i) => document.lineAt(i).text,
  ).findIndex((text) => text.includes(`${FIELD} * `));
  assert.ok(line >= 0, "sample file is missing the line to rename");
  const text = document.lineAt(line).text;
  const column = text.indexOf(FIELD);
  const range = new vscode.Range(
    new vscode.Position(line, column),
    new vscode.Position(line, column + FIELD.length),
  );
  await editor.edit((builder) => builder.replace(range, RENAMED));
  // Park the caret at the end of the file: a completion suggestion there can
  // only append text, so anything that rewrites `cheapest` came from next-edit.
  await focusEditor();
  const caret = caretAtEnd(document);
  editor.selection = new vscode.Selection(caret, caret);
  await sleep(400);
}

function takeShot(name) {
  if (!SHOT_DIR) return;
  try {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    execFileSync("import", ["-window", "root", path.join(SHOT_DIR, name)], {
      timeout: 15000,
    });
    console.log(`[next-edit-e2e] screenshot: ${path.join(SHOT_DIR, name)}`);
  } catch (error) {
    console.log(`[next-edit-e2e] screenshot failed: ${error.message}`);
  }
}

/**
 * Asks the provider once (Invoke skips the debounce) and takes whatever shows
 * up. Deliberately one trigger per attempt: every new trigger cancels the
 * provider call still in flight, so a retry loop that re-triggers faster than
 * the model answers would cancel its own requests forever.
 */
/**
 * One attempt, in the shape the user actually gets: ask, look at the overlay,
 * then go there and take it.
 *
 * Three things are deliberate here:
 *
 * - **one trigger per attempt**: every new trigger cancels the provider call
 *   still in flight (the CLI aborts this session's previous next-edit request),
 *   so a retry loop that re-triggers faster than the model answers would cancel
 *   its own requests forever;
 * - **no write before the accept**: nothing may be applied behind the user's
 *   back (spec 故事 4 场景 3), so the document is asserted unchanged first;
 * - **accept is its own command**: VS Code's inline completion API only renders
 *   insertions at the caret — a range replacement is accepted by the API and then
 *   silently never shown (measured here) — so a rewrite is drawn as a decoration
 *   overlay and taken with `wave.applyNextEditSuggestion`.
 */
async function triggerHintThenApply(editor, document, shotName) {
  const before = document.getText();
  await vscode.commands.executeCommand("editor.action.inlineSuggest.trigger", {
    explicit: true,
  });
  // The model answers in one to three seconds; this is also the window in which
  // nothing may be written behind the user's back (spec 故事 4 场景 3).
  await sleep(3000);
  if (shotName) takeShot(shotName);
  assert.strictEqual(
    document.getText(),
    before,
    "a next-edit suggestion was applied without the user taking it",
  );

  const caretBefore = editor.selection.active.line;
  await vscode.commands.executeCommand(JUMP_TO_NEXT_EDIT_COMMAND);
  await sleep(300);
  const caretAfter = editor.selection.active.line;
  console.log(
    `[next-edit-e2e] jump: line ${caretBefore} -> ${caretAfter} of ${document.lineCount}`,
  );
  if (shotName) takeShot("next-edit-after-jump.png");

  await vscode.commands.executeCommand(APPLY_COMMAND);
  await sleep(500);
  return { after: document.getText(), caretAfter };
}

async function openSession() {
  // Next edit borrows the chat session's model config, exactly like completion.
  await vscode.commands.executeCommand("wave-code.openChatSidebar");
  await sleep(SESSION_READY_MS);
}

suite("Wave next edit suggestion (real VS Code)", function () {
  this.timeout(SESSION_READY_MS + 3 * SUGGESTION_WINDOW_MS + 90000);

  let document;
  let editor;

  suiteSetup(async function () {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(
      extension,
      `extension ${EXTENSION_ID} is not loaded in this host`,
    );
    await extension.activate();

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-next-edit-e2e-"));
    const filePath = path.join(dir, "pricing.ts");
    fs.writeFileSync(filePath, SAMPLE);
    document = await vscode.workspace.openTextDocument(filePath);
    editor = await vscode.window.showTextDocument(
      document,
      vscode.ViewColumn.One,
    );
    await openSession();
  });

  test("the rename propagates to the next function", async () => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      await resetTo(editor, document, SAMPLE);
      await renameInFirstFunction(editor, document);
      const { after } = await triggerHintThenApply(
        editor,
        document,
        attempt === 1 ? "next-edit-ghost-text.png" : undefined,
      );
      console.log(
        `[next-edit-e2e] attempt ${attempt}: ${JSON.stringify(after)}`,
      );

      // The rest of the file must survive: a range that swallowed the opening of
      // `reduce(...)` would be a data-losing suggestion, and real-model answers
      // do sometimes get the boundaries wrong.
      assert.ok(
        after.includes("return items.reduce((min, item) =>"),
        `accepted suggestion damaged the surrounding code: ${after}`,
      );
      assert.ok(
        after.includes("export interface Price {"),
        `accepted suggestion damaged the file header: ${after}`,
      );
      if (after.includes("min.unitPrice") || after.includes("item.unitPrice <"))
        return;
    }

    assert.fail(
      `no attempt renamed the field in the next function — last document: ${JSON.stringify(document.getText())}`,
    );
  });
});
