import { describe, it, expect } from "vitest";
import { homedir } from "os";
import { join, resolve } from "path";
import {
  MCP_FAILURE_MESSAGE_LIMIT,
  McpConfigError,
  classifyMcpFailure,
  sanitizeMcpFailureMessage,
} from "../../src/utils/mcpFailure.js";

/** Shaped like the errors the MCP SDK and `cross-spawn` actually throw. */
function errorWithCode(message: string, code: unknown): Error {
  const error = new Error(message) as Error & { code?: unknown };
  error.code = code;
  return error;
}

describe("classifyMcpFailure", () => {
  it("buckets a command that could not be started as spawn", () => {
    expect(
      classifyMcpFailure(errorWithCode("spawn npx ENOENT", "ENOENT")),
    ).toBe("spawn");
    expect(
      classifyMcpFailure(errorWithCode("spawn uvx EACCES", "EACCES")),
    ).toBe("spawn");
    // A wrapped error can lose `code` and keep only the message.
    expect(classifyMcpFailure(new Error("spawn npx ENOENT"))).toBe("spawn");
  });

  it("buckets a refusal by the server as auth", () => {
    expect(
      classifyMcpFailure(errorWithCode("Streamable HTTP error: …", 401)),
    ).toBe("auth");
    expect(
      classifyMcpFailure(errorWithCode("Streamable HTTP error: …", 403)),
    ).toBe("auth");
    expect(
      classifyMcpFailure(new Error("Error POSTing to endpoint (HTTP 401): no")),
    ).toBe("auth");
    const unauthorized = new Error("Failed to authorize");
    unauthorized.name = "UnauthorizedError";
    expect(classifyMcpFailure(unauthorized)).toBe("auth");
  });

  it("buckets an existing SDK timer as timeout", () => {
    expect(classifyMcpFailure(errorWithCode("Request timed out", -32001))).toBe(
      "timeout",
    );
    expect(
      classifyMcpFailure(errorWithCode("connect ETIMEDOUT", "ETIMEDOUT")),
    ).toBe("timeout");
    expect(classifyMcpFailure(new Error("Body Timeout Error"))).toBe("timeout");
  });

  it("buckets a handshake-level protocol problem as protocol", () => {
    expect(
      classifyMcpFailure(
        new Error("Server's protocol version is not supported: 2024-01-01"),
      ),
    ).toBe("protocol");
    // `McpError` carries a JSON-RPC code (-32700…-32600).
    expect(classifyMcpFailure(errorWithCode("Invalid params", -32602))).toBe(
      "protocol",
    );
  });

  it("buckets our own config validation as config", () => {
    expect(
      classifyMcpFailure(
        new McpConfigError(
          'MCP server x has unknown type "websocket". Must be "stdio", "sse", or "http"',
        ),
      ),
    ).toBe("config");
    // `new URL(bad)` throws a TypeError; that is a config problem.
    expect(classifyMcpFailure(new TypeError("Invalid URL"))).toBe("config");
  });

  it("buckets a `listTools()` failure by the stage, not by the error", () => {
    // The handshake already succeeded here, so even an error that would
    // otherwise read as a spawn problem is "connected but unusable".
    expect(
      classifyMcpFailure(
        errorWithCode("spawn npx ENOENT", "ENOENT"),
        "list_tools",
      ),
    ).toBe("list_tools");
  });

  it("buckets a channel closed before the handshake as closed", () => {
    // What a server that exits right after being spawned really produces.
    expect(
      classifyMcpFailure(
        errorWithCode("MCP error -32000: Connection closed", -32000),
      ),
    ).toBe("closed");
  });

  it("falls back to other for anything unrecognised", () => {
    expect(classifyMcpFailure(new Error("something odd"))).toBe("other");
    expect(classifyMcpFailure(undefined)).toBe("other");
  });
});

describe("sanitizeMcpFailureMessage", () => {
  const WORKDIR = resolve("/fake/customer/project");

  it("keeps the reason and drops the session workdir prefix", () => {
    const message = sanitizeMcpFailureMessage(
      new Error(
        `ENOENT: no such file or directory, open '${join(WORKDIR, ".mcp.json")}'`,
      ),
      { workdir: WORKDIR },
    );

    expect(message).toBe(
      `ENOENT: no such file or directory, open '${join("<workdir>", ".mcp.json")}'`,
    );
  });

  it("replaces the home directory with a tilde", () => {
    const home = homedir();
    const message = sanitizeMcpFailureMessage(
      new Error(
        `EACCES: permission denied, open '${join(home, ".wave", "mcp.json")}'`,
      ),
      { homeDir: home },
    );

    expect(message).not.toContain(home);
    expect(message).toContain("~");
  });

  it("redacts the directory whichever separator either side spells it with", () => {
    // Windows: the configured home can be POSIX-style (`/tmp`, as on the CI
    // runner) while `path.win32` joins it into `\tmp\…`; the reverse
    // (backslash config, forward-slash message) is just as reachable.
    for (const [inMessage, configured] of [
      ["\\home\\liu\\.wave\\mcp.json", "/home/liu"],
      ["/home/liu/.wave/mcp.json", "\\home\\liu"],
    ]) {
      const message = sanitizeMcpFailureMessage(
        new Error(`EACCES: permission denied, open '${inMessage}'`),
        { homeDir: configured },
      );

      expect(message).not.toContain("liu");
      expect(message).toContain("~");
    }
  });

  it("strips a URL's credentials and query string but keeps host and path", () => {
    const message = sanitizeMcpFailureMessage(
      new Error(
        "Error POSTing to endpoint (HTTP 500): https://alice:s3cret@mcp.example.com/v1/tools?access_token=abc123&x=1#frag",
      ),
    );

    expect(message).not.toContain("s3cret");
    expect(message).not.toContain("access_token");
    expect(message).not.toContain("alice");
    expect(message).toContain("https://mcp.example.com/v1/tools");
  });

  it("masks a bearer token a server echoed back", () => {
    const message = sanitizeMcpFailureMessage(
      new Error(
        "401 Unauthorized: Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.x.y",
      ),
    );

    expect(message).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(message).toContain("Bearer <redacted>");
  });

  it("collapses newlines so a multi-line body stays one attribute", () => {
    const message = sanitizeMcpFailureMessage(
      new Error("first line\n  second line\n\nthird"),
    );

    expect(message).toBe("first line second line third");
  });

  it("truncates to the telemetry limit", () => {
    const message = sanitizeMcpFailureMessage(new Error("x".repeat(500)));

    expect(message.length).toBe(MCP_FAILURE_MESSAGE_LIMIT + 1);
    expect(message.endsWith("…")).toBe(true);
  });

  it("ignores an empty workdir instead of mangling the message", () => {
    expect(
      sanitizeMcpFailureMessage(new Error("plain failure"), { workdir: "" }),
    ).toBe("plain failure");
  });
});
