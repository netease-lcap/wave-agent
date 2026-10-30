// Real-VS-Code end-to-end test for inline (ghost text) completion.
//
// Drives the same path a user does: put the caret somewhere, edit the buffer,
// let the provider ask the CLI for a suggestion, take it — then assert on what
// ended up in the document.
//
// Why the document and not the ghost text: VS Code exposes no API to read an
// inline suggestion (microsoft/vscode-discussions#483 — `editor.action
// .inlineSuggest.commit` is the only observable hook), so "accepted text
// appeared after the caret" is the strongest black-box assertion available.
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vscode = require("vscode");

const EXTENSION_ID = "wave-codechat.wave-vscode";
/** A shape every model finishes predictably, and an assertion anchor. */
const SEED = "export function add(a: number, b: number): number {\n  ";
/** The symbol imported from the other file (also used to locate it for the definition call). */
const IMPORTED_SYMBOL = "formatPrice";
/**
 * A name that exists **only** in `helper.ts`: the seed file never spells it, and
 * neither does the import line. So a suggestion that contains it can only come
 * from the collected definition snippet — which is what this test is about.
 * Merely reusing `IMPORTED_SYMBOL` would prove nothing: it is already on screen.
 */
const CROSS_FILE_FIELD = "cents";
const HELPER = [
  "export type Money = { cents: number; currency: string };",
  "",
  'export function formatPrice(money: Money, locale = "zh-CN"): string {',
  "  return new Intl.NumberFormat(locale, {",
  '    style: "currency",',
  "    currency: money.currency,",
  "  }).format(money.cents / 100);",
  "}",
  "",
].join("\n");
/**
 * The caret sits after `= `: there is no ready-made `Money`-shaped object in
 * this file to pass along, so the model has to build the argument — and it can
 * only know the argument is `{ cents, currency }` from the definition snippet.
 */
const IMPORT_SEED = `import { ${IMPORTED_SYMBOL} } from "./helper";\n\nconst amount = 1999;\nconst currency = "CNY";\nconst label = `;
/** CLI spawn + first RPC round-trip (login PATH probe, session handshake). */
const SESSION_READY_MS = 12000;
/** The provider gives up after 3s; leave room for debounce + delivery. */
const SUGGESTION_WINDOW_MS = 30000;
/** Optional: capture the ghost text so a human can look at the real rendering. */
const SHOT_DIR = process.env.WAVE_E2E_SHOT_DIR;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function takeShot(name) {
  if (!SHOT_DIR) return;
  try {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    execFileSync("import", ["-window", "root", path.join(SHOT_DIR, name)], {
      timeout: 15000,
    });
    console.log(`[completion-e2e] screenshot: ${path.join(SHOT_DIR, name)}`);
  } catch (error) {
    console.log(`[completion-e2e] screenshot failed: ${error.message}`);
  }
}

/**
 * Ghost text has no API to wait on (see the header), so there is no "it is on
 * screen now" signal to shoot against — the only way to find out is to look.
 * Take a burst and let a human pick the frame that caught it. No-op unless
 * `WAVE_E2E_SHOT_DIR` is set, so a normal run pays nothing.
 */
async function captureGhostTexts(prefix, count = 8, gapMs = 250) {
  if (!SHOT_DIR) return;
  for (let i = 0; i < count; i++) {
    takeShot(`${prefix}-${i}.png`);
    await sleep(gapMs);
  }
}

/**
 * The extension host's stdout is not forwarded to the runner's log, so a shot
 * run is otherwise unobservable: drop a line next to the frames for whoever is
 * picking them. No-op without `WAVE_E2E_SHOT_DIR`.
 */
function note(line) {
  if (!SHOT_DIR) return;
  try {
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    fs.appendFileSync(path.join(SHOT_DIR, "notes.txt"), `${line}\n`);
  } catch {
    // Diagnostics must never turn into a test failure.
  }
}

function caretAtEnd(document) {
  const line = document.lineCount - 1;
  return new vscode.Position(line, document.lineAt(line).text.length);
}

