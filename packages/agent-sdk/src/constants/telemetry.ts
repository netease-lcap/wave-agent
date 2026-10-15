/**
 * Host entrypoints → the `app.entrypoint` attribute
 * (docs/specs/enterprise/opentelemetry.md「宿主入口标识」).
 *
 * A closed table rather than free text: the value ends up as an attribute value,
 * so a typo would mint a series nobody ever looks at. Anything outside this list
 * — an older host, a hand-written frame, a third-party client — is treated as
 * "not declared" instead of being exported as-is.
 *
 * The entrypoint belongs to whoever CREATES the session, not to the process the
 * session ends up running in: a daemon hosts sessions created locally and ones
 * created from the phone over the remote-control channel, and those must stay
 * distinguishable.
 */
export const HOST_ENTRYPOINTS = [
  /** Interactive CLI, and `-p` / `--print` */
  "cli",
  /** Desktop app — one `wave --stdio` child per session */
  "desktop",
  /** VS Code extension */
  "vscode",
  /** JetBrains plugin */
  "jetbrains",
  /** Remote-control channel: a session created from the phone / Web page */
  "remote",
] as const;

/** One of the entrypoints above. */
export type HostEntrypoint = (typeof HOST_ENTRYPOINTS)[number];

/**
 * Narrow a value of unknown provenance (a stdio `initialize` field) to a known
 * entrypoint.
 *
 * `undefined` is both a valid input and a valid outcome — a session whose
 * creator declared nothing is the normal case, not an error.
 */
export function normalizeEntrypoint(
  value: unknown,
): HostEntrypoint | undefined {
  return typeof value === "string" &&
    (HOST_ENTRYPOINTS as readonly string[]).includes(value)
    ? (value as HostEntrypoint)
    : undefined;
}
