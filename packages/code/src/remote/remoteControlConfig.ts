/**
 * Where remote control dials out to, who this machine is on that channel, and
 * how it gets itself registered there.
 *
 * Three things have to be resolved before a process can subscribe:
 *
 * - **The relay URL.** Derived from the same server URL the rest of the CLI
 *   uses for SSO (`authService.getServerUrl()`), so a private deployment that
 *   sets `WAVE_SERVER_URL` gets its own relay without a second knob. A relay
 *   that lives elsewhere is reachable through `WAVE_REMOTE_CONTROL_URL`, which
 *   is the **whole** subscribe URL (host id included), not an origin.
 * - **This machine's identity.** The channel is keyed by the machine
 *   (`/v1/hosts/ws/{hostId}/subscribe`) and the id is **derived here** from the
 *   OS machine id plus the signed-in account (`hostIdentity.ts`), then sent along
 *   with the registration: the relay reuses the row it already holds for that id,
 *   or creates one with it. That is what keeps one machine to one row — and one
 *   page URL — when a state file is lost.
 * - **The page a phone opens.** `<server>/remote/?host={hostId}`, assembled here
 *   because the process holding the channel key is the only one that knows both
 *   halves of it — and it is what the QR code encodes.
 *
 * Registration happens **once per machine**. The id and its token are long-lived
 * (90 days, revocable) and the pair is kept in `~/.wave/remote-control.json`,
 * read on every boot and written only when a machine registers. A stored
 * identity always wins over the derivation — it is reused as-is and never
 * re-derived, so no machine moves to a new row when the derivation changes.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { authService, createAuthAwareFetch } from "wave-agent-sdk";
import { deriveHostId } from "./hostIdentity.js";
import { readNearestPackageJson } from "../utils/readPackageJson.js";

/** Everything the relay connection needs, resolved fresh at connect time. */
export interface RemoteControlEndpoint {
  url: string;
  /** The relay-assigned channel id (also the path segment of `url`). */
  hostId: string;
  /** Long-lived host credential. Never logged, never shown. */
  hostToken: string;
  version: string;
}

export interface RelayHostRegistration {
  hostId: string;
  hostToken: string;
}

/** Registration is a one-shot call on a very slow path; it may not hang the daemon. */
const REGISTER_TIMEOUT_MS = 10_000;

const NOT_SIGNED_IN =
  "Not signed in: remote control registers this machine with the relay and needs an SSO credential to do it (run /login).";

export function getRemoteControlStatePath(): string {
  return path.join(os.homedir(), ".wave", "remote-control.json");
}

interface RemoteControlStateFile {
  /** Both assigned by the relay; both needed before anything can connect. */
  hostId?: string;
  hostToken?: string;
  /** The label registration sent, so a later `on` does not silently rename. */
  name?: string;
}

function readState(): RemoteControlStateFile {
  try {
    const raw = fs.readFileSync(getRemoteControlStatePath(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) {
      return parsed as RemoteControlStateFile;
    }
  } catch {
    // Missing or unreadable reads as "not registered yet". That is also what a
    // half-written file must look like: registering again is recoverable (it
    // leaves an orphan row), crashing a daemon that is already serving is not.
  }
  return {};
}

function writeState(state: RemoteControlStateFile): void {
  const filePath = getRemoteControlStatePath();
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    // Write-then-rename: a daemon killed mid-write must not leave a truncated
    // file that reads back as "not registered" and registers a second machine.
    const tmp = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    fs.renameSync(tmp, filePath);
  } catch {
    // A read-only home is not fatal — the machine just registers again next
    // time, which the relay tolerates (it only costs an extra row).
  }
}

/**
 * RPC base for the relay's REST surface (`/api/relay/hosts`, …): the same
 * deployment that serves the WebSocket channel.
 *
 * The subscribe-URL override wins when set, because a relay reached through it
 * is by definition not the one `getServerUrl()` points at — and registration has
 * to land on the relay the machine will actually connect to.
 */
export function getRelayApiBaseUrl(): string {
  const override = process.env.WAVE_REMOTE_CONTROL_URL;
  if (override) {
    try {
      const url = new URL(override);
      url.protocol = url.protocol === "wss:" ? "https:" : "http:";
      return url.origin;
    } catch {
      // Not a URL at all: fall back to the configured server.
    }
  }
  return authService.getServerUrl();
}

