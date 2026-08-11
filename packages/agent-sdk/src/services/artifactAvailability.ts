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

/** Code default for Artifact availability. Flip to true after the frame backend goes live. */
export const ARTIFACT_DEFAULT_ENABLED = false;

/**
 * Whether the Artifact tool should be registered / usable for the given workdir.
 * Explicit `enableArtifact` in merged settings wins over the code default.
 */
export function isArtifactEnabled(workdir?: string): boolean {
  if (workdir) {
    const config = loadMergedWaveConfig(workdir);
    if (config?.enableArtifact !== undefined) {
      return config.enableArtifact;
    }
  }
  return ARTIFACT_DEFAULT_ENABLED;
}
