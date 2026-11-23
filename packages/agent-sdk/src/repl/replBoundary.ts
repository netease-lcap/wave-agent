/**
 * The realm-side half of the REPL sandbox boundary.
 *
 * Everything in `REPL_BOUNDARY_SOURCE` is evaluated *inside* the `vm` context,
 * so every value it produces belongs to the sandbox realm. That is the whole
 * point: `codeGeneration: { strings: false }` only restricts the sandbox's own
 * `Function`, and a function created in the host realm carries the HOST realm's
 * `Function` as its `.constructor`. Handing a raw host closure to the script
 * therefore re-opens code generation (`tool.constructor("return process")()`).
 * Building the wrappers here gets the isolation in-process, without paying for a
 * worker thread the way the pre-REPL exec sandbox did.
 *
 * Two directions, two rules:
 *
 * - **Host -> sandbox** (`clone`): deep copy into this realm. Objects are built
 *   as plain objects of this realm and lose `constructor` / `prototype` /
 *   function fields, so nothing of the host's prototype chain comes along.
 *   What they inherit is the sandbox's own `Object.prototype`. Arrays longer
 *   than `MAX_ARRAY_ITEMS` carry only their first 4096 entries and are
 *   re-shaped as `{ items, truncatedFrom }` — an array cannot carry the marker
 *   through JSON, and this class of value has to look the same when it travels
 *   back out.
 * - **Sandbox -> host** (`encodeResult` / `encodeArgs`): serialise to JSON text
 *   right here, in the realm, so the host never receives a sandbox object.
 *   `encodeResult` is lenient (functions, symbols and BigInts are dropped, since
 *   a return value is whatever the script happened to end with); `encodeArgs` is
 *   strict, because a tool argument that silently loses a field would make the
 *   nested call behave differently from the flat call it replaced.
 *
 * The step counter lives here too. It has to: `vm`'s `{ timeout }` only covers
 * the synchronous run, and `(async () => { await 0; while (true) {} })()` resumes
 * on the host microtask queue where that timeout no longer applies. The only
 * thing that can stop it is a check woven into the script's own source — see
 * `replSandbox.ts` for the injection, and `step()` for the checks.
 */

/** Message used when a script reaches a code path the sealed context forbids. */
export const REPL_SEALED_MESSAGE =
  "REPL scripts run in a sealed context: modules cannot be loaded, so import / import() / require are not available. " +
  'Use the tools instead — for example await Read({ file_path: "..." }), await Glob({ pattern: "..." }), ' +
  'await Grep({ pattern: "..." }), or await $`rg ...` for a shell command.';

/** Array entries moved across the boundary (spec: 4096). */
export const REPL_MAX_ARRAY_ITEMS = 4096;

/** Nesting depth allowed before the boundary reports a clear error. */
export const REPL_MAX_VALUE_DEPTH = 64;

/** Default step budget for one script (spec: 300,000,000). */
export const REPL_DEFAULT_STEP_BUDGET = 300_000_000;

/** Host-side timer plumbing for one run; handles are plain numbers inside the sandbox. */
export interface ReplBoundaryTimers {
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(handle: number): void;
  setInterval(callback: () => void, ms: number): number;
  clearInterval(handle: number): void;
}

/** Host functions the realm wrappers delegate to. Arguments arrive as JSON text. */
export interface ReplBoundaryBridge {
  callTool(name: string, argsText: string): Promise<unknown>;
  searchTools(queryText: string, maxText: string): Promise<unknown>;
  describeTool(nameText: string): Promise<unknown>;
  listToolNames(): string[];
  /**
   * Run one `` $`cmd` ``. `options` is whatever the chain declared
   * (`{ timeout?, cwd?, env? }`), validated on the host side; the return value is
   * the plain record `shellOutput` turns into the object the script sees.
   */
  runShell(command: string, options?: unknown): Promise<unknown>;
  /** Already-formatted display strings, one per argument the script passed. */
  selfLog(values: string[]): void;
  consoleWrite(level: string, values: string[]): void;
  consoleTail(n: number): string;
  consoleBuffer(): string;
  consoleDropped(): number;
  running(): unknown;
  /** Text of the "budget exhausted" error is the host's call. */
  stepError(): Error;
}

