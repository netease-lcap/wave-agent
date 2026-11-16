/**
 * Host notice channel
 *
 * Process-level, one-shot notices the SDK owes the user through the host UI:
 * the private-deployment license gate rejected the managed-config fetch, the
 * SSO session expired, a settings file no longer parses. They have no session
 * to attach to — they fire before any session is bound (startup, SSO login,
 * hourly poll) or come from a subsystem the process owns on its own — so the
 * notice carries no `sessionId` and the host only has to *display* it.
 *
 * De-duplication is the SDK's job: each source decides when its notice is
 * worth re-emitting (one per license code, one per expiring session, one per
 * broken path) and re-arms itself on its own success path. The protocol layer
 * therefore holds no state — a host that was not listening yet loses nothing
 * but the notice.
 *
 * `message` is given by the SDK, never composed by the host: for the license
 * gate it is the server's own `error` text verbatim, for the other sources it
 * is an SDK constant. Hosts render it as-is.
 */

export type HostNoticeKind =
  | "licenseBlocked"
  | "authExpired"
  | "configParseError";

export interface HostNotice {
  kind: HostNoticeKind;
  /** 给用户看的原文；客户端不自造第二条文案。 */
  message: string;
}

let _hostNoticeCallbacks: Array<(notice: HostNotice) => void> = [];

/**
 * Subscribe to host notices. Subscribers are per-process surfaces that turn a
 * notice into their own one-off UI (CLI hint line, desktop toast, IDE error
 * bubble). Returns an unsubscribe function.
 */
export function onHostNotice(
  callback: (notice: HostNotice) => void,
): () => void {
  _hostNoticeCallbacks.push(callback);
  return () => {
    _hostNoticeCallbacks = _hostNoticeCallbacks.filter((cb) => cb !== callback);
  };
}

/**
 * Emit a notice to every current subscriber. Called by the SDK sources that
 * own the de-duplication; subscriber errors must never break the flow that
 * raised the notice (a fetch, a token refresh, a config load).
 */
export function emitHostNotice(notice: HostNotice): void {
  for (const cb of _hostNoticeCallbacks) {
    try {
      cb(notice);
    } catch {
      // Subscriber errors must not break the emitting flow.
    }
  }
}
