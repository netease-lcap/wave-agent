/**
 * REPL sandbox constants.
 *
 * Everything here is a tunable default, not a contract — with one exception,
 * `EXEC_SEARCH_NAME`: it is part of the sandbox API surface, so the tool
 * description has to name it (and it is derived from the same constant, so the
 * two cannot drift).
 *
 * Note what is deliberately *absent*: no budget bounds the announcement. The
 * announcement is a list of names, and a name list that stops early reads as
 * "those capabilities do not exist" — the worst failure mode this feature has.
 * For the same reason there is no `EXEC_MAX_NESTED_WAIT_SECONDS`: a nested call
 * waits as long as the tool it called, the per-call watchdog below is what stops
 * a call that never answers.
 *
 * Values are cross-checked against Claude Code 2.1.326's REPL module (see
 * `docs/specs/core/repl-tool.md`); each one notes which of its behaviours it
 * encodes.
 */

/**
 * Wall-clock budget for the *synchronous* part of one script, in milliseconds.
 * Waiting on a nested call does not count: the vm is not running then, which is
 * what makes "wait for an approval prompt" free.
 *
 * Provenance: Claude Code's REPL `timeout` input defaults to 30000.
 */
export const EXEC_DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Ceiling for the `timeout` input, whatever the model asks for. Above this the
 * value is clamped rather than rejected.
 *
 * Provenance: Claude Code's REPL `timeout` input caps at 600000.
 */
export const EXEC_MAX_TIMEOUT_MS = 600_000;

/**
 * Maximum number of sandbox -> host tool calls per script. The call that crosses
 * the line does not run, and no later call in that script is answered — a runaway
 * script has to stop at its next tool round-trip instead of grinding through a
 * step budget.
 *
 * Provenance: Claude Code's `50,000` tool-call budget per REPL call.
 */
export const EXEC_DEFAULT_MAX_TOOL_CALLS = 50_000;

/** Maximum number of `console` ring characters kept in memory (not returned). */
export const EXEC_DEFAULT_MAX_LOG_CHARS = 8_000;

/**
 * Total number of characters of *result text* handed back to the model, on top of
 * the per-part cap. Mirrors the `DEFAULT_MAX_RESULT_SIZE_CHARS` bound that the flat
 * MCP and Bash paths apply to their own results: a per-part cap bounds each part
 * but not how many parts there are, so a script that logs a hundred values would
 * otherwise still out-pay the call it replaced.
 *
 * Provenance: Claude Code's `Do = 1e5`, applied to a rendered REPL result.
 */
export const EXEC_DEFAULT_MAX_RESULT_CHARS = 100_000;

/**
 * Per-part character budget for everything the script hands to the model (logs
 * and each returned value). Over-long parts keep their head and tail with an
 * `... [N chars elided] ...` marker in between.
 *
 * Provenance: Claude Code truncates each REPL result part at 30000 characters.
 */
export const EXEC_PART_CHAR_LIMIT = 30_000;

/**
 * Images hoisted from nested calls onto the REPL result. Beyond this the extra
 * ones are dropped with a note; the script only ever saw a text placeholder.
 *
 * Provenance: Claude Code's per-result cap of 8 images and 4 PDFs.
 */
export const EXEC_MAX_IMAGES = 8;

/** PDF attachments hoisted from nested calls onto the REPL result. @see EXEC_MAX_IMAGES */
export const EXEC_MAX_PDFS = 4;

/**
 * Legacy image cap of the old one-script-per-context `Exec`. Superseded by
 * `EXEC_MAX_IMAGES`; kept only until the runtime stops importing it.
 */
export const EXEC_DEFAULT_MAX_IMAGES = 4;

/**
 * How many items of an array survive crossing the sandbox boundary. The carried
 * value gets a `truncatedFrom` field naming the real length, because a silent cut
 * would teach the model that 4096 is the true size.
 *
 * Provenance: Claude Code's 4096-item cross-boundary cap.
 */
export const EXEC_MAX_VM_ARRAY_ITEMS = 4_096;

/**
 * How many hits a keyword search returns by default.
 *
 * Provenance: Claude Code's `searchTools(query, max?)` default of 8. The point is
 * not the number but that there *is* one: a search that can return the whole pool
 * is a search whose result is a second announcement, and the model asked for it
 * precisely because it did not want to read the whole pool.
 */
export const EXEC_SEARCH_DEFAULT_MAX_RESULTS = 8;

/**
 * Hard ceiling on `maxResults`, whatever the caller asks for. The sandbox takes
 * its limit from the model, so without a ceiling one script could dump the entire
 * pool into the context in a single call.
 *
 * Provenance: Claude Code's host-side `25` clamp on `searchTools`.
 */
export const EXEC_SEARCH_MAX_RESULTS_LIMIT = 25;

/**
 * Total budget for one script in ask permission mode, in milliseconds, counted
 * from start and *including* the time a human spends on an approval prompt.
 * Without it a dialog nobody answers keeps the context attached forever.
 *
 * Provenance: Claude Code's 600000 ms ask-mode total.
 */
