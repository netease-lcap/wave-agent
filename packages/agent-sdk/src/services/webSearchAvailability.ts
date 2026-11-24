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
 *
 * The explicit switch (`enableWebSearch`) is the *other* reason the tool may be
 * absent, and it is a different fact from the 404 above: a 404 is what the server
 * says about itself, `false` is what configuration says. It resolves like every
 * other feature key — remote managed settings (`GET /api/wave/settings`, admin
 * push) → local merged settings → code default — and it is consulted *before* the
 * 404 verdict, so a closed switch costs zero round trips instead of one. The two
 * stack rather than replace each other: switch on + 404 still hides the tool.
 */
import { authService } from "./authService.js";
import { loadMergedWaveConfig } from "./configurationService.js";
import { getRemoteSettingsSync } from "./remoteSettingsService.js";
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

/** Code default for the explicit switch: on, unless someone says otherwise. */
export const WEB_SEARCH_DEFAULT_ENABLED = true;

/**
 * Whether configuration allows `WebSearch` for `workdir`.
 *
 * Resolution order, highest first: remote managed `enableWebSearch` → local
 * merged `enableWebSearch` → code default (on). A managed value wins in both
 * directions — that is what makes it an operator control rather than a hint.
 *
 * `workdir` is the session's opening directory (`SessionWorkdir`), never the
 * shell's current one: which settings file decides must not change because the
 * agent ran a `cd`.
 *
 * A non-boolean value at a layer reads as "that layer says nothing" rather than
 * being coerced — a malformed push must not be able to flip a switch. A settings
 * read that throws falls back to the default for the same reason: with the
 * default on, an unreadable file must not withdraw the capability.
 */
export function isWebSearchEnabledBySettings(workdir?: string): boolean {
  const managed = readBooleanFlag(getRemoteSettingsSync()?.enableWebSearch);
  if (managed !== undefined) return managed;
  if (workdir) {
    try {
      const local = readBooleanFlag(
        loadMergedWaveConfig(workdir)?.enableWebSearch,
      );
      if (local !== undefined) return local;
    } catch {
      return WEB_SEARCH_DEFAULT_ENABLED;
    }
  }
  return WEB_SEARCH_DEFAULT_ENABLED;
}

/** `true` / `false` when the value is a real boolean, `undefined` otherwise. */
function readBooleanFlag(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** Drop the memo so a test can exercise the probe itself. */
export function __resetWebSearchAvailabilityForTesting(): void {
  unsupportedServers.clear();
}
