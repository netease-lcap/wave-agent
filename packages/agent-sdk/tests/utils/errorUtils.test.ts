import { describe, it, expect } from "vitest";
import { serializeError } from "../../src/utils/errorUtils.js";

/**
 * `new Error(msg, { cause })` is not in the configured TS lib, so build the
 * cause chain the way undici does at runtime — note that `cause` is
 * **non-enumerable**, which is why `JSON.stringify` drops it.
 */
function withCause<T extends Error>(error: T, cause: unknown): T {
  Object.defineProperty(error, "cause", {
    value: cause,
    enumerable: false,
    writable: true,
    configurable: true,
  });
  return error;
}

describe("serializeError", () => {
  it("should keep name and message of a plain Error", () => {
    expect(serializeError(new TypeError("fetch failed"))).toEqual({
      name: "TypeError",
      message: "fetch failed",
    });
  });

  it("should keep the cause chain that holds the real network failure", () => {
    const cause = Object.assign(new Error("self-signed certificate"), {
      code: "DEPTH_ZERO_SELF_SIGNED_CERT",
    });

    expect(
      serializeError(withCause(new TypeError("fetch failed"), cause)),
    ).toEqual({
      name: "TypeError",
      message: "fetch failed",
      cause: {
        name: "Error",
        message: "self-signed certificate",
        code: "DEPTH_ZERO_SELF_SIGNED_CERT",
      },
    });
  });

  it("should keep node system error fields (code/errno/syscall)", () => {
    const error = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
      errno: -111,
      syscall: "connect",
      address: "127.0.0.1",
      port: 443,
    });

    expect(serializeError(error)).toEqual({
      name: "Error",
      message: "connect ECONNREFUSED",
      code: "ECONNREFUSED",
      errno: -111,
      syscall: "connect",
    });
  });

  it("should keep the HTTP status carrier field", () => {
    const error = Object.assign(new Error("HTTP 500 Internal Server Error"), {
      status: 500,
      body: "x".repeat(1000),
    });

    expect(serializeError(error)).toEqual({
      name: "Error",
      message: "HTTP 500 Internal Server Error",
      status: 500,
    });
  });

  it("should survive JSON.stringify into a log line", () => {
    const cause = Object.assign(new Error("certificate has expired"), {
      code: "CERT_HAS_EXPIRED",
    });
    const networkError = () => withCause(new TypeError("fetch failed"), cause);

    // The old shape: a raw Error nested in the log payload serializes to nothing.
    expect(JSON.stringify({ error: networkError() })).toBe('{"error":{}}');

    expect(JSON.stringify({ error: serializeError(networkError()) })).toContain(
      "CERT_HAS_EXPIRED",
    );
  });

  it("should stop at a self-referencing cause instead of recursing forever", () => {
    const error = new Error("loop") as Error & { cause?: unknown };
    error.cause = error;

    const serialized = serializeError(error);

    expect(serialized.name).toBe("Error");
    expect(serialized.message).toBe("loop");
    expect(JSON.stringify(serialized).length).toBeLessThan(500);
  });

  it("should truncate a cause chain that is deeper than the limit", () => {
    let error = new Error("level-0");
    for (let i = 1; i <= 20; i++) {
      error = withCause(new Error(`level-${i}`), error);
    }

    const json = JSON.stringify(serializeError(error));

    expect(json.length).toBeLessThan(2000);
    expect(json).toContain("[truncated]");
  });

  it("should summarize non-Error throws", () => {
    expect(serializeError("boom")).toEqual({
      name: "NonError",
      message: "boom",
    });
    expect(serializeError({ status: 403, reason: "forbidden" })).toEqual({
      name: "NonError",
      message: '{"status":403,"reason":"forbidden"}',
    });
    expect(serializeError(undefined)).toEqual({
      name: "NonError",
      message: "undefined",
    });
  });

  it("should summarize a non-Error cause", () => {
    const error = withCause(new TypeError("fetch failed"), "socket closed");

    expect(serializeError(error)).toEqual({
      name: "TypeError",
      message: "fetch failed",
      cause: "socket closed",
    });
  });
});
