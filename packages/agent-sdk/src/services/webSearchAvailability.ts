/**
 * Whether web search exists on the server this process talks to.
 *
 * The endpoint answers `404` when the deployment does not have the capability
 * (`WEB_SEARCH_ENABLED` off) — a property of *that* deployment, not a transient
 * failure of one request. Probing it every turn costs a round trip and makes the
 * model apologise over and over for a switch it cannot flip, so the first 404 is
 * remembered and the tool stops being registered.
 *
 * Three deliberate choices:
 *
 * - **In memory only.** It is not a user preference and not a fact about the
 *   account, so nothing is written to `~/.wave`: no settings key, no auth field.
 *   A restart re-probes once, which is the right cost for a server that may have
 *   been reconfigured meanwhile.
 * - **Keyed by `serverUrl`.** The login state follows the server URL
 *   (`authService`), so switching to another deployment must not inherit "no
 *   search here" from the previous one. Per-server is the smallest key that stays
 *   correct across that switch.
 * - **Registration-time, not call-time only.** `ToolManager` reads it when
 *   building the tool table, so a 404 also removes the tool from the declaration
 *   the model sees — a hidden capability beats a listed one that always errors.
 *   The tool's `execute` reads it too, because a REPL script can hold a plugin
 *   reference from before the unregister.
 */
import { authService } from "./authService.js";
import { logger } from "../utils/globalLogger.js";

/** Server URLs this process has been told "no web search here" by. */
const unsupportedServers = new Set<string>();

/** Whether the current server is known to *lack* the capability. */
export function isWebSearchAvailable(): boolean {
  return !unsupportedServers.has(authService.getServerUrl());
}

/**
 * Record the 404 verdict for the current server. Idempotent, and logged once per
 * server so a session that keeps calling the stale plugin reference does not
 * flood the log with the same line.
 */
export function markWebSearchUnsupported(): void {
  const serverUrl = authService.getServerUrl();
  if (unsupportedServers.has(serverUrl)) return;
  unsupportedServers.add(serverUrl);
  logger?.info("Web search is not available on this server", { serverUrl });
}

/** Drop the memo so a test can exercise the probe itself. */
export function __resetWebSearchAvailabilityForTesting(): void {
  unsupportedServers.clear();
}
