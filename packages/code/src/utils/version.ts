import semver from "semver";

export function isUpdateAvailable(
  currentVersion: string,
  latestVersion: string,
): boolean {
  return semver.gt(latestVersion, currentVersion);
}
