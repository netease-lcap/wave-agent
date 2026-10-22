// Real-VS-Code end-to-end test for IDE context attachment
// (`@terminal` / `@problems`, spec ui/ide-context-mentions.md).
//
// What only a real editor can answer, and what the unit tests cannot:
//   - Does `workbench.action.terminal.selectToPreviousCommand` + `copySelection`
//     actually put the terminal output on the clipboard in a real VS Code (it
//     needs the terminal's own selection machinery, not just the API surface)?
//   - Does `languages.getDiagnostics` carry the built-in TypeScript extension's
//     findings for the active file, with the shape the webview formats?
//   - Is the user's clipboard restored after the read (the known cost of the
//     clipboard round-trip)?
//
// The service under test is the real `src/services/ideContextService.ts`, bundled
// by the runner (`scripts/runIdeContextE2E.mjs`) and required here — this spec
// runs inside the extension host, so `vscode` APIs are real. No model is
// involved: nothing here talks to the agent.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vscode = require("vscode");

const BUNDLE = process.env.WAVE_E2E_IDE_CONTEXT_BUNDLE;
assert.ok(
  BUNDLE && fs.existsSync(BUNDLE),
  `WAVE_E2E_IDE_CONTEXT_BUNDLE must point at the bundled service (got ${BUNDLE})`,
);

const { IdeContextService } = require(BUNDLE);
const service = new IdeContextService();

const MARKER = "wave-terminal-marker";
const CLIPBOARD_SENTINEL = "wave-e2e-clipboard-sentinel";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
    }
    await sleep(200);
  }
}

/** The workspace folder the runner passed on the command line. */
function workspaceDir() {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(
    folder,
    "no workspace folder — the runner must launch VS Code on one",
  );
  return folder.uri.fsPath;
}

suite("@terminal / @problems in a real VS Code", () => {
  test("reads the active terminal's last command output, and restores the clipboard", async () => {
    const terminal = vscode.window.createTerminal({
      name: "wave-e2e-terminal",
      cwd: workspaceDir(),
    });
    terminal.show();
    try {
      // Let the shell reach its prompt before typing: a command sent into a
      // cold terminal can be echoed before bash is listening.
      await sleep(3000);
      terminal.sendText(`printf '${MARKER}\\n'`);
      await sleep(4000);

      await vscode.env.clipboard.writeText(CLIPBOARD_SENTINEL);
      const [result] = await service.read(["terminal"]);
      console.log("[ide-context-e2e] terminal result:", JSON.stringify(result));

      assert.strictEqual(result.provider, "terminal");
      assert.strictEqual(
        result.ok,
        true,
        `expected a readable terminal, got: ${result.reason}`,
      );
      assert.match(
        result.terminalText,
        new RegExp(MARKER),
        "the copied terminal text did not contain the command's output",
      );

      const clipboardAfter = await vscode.env.clipboard.readText();
      assert.strictEqual(
        clipboardAfter,
        CLIPBOARD_SENTINEL,
        "the user's clipboard was not restored after reading the terminal",
      );
    } finally {
      terminal.dispose();
    }
  });

  test("reads errors of the active file with 1-based positions", async () => {
    const file = path.join(workspaceDir(), "src", "broken.ts");
    const document = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(document);

    // The built-in TypeScript extension publishes diagnostics asynchronously.
    const diagnostics = await waitFor(
      () => {
        const found = vscode.languages.getDiagnostics(document.uri);
        return found.length > 0 ? found : undefined;
      },
      20000,
      "TypeScript diagnostics for src/broken.ts",
    );
    console.log(
      "[ide-context-e2e] diagnostics:",
      JSON.stringify(
        diagnostics.map((d) => ({
          line: d.range.start.line,
          severity: d.severity,
          message: d.message,
          source: d.source,
        })),
      ),
    );

    const [result] = await service.read(["problems"]);
    console.log("[ide-context-e2e] problems result:", JSON.stringify(result));

    assert.strictEqual(result.ok, true);
    assert.ok(
      result.problems.length > 0,
      "expected at least one error/warning for the open file",
    );
    const first = result.problems[0];
    assert.ok(first.line >= 1, `line must be 1-based, got ${first.line}`);
    assert.ok(first.column >= 1, `column must be 1-based, got ${first.column}`);
    assert.ok(
      first.severity === "error" || first.severity === "warning",
      `unexpected severity ${first.severity}`,
    );
    assert.ok(first.message.length > 0, "diagnostic message must not be empty");
    assert.strictEqual(
      result.filePath,
      path.join("src", "broken.ts"),
      "filePath should be workspace-relative",
    );
  });

  test("reports 'no active terminal' instead of throwing", async () => {
    const [result] = await service.read(["terminal"]);
    assert.strictEqual(result.provider, "terminal");
    if (result.ok) {
      // Another terminal may still be active (the user's own, or one the
      // extension opened) — then the read is legitimately successful.
      assert.ok(result.terminalText.length > 0);
    } else {
      assert.ok(
        typeof result.reason === "string" && result.reason.length > 0,
        "a failed read must explain itself",
      );
    }
  });
});
