import * as path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const store = vi.hoisted(() => ({ files: new Map<string, string>() }));

vi.mock("node:fs", () => ({
  readFileSync: (filePath: string) => {
    const content = store.files.get(filePath);
    if (content === undefined) {
      throw Object.assign(new Error(`ENOENT: ${filePath}`), { code: "ENOENT" });
    }
    return content;
  },
  writeFileSync: (filePath: string, data: string) => {
    store.files.set(filePath, data);
  },
  renameSync: (from: string, to: string) => {
    const content = store.files.get(from);
    if (content === undefined) throw new Error(`ENOENT: ${from}`);
    store.files.set(to, content);
    store.files.delete(from);
  },
  mkdirSync: () => undefined,
}));

vi.mock("node:os", () => ({
  homedir: () => "/fake-home",
  hostname: () => "fake-host",
}));

const auth = vi.hoisted(() => ({
  getSSOToken: vi.fn<() => string | undefined>(),
  getServerUrl: vi.fn<() => string>(),
}));

vi.mock("wave-agent-sdk", () => ({
  authService: {
    getSSOToken: auth.getSSOToken,
    getServerUrl: auth.getServerUrl,
  },
  // The real one attaches the current SSO token (and refreshes it if needed);
  // mirrored here so a test can assert the credential actually goes out.
  createAuthAwareFetch: (inner: typeof fetch) => {
    return (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const token = auth.getSSOToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
      return inner(input, { ...init, headers });
    };
  },
}));

vi.mock("../../src/utils/readPackageJson.js", () => ({
  readNearestPackageJson: () => ({ name: "wave-code", version: "1.3.0" }),
}));

const identity = vi.hoisted(() => ({
  deriveHostId: vi.fn<() => string | undefined>(),
}));

vi.mock("../../src/remote/hostIdentity.js", () => ({
  deriveHostId: identity.deriveHostId,
}));

import {
  buildPageUrl,
  buildSubscribeUrl,
  ensureRelayHostRegistration,
  getRemoteControlStatePath,
  getRelayApiBaseUrl,
  resolveRemoteControlEndpoint,
} from "../../src/remote/remoteControlConfig.js";

/**
 * Derived with `path.join` from the same fake home the `node:os` mock returns,
 * never written as a literal with `/` in it: the code under test builds the path
 * with `path.join`, so a hard-coded POSIX expectation pins the separator of the
 * machine running the suite instead of the derivation and fails on Windows
 * (where `path.join` yields `\`). This key is also the in-memory fs mock's, so
 * getting it wrong makes a written state file invisible to `storedState()`.
 */
const STATE_PATH = path.join("/fake-home", ".wave", "remote-control.json");

type StubReply = { status: number; body?: unknown };

interface StubCall {
  url: string;
  method: string | undefined;
  authorization: string | null;
  body: unknown;
}

let calls: StubCall[] = [];

