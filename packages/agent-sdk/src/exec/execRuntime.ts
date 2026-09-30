/**
 * Parent-side driver for the Exec sandbox worker.
 *
 * Owns everything the sandbox must not: the tool pool, the permission context,
 * the wall-clock budget and termination. The sandbox only ever sends plain
 * JSON (`{ name, args }`) and only ever receives plain JSON back.
 */
import { Worker } from "node:worker_threads";
import type { ToolContext } from "../tools/types.js";
import { logger } from "../utils/globalLogger.js";
import {
  EXEC_DEFAULT_MAX_IMAGES,
  EXEC_DEFAULT_MAX_LOG_CHARS,
  EXEC_DEFAULT_MAX_RESULT_CHARS,
  EXEC_DEFAULT_MAX_TOOL_CALLS,
  EXEC_DEFAULT_TIMEOUT_MS,
  EXEC_SEARCH_NAME,
} from "./constants.js";
import { EXEC_WORKER_SOURCE } from "./workerSource.js";
import {
  renderSearchCallForm,
  resolveSearchArgs,
  searchPool,
} from "./catalog.js";
import type { ExecPoolEntry } from "./catalog.js";

export interface RunExecOptions {
  code: string;
  /** Every on-demand tool the sandbox may call. Also the allowlist for nested calls. */
  pool: ExecPoolEntry[];
  context: ToolContext;
  /**
   * Called as each nested call is issued, before it is dispatched, in the order
   * the script issues them. Lets the caller show live progress; a call that is
   * refused afterwards (over the limit) still reports.
   */
  onToolCall?: (name: string) => void;
  timeoutMs?: number;
  maxToolCalls?: number;
  maxLogChars?: number;
  maxResultChars?: number;
}

export interface ExecCallResult {
  /**
   * What the script's `await` resolves to — the tool's structured output, else its
   * text, else `null` (the rule `renderToolSignature` promises a signature's return
   * type from). Plain JSON only: it crosses the worker boundary and is deep-cloned
   * inside the sandbox.
   */
  output: unknown;
  /**
   * Images to hoist onto the `Exec` result. Never seen by the script: a nested call
   * resolves to the tool's output, and an image is not something a script composes
   * with.
   */
  images?: Array<{ data: string; mediaType?: string }>;
}

export interface ExecRunResult {
  ok: boolean;
  /** Serialized script return value. Only set when `ok`. */
  value?: string;
  error?: string;
  logs: string[];
  toolCalls: number;
  images: Array<{ data: string; mediaType?: string }>;
}

/** Sandbox -> parent tool-call message. */
interface ExecCallMessage {
  kind: "call";
  id: number;
  name: string;
  args: Record<string, unknown>;
}

const DYNAMIC_IMPORT_PATTERN = /dynamic import callback/i;

/**
 * Rewrite engine-internal messages the model cannot act on into something it
 * can. `node:vm` refuses `import()` with an internal-sounding message that
 * mentions a callback the model has no way to know about.
 */
function humanizeError(message: string): string {
  if (DYNAMIC_IMPORT_PATTERN.test(message)) {
    return "import() is not available inside Exec";
  }
  return message;
}

async function handleExecCall(
  name: string,
  args: Record<string, unknown>,
  pool: readonly ExecPoolEntry[],
  context: ToolContext,
): Promise<ExecCallResult> {
  if (name === EXEC_SEARCH_NAME) {
    // Matching, ranking and the result cap all live in `searchPool`, so the value
    // the script reads is exactly what `SEARCH_OUTPUT_SCHEMA` promises. The output
    // is the object itself, not its JSON text — the same rule an MCP call follows:
    // a script composes values, and making it parse a string first is the kind of
    // extra step a signature should not have to mention.
    return { output: searchPool(pool, resolveSearchArgs(args)) };
  }

  const entry = pool.find((candidate) => candidate.name === name);
  if (!entry) {
    throw new Error(
      `Unknown tool "${name}". Only the tools listed as reachable from Exec can be called this way. ` +
        `Use ${renderSearchCallForm()} to find one.`,
    );
  }

  return entry.isMcp === true
    ? callMcpTool(name, args, context)
    : callBuiltInTool(name, args, context);
}

/**
 * Dispatch an MCP call through its single funnel: it runs the permission/approval
 * check internally and keys it on the flattened name, so a nested call is approved
 * exactly like a flat MCP call.
 */
