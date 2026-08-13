/**
 * Artifact feature availability.
 *
 * The frame backend (`POST /api/frame/deploy/direct`) is not live yet, so the
 * code default is DISABLED. Internal beta / gradual rollout enables the feature
 * via settings.json `enableArtifact: true` without code changes. Once the
 * backend goes live, flip `ARTIFACT_DEFAULT_ENABLED` to `true` so an unset
 * `enableArtifact` defaults to enabled (matching Claude Code's `enableArtifact`
 * "unset follows feature availability" semantics).
 */
import { loadMergedWaveConfig } from "./configurationService.js";
import { getRemoteSettingsSync } from "./remoteSettingsService.js";

/** Code default for Artifact availability. Flip to true after the frame backend goes live. */
export const ARTIFACT_DEFAULT_ENABLED = false;

/**
 * Whether the Artifact tool should be registered / usable for the given workdir.
 * Resolution order: remote managed settings (`enableArtifact` from
 * `GET /api/wave/settings`, admin override) → explicit `enableArtifact` in local
 * merged settings → code default.
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
  return ARTIFACT_DEFAULT_ENABLED;
}
