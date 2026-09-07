// Minimal newline-delimited MCP stdio server used by McpManager tests to
// exercise the real spawn/terminate lifecycle of a stdio MCP child process
// (no SDK dependency, so it stays deterministic and dependency-free).
//
// Env knobs:
//   IGNORE_EOF=1  keep running after stdin EOF (stubborn server that must be
//                 signalled/killed instead of exiting on its own)
const readline = require("readline");

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});
const ignoreEof = process.env.IGNORE_EOF === "1";

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

rl.on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method && msg.id !== undefined) {
    // Request
    if (msg.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "mcp-stub-server", version: "1.0.0" },
        },
      });
    } else if (msg.method === "tools/list") {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          tools: [
            {
              name: "echo",
              description: "echo back the input",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        },
      });
    } else {
      send({ jsonrpc: "2.0", id: msg.id, result: {} });
    }
  } else if (msg.method === "notifications/initialized") {
    // no-op
  } else if (msg.method === "notifications/exit") {
    process.exit(0);
  }
});

process.stdin.on("end", () => {
  if (ignoreEof) {
    // Stubborn server: ignores EOF and stays alive until signalled/killed.
    // The interval keeps the event loop from draining so the process lingers.
    setInterval(() => {}, 1000);
  } else {
    process.exit(0);
  }
});
