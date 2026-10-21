// Entry point for `@vscode/test-electron` — the extension host requires this
// module to export a `run()` that throws on failure. The actual assertions live
// in `specs/inlineCompletion.spec.cjs` so that Mocha's `suite`/`test` globals
// are installed before the spec is loaded.
const path = require("node:path");
const Mocha = require("mocha");

exports.run = async function run() {
  const mocha = new Mocha({ ui: "tdd", timeout: 180000, color: true });
  mocha.addFile(path.join(__dirname, "specs", "inlineCompletion.spec.cjs"));
  await new Promise((resolve, reject) => {
    mocha.run((failures) =>
      failures
        ? reject(new Error(`${failures} inline-completion test(s) failed`))
        : resolve(),
    );
  });
};
