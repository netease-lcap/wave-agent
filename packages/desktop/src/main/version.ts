/**
 * Semver helpers shared by the binary resolver and the update checker.
 * (Copied from packages/vscode/src/services/updateService.ts — that module also
 * carries VS Code-specific download/install code we don't need here.)
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Parse a semver string (e.g., "0.3.1" or "0.3.1-alpha.0") into components.
 * Returns null if the version string is invalid.
 */
export function parseVersion(version: string): ParsedVersion | null {
  // Strip pre-release suffix for comparison
  const core = version.replace(/^v?/, "").split("-")[0];
  const parts = core.split(".").map(Number);
  if (parts.length !== 3 || parts.some((p) => Number.isNaN(p))) {
    return null;
  }
  return { major: parts[0], minor: parts[1], patch: parts[2] };
}

/**
 * Compare two parsed versions. Returns:
 *  -1 if a < b
 *   0 if a === b
 *   1 if a > b
 */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}
