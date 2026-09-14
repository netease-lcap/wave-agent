/**
 * Exec sandbox constants.
 *
 * Almost everything here is a tunable default, not a contract. In particular no
 * *knob* may be rendered into model-visible text: the catalog has to stay
 * byte-identical for an unchanged MCP pool, so changing a budget must not
 * change the prompt (see `Exec`'s `prompt()`).
 *
 * The exception is `EXEC_RESERVED_NAMESPACE`: it is part of the sandbox API
 * surface, so the tool description has to name it (and it is derived from the
 * same constant, so the two cannot drift).
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
 * Maximum size of the MCP catalog rendered into the Exec tool description, in
 * estimated tokens (a plain `chars / 4`; see `estimateCatalogTokens`).
 *
 * Provenance: opencode's `catalogBudget` — `defaultCatalogBudget = 2_000` in
 * `packages/codemode/src/tool-runtime.ts`. Deliberately not CJK-aware: MCP tool
 * descriptions are overwhelmingly English. Tunable, not a contract.
 */
export const EXEC_DEFAULT_CATALOG_TOKENS = 2_000;

/**
 * Minimum number of catalogable MCP tools before Exec is registered at all.
 * Below this, the flat declarations cost less than the catalog plus the
 * orchestration overhead, so collapsing the pool is a net loss.
 */
export const EXEC_MIN_MCP_TOOLS = 5;

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
