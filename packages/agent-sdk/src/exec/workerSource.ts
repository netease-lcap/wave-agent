/**
 * Source of the Exec sandbox worker.
 *
 * It is a plain string evaluated with `new Worker(source, { eval: true })` so
 * that no extra dist file is needed and no host bundler (esbuild in
 * `packages/vscode`, the JetBrains/desktop packaging steps) has to know about
 * it.
 *
 * Two properties are load-bearing and were both measured on Node 22:
 *
 * 1. **Isolation is a thread + plain-data boundary, not `node:vm`.** Handing a
 *    host function or host object to a `vm` context lets the script reach the
 *    HOST realm through `tools.x.constructor(...)` — `codeGeneration` cannot
 *    stop that, because the host realm has code generation enabled. So the
 *    sandbox receives no host value at all: every bridge is built inside the
 *    context and every value crossing back is deep-cloned into the context
 *    realm.
 * 2. **Termination is `worker.terminate()`.** `vm`'s `{ timeout }` only bounds
 *    synchronous execution: `(async () => { await 0; while (true) {} })()`
 *    returns in ~1ms and then spins inside the host event loop forever, which
 *    hangs the whole process. `{ timeout }` is still passed as a cheap first
 *    line for purely synchronous spins.
 *
 * `codeGeneration: { strings: false, wasm: false }` remains the mechanism that
 * blocks `eval` / `new Function` / dynamic `import` at the engine level.
 */

/** Helpers compiled *inside* the context, so everything the script can reach belongs to the sandbox realm. */
const SANDBOX_HELPERS = `
(function () {
  "use strict";
  function cloneValue(v) {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) {
      const out = [];
      for (let i = 0; i < v.length; i++) out.push(cloneValue(v[i]));
      return out;
    }
    const obj = { __proto__: null };
    const keys = Object.keys(v);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (key === "__proto__") continue;
      const child = v[key];
      if (typeof child === "function") continue;
      obj[key] = cloneValue(child);
    }
    return obj;
  }
  return {
    build: function (callHost, emit, toolNames, searchName, reservedNamespace) {
      // Everything handed to the script is built here, so every function object
      // the script receives belongs to the context realm: reaching
      // \`tools.x.constructor\` yields the context's Function, which refuses to
      // compile without code generation. Handing out \`callHost\` itself — a
      // worker-realm function whose Function can compile — would be the way out.
      function makeTool(name) {
        return function () {
          const arg = arguments.length > 0 ? arguments[0] : {};
          return Promise.resolve(callHost(name, arg)).then(cloneValue);
        };
      }
      const tools = { __proto__: null };
      for (let i = 0; i < toolNames.length; i++) {
        tools[toolNames[i]] = makeTool(toolNames[i]);
      }
      const namespace = { __proto__: null };
      namespace.search = makeTool(searchName);
      tools[reservedNamespace] = Object.freeze(namespace);

      // A name that is not in the pool must reach the host so it can answer with
      // a pointer to search; otherwise the script would only see a bare
      // "tools.foo is not a function". Restricted to the mcp__ prefix so
      // ordinary property reads stay untouched — in particular "then", which
      // would otherwise make this object look like a thenable.
      const reachable = new Proxy(tools, {
        get: function (target, key) {
          if (
            typeof key === "string" &&
            !(key in target) &&
            key.indexOf("mcp__") === 0
          ) {
            return makeTool(key);
          }
          return target[key];
        },
      });
      Object.freeze(tools);

      const levels = ["log", "info", "warn", "error", "debug"];
      const consoleObj = {};
      for (let i = 0; i < levels.length; i++) {
        const level = levels[i];
        consoleObj[level] = function () {
          emit(level, Array.prototype.slice.call(arguments));
        };
      }

      return {
        tools: reachable,
        console: Object.freeze(consoleObj),
      };
    },
  };
})()
`;

/**
 * Surface reduction. These globals have no legitimate use inside a bounded
 * script: they either expose an alternate code-generation path (`ShadowRealm`,
 * `WebAssembly`), schedule host callbacks outside the run's try/catch
 * (`FinalizationRegistry`, `WeakRef`, `queueMicrotask`), or only matter with
 * shared memory (`Atomics`, `SharedArrayBuffer`). Some are engine-optional
 * today, so the loop is defensive.
 */