export interface ReplGlobalsConfig {
  /** Reachable tool names for this run: members of `tools` plus bare globals. */
  toolNames: readonly string[];
  stepBudget: number;
  /** Sync-segment wall clock ceiling, refreshed whenever the host hands control back. */
  timeoutMs: number;
  timers: ReplBoundaryTimers;
}

export interface ReplBoundaryGlobals {
  /** Name -> realm-local value to install on the realm's global object. */
  globals: Record<string, unknown>;
  /** Every name in `globals`, in installation order. */
  names: string[];
  /** Tool names that also became bare globals. */
  toolNames: string[];
}

export interface ReplBoundary {
  /** The realm's own global object, captured before any script could replace it. */
  globalObject: Record<string, unknown>;
  /**
   * Whether [name] was already the realm's own when the realm was made — a
   * JavaScript built-in. Read off a frozen snapshot, not off the live global
   * object, so a name an earlier script defined is *not* reported here: that is
   * what lets a later script reuse it (Claude Code's `isGlobalName`, which only
   * covers built-ins, helpers and tool names). `true` (fail closed) if the
   * snapshot is somehow unreadable.
   */
  isBuiltinGlobal(name: string): boolean;
  createGlobals(
    bridge: ReplBoundaryBridge,
    config: ReplGlobalsConfig,
  ): ReplBoundaryGlobals;
  /** Sandbox value -> `{"v": <json>}` text. Throws a realm error on cycles/depth. */
  encodeResult(value: unknown): string;
  clone(value: unknown): unknown;
}

/**
 * The boundary, as source. Compiled into the sandbox realm by
 * `vm.runInContext`, so this string is the only thing that ever runs there
 * before the script itself.
 *
 * Deliberately free of template literals, backslashes and `${}` so it can sit in
 * a TS template string verbatim.
 */
