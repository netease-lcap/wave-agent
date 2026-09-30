/**
 * Exec sandbox constants.
 *
 * Everything here is a tunable default, not a contract — with one exception,
 * `EXEC_RESERVED_NAMESPACE`: it is part of the sandbox API surface, so the tool
 * description has to name it (and it is derived from the same constant, so the
 * two cannot drift).
 *
 * Note what is deliberately *absent*: no budget bounds the announcement. The
 * announcement is a list of names, and a name list that stops early reads as
 * "those capabilities do not exist" — the worst failure mode this feature has.
 */

/**
 * Wall-clock budget for one Exec script. The parent terminates the sandbox
 * worker when it expires, so a script blocked in `await` is killed instead of
 * spinning on the host event loop forever.
 */
export const EXEC_DEFAULT_TIMEOUT_MS = 60_000;

/** Maximum number of sandbox -> host tool calls per Exec script. */
export const EXEC_DEFAULT_MAX_TOOL_CALLS = 50;

/** Maximum number of `console` output characters returned to the model. */
export const EXEC_DEFAULT_MAX_LOG_CHARS = 8_000;

/**
 * Maximum number of characters of the *script return value* handed back to the
 * model. Mirrors the `DEFAULT_MAX_RESULT_SIZE_CHARS` bound that the flat MCP and
 * Bash paths apply to their own results: without it a script could return a
 * payload far larger than the call it replaced would have produced.
 */
export const EXEC_DEFAULT_MAX_RESULT_CHARS = 100_000;

/** Maximum number of images propagated from nested MCP calls. */
export const EXEC_DEFAULT_MAX_IMAGES = 4;

/**
 * How many hits a keyword search returns by default.
 *
 * Provenance: Claude Code's `ToolSearch` `max_results = 5`. The point is not the
 * number but that there *is* one: a search that can return the whole pool is a
 * search whose result is a second announcement, and the model asked for it
 * precisely because it did not want to read the whole pool.
 */
export const EXEC_SEARCH_DEFAULT_MAX_RESULTS = 5;

/**
 * Hard ceiling on `max_results`, whatever the caller asks for. The sandbox takes
 * its limit from the model, so without a ceiling one script could dump the entire
 * pool into the context in a single call.
 */
export const EXEC_SEARCH_MAX_RESULTS_LIMIT = 50;

/**
 * Reserved property on the sandbox `tools` object hosting search. The `$`
 * prefix cannot collide with an MCP tool name (`[A-Za-z0-9_.-]`).
 */
export const EXEC_RESERVED_NAMESPACE = "$codemode";

/**
 * Internal name the sandbox uses to reach host-side catalog search. Matches the
 * sandbox path `tools.$codemode.search` but never appears in model-visible text.
 */
export const EXEC_SEARCH_CALL = "$codemode.search";