async function focusEditor() {
  await vscode.commands.executeCommand(
    "workbench.action.focusFirstEditorGroup",
  );
  await sleep(300);
  console.log(
    "[completion-e2e] editor focus state:",
    vscode.window.state.focused,
    "active=",
    vscode.window.activeTextEditor?.document.uri.toString(),
    "inlineSuggest.enabled=",
    vscode.workspace.getConfiguration("editor").get("inlineSuggest.enabled"),
  );
}

async function commitSuggestion() {
  try {
    await vscode.commands.executeCommand("editor.action.inlineSuggest.commit");
  } catch {
    // No visible suggestion: the command's precondition fails. Expected while
    // we are still waiting for the model.
  }
}

/** Asks the provider explicitly (Invoke skips its debounce), then takes it. */
async function triggerAndAccept(document, before) {
  const deadline = Date.now() + SUGGESTION_WINDOW_MS;
  while (Date.now() < deadline) {
    await vscode.commands.executeCommand(
      "editor.action.inlineSuggest.trigger",
      {
        explicit: true,
      },
    );
    await sleep(800);
    await commitSuggestion();
    if (document.getText() !== before) return document.getText();
    await sleep(400);
  }
  return document.getText();
}

/**
 * `triggerAndAccept`, except the first round also shoots the ghost text — that
 * is what the docs image needs. Only the first round: a burst takes seconds, and
 * a suggestion can expire while it runs, which would turn the shot into a
 * repeated miss. Every later round keeps the plain trigger/commit cadence.
 */
async function triggerShootAndAccept(document, before) {
  const deadline = Date.now() + SUGGESTION_WINDOW_MS;
  let shot = false;
  let round = 0;
  while (Date.now() < deadline) {
    round++;
    await vscode.commands.executeCommand(
      "editor.action.inlineSuggest.trigger",
      {
        explicit: true,
      },
    );
    if (shot) {
      await sleep(800);
    } else {
      await captureGhostTexts("completion-ghost");
      shot = true;
    }
    await commitSuggestion();
    const changed = document.getText() !== before;
    note(`round ${round}: ${changed ? "accepted" : "nothing to accept"}`);
    if (changed) return document.getText();
    await sleep(400);
  }
  note(`gave up after ${round} round(s)`);
  return document.getText();
}

/** For the automatic path: never calls `trigger`, only takes what shows up. */
async function acceptWhatAppears(document, before) {
  const deadline = Date.now() + SUGGESTION_WINDOW_MS;
  while (Date.now() < deadline) {
    await sleep(500);
    await commitSuggestion();
    if (document.getText() !== before) return document.getText();
  }
  return document.getText();
}

async function openSession() {
  // Completion borrows the chat session's model config, so a session must
  // exist before any suggestion can be produced (docs/specs/ide/code-completion.md).
  await vscode.commands.executeCommand("wave-code.openChatSidebar");
  await sleep(SESSION_READY_MS);
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
  await sleep(1500);
  await focusEditor();
  const caret = caretAtEnd(document);
  editor.selection = new vscode.Selection(caret, caret);
}