export const EXEC_ASK_MODE_TOTAL_MS = 600_000;

/**
 * How long one `REPL` call waits for its script before answering with a dispatch
 * receipt, in milliseconds. Fixed, and deliberately *not* the model's `timeout`:
 * the two answer different questions, and folding them together is how a
 * `timeout: 600000` used to hold a whole turn for ten minutes. Past this window
 * the script keeps running on the async lane and its result arrives as an event —
 * the lane that exists for long work — while `timeout` only bounds the
 * synchronous segment of the script itself.
 *
 * Provenance: Claude Code's wait window is the constant 30000 (its `P6t()`
 * returns 30000 and the window is computed from that, never from the `timeout`
 * input).
 */
export const EXEC_SYNC_WAIT_MS = 30_000;

/**
 * Scripts allowed to be in flight on one context. Beyond this a dispatch is
 * *refused* rather than queued: a queue would let the model believe its call is
 * already running.
 *
 * Provenance: Claude Code's concurrency limit of 8.
 */
export const EXEC_ASYNC_CONCURRENCY_LIMIT = 8;

/**
 * Nested calls still answered after the user aborts a script. The window exists so
 * `finally` / cleanup logic can finish; from the 21st call on the host stops
 * answering (the call returns a Promise that never settles) while calls already in
 * flight still complete.
 *
 * Provenance: Claude Code's 20-call post-abort grace.
 */
export const EXEC_ABORT_GRACE_CALLS = 20;

/**
 * Watchdog multiplier for one nested call: a call that declared
 * `nativeTimeoutMs` is killed after `nativeTimeoutMs * EXEC_WATCHDOG_FACTOR +
 * EXEC_WATCHDOG_BASE_MS`, and the error goes back to the script, which keeps
 * running.
 *
 * Provenance: Claude Code's `nativeTimeoutMs × 1.5 + 5000` watchdog.
 */
export const EXEC_WATCHDOG_FACTOR = 1.5;

/** Constant term of the per-call watchdog. @see EXEC_WATCHDOG_FACTOR */
export const EXEC_WATCHDOG_BASE_MS = 5_000;

/**
 * The timeout the watchdog assumes for a nested built-in that takes no timeout
 * input (`Read` / `Write` / `Edit` / `Glob` / `Grep`).
 *
 * Provenance: Claude Code's 10000 ms default for those calls.
 */
export const EXEC_DEFAULT_NATIVE_TIMEOUT_MS = 10_000;

/**
 * Wall-clock ceiling for one background script. Reaching it terminates the script
 * and delivers the failure as an event, so a dispatched script cannot outlive the
 * session's memory of it.
 *
 * Provenance: Claude Code's 7200000 ms (2 hour) background ceiling.
 */
export const EXEC_BACKGROUND_MAX_MS = 7_200_000;

/**
 * How long the sandbox's `$` command-template helper waits for a command that set
 * no timeout of its own; a longer explicit one is honoured up to
 * `EXEC_BACKGROUND_MAX_MS`. Past the wait it *moves to the background* instead of
 * throwing, so a long build does not hold the context.
 *
 * Provenance: Claude Code's 600000 ms shell wait / 7200000 ms ceiling.
 */
export const EXEC_SHELL_DEFAULT_WAIT_MS = 600_000;

/**
 * The sandbox property hosting catalog search — the one name in the sandbox that
 * is not a tool, and the only one that has to be named in model-visible text.
 *
 * Deliberately *not* namespaced. `tools["$codemode"].search` bought one property
 * (the `$` prefix cannot collide with an MCP tool name) at the cost of a
 * one-member namespace, which is a layer with nothing in it. A name that matches
 * Claude Code's `ToolSearch` is worth more than that prefix: the two entries are
 * the same idea under the same name. What the prefix did not buy back is the
 * collision guarantee, so `buildExecPool` asserts that no pool member carries this
 * name — see the comment there for why the assertion lives host-side.
 */
export const EXEC_SEARCH_NAME = "searchTools";

/**
 * How long `Poll` waits before answering with a status line instead of a result.
 *
 * `Poll` is the explicit wait of the async lane, and an explicit wait that never
 * ends is a turn held hostage: a script can legitimately run for two hours, so the
 * ceiling here is about how long to stay silent, not about how long the script may
 * take. Answering "still running" costs one round-trip and is always available
 * again, which is why staying parked is the wrong default.
 */
export const EXEC_POLL_DEFAULT_WAIT_MS = 20_000;

/**
 * How many settled scripts one `Poll` answer carries.
 *
 * Past this the answer says the rest are still queued, oldest first. A cap rather
 * than a promise to deliver everything: several scripts finishing together would
 * otherwise arrive as one message large enough to push a working context out, and
 * the number is the caller's only way to know a next `Poll` has something in it.
 */
export const EXEC_POLL_MAX_EVENTS = 4;
