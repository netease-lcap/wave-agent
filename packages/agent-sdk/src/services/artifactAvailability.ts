/**
 * Artifact feature availability.
 *
 * Artifact is ON by default, but only for an account that can actually use it:
 * every request it makes (`POST /api/frame/deploy/direct`, `via=model_read`, …)
 * carries the SSO Bearer token, so with no credentials an unset `enableArtifact`
 * would register a tool whose every action fails. The code default therefore
 * requires two things — the feature flag AND a logged-in account — where the
 * account half is the same check the Artifact tool applies before each action.
 *
 * Explicit sources still win over the default in both directions: remote managed
 * settings (admin push) and local `enableArtifact`. An explicit `true` opens the
 * tool even without credentials (the tool then sends the model to `/login`), and
 * an explicit `false` closes it.
 *
 * Claude Code's counterpart is `enabled = no "off" source && (defaultOn ||
 * explicit true)` on top of an account-level gate (`no_auth` / provider / token
 * scope); the account half here is the login condition specified in
 * `docs/specs/core/artifact-tool.md` (「启用开关与默认启用」).
 */
import { authService } from "./authService.js";
import { loadMergedWaveConfig } from "./configurationService.js";
import { getRemoteSettingsSync } from "./remoteSettingsService.js";

/**
 * Code default for Artifact availability. An unset `enableArtifact` is on for a
 * logged-in account; see `hasArtifactCredentials()` for the account half.
 */
export const ARTIFACT_DEFAULT_ENABLED = true;

/**
 * Whether this process has an account to publish / read with.
 *
 * SSO token presence is wave's established "has usable auth" predicate — the CLI
 * welcome page uses the same one, where a stale access token still counts because
 * it refreshes lazily on the next request (`createAuthAwareFetch`) — and it is
 * exactly what the Artifact tool checks before every action. Token expiry is
 * deliberately not consulted: nothing refreshes at startup, so gating on
 * freshness would withhold the tool from returning users whose token is merely
 * stale. It is a plain file read, so `isArtifactEnabled()` stays synchronous for
 * its registration-time callers.
 */
export function hasArtifactCredentials(): boolean {
  return authService.getSSOToken() !== undefined;
}

/**
 * Whether the Artifact tool should be registered / usable for the given workdir.
 * Resolution order: remote managed settings (`enableArtifact` from
 * `GET /api/wave/settings`, admin override) → explicit `enableArtifact` in local
 * merged settings → code default (on, for a logged-in account).
 */
export function isArtifactEnabled(workdir?: string): boolean {
  // Remote managed settings win (same last-write-wins semantics as `model`).
  const remote = getRemoteSettingsSync();
  if (remote?.enableArtifact !== undefined) {
    return remote.enableArtifact;
  }
  if (workdir) {
    const config = loadMergedWaveConfig(workdir);
    if (config?.enableArtifact !== undefined) {
      return config.enableArtifact;
    }
  }
  // Code default: the feature is on, minus the accounts that could not use it.
  return ARTIFACT_DEFAULT_ENABLED && hasArtifactCredentials();
}
