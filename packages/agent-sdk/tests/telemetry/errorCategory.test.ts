import { describe, it, expect } from "vitest";
import {
  classifyError,
  type ErrorCategory,
} from "../../src/telemetry/errorCategory.js";

/** An upstream SDK error: it carries a status and, usually, a class name. */
function apiError(
  status: number,
  message = "upstream said no",
): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

describe("classifyError", () => {
  describe("structured HTTP status", () => {
    it("maps 401 and 403 to auth", () => {
      expect(classifyError(apiError(401))).toBe("auth");
      expect(classifyError(apiError(403))).toBe("auth");
    });

    it("maps 429 to rate_limit", () => {
      expect(classifyError(apiError(429))).toBe("rate_limit");
    });

    it("maps 5xx (including the overload 529) to server", () => {
      expect(classifyError(apiError(500))).toBe("server");
      expect(classifyError(apiError(502))).toBe("server");
      expect(classifyError(apiError(529))).toBe("server");
    });

    it("maps 400 and 422 to invalid_request", () => {
      expect(classifyError(apiError(400))).toBe("invalid_request");
      expect(classifyError(apiError(422))).toBe("invalid_request");
    });

    it("maps 408 to timeout", () => {
      expect(classifyError(apiError(408))).toBe("timeout");
    });

    it("reads statusCode as well as status", () => {
      const error = new Error("rejected") as Error & { statusCode: number };
      error.statusCode = 429;
      expect(classifyError(error)).toBe("rate_limit");
    });

    it("lets the status win over the message", () => {
      // A 429 whose wording also mentions the model must stay a rate limit: the
      // structured field is the trustworthy signal.
      expect(classifyError(apiError(429, "model is not configured"))).toBe(
        "rate_limit",
      );
    });
  });

  describe("transport failures", () => {
    it("maps provider connection classes to network", () => {
      const error = new Error("Connection error.");
      error.name = "APIConnectionError";
      expect(classifyError(error)).toBe("network");
    });

    it("maps node network codes to network", () => {
      for (const code of ["ECONNREFUSED", "ENOTFOUND", "ECONNRESET"]) {
        const error = new Error("connect failed") as Error & { code: string };
        error.code = code;
        expect(classifyError(error)).toBe("network");
      }
    });

    it("maps certificate failures to network", () => {
      const error = new Error("self signed certificate") as Error & {
        code: string;
      };
      error.code = "DEPTH_ZERO_SELF_SIGNED_CERT";
      expect(classifyError(error)).toBe("network");
    });

    it("maps provider timeout classes and codes to timeout", () => {
      const byName = new Error("Request timed out.");
      byName.name = "APIConnectionTimeoutError";
      expect(classifyError(byName)).toBe("timeout");

      const byCode = new Error("timed out") as Error & { code: string };
      byCode.code = "UND_ERR_CONNECT_TIMEOUT";
      expect(classifyError(byCode)).toBe("timeout");
    });
  });

  describe("message-only families", () => {
    it("maps a rejected oversized image to invalid_request", () => {
      expect(
        classifyError(apiError(400, "image exceeds 5 MB maximum size")),
      ).toBe("invalid_request");
      expect(classifyError(new Error("image dimensions exceed 8000px"))).toBe(
        "invalid_request",
      );
    });

    it("maps a too-long prompt to invalid_request", () => {
      expect(classifyError(new Error("Prompt is too long"))).toBe(
        "invalid_request",
      );
      expect(classifyError(new Error("context window exceeded"))).toBe(
        "invalid_request",
      );
    });

    it("maps local misconfiguration to config", () => {
      expect(
        classifyError(
          new Error(
            "Agent configuration requires model. Provide via constructor or WAVE_MODEL environment variable.",
          ),
        ),
      ).toBe("config");
      expect(classifyError(new Error("missing api key"))).toBe("config");
      expect(classifyError(new Error("API key is not configured"))).toBe(
        "config",
      );
    });
  });

  describe("local persistence", () => {
    it("maps write-side filesystem codes to persist", () => {
      for (const code of ["ENOSPC", "EACCES", "EROFS", "EMFILE", "EDQUOT"]) {
        const error = new Error("write failed") as Error & { code: string };
        error.code = code;
        expect(classifyError(error)).toBe("persist");
      }
    });

    it("maps a missing transcript to persist", () => {
      // This is the message `appendMessages` throws when the directory the
      // session was opened under no longer encodes to where its file lives.
      expect(
        classifyError(
          new Error(
            "Session file not found: e81f0cd1. Use createSession() to create a new session first.",
          ),
        ),
      ).toBe("persist");
    });

    it("does not treat a bare ENOENT as a persistence failure", () => {
      // ENOENT on its own is some other lookup that happened to miss; only the
      // write-path wording makes it a persistence failure.
      const error = new Error("no such file") as Error & { code: string };
      error.code = "ENOENT";
      expect(classifyError(error)).toBe("unknown");
    });
  });

  describe("fallback and closed set", () => {
    it("maps an unrecognized failure to unknown", () => {
      expect(classifyError(new Error("boom"))).toBe("unknown");
      expect(
        classifyError(new Error("Stream ended without a finish_reason")),
      ).toBe("unknown");
    });

    it("never leaks the message into the category", () => {
      // `message` is free text; putting any of it in a label value is what
      // makes a metric dimension explode.
      const category = classifyError(new Error("boom-9f3a"));
      expect(category).toBe("unknown");
      expect(category).not.toContain("9f3a");
    });

    it("takes non-Error throwables without throwing", () => {
      const values: unknown[] = [
        undefined,
        null,
        "some string",
        42,
        { foo: "bar" },
        [],
      ];
      const known: ErrorCategory[] = [
        "network",
        "timeout",
        "auth",
        "rate_limit",
        "server",
        "invalid_request",
        "config",
        "unknown",
      ];
      for (const value of values) {
        expect(known).toContain(classifyError(value));
      }
    });
  });
});
