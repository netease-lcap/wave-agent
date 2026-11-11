// Entry point for `@vscode/test-electron` — the extension host requires this
// module to export a `run()` that throws on failure. The actual assertions live
// in `specs/*.spec.cjs`; `harness.cjs` loads the spec in this process (the only
// one where `require("vscode")` resolves) and runs it. Which suite runs is chosen
// by the runner (`WAVE_E2E_SPEC`), because completion and next edit need
// opposite project settings.
const path = require("node:path");
const { runSpec } = require("./harness.cjs");

const SPECS = {
  inlineCompletion: "inlineCompletion.spec.cjs",
  nextEdit: "nextEdit.spec.cjs",
};

exports.run = function run() {
  const spec = SPECS[process.env.WAVE_E2E_SPEC ?? "inlineCompletion"];
  if (!spec) {
    throw new Error(`unknown WAVE_E2E_SPEC: ${process.env.WAVE_E2E_SPEC}`);
  }
  return runSpec(path.join(__dirname, "specs", spec));
};
