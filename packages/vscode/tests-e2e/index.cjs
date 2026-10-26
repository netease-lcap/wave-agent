// Entry point for `@vscode/test-electron` — the extension host requires this
// module to export a `run()` that throws on failure. The actual assertions live
// in `specs/*.spec.cjs` so that Mocha's `suite`/`test` globals are installed
// before the spec is loaded. Which suite runs is chosen by the runner
// (`WAVE_E2E_SPEC`), because completion and next edit need opposite project
// settings.
const path = require("node:path");
const Mocha = require("mocha");

const SPECS = {
  inlineCompletion: "inlineCompletion.spec.cjs",
  nextEdit: "nextEdit.spec.cjs",
};

exports.run = async function run() {
  const spec = SPECS[process.env.WAVE_E2E_SPEC ?? "inlineCompletion"];
  if (!spec) {
    throw new Error(`unknown WAVE_E2E_SPEC: ${process.env.WAVE_E2E_SPEC}`);
  }
  const mocha = new Mocha({ ui: "tdd", timeout: 180000, color: true });
  mocha.addFile(path.join(__dirname, "specs", spec));
  await new Promise((resolve, reject) => {
    mocha.run((failures) =>
      failures
        ? reject(new Error(`${failures} ${spec} test(s) failed`))
        : resolve(),
    );
  });
};
