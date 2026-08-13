/**
 * True for http(s) URLs whose path matches the artifact page format
 * `{host}/code/artifact/{slug}` — the same shape the Artifact tool publishes
 * and WebFetch's extractArtifactSlug recognizes. Artifact pages are private
 * and auth'd through the SSO session, which the sandboxed preview <webview>
 * cannot carry, so the desktop host routes these links to the system browser
 * instead, where the user's browser SSO login applies.
 */
export function isArtifactUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    return /^\/code\/artifact\/[^/]+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}