/** Reply to the relay's REST surface without touching a network. */
function stubFetch(reply: StubReply | ((call: StubCall) => StubReply)): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const call: StubCall = {
        url: String(input),
        method: init?.method,
        authorization: headers.get("Authorization"),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      const resolved = typeof reply === "function" ? reply(call) : reply;
      return new Response(JSON.stringify(resolved.body ?? {}), {
        status: resolved.status,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
}

const REGISTERED = {
  status: 201,
  body: {
    host: {
      id: "relay-assigned-id",
      name: "mac",
      platform: "darwin",
      status: "pending",
    },
    hostToken: "rch_secret",
  },
};

function storedState(): Record<string, unknown> {
  return JSON.parse(store.files.get(STATE_PATH) ?? "{}") as Record<
    string,
    unknown
  >;
}

describe("remoteControlConfig", () => {
  beforeEach(() => {
    store.files.clear();
    calls = [];
    vi.clearAllMocks();
    auth.getSSOToken.mockReturnValue("sso-token");
    auth.getServerUrl.mockReturnValue("https://codechat.example.com");
    identity.deriveHostId.mockReturnValue("derived-machine-id");
    delete process.env.WAVE_REMOTE_CONTROL_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.WAVE_REMOTE_CONTROL_URL;
  });

  it("should keep its state next to the other wave config", () => {
    expect(getRemoteControlStatePath()).toBe(STATE_PATH);
  });

  describe("buildSubscribeUrl", () => {
    it("should derive a wss subscribe url from the sso server url", () => {
      expect(buildSubscribeUrl("https://codechat.example.com", "h1")).toBe(
        "wss://codechat.example.com/v1/hosts/ws/h1/subscribe",
      );
    });

    it("should downgrade the scheme for a plain-http server", () => {
      expect(buildSubscribeUrl("http://localhost:8080", "h1")).toBe(
        "ws://localhost:8080/v1/hosts/ws/h1/subscribe",
      );
    });

    it("should drop any path, query or hash on the server url", () => {
      expect(buildSubscribeUrl("https://host/base?a=1#frag", "h1")).toBe(
        "wss://host/v1/hosts/ws/h1/subscribe",
      );
    });

    it("should escape a host id so it cannot forge a path", () => {
      expect(buildSubscribeUrl("https://host", "a/b?c")).toBe(
        "wss://host/v1/hosts/ws/a%2Fb%3Fc/subscribe",
      );
    });
  });

  describe("buildPageUrl", () => {
    it("should point the page at this machine's channel on the configured server", () => {
      expect(buildPageUrl("h1")).toBe(
        "https://codechat.example.com/remote/?host=h1",
      );
    });

    it("should escape a host id so it cannot forge a query", () => {
      expect(buildPageUrl("a/b&c=d")).toBe(
        "https://codechat.example.com/remote/?host=a%2Fb%26c%3Dd",
      );
    });

    it("should drop any path, query or hash on the server url", () => {
      auth.getServerUrl.mockReturnValue("https://host/base?a=1#frag");
      expect(buildPageUrl("h1")).toBe("https://host/remote/?host=h1");
    });

    it("should report nothing when the server url cannot be parsed", () => {
      auth.getServerUrl.mockReturnValue("not a url");
      expect(buildPageUrl("h1")).toBeUndefined();
    });
  });

  describe("getRelayApiBaseUrl", () => {
    it("should follow the subscribe-url override to the relay that will be dialed", () => {
      process.env.WAVE_REMOTE_CONTROL_URL =
        "ws://127.0.0.1:3401/v1/hosts/ws/some-id/subscribe";
      expect(getRelayApiBaseUrl()).toBe("http://127.0.0.1:3401");
    });

    it("should use the configured server otherwise", () => {
      expect(getRelayApiBaseUrl()).toBe("https://codechat.example.com");
    });
  });

  describe("ensureRelayHostRegistration", () => {
    it("should register with the derived id and keep what the relay hands back", async () => {
      stubFetch(REGISTERED);

      const registration = await ensureRelayHostRegistration("mac");

      // The id goes out with the request and the relay's answer is what is
      // stored: the relay is still the one that decides which row this channel
      // is (it reuses the derived one, or mints a new one when that id is taken).
      expect(registration.hostId).toBe("relay-assigned-id");
      expect(registration.hostToken).toBe("rch_secret");
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("https://codechat.example.com/api/relay/hosts");
      expect(calls[0].method).toBe("POST");
      expect(calls[0].authorization).toBe("Bearer sso-token");
      expect(calls[0].body).toEqual({
        name: "mac",
        platform: process.platform,
        id: "derived-machine-id",
      });
      expect(storedState()).toMatchObject({
        hostId: "relay-assigned-id",
        hostToken: "rch_secret",
        name: "mac",
      });
    });

    it("should register without an id when this machine cannot be identified", async () => {
      // No machine id / no account: the relay mints the id, exactly as it did
      // before the derivation existed. The machine only loses the ability to
      // come back to the same row after a lost state file.
      identity.deriveHostId.mockReturnValue(undefined);
      stubFetch(REGISTERED);

      await ensureRelayHostRegistration();

      expect(calls[0].body).toEqual({
        name: "fake-host",
        platform: process.platform,
      });
    });

    it("should not register twice: the stored identity is reused as-is", async () => {
      store.files.set(
        STATE_PATH,
        JSON.stringify({ hostId: "stored-id", hostToken: "rch_stored" }),
      );

      const registration = await ensureRelayHostRegistration();

      expect(registration).toEqual({
        hostId: "stored-id",
        hostToken: "rch_stored",
      });
      // A stored identity wins over the derivation, so an existing row is never
      // abandoned for a freshly derived id.
      expect(identity.deriveHostId).not.toHaveBeenCalled();
      expect(calls).toHaveLength(0);
    });

    it("should re-register when the file has an id but no token", async () => {
      // The pre-registration layout minted an id locally; such a file cannot
      // connect (no credential, no row), so it is replaced, not trusted.
      store.files.set(STATE_PATH, JSON.stringify({ hostId: "self-minted-id" }));
      stubFetch(REGISTERED);

      const registration = await ensureRelayHostRegistration();

      expect(registration.hostId).toBe("relay-assigned-id");
      expect(storedState().hostId).toBe("relay-assigned-id");
    });

    it("should register again when asked to refresh, keeping the stored label", async () => {
      store.files.set(
        STATE_PATH,
        JSON.stringify({
          hostId: "dead-id",
          hostToken: "rch_dead",
          name: "mac",
        }),
      );
      stubFetch(REGISTERED);

      const registration = await ensureRelayHostRegistration(undefined, {
        refresh: true,
      });

      expect(registration).toEqual({
        hostId: "relay-assigned-id",
        hostToken: "rch_secret",
      });
      expect(calls).toHaveLength(1);
      // A refresh is not a rename: the label survives even though nothing was
      // passed in, so the machine does not reappear on the phone under a new name.
      expect(calls[0].body).toMatchObject({ name: "mac" });
      expect(storedState()).toMatchObject({
        hostId: "relay-assigned-id",
        hostToken: "rch_secret",
        name: "mac",
      });
    });

    it("should drop the dead identity before a refresh that fails", async () => {
      // The registration that has to happen is refused (an expired sign-in is the
      // usual cause). The stale pair must not survive it — keeping it would make
      // the next attempt hand the same refused token over, which is the state the
      // user can only escape by deleting the file by hand.
      store.files.set(
        STATE_PATH,
        JSON.stringify({
          hostId: "dead-id",
          hostToken: "rch_dead",
          name: "mac",
        }),
      );
      stubFetch({ status: 401, body: { error: "Sign-in required" } });

      await expect(
        ensureRelayHostRegistration(undefined, { refresh: true }),
      ).rejects.toThrow();
      expect(storedState()).toEqual({ name: "mac" });
    });

    it("should tell the two 403s apart", async () => {
      stubFetch({ status: 403, body: { error: "Enterprise access required" } });
      await expect(ensureRelayHostRegistration()).rejects.toThrow(
        /no enterprise context/,
      );

      stubFetch({
        status: 403,
        body: { error: "You must be an active enterprise member" },
      });
      await expect(ensureRelayHostRegistration()).rejects.toThrow(
        /not an active member/,
      );
    });

    it("should refuse to register without a credential", async () => {
      auth.getSSOToken.mockReturnValue(undefined);
      stubFetch(REGISTERED);

      await expect(ensureRelayHostRegistration()).rejects.toThrow(/\/login/);
      expect(calls).toHaveLength(0);
    });

    it("should not claim a machine it cannot authenticate again", async () => {
      stubFetch({ status: 201, body: { host: { id: "h1" } } });

      await expect(ensureRelayHostRegistration()).rejects.toThrow(
        /no host id \/ token/,
      );
      expect(store.files.size).toBe(0);
    });

    it("should report an unreachable relay instead of throwing raw", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("connect ECONNREFUSED");
        }),
      );

      await expect(ensureRelayHostRegistration()).rejects.toThrow(
        /cannot reach the relay.*ECONNREFUSED/,
      );
    });
  });

  describe("resolveRemoteControlEndpoint", () => {
    it("should refuse to dial out without registering", async () => {
      auth.getSSOToken.mockReturnValue(undefined);
      stubFetch(REGISTERED);

      const resolved = await resolveRemoteControlEndpoint();

      expect(resolved.endpoint).toBeUndefined();
      expect(resolved.error).toContain("/login");
      expect(store.files.size).toBe(0);
    });

    it("should target this machine's own channel on the configured server", async () => {
      stubFetch(REGISTERED);

      const resolved = await resolveRemoteControlEndpoint({ name: "mac" });

      expect(resolved.error).toBeUndefined();
      expect(resolved.endpoint).toEqual({
        url: "wss://codechat.example.com/v1/hosts/ws/relay-assigned-id/subscribe",
        hostId: "relay-assigned-id",
        hostToken: "rch_secret",
        version: "1.3.0",
      });
      expect(resolved.pageUrl).toBe(
        "https://codechat.example.com/remote/?host=relay-assigned-id",
      );
    });

    it("should prefer an explicit relay url, and register against that relay", async () => {
      process.env.WAVE_REMOTE_CONTROL_URL =
        "ws://127.0.0.1:3401/v1/hosts/ws/relay-assigned-id/subscribe";
      stubFetch(REGISTERED);

      const resolved = await resolveRemoteControlEndpoint();

      expect(resolved.endpoint?.url).toBe(
        "ws://127.0.0.1:3401/v1/hosts/ws/relay-assigned-id/subscribe",
      );
      expect(calls[0].url).toBe("http://127.0.0.1:3401/api/relay/hosts");
    });

    it("should register again on a refresh instead of dialing with the stored pair", async () => {
      // The self-heal path: the relay refused the stored identity, so this call
      // has to produce a *new* credential — reusing the stored one would dial
      // into the same `4003` forever.
      store.files.set(
        STATE_PATH,
        JSON.stringify({
          hostId: "dead-id",
          hostToken: "rch_dead",
          name: "mac",
        }),
      );
      stubFetch(REGISTERED);

      const resolved = await resolveRemoteControlEndpoint({
        refreshIdentity: true,
      });

      expect(calls).toHaveLength(1);
      expect(resolved.endpoint?.hostToken).toBe("rch_secret");
      expect(resolved.endpoint?.url).toBe(
        "wss://codechat.example.com/v1/hosts/ws/relay-assigned-id/subscribe",
      );
    });

    it("should report a server url it cannot parse", async () => {
      stubFetch(REGISTERED);
      auth.getServerUrl.mockReturnValue("not-a-url");

      const resolved = await resolveRemoteControlEndpoint();

      expect(resolved.endpoint).toBeUndefined();
      expect(resolved.error).toContain("relay URL");
    });
  });
});
