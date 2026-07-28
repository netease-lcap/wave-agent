/**
 * True for http(s) URLs pointing at a local dev server: localhost, 127.0.0.1
 * or [::1], any port. Everything else (external sites, file:, custom schemes)
 * returns false. Used by the desktop host to route link clicks into the
 * preview pane; mirrored by the same-named helper in
 * packages/desktop for the main-process <webview> attach gate.
 */
export function isLocalhostUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}
