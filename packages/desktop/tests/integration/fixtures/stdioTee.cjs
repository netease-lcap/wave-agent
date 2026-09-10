/**
 * Transparent stdio tee for the real-host integration suite.
 *
 * `resolveWaveBinary` treats `WAVE_CLI_PATH` as an opaque executable and
 * `StdioClient` spawns any `.cjs` path through `process.execPath`, so pointing
 * `WAVE_CLI_PATH` at this file makes it the child the host talks to. It spawns
 * the *real* CLI and forwards stdin/stdout/stderr verbatim — the host/CLI
 * handshake is byte-for-byte unchanged — while recording every line in both
 * directions to `WAVE_STDIO_TEE_LOG` as JSONL:
 *
 *   {"dir":"req","line":{...}}   host → CLI (`initialize`, `updateConfig`, …)
 *   {"dir":"res","line":{...}}   CLI → host (results / notifications)
 *
 * That turns "the host no longer ships apiKey/baseURL/defaultHeaders over the
 * wire" into an assertion on the real payloads instead of a mock expectation.
 *
 * Env: WAVE_STDIO_TEE_LOG (append target), WAVE_STDIO_TEE_CLI (real CLI path).
 */

const { spawn } = require("child_process");
const fs = require("fs");

const logPath = process.env.WAVE_STDIO_TEE_LOG;
const realCli = process.env.WAVE_STDIO_TEE_CLI;

if (!logPath || !realCli) {
  process.stderr.write(
    "[stdio-tee] WAVE_STDIO_TEE_LOG and WAVE_STDIO_TEE_CLI are both required\n",
  );
  process.exit(1);
}

const child = spawn(process.execPath, [realCli, ...process.argv.slice(2)], {
  stdio: ["pipe", "pipe", "pipe"],
});

/** Per-direction line buffer: a chunk may hold several lines, or half of one. */
function recorder(dir) {
  let buffer = "";
  return (chunk) => {
    buffer += chunk.toString();
    let index = buffer.indexOf("\n");
    while (index !== -1) {
      const raw = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      index = buffer.indexOf("\n");
      if (!raw.trim()) continue;
      try {
        fs.appendFileSync(
          logPath,
          `${JSON.stringify({ dir, line: JSON.parse(raw) })}\n`,
        );
      } catch {
        // Non-JSON line (CLI banner / progress noise): not a JSON-RPC message.
        fs.appendFileSync(
          logPath,
          `${JSON.stringify({ dir, raw: raw.slice(0, 500) })}\n`,
        );
      }
    }
  };
}

const recordRequest = recorder("req");
const recordResponse = recorder("res");

process.stdin.on("data", (chunk) => {
  child.stdin.write(chunk);
  recordRequest(chunk);
});
process.stdin.on("end", () => child.stdin.end());
process.stdin.on("error", () => {});

child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  recordResponse(chunk);
});
child.stderr.on("data", (chunk) => process.stderr.write(chunk));

child.on("error", (error) => {
  process.stderr.write(`[stdio-tee] failed to spawn CLI: ${error.message}\n`);
  process.exit(1);
});
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
