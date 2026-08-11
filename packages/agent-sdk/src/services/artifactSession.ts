/**
 * Session-scoped state shared between the Artifact tool and the WebFetch tool.
 *
 * - file_path → artifact record: lets a model republish a file it already
 *   published this session without passing `url` again, and enables the
 *   same-session auto-allow (the publish was already confirmed once).
 * - slug → latest known version: powers the stale-version guard
 *   (local knowledge older than the live version blocks a redeploy
 *   unless `force` is set) and lets WebFetch record versions it observed.
 *
 * State is keyed by sessionId so parallel sessions never observe each other.
 */

export interface ArtifactRecord {
  url: string;
  slug: string;
  version: string;
}

const sessionArtifacts = new Map<string, Map<string, ArtifactRecord>>();
const sessionSlugVersions = new Map<string, Map<string, string>>();

function fileMapFor(sessionId: string): Map<string, ArtifactRecord> {
  let map = sessionArtifacts.get(sessionId);
  if (!map) {
    map = new Map();
    sessionArtifacts.set(sessionId, map);
  }
  return map;
}

function slugMapFor(sessionId: string): Map<string, string> {
  let map = sessionSlugVersions.get(sessionId);
  if (!map) {
    map = new Map();
    sessionSlugVersions.set(sessionId, map);
  }
  return map;
}

/** Record a successful publish so same-session republishes auto-allow. */
export function recordArtifact(
  sessionId: string,
  filePath: string,
  record: ArtifactRecord,
): void {
  fileMapFor(sessionId).set(filePath, record);
  slugMapFor(sessionId).set(record.slug, record.version);
}

/** Look up an artifact previously published in this session by file path. */
export function getArtifactByFilePath(
  sessionId: string,
  filePath: string,
): ArtifactRecord | undefined {
  return sessionArtifacts.get(sessionId)?.get(filePath);
}

/** Latest version of a slug this session has observed (publish, conflict, or read). */
export function getRecordedVersion(
  sessionId: string,
  slug: string,
): string | undefined {
  return sessionSlugVersions.get(sessionId)?.get(slug);
}

/** Record an observed version (from a publish, a 409 conflict, or a WebFetch read). */
export function recordVersion(
  sessionId: string,
  slug: string,
  version: string,
): void {
  slugMapFor(sessionId).set(slug, version);
}

/** Clear all session-scoped artifact state (used when a session ends). */
export function clearArtifactSession(sessionId: string): void {
  sessionArtifacts.delete(sessionId);
  sessionSlugVersions.delete(sessionId);
}
