/**
 * Manual smoke for renderer-crash forensics — NOT part of the test suites.
 *
 * Run it when you touch crashRecovery.ts / unresponsiveSampler.ts / crashReporter.ts:
 *
 *   pnpm -F wave-desktop run smoke:crash                      # macOS, real display
 *   xvfb-run -a pnpm -F wave-desktop run smoke:crash:headless  # Linux CI box
 *
 * It is the only place where two things are verified against a *real* Electron
 * (unit tests mock both):
 *  1. `mainFrame.collectJavaScriptCallStack()` really returns a stack for a
 *     frozen renderer, which only works when the Document-Policy header from
 *     index.ts is in place (without it Electron answers "Website owner has not
 *     opted in…"; with an idle frame the promise never settles).
 *  2. `forcefullyCrashRenderer()` emits `render-process-gone` with a real
 *     `reason`/`exitCode` pair — the event the recovery dialog hangs on.
 *
 * It is not wired into CI: the PR gate has no GUI runner and the `electron`
 * package's binary is not downloaded by `pnpm install` (its postinstall is
 * skipped), so a green run there would prove nothing.
 */

const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DOCUMENT_POLICY = "include-js-call-stacks-in-crash-reports";

const out = (label, value) => console.log(`SMOKE ${label} ${value}`);
const fail = (message) => {
  console.error(`SMOKE FAIL ${message}`);
  app.exit(1);
};

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve("__TIMEOUT__"), ms)),
  ]);

const htmlPath = path.join(os.tmpdir(), "wave-crash-smoke.html");
fs.writeFileSync(
  htmlPath,
  "<!doctype html><html><body><h1>crash smoke</h1><script>window.spin=(ms)=>{const t=Date.now();while(Date.now()-t<ms){}};</script></body></html>",
);

app.whenReady().then(async () => {
  // Mirror index.ts: the webview is loaded from file:// and this is the only
  // way to opt the document into JS call stacks.
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ["file://*/*"] },
    (details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Document-Policy": [DOCUMENT_POLICY],
        },
      });
    },
  );

  const win = new BrowserWindow({ show: false, backgroundColor: "#1e1e1e" });
  let gone;

  win.webContents.on("render-process-gone", (_event, details) => {
    gone = details;
    out("render-process-gone", JSON.stringify(details));
  });
  win.webContents.on("did-fail-load", (_event, code, description, url) => {
    out("did-fail-load", `${code} ${description} ${url}`);
  });
  win.webContents.on("did-finish-load", async () => {
    // Freeze the renderer main thread so the collector has a stack to report.
    void win.webContents.executeJavaScript("spin(5000); 0");
    await new Promise((resolve) => setTimeout(resolve, 500));

    const stack = await withTimeout(
      win.webContents.mainFrame.collectJavaScriptCallStack(),
      3000,
    );
    out("collected-stack", JSON.stringify(String(stack).trim().slice(0, 160)));
    if (
      !stack ||
      stack === "__TIMEOUT__" ||
      String(stack).startsWith("Website owner")
    ) {
      fail(
        "no JS call stack collected — is the Document-Policy header applied?",
      );
      return;
    }

    out("force-crash", String(win.webContents.forcefullyCrashRenderer()));
    setTimeout(() => {
      if (!gone) {
        fail("render-process-gone did not fire within 4s");
        return;
      }
      if (gone.reason !== "crashed") {
        fail(`unexpected reason: ${gone.reason}`);
        return;
      }
      console.log("SMOKE PASS");
      app.exit(0);
    }, 4000);
  });

  setTimeout(() => fail("hard timeout after 20s"), 20000);
  await win
    .loadFile(htmlPath)
    .catch((error) => fail(`loadFile failed: ${error.message}`));
});