async function callMcpTool(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ExecCallResult> {
  const mcpManager = context.mcpManager;
  if (!mcpManager) {
    throw new Error("MCP manager is not available in the Exec context");
  }
  const result = await mcpManager.executeMcpTool(name, args, context);
  return { output: result.output, images: result.images };
}

/**
 * Dispatch a built-in call through `ToolManager.execute`, which is the built-ins'
 * equivalent funnel: each built-in runs its own `checkPermission` inside
 * `execute()`, and this entry point is what supplies the enhanced context (permission
 * manager, task manager, …) they read it from. Routing around it would hand a
 * built-in a context missing the managers it needs.
 *
 * `execute()` reports failure in the result rather than by throwing, so a failed
 * call is turned back into a rejection here. Both tool kinds then behave the same
 * way inside the script: a failed `await` lands in the script's `catch`, instead
 * of resolving to a value that looks like a successful empty result.
 */
async function callBuiltInTool(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<ExecCallResult> {
  const toolManager = context.toolManager;
  if (!toolManager) {
    throw new Error("Tool manager is not available in the Exec context");
  }
  const result = await toolManager.execute(name, args, context);
  if (!result.success) {
    throw new Error(result.error || `${name} failed`);
  }
  return { output: result.content, images: result.images };
}

function terminate(worker: Worker): void {
  worker.terminate().catch(() => {
    /* already gone */
  });
}

/**
 * Run one Exec script in a terminable sandbox worker.
 *
 * Never rejects: every failure mode (script throw, budget, abort, worker crash)
 * comes back as `{ ok: false, error }` so the model gets a result to act on.
 */
export function runExecScript(options: RunExecOptions): Promise<ExecRunResult> {
  const timeoutMs = options.timeoutMs ?? EXEC_DEFAULT_TIMEOUT_MS;
  const maxToolCalls = options.maxToolCalls ?? EXEC_DEFAULT_MAX_TOOL_CALLS;
  const maxLogChars = options.maxLogChars ?? EXEC_DEFAULT_MAX_LOG_CHARS;
  const maxResultChars =
    options.maxResultChars ?? EXEC_DEFAULT_MAX_RESULT_CHARS;
  const images: Array<{ data: string; mediaType?: string }> = [];

  return new Promise<ExecRunResult>((resolve) => {
    const worker = new Worker(EXEC_WORKER_SOURCE, { eval: true });
    let settled = false;
    let toolCalls = 0;

    const finish = (result: ExecRunResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(budget);
      options.context.abortSignal?.removeEventListener("abort", onAbort);
      terminate(worker);
      resolve(result);
    };

    const budget = setTimeout(() => {
      finish({
        ok: false,
        error:
          `Exec script exceeded the ${timeoutMs}ms budget and was terminated. ` +
          `Tool calls that already completed still apply.`,
        logs: [],
        toolCalls,
        images,
      });
    }, timeoutMs);

    const onAbort = (): void => {
      finish({
        ok: false,
        error: "Exec script was aborted.",
        logs: [],
        toolCalls,
        images,
      });
    };

    if (options.context.abortSignal?.aborted) {
      onAbort();
      return;
    }
    options.context.abortSignal?.addEventListener("abort", onAbort, {
      once: true,
    });

    worker.on(
      "message",
      (message: ExecCallMessage | Record<string, unknown>) => {
        if (settled) return;
        if (message.kind === "call") {
          const call = message as ExecCallMessage;
          toolCalls += 1;
          options.onToolCall?.(call.name);
          if (toolCalls > maxToolCalls) {
            worker.postMessage({
              kind: "result",
              id: call.id,
              ok: false,
              error: `Exec tool-call limit reached (${maxToolCalls}).`,
            });
            return;
          }
          handleExecCall(
            call.name,
            call.args,
            options.pool,
            options.context,
          ).then(
            (result) => {
              if (result.images?.length) {
                for (const image of result.images) {
                  if (images.length < EXEC_DEFAULT_MAX_IMAGES)
                    images.push(image);
                }
              }
              if (settled) return;
              worker.postMessage({
                kind: "result",
                id: call.id,
                ok: true,
                value: result.output,
              });
            },
            (error: unknown) => {
              if (settled) return;
              worker.postMessage({
                kind: "result",
                id: call.id,
                ok: false,
                error: humanizeError(
                  error instanceof Error ? error.message : String(error),
                ),
              });
            },
          );
          return;
        }
        if (message.kind === "done") {
          const done = message as {
            ok: boolean;
            value?: string;
            error?: string;
            logs?: string[];
          };
          const logs = Array.isArray(done.logs) ? done.logs : [];
          if (done.ok) {
            finish({
              ok: true,
              value: done.value,
              logs,
              toolCalls,
              images,
            });
          } else {
            finish({
              ok: false,
              error: humanizeError(done.error ?? "Exec script failed"),
              logs,
              toolCalls,
              images,
            });
          }
        }
      },
    );

    worker.on("error", (error: Error) => {
      logger.error(`[Exec] sandbox worker error: ${error.message}`);
      finish({
        ok: false,
        error: humanizeError(error.message),
        logs: [],
        toolCalls,
        images,
      });
    });

    worker.on("exit", (code: number) => {
      finish({
        ok: false,
        error: `Exec sandbox exited unexpectedly (code ${code})`,
        logs: [],
        toolCalls,
        images,
      });
    });

    worker.postMessage({
      kind: "run",
      code: options.code,
      toolNames: options.pool.map((entry) => entry.name),
      searchName: EXEC_SEARCH_NAME,
      timeoutMs,
      maxLogChars,
      maxResultChars,
    });
  });
}