const HARDEN_SOURCE = `
(function () {
  "use strict";
  const removed = [
    "ShadowRealm",
    "WebAssembly",
    "FinalizationRegistry",
    "WeakRef",
    "Atomics",
    "SharedArrayBuffer",
    "queueMicrotask",
  ];
  for (let i = 0; i < removed.length; i++) {
    try {
      delete globalThis[removed[i]];
    } catch (error) {
      /* non-configurable in some engines */
    }
  }
})()
`;

/** The worker body. Receives `run` / `result` messages on the parent port. */
export const EXEC_WORKER_SOURCE = `
"use strict";
const vm = require("node:vm");
const { parentPort } = require("node:worker_threads");

const pending = new Map();
let callSeq = 0;
let logs = [];
let logChars = 0;
let maxLogChars = 8000;
let maxResultChars = 100000;

function describeError(err) {
  if (err && typeof err === "object") {
    const message = err.message;
    if (typeof message === "string" && message.length > 0) return message;
    try {
      return String(err);
    } catch (stringifyError) {
      return "an unprintable error";
    }
  }
  return String(err);
}

function safeStringify(value) {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  try {
    const json = JSON.stringify(value, function (key, item) {
      return typeof item === "function" ? undefined : item;
    });
    if (json !== undefined) return json;
  } catch (error) {
    /* circular structure or a hostile toJSON */
  }
  try {
    return String(value);
  } catch (error) {
    return "<unprintable>";
  }
}

function emit(level, args) {
  if (logChars >= maxLogChars) return;
  const parts = [];
  for (let i = 0; i < args.length; i++) parts.push(safeStringify(args[i]));
  const line = (level === "log" ? "" : level + ": ") + parts.join(" ");
  logChars += line.length;
  logs.push(line);
}

/**
 * Bound what the script hands back. The flat MCP path caps its own results
 * (toolResultStorage), so returning an unbounded value here would make the
 * nested call *more* expensive than the call it replaced.
 */
function boundResult(text) {
  if (text.length <= maxResultChars) return text;
  return (
    text.slice(0, maxResultChars) +
    "\\n... (returned value truncated: " + text.length + " characters total)"
  );
}

function callHost(name, args) {
  return new Promise(function (resolve, reject) {
    let payload;
    try {
      payload = args === undefined || args === null ? {} : JSON.parse(JSON.stringify(args));
    } catch (error) {
      reject(new Error("Exec tool arguments must be JSON-serializable"));
      return;
    }
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      reject(new Error("Exec tool arguments must be a plain object"));
      return;
    }
    const id = ++callSeq;
    pending.set(id, { resolve: resolve, reject: reject });
    parentPort.postMessage({ kind: "call", id: id, name: name, args: payload });
  });
}

function runScript(message) {
  maxLogChars = message.maxLogChars;
  if (typeof message.maxResultChars === "number") {
    maxResultChars = message.maxResultChars;
  }
  const sandbox = { __proto__: null };
  const context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  });

  vm.runInContext(${JSON.stringify(HARDEN_SOURCE)}, context);
  const helpers = vm.runInContext(${JSON.stringify(SANDBOX_HELPERS)}, context);
  const globals = helpers.build(
    callHost,
    emit,
    message.toolNames,
    message.searchName,
    message.reservedNamespace,
  );
  sandbox.tools = globals.tools;
  sandbox.console = globals.console;

  let scriptResult;
  try {
    scriptResult = vm.runInContext("(async () => {\\n" + message.code + "\\n})()", context, {
      timeout: message.timeoutMs,
    });
  } catch (error) {
    parentPort.postMessage({
      kind: "done",
      ok: false,
      error: describeError(error),
      logs: logs,
    });
    return;
  }

  Promise.resolve(scriptResult).then(
    function (value) {
      parentPort.postMessage({
        kind: "done",
        ok: true,
        value: boundResult(safeStringify(value)),
        logs: logs,
      });
    },
    function (error) {
      parentPort.postMessage({
        kind: "done",
        ok: false,
        error: describeError(error),
        logs: logs,
      });
    },
  );
}

parentPort.on("message", function (message) {
  if (message.kind === "result") {
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    if (message.ok) entry.resolve(message.value);
    else entry.reject(new Error(message.error));
    return;
  }
  if (message.kind === "run") {
    try {
      runScript(message);
    } catch (error) {
      parentPort.postMessage({
        kind: "done",
        ok: false,
        error: describeError(error),
        logs: logs,
      });
    }
  }
});
`;
