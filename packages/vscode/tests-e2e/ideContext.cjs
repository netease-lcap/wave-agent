// Entry point for `@vscode/test-electron` — the real-VS-Code suite for IDE
// context attachment (`@terminal` / `@problems`, spec ui/ide-context-mentions.md).
//
// Separate from `index.cjs` on purpose: the inline-completion suite burns real
// model calls and needs a logged-in session, while this one only exercises the
// host's IDE reads (`IdeContextService`) — a real terminal, a real diagnostics
// producer, no model. Keeping them apart lets either run alone.
const path = require("node:path");
const { runSpec } = require("./harness.cjs");

exports.run = function run() {
  return runSpec(path.join(__dirname, "specs", "ideContext.spec.cjs"));
};