interface RegisterResponseBody {
  host?: { id?: unknown; name?: unknown; platform?: unknown; status?: unknown };
  hostToken?: unknown;
  error?: unknown;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * The relay's refusals are not interchangeable: "this account has no enterprise
 * context" and "this account is not an active member" are the same status code
 * and need different things done about them, so the two are kept apart here
 * rather than collapsed into "403".
 */
export function describeRegistrationFailure(
  status: number,
  error: string | undefined,
): string {
  if (error === "Enterprise access required") {
    return "this account has no enterprise context, and remote control is enterprise-only (ops administrators and personal accounts are not eligible).";
  }
  if (error === "You must be an active enterprise member") {
    return "this account is not an active member of the enterprise that runs the relay — ask an administrator to activate the membership, then try again.";
  }
  if (status === 401) {
    return "the sign-in is missing or expired: registering this machine needs a current enterprise member credential (run /login).";
  }
  if (error === "invalid_name" || error === "invalid_platform") {
    return "the relay rejected this machine's name or platform (the name is limited to 100 characters).";
  }
  if (status === 503) {
    return "this deployment has remote control switched off.";
  }
  return `the relay refused to register this machine (${status}${error ? `: ${error}` : ""}).`;
}

/**
 * Register this machine with the relay and take the identity it hands back.
 *
 * Called through `createAuthAwareFetch` so the credential is the current SSO
 * token — refreshed if it is about to expire, which matters because a daemon can
 * sit idle for hours before someone turns remote control on.
 */
export async function registerRelayHost(options: {
  name: string;
  platform?: string;
  /**
   * The id derived from this machine's identity (`deriveHostId`). The relay reuses
   * the row it already has for that id and mints one only when it has none — so a
   * machine that lost its state file comes back as itself instead of leaving a
   * second row behind. Omitted when the identity cannot be derived.
   */
  id?: string;
}): Promise<RelayHostRegistration> {
  if (!authService.getSSOToken()) throw new Error(NOT_SIGNED_IN);

  let response: Response;
  try {
    response = await createAuthAwareFetch(globalThis.fetch)(
      `${getRelayApiBaseUrl()}/api/relay/hosts`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: options.name,
          platform: options.platform ?? process.platform,
          ...(options.id ? { id: options.id } : {}),
        }),
        signal: AbortSignal.timeout(REGISTER_TIMEOUT_MS),
      },
    );
  } catch (err) {
    throw new Error(
      `cannot reach the relay to register this machine: ${(err as Error).message}`,
    );
  }

  const body = (await response.json().catch(() => undefined)) as
    | RegisterResponseBody
    | undefined;
  if (!response.ok) {
    throw new Error(
      describeRegistrationFailure(response.status, asString(body?.error)),
    );
  }

  const hostId = asString(body?.host?.id);
  const hostToken = asString(body?.hostToken);
  if (!hostId || !hostToken) {
    throw new Error(
      "the relay accepted the registration but returned no host id / token — this machine cannot be trusted to reach it again.",
    );
  }

  return { hostId, hostToken };
}

/**
 * This machine's relay identity: the stored one when there is one, otherwise a
 * fresh registration. Never registers twice for the same machine — and, with the
 * derived id, no longer registers a second row for it either when the state file
 * went missing.
 *
 * `refresh` is the one exception, and it has one caller: the relay answered
 * `4003` with a stale-identity reason, so the stored pair is known to be dead
 * (revoked row / expired token / a file whose id and token never belonged
 * together). Dropping it *before* registering is deliberate — if the
 * registration then fails (an expired sign-in is the common case), the file must
 * not keep pointing at an identity the relay has already refused, or the next
 * attempt would hand the same dead token over and the user would be back to
 * moving that file by hand.
 */
export async function ensureRelayHostRegistration(
  name?: string,
  options: { refresh?: boolean } = {},
): Promise<RelayHostRegistration> {
  const state = readState();
  const storedName = asString(state.name);
  if (!options.refresh) {
    const storedId = asString(state.hostId);
    const storedToken = asString(state.hostToken);
    if (storedId && storedToken) {
      return { hostId: storedId, hostToken: storedToken };
    }
  } else {
    writeState(storedName ? { name: storedName } : {});
  }

  const label = name?.trim() || storedName || os.hostname();
  const registration = await registerRelayHost({
    name: label,
    id: deriveHostId(),
  });
  writeState({
    hostId: registration.hostId,
    hostToken: registration.hostToken,
    name: label,
  });
  return registration;
}

/**
 * `https://host` → `wss://host`, `http://host` → `ws://host`. An explicit
 * scheme in `WAVE_REMOTE_CONTROL_URL` is used as given.
 */
export function buildSubscribeUrl(serverUrl: string, hostId: string): string {
  const parsed = new URL(serverUrl);
  parsed.protocol = parsed.protocol === "http:" ? "ws:" : "wss:";
  parsed.pathname = `/v1/hosts/ws/${encodeURIComponent(hostId)}/subscribe`;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

/**
 * The page a phone should open for this machine's channel.
 *
 * It is derived from the server URL the page is served from — the enterprise
 * deployment hosts it, next to the SSO login it reuses, so the host matches
 * `WAVE_SERVER_URL` by construction and the page reads the signed-in token from
 * its own origin. The channel id is the only thing that has to come from here,
 * and it is not a secret: the relay checks on handshake that the channel belongs
 * to the signed-in account and that the account is an active member of the
 * enterprise. Undefined when that URL cannot be parsed (the channel id is still
 * printable; only the QR needs a URL).
 */
export function buildPageUrl(hostId: string): string | undefined {
  try {
    const url = new URL("/remote/", authService.getServerUrl());
    url.searchParams.set("host", hostId);
    return url.toString();
  } catch {
    return undefined;
  }
}

/**
 * Resolve the connection target, or say why there isn't one. Called at connect
 * time rather than at daemon boot: a resident daemon outlives the SSO token it
 * was started with, and the user may turn remote control on hours later — and,
 * on a machine that has never paired, this is also where the one registration
 * call happens.
 */
export async function resolveRemoteControlEndpoint(
  options: {
    name?: string;
    /** Register again instead of trusting the stored pair (see above). */
    refreshIdentity?: boolean;
  } = {},
): Promise<{
  endpoint?: RemoteControlEndpoint;
  pageUrl?: string;
  error?: string;
}> {
  let registration: RelayHostRegistration;
  try {
    registration = await ensureRelayHostRegistration(options.name, {
      refresh: options.refreshIdentity,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  const override = process.env.WAVE_REMOTE_CONTROL_URL;
  let url: string;
  if (override) {
    url = override;
  } else {
    try {
      url = buildSubscribeUrl(authService.getServerUrl(), registration.hostId);
    } catch (err) {
      return {
        error: `Cannot build the relay URL from the server URL: ${(err as Error).message}`,
      };
    }
  }

  const pageUrl = buildPageUrl(registration.hostId);
  return {
    endpoint: {
      url,
      hostId: registration.hostId,
      hostToken: registration.hostToken,
      version: readNearestPackageJson().version,
    },
    ...(pageUrl ? { pageUrl } : {}),
  };
}