export const REPL_BOUNDARY_SOURCE = `(() => {
  "use strict";

  const jsonParse = JSON.parse;
  const jsonStringify = JSON.stringify;
  const objectCreate = Object.create;
  const objectFreeze = Object.freeze;
  const defineProperty = Object.defineProperty;
  const getPrototypeOf = Object.getPrototypeOf;
  const objectKeys = Object.keys;
  const getOwnDescriptor = Object.getOwnPropertyDescriptor;
  const isArray = Array.isArray;
  const objectProto = Object.prototype;
  const slice = Array.prototype.slice;
  const ErrorCtor = Error;
  const StringCtor = String;
  const DateNow = () => Date.now();
  const SQUOTE = StringCtor.fromCharCode(39);
  const BACKSLASH = StringCtor.fromCharCode(92);
  const realmGlobal = globalThis;

  // What the realm's global object already owned before any helper, tool or
  // script touched it: the JavaScript built-ins. Frozen here, once, because the
  // collision check below is about *built-ins* — a name an earlier script put on
  // the global object must stay reusable, so it must never enter this set.
  const builtinNames = new Set(Object.getOwnPropertyNames(realmGlobal));

  const MAX_ITEMS = ${REPL_MAX_ARRAY_ITEMS};
  const MAX_DEPTH = ${REPL_MAX_VALUE_DEPTH};
  const DEFAULT_BUDGET = ${REPL_DEFAULT_STEP_BUDGET};

  const makeError = (name, message) => {
    const error = new ErrorCtor(message);
    if (name && name !== "Error") error.name = name;
    return error;
  };

  // A host error must never reach the script: its prototype chain leads to the
  // host realm, where code generation is enabled. Rebuild it here and keep only
  // the name and the text (the host stack would also leak host paths).
  const toRealmError = (error) => {
    if (error === null || typeof error !== "object") return makeError("Error", StringCtor(error));
    let name = "Error";
    let message = "";
    try { if (typeof error.name === "string" && error.name) name = error.name; } catch (ignored) {}
    try {
      if (typeof error.message === "string") message = error.message;
      else message = StringCtor(error);
    } catch (ignored) { message = "REPL call failed"; }
    return makeError(name, message);
  };

  const describeType = (value) => {
    try {
      if (typeof value === "function") return "a function";
      const proto = getPrototypeOf(value);
      const ctor = proto && proto.constructor;
      if (typeof ctor === "function" && ctor.name) return "an instance of " + ctor.name;
    } catch (ignored) {}
    return "a non-plain object";
  };

  const isPlainRecord = (value) => {
    try {
      const proto = getPrototypeOf(value);
      return proto === objectProto || proto === null;
    } catch (ignored) {
      return false;
    }
  };

  const truncated = (items, from) => ({ items, truncatedFrom: from });

  const indexOfRef = (stack, value) => {
    for (let i = 0; i < stack.length; i++) if (stack[i] === value) return i;
    return -1;
  };

  // ---- host -> sandbox: deep copy into this realm -------------------------
  // Own properties only, \`__proto__\` skipped, function fields dropped, and no
  // prototype chain carried over: the script gets data, not host objects.
  // Copies are plain objects of THIS realm, the way Claude Code builds them
  // (obj: () => ({})): a null prototype bought nothing here and cost the script
  // its diagnosis, because String(value) threw a TypeError on the { error } a
  // failed tool call resolves to, so the tool's own error text never reached the
  // model.
  const cloneValue = (value, depth, stack) => {
    const level = depth || 0;
    if (value === null) return null;
    const type = typeof value;
    if (type === "string" || type === "number" || type === "boolean") return value;
    if (type === "undefined" || type === "bigint" || type === "symbol" || type === "function") return undefined;
    if (level > MAX_DEPTH) {
      throw makeError("TypeError", "REPL value is nested deeper than " + MAX_DEPTH + " levels; flatten it before it crosses the boundary");
    }
    if (indexOfRef(stack, value) !== -1) {
      throw makeError("TypeError", "REPL value contains a circular reference; it cannot be copied into the sandbox");
    }
    stack.push(value);
    let out;
    if (isArray(value)) {
      const total = value.length;
      const count = total > MAX_ITEMS ? MAX_ITEMS : total;
      const items = [];
      for (let i = 0; i < count; i++) items.push(cloneValue(value[i], level + 1, stack));
      out = total > MAX_ITEMS ? truncated(items, total) : items;
    } else {
      const copy = {};
      let keys = [];
      try { keys = objectKeys(value); } catch (ignored) { keys = []; }
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
        let child;
        try { child = value[key]; } catch (ignored) { continue; }
        if (typeof child === "function") continue;
        copy[key] = cloneValue(child, level + 1, stack);
      }
      out = copy;
    }
    stack.pop();
    return out;
  };

  const clone = (value) => cloneValue(value, 0, []);

  // ---- sandbox -> host: pure JSON text -----------------------------------
  const toJsonValue = (value, depth, stack, strict) => {
    if (value === null) return null;
    const type = typeof value;
    if (type === "string" || type === "number" || type === "boolean") return value;
    if (type === "undefined") return undefined;
    if (type === "function" || type === "symbol" || type === "bigint") {
      if (strict) {
        throw makeError("TypeError", "REPL tool arguments must be plain data (plain objects, arrays, strings, numbers, booleans, null); got " + (type === "function" ? "a function" : "a " + type));
      }
      return undefined;
    }
    if (depth > MAX_DEPTH) {
      throw makeError("TypeError", "REPL value is nested deeper than " + MAX_DEPTH + " levels; flatten it before it crosses the boundary");
    }
    if (indexOfRef(stack, value) !== -1) {
      throw makeError("TypeError", "REPL value contains a circular reference; it cannot be serialised");
    }
    stack.push(value);
    let out;
    if (isArray(value)) {
      const total = value.length;
      const count = total > MAX_ITEMS ? MAX_ITEMS : total;
      const items = [];
      for (let i = 0; i < count; i++) items.push(toJsonValue(value[i], depth + 1, stack, strict));
      out = total > MAX_ITEMS ? truncated(items, total) : items;
    } else {
      if (strict && !isPlainRecord(value)) {
        throw makeError("TypeError", "REPL tool arguments must be plain data (plain objects, arrays, strings, numbers, booleans, null); got " + describeType(value));
      }
      const copy = objectCreate(null);
      let keys = [];
      try { keys = objectKeys(value); } catch (ignored) { keys = []; }
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (key === "__proto__") {
          if (strict) throw makeError("TypeError", "REPL tool arguments must not carry a __proto__ key");
          continue;
        }
        if (key === "constructor" || key === "prototype") continue;
        let child;
        try { child = value[key]; } catch (ignored) { continue; }
        if (typeof child === "function") {
          if (strict) throw makeError("TypeError", "REPL tool argument \\"" + key + "\\" is a function; only plain data can be passed to a tool");
          continue;
        }
        const converted = toJsonValue(child, depth + 1, stack, strict);
        if (converted !== undefined) copy[key] = converted;
      }
      out = copy;
    }
    stack.pop();
    return out;
  };

  const envelope = (value, strict) => {
    const text = jsonStringify({ v: toJsonValue(value, 0, [], strict) });
    return text === undefined ? "{}" : text;
  };

  const encodeResult = (value) => envelope(value, false);
  const encodeArgs = (value) => envelope(value, true);

  const displayValue = (value) => {
    const type = typeof value;
    if (type === "string") return value;
    if (type === "undefined") return "undefined";
    if (value === null) return "null";
    if (type === "number" || type === "boolean") return StringCtor(value);
    if (type === "bigint") return StringCtor(value) + "n";
    if (type === "symbol") return StringCtor(value);
    if (type === "function") {
      let name = "";
      try { name = value.name ? ": " + value.name : ""; } catch (ignored) {}
      return "[Function" + name + "]";
    }
    try {
      const text = jsonStringify(toJsonValue(value, 0, [], false));
      return text === undefined ? StringCtor(value) : text;
    } catch (ignored) {
      try { return StringCtor(value); } catch (ignoredToo) { return "[unprintable]"; }
    }
  };

  const formatArgs = (argsLike) => {
    const args = slice.call(argsLike);
    const out = [];
    for (let i = 0; i < args.length; i++) out.push(displayValue(args[i]));
    return out;
  };

  // Arguments are always one shell word (or one word per array entry) wrapped in
  // single quotes, so \`grep \${pattern} \${file}\` cannot be turned into a different
  // command by a pattern containing spaces or semicolons.
  const posixQuote = (value) => {
    const text = StringCtor(value);
    const escaped = text.split(SQUOTE).join(SQUOTE + BACKSLASH + SQUOTE + SQUOTE);
    return SQUOTE + escaped + SQUOTE;
  };

  const isBuiltinGlobal = (name) => {
    try {
      return builtinNames.has(name);
    } catch (ignored) {
      return true;
    }
  };

  const createGlobals = (bridge, config) => {
    const budget = typeof config.stepBudget === "number" && config.stepBudget > 0 ? config.stepBudget : DEFAULT_BUDGET;
    const syncWallMs = typeof config.timeoutMs === "number" && config.timeoutMs > 0 ? config.timeoutMs : 30000;
    const timers = config.timers;
    const toolNames = [];
    const requested = config.toolNames || [];
    for (let i = 0; i < requested.length; i++) {
      const name = requested[i];
      if (typeof name === "string" && name.length > 0) toolNames.push(name);
    }

    let steps = 0;
    let deadline = DateNow() + syncWallMs;

    // Called every time the host hands control back to the script: waiting on a
    // nested call (an approval dialog, a slow server) must not eat the sync
    // wall clock budget — that is exactly why the budget only covers sync
    // segments, and why this has to be refreshed at each resume.
    const resume = () => { deadline = DateNow() + syncWallMs; };

    const stepError = () => toRealmError(bridge.stepError());

    const step = () => {
      steps = steps + 1;
      if (steps > budget) throw stepError();
      // Checking the clock on every step would dominate the loop it is meant to
      // bound; every 1024 steps still trips within a millisecond of a tight spin.
      if ((steps & 1023) === 0 && DateNow() > deadline) throw stepError();
    };

    const syncDeclaration = (pairs) => {
      const list = pairs || [];
      for (let i = 0; i < list.length; i++) {
        const name = list[i][0];
        let value;
        try {
          value = list[i][1]();
        } catch (ignored) {
          // Not initialised (TDZ) or the getter threw: nothing to persist.
          continue;
        }
        try {
          defineProperty(realmGlobal, name, { value: value, writable: true, enumerable: true, configurable: true });
        } catch (ignored) {}
      }
    };

    const settleHostCall = (pending, onValue) =>
      Promise.resolve(pending).then(
        (value) => { resume(); return onValue(value); },
        (error) => { resume(); throw toRealmError(error); },
      );

    const callHost = (invoke, onValue) => {
      let pending;
      try {
        pending = invoke();
      } catch (error) {
        resume();
        return Promise.reject(toRealmError(error));
      }
      return settleHostCall(pending, onValue);
    };

    // \`tools.list()\` and \`running()\` answer from memory on the host side, so they
    // return their value directly: a script reading \`tools.list()[0]\` or
    // \`running()[0].id\` without an await is the documented usage.
    const readHost = (invoke) => {
      try {
        return clone(invoke());
      } catch (error) {
        throw toRealmError(error);
      }
    };

    const makeTool = (name) => function () {
      const arg = arguments.length > 0 ? arguments[0] : undefined;
      let text;
      try {
        text = encodeArgs(arg);
      } catch (error) {
        return Promise.reject(toRealmError(error));
      }
      return callHost(() => bridge.callTool(name, text), clone);
    };

    const tools = objectCreate(null);
    tools.list = () => readHost(() => bridge.listToolNames());

    const globals = objectCreate(null);
    // Reachable names that are not identifiers (\`mcp__srv.x\`, names with a dash)
    // stay inside \`tools\`; everything else also gets the bare global form the
    // tool description tells the model to use.
    const bareNames = [];
    for (let i = 0; i < toolNames.length; i++) {
      const name = toolNames[i];
      const fn = makeTool(name);
      tools[name] = fn;
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
        globals[name] = fn;
        bareNames.push(name);
      }
    }
    objectFreeze(tools);
    globals.tools = tools;

    globals.searchTools = (query, max) => {
      let queryText;
      let maxText;
      try {
        queryText = encodeArgs(query);
        maxText = encodeArgs(max);
      } catch (error) {
        return Promise.reject(toRealmError(error));
      }
      return callHost(() => bridge.searchTools(queryText, maxText), clone);
    };

    globals.describeTool = (name) => {
      let text;
      try {
        text = encodeArgs(name);
      } catch (error) {
        return Promise.reject(toRealmError(error));
      }
      return callHost(() => bridge.describeTool(text), clone);
    };

    // ---- \`$\` -------------------------------------------------------------
    const LF = StringCtor.fromCharCode(10);
    const CR = StringCtor.fromCharCode(13);

    // Split on newlines, the way a script would: no trailing empty line, and CRLF
    // input (a Windows shell) does not leave a CR at the end of every entry.
    const splitLines = (text) => {
      if (!text) return [];
      const normalized = text.indexOf(CR) === -1 ? text : text.split(CR + LF).join(LF);
      const lines = normalized.split(LF);
      while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
      return lines;
    };

    // \`json()\` reports why the text is not JSON, and keeps the text itself out of
    // the message: the script already has it, and a 30 KB blob in an error string
    // is not something the model can act on.
    const parseJsonOutput = (text) => {
      try {
        return jsonParse(text);
      } catch (error) {
        const detail = error && error.message ? error.message : "invalid JSON";
        throw makeError("SyntaxError", "The command output is not JSON: " + detail);
      }
    };

    const decorateShellOutput = (out) => {
      out.text = () => out.stdout;
      out.lines = () => splitLines(out.stdout);
      out.json = () => parseJsonOutput(out.stdout);
      out.toString = () => out.output;
      return out;
    };

    const blankShellOutput = (message) => {
      const out = objectCreate(null);
      out.stdout = "";
      out.stderr = message;
      out.exitCode = null;
      out.output = message;
      out.truncated = false;
      return decorateShellOutput(out);
    };

    const shellOutput = (value) => {
      const data = value !== null && typeof value === "object" ? clone(value) : objectCreate(null);
      const out = objectCreate(null);
      out.stdout = typeof data.stdout === "string" ? data.stdout : "";
      out.stderr = typeof data.stderr === "string" ? data.stderr : "";
      out.exitCode = typeof data.exitCode === "number" ? data.exitCode : null;
      // The text the result shows: stdout, then the tool's own reading of it.
      out.output = typeof data.output === "string" ? data.output : out.stdout;
      // \`truncated\` says stdout holds only the start of the output; \`file\` names
      // the spill file that has the rest, so a script can read it instead of
      // re-running a command that already printed everything.
      out.truncated = data.truncated === true;
      if (typeof data.file === "string" && data.file !== "") out.file = data.file;
      // The host's reading of a non-zero exit that is not a failure (grep with no
      // match). Its presence is what keeps \`$\` from throwing below.
      if (typeof data.note === "string" && data.note !== "") out.note = data.note;
      // The shell's own \`cd\` note, split out of \`stdout\`: it says where the next
      // command will run, which the command's own output cannot. Absent when the
      // command left the shell where it was.
      if (typeof data.cwdNote === "string" && data.cwdNote !== "") {
        out.cwdNote = data.cwdNote;
      }
      if (typeof data.command === "string") out.command = data.command;
      // Present only when the command outlived its timeout: it is still running,
      // so \`exitCode\` is null and the output streams to \`outputPath\` instead.
      if (data.running !== null && typeof data.running === "object") {
        const background = objectCreate(null);
        background.taskId = StringCtor(data.running.taskId);
        background.outputPath = StringCtor(data.running.outputPath);
        out.running = background;
      }
      return decorateShellOutput(out);
    };

    const shellFailure = (out) => {
      const detail = out.stderr ? ": " + out.stderr : "";
      const error = makeError("ShellError", "Command failed with exit code " + out.exitCode + detail);
      error.exitCode = out.exitCode;
      error.stdout = out.stdout;
      error.stderr = out.stderr;
      return error;
    };

    // \`options\` carries what the chain methods declared: nothrow, timeout, cwd, env.
    // Its values go to the host as written — validating them there keeps one
    // reading of "is this a usable directory / variable name" instead of two.
    const makeShell = (command, options) => {
      const nothrow = options.nothrow === true;
      let started = null;
      const run = () => {
        if (started === null) {
          const call = objectCreate(null);
          if (options.timeout !== undefined) call.timeout = options.timeout;
          if (options.cwd !== undefined) call.cwd = options.cwd;
          if (options.env !== undefined) call.env = options.env;
          started = callHost(() => bridge.runShell(command, call), shellOutput).then((out) => {
            // Three ways a non-zero exit is not a failure: the script asked for it
            // (\`.nothrow()\`), the host read it as the command's own answer (\`note\`,
            // e.g. grep finding nothing), or it never finished (still running).
            if (nothrow || out.note !== undefined) return out;
            if (out.exitCode !== null && out.exitCode !== 0) throw shellFailure(out);
            return out;
          }, (error) => {
            if (nothrow) {
              return blankShellOutput(error && error.message ? error.message : "");
            }
            throw error;
          });
        }
        return started;
      };
      // Thenable on purpose: \`await $\`cmd\`\` and \`await $\`cmd\`.text()\` both work,
      // and \`.nothrow()\` hands back a version that resolves instead of throwing.
      const shell = objectCreate(null);
      shell.then = (ok, bad) => run().then(ok, bad);
      shell.catch = (bad) => run().catch(bad);
      shell.finally = (fn) => run().finally(fn);
      shell.text = () => run().then((out) => out.text());
      // The same readers, before the await: \`await $\`cmd\`.lines()\`.
      shell.lines = () => run().then((out) => out.lines());
      shell.json = () => run().then((out) => out.json());
      shell.nothrow = () => makeShell(command, {
        nothrow: true,
        timeout: options.timeout,
        cwd: options.cwd,
        env: options.env,
      });
      // A longer wait than the default, in ms; past it the command moves to the
      // background instead of failing, so a long build does not block the script.
      shell.timeout = (ms) => makeShell(command, {
        nothrow,
        timeout: typeof ms === "number" && ms > 0 ? ms : options.timeout,
        cwd: options.cwd,
        env: options.env,
      });
      // This command only: neither moves the session, and both are scoped by the
      // host to the one call (see the Bash funnel's derived context).
      shell.cwd = (dir) => makeShell(command, {
        nothrow,
        timeout: options.timeout,
        cwd: dir,
        env: options.env,
      });
      shell.env = (vars) => makeShell(command, {
        nothrow,
        timeout: options.timeout,
        cwd: options.cwd,
        env: vars,
      });
      shell.toString = () => command;
      shell.command = command;
      return shell;
    };

    globals.$ = function shellTag(strings) {
      // \`$(cmd, ms)\`: a command given as a plain string rather than a template.
      if (typeof strings === "string") {
        const ms = arguments[1];
        return makeShell(StringCtor(strings), {
          nothrow: false,
          timeout: typeof ms === "number" && ms > 0 ? ms : undefined,
        });
      }
      const values = slice.call(arguments, 1);
      const head = strings && strings.length > 0 ? StringCtor(strings[0]) : "";
      const parts = [head];
      for (let i = 0; i < values.length; i++) {
        const value = values[i];
        let piece;
        if (value !== null && typeof value === "object" && !isArray(value) && value.raw !== undefined) {
          piece = StringCtor(value.raw);
        } else if (isArray(value)) {
          const words = [];
          for (let j = 0; j < value.length; j++) words.push(posixQuote(value[j]));
          piece = words.join(" ");
        } else {
          piece = posixQuote(value);
        }
        parts.push(piece);
        const next = strings && strings[i + 1] !== undefined ? StringCtor(strings[i + 1]) : "";
        parts.push(next);
      }
      return makeShell(parts.join(""), { nothrow: false });
    };

    // ---- preview ---------------------------------------------------------
    globals.preview = (value, n) => {
      const limit = typeof n === "number" && n >= 0 && n === n && n !== Infinity ? Math.floor(n) : 200;
      const text = StringCtor(value);
      if (text.length <= limit) return text;
      return text.slice(0, limit) + "\\u2026[+" + (text.length - limit) + " chars]";
    };

    // ---- self.log / console ---------------------------------------------
    const selfLog = function () {
      const values = formatArgs(arguments);
      try { bridge.selfLog(values); } catch (ignored) {}
    };
    globals.self = realmGlobal;
    globals.log = selfLog;

    globals.running = () => readHost(() => bridge.running());

    const consoleObj = objectCreate(null);
    const levels = ["log", "info", "warn", "error", "debug"];
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      consoleObj[level] = function () {
        const values = formatArgs(arguments);
        try { bridge.consoleWrite(level, values); } catch (ignored) {}
        resume();
      };
    }
    consoleObj.tail = (n) => {
      const count = typeof n === "number" && n >= 0 ? Math.floor(n) : 50;
      try { return StringCtor(bridge.consoleTail(count)); } catch (error) { throw toRealmError(error); }
    };
    consoleObj.buffer = () => {
      try { return StringCtor(bridge.consoleBuffer()); } catch (error) { throw toRealmError(error); }
    };
    consoleObj.dropped = () => {
      try { return Number(bridge.consoleDropped()); } catch (error) { throw toRealmError(error); }
    };
    globals.console = consoleObj;

    // ---- timers ----------------------------------------------------------
    // Handles are numbers, never host objects, and the callback is resumed the
    // same way a nested call is: a script waiting on a timer's promise is not
    // burning its sync budget while it waits.
    const wrapCallback = (callback) => function () {
      resume();
      if (typeof callback === "function") return callback();
    };
    globals.setTimeout = (callback, ms) => timers.setTimeout(wrapCallback(callback), typeof ms === "number" ? ms : 0);
    globals.clearTimeout = (handle) => { timers.clearTimeout(handle); };
    globals.setInterval = (callback, ms) => timers.setInterval(wrapCallback(callback), typeof ms === "number" ? ms : 0);
    globals.clearInterval = (handle) => { timers.clearInterval(handle); };

    globals.__replStep = step;
    globals.__replSync = syncDeclaration;

    const names = [];
    const all = objectKeys(globals);
    for (let i = 0; i < all.length; i++) names.push(all[i]);
    return objectFreeze({ globals: globals, names: names, toolNames: bareNames });
  };

  return objectFreeze({
    globalObject: realmGlobal,
    isBuiltinGlobal: isBuiltinGlobal,
    createGlobals: createGlobals,
    encodeResult: encodeResult,
    clone: clone,
    getOwnDescriptor: getOwnDescriptor,
    jsonParse: jsonParse,
  });
})()`;