suite("Wave inline completion (real VS Code)", function () {
  // Session handshake once, plus the cross-file test's retries (up to three
  // 30s suggestion windows), plus slack for editor/extension startup.
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

    // Ghost text gets syntax colours by default, which makes a screenshot read as
    // "this is already typed". Plain grey is what a suggestion should look like
    // in the docs image; the assertions read the document, never pixels, so this
    // changes nothing about what the suite proves.
    if (SHOT_DIR) {
      await vscode.workspace
        .getConfiguration("editor")
        .update(
          "inlineSuggest.syntaxHighlightingEnabled",
          false,
          vscode.ConfigurationTarget.Global,
        );
      // The breadcrumb ends in the throwaway directory this suite creates
      // (`wave-completion-e2e-XXXXXX`), which is noise in a docs image.
      await vscode.workspace
        .getConfiguration("breadcrumbs")
        .update("enabled", false, vscode.ConfigurationTarget.Global);
    }

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-completion-e2e-"));
    const filePath = path.join(dir, "math.ts");
    fs.writeFileSync(filePath, SEED);
    document = await vscode.workspace.openTextDocument(filePath);
    editor = await vscode.window.showTextDocument(
      document,
      vscode.ViewColumn.One,
    );
    await openSession();
  });

  test("manual trigger inserts a suggestion at the caret", async () => {
    await focusEditor();
    const caret = caretAtEnd(document);
    editor.selection = new vscode.Selection(caret, caret);
    const before = document.getText();

    const after = await triggerAndAccept(document, before);

    assert.notStrictEqual(after, before, "no suggestion was accepted in time");
    assert.ok(
      after.startsWith(SEED),
      "accepted text must be inserted at the caret, not replace the buffer",
    );
  });

  test("typing triggers a suggestion without an explicit command", async () => {
    // Reset the buffer: the previous test left a finished function body, where a
    // model legitimately has nothing to add (and the provider's cache would
    // answer from the old cursor context).
    await resetTo(editor, document, SEED);

    const caret = caretAtEnd(document);
    await editor.edit((builder) => builder.insert(caret, " "));
    const before = document.getText();

    const after = await acceptWhatAppears(document, before);

    assert.notStrictEqual(
      after,
      before,
      "typing did not produce an automatic suggestion in time",
    );
  });

  test("a definition imported from another file reaches the model", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-completion-e2e-"));
    fs.writeFileSync(path.join(dir, "helper.ts"), HELPER);
    const multiPath = path.join(dir, "answer.ts");
    fs.writeFileSync(multiPath, IMPORT_SEED);

    // One tab only: the two earlier tests leave `math.ts` open, and a docs image
    // should not have to explain a tab the reader never asked about.
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    const multiDocument = await vscode.workspace.openTextDocument(multiPath);
    const multiEditor = await vscode.window.showTextDocument(
      multiDocument,
      vscode.ViewColumn.One,
    );

    // The snippet collector resolves imports through the host's own definition
    // provider, so prove that provider is alive here before blaming the model —
    // this is the half that `--disable-extensions` would silently break (it
    // takes the built-in TypeScript extension with it).
    const importLine = multiDocument.lineAt(0).text;
    const definitions = await vscode.commands.executeCommand(
      "vscode.executeDefinitionProvider",
      multiDocument.uri,
      new vscode.Position(0, importLine.indexOf(IMPORTED_SYMBOL)),
    );
    assert.ok(
      Array.isArray(definitions) && definitions.length > 0,
      "the TypeScript definition provider returned nothing, so no cross-file " +
        "snippet can be collected in this host",
    );

    // The model is free to answer something else; give it a few goes rather
    // than turning one unlucky sample into a red suite.
    let after = IMPORT_SEED;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await resetTo(multiEditor, multiDocument, IMPORT_SEED);
      const before = multiDocument.getText();
      // The first pass also shoots the ghost text: it only exists on screen,
      // there is no API to read it, so a screenshot is the only way to show it.
      after =
        attempt === 1
          ? await triggerShootAndAccept(multiDocument, before)
          : await triggerAndAccept(multiDocument, before);
      console.log(
        `[completion-e2e] cross-file attempt ${attempt}: ${JSON.stringify(after)}`,
      );
      note(`attempt ${attempt} result:\n${after}`);
      assert.notStrictEqual(
        after,
        before,
        "no suggestion was accepted in time",
      );
      if (after.includes(CROSS_FILE_FIELD)) break;
    }

    assert.ok(
      after.includes(IMPORTED_SYMBOL),
      `the suggestion did not call the imported symbol — last answer: ${after}`,
    );
    assert.ok(
      after.includes(CROSS_FILE_FIELD),
      "the suggestion called the imported symbol but never mentioned " +
        `\`${CROSS_FILE_FIELD}\`, so its argument shape did not come from the ` +
        `collected definition — last answer: ${after}`,
    );
  });
});
