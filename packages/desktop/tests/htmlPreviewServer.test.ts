import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — the server class is unit-tested without real sockets or a real fs:
// * node:http's createServer hands us the request handler directly, so a
//   "request" is just invoking that handler with a fake req/res.
// * node:fs promises are backed by an in-memory file map (testing rule: no
//   mkdtemp / real disk in tests).
// ---------------------------------------------------------------------------

const hf = vi.hoisted(() => ({
  files: new Map<string, string | Buffer>(),
  // Explicit file sizes (byte cap test) — falls back to the content length.
  sizes: new Map<string, number>(),
  // Symlink table: realpath(p) → target (identity when absent).
  symlinks: new Map<string, string>(),
  // Every http server the module created, in creation order.
  servers: [] as Array<{
    handler: (req: unknown, res: unknown) => void;
    listen: ReturnType<typeof vi.fn>;
    address: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    closeAllConnections: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("node:http", () => ({
  default: {
    createServer: (handler: (req: unknown, res: unknown) => void) => {
      // Port is captured before the push so the first server gets 45000.
      const port = 45000 + hf.servers.length;
      const server = {
        handler,
        listen: vi.fn((_port: number, host: string, cb: () => void) => {
          expect(host).toBe("127.0.0.1");
          cb();
        }),
        address: vi.fn(() => ({
          port,
          family: "IPv4",
          address: "127.0.0.1",
        })),
        close: vi.fn((cb: () => void) => cb()),
        closeAllConnections: vi.fn(),
        once: vi.fn(),
      };
      hf.servers.push(server);
      return server;
    },
  },
}));

vi.mock("node:fs", () => ({
  promises: {
    realpath: vi.fn(async (p: string) => hf.symlinks.get(p) ?? p),
    stat: vi.fn(async (p: string) => {
      const data = hf.files.get(p);
      if (data === undefined) {
        throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
      }
      return {
        isFile: () => true,
        isDirectory: () => false,
        size: hf.sizes.get(p) ?? Buffer.byteLength(data),
      };
    }),
    readFile: vi.fn(async (p: string) => {
      const data = hf.files.get(p);
      if (data === undefined) {
        throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
      }
      return data;
    }),
  },
}));

import { HtmlPreviewServer } from "../src/main/htmlPreviewServer";

interface FakeResponse {
  statusCode: number;
  setHeader: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

/** Drive one request through server #idx's handler and drain its microtasks.
 * `statusCode` starts at 200 like a real node http ServerResponse (the success
 * path never assigns it; only error paths do). */
async function serve(
  idx: number,
  method: string,
  url: string,
): Promise<FakeResponse> {
  const res: FakeResponse = {
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn(),
  };
  hf.servers[idx].handler({ method, url }, res);
  await new Promise((resolve) => setImmediate(resolve));
  return res;
}

beforeEach(() => {
  hf.files.clear();
  hf.sizes.clear();
  hf.symlinks.clear();
  hf.servers.length = 0;
});

describe("HtmlPreviewServer", () => {
  it("acquire serves the file's directory on a loopback-bound server", async () => {
    hf.files.set("/work/a/report.html", "<html>hi</html>");
    const server = new HtmlPreviewServer();

    const url = await server.acquire(
      "pane-1",
      "/work/a",
      "/work/a/report.html",
      "/work/a/report.html",
    );

    // Loopback-only listener on an OS-assigned port (spec scenario 8).
    expect(hf.servers).toHaveLength(1);
    expect(hf.servers[0].listen).toHaveBeenCalledWith(
      0,
      "127.0.0.1",
      expect.any(Function),
    );
    expect(url).toBe("http://127.0.0.1:45000/report.html");

    const res = await serve(0, "GET", "/report.html");
    expect(res.statusCode).toBe(200);
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "text/html; charset=utf-8",
    );
    expect(res.end).toHaveBeenCalledWith("<html>hi</html>");
  });

  it("serves sibling files (relative resources) and nested paths from the same root", async () => {
    hf.files.set("/work/a/style.css", "body{}");
    hf.files.set("/work/a/img/logo.png", Buffer.from([1, 2, 3]));
    const server = new HtmlPreviewServer();
    await server.acquire(
      "pane-1",
      "/work/a",
      "/work/a/report.html",
      "/work/a/report.html",
    );

    const css = await serve(0, "GET", "/style.css");
    expect(css.statusCode).toBe(200);
    expect(css.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "text/css; charset=utf-8",
    );

    const img = await serve(0, "GET", "/img/logo.png");
    expect(img.statusCode).toBe(200);
    expect(img.end).toHaveBeenCalledWith(Buffer.from([1, 2, 3]));
  });

  it("reuses one server for the same root across acquires (multiple tabs)", async () => {
    hf.files.set("/work/a/report.html", "a");
    hf.files.set("/work/a/other.html", "b");
    const server = new HtmlPreviewServer();

    await server.acquire(
      "pane-1",
      "/work/a",
      "/work/a/report.html",
      "/work/a/report.html",
    );
    await server.acquire(
      "pane-2",
      "/work/a",
      "/work/a/other.html",
      "/work/a/other.html",
    );

    expect(hf.servers).toHaveLength(1);
  });

  it("keeps distinct roots on separate servers; releasing one root does not kill the other", async () => {
    hf.files.set("/work/a/report.html", "a");
    hf.files.set("/work/b/other.html", "b");
    const server = new HtmlPreviewServer();

    await server.acquire(
      "pane-1",
      "/work/a",
      "/work/a/report.html",
      "/work/a/report.html",
    );
    await server.acquire(
      "pane-1",
      "/work/b",
      "/work/b/other.html",
      "/work/b/other.html",
    );
    expect(hf.servers).toHaveLength(2);

    // Close the tab previewing /work/a/report.html: only that root dies.
    server.release("pane-1", "/work/a/report.html");
    expect(hf.servers[0].close).toHaveBeenCalledTimes(1);
    expect(hf.servers[0].closeAllConnections).toHaveBeenCalledTimes(1);
    expect(hf.servers[1].close).not.toHaveBeenCalled();

    // The surviving root still serves.
    const res = await serve(1, "GET", "/other.html");
    expect(res.statusCode).toBe(200);
  });

  it("same-directory tabs share a root: closing one keeps the server for the other (spec scenario 8)", async () => {
    hf.files.set("/work/a/report.html", "a");
    hf.files.set("/work/a/other.html", "b");
    const server = new HtmlPreviewServer();

    await server.acquire(
      "pane-1",
      "/work/a",
      "/work/a/report.html",
      "/work/a/report.html",
    );
    await server.acquire(
      "pane-1",
      "/work/a",
      "/work/a/other.html",
      "/work/a/other.html",
    );

    server.release("pane-1", "/work/a/report.html");
    expect(hf.servers[0].close).not.toHaveBeenCalled();

    // Last reference of the root → server closes.
    server.release("pane-1", "/work/a/other.html");
    expect(hf.servers[0].close).toHaveBeenCalledTimes(1);
  });

  it("rejects directory traversal outside the served root (spec scenario 8)", async () => {
    hf.files.set("/work/a/report.html", "a");
    // One level above the root: `/work/a/../secret.txt` resolves here.
    hf.files.set("/work/secret.txt", "token");
    const server = new HtmlPreviewServer();
    await server.acquire(
      "pane-1",
      "/work/a",
      "/work/a/report.html",
      "/work/a/report.html",
    );

    const escape = await serve(0, "GET", "/../secret.txt");
    expect(escape.statusCode).toBe(404);
    expect(escape.end).toHaveBeenCalledWith(); // no body, no token

    // Encoded traversal must not slip past either.
    const encoded = await serve(0, "GET", "/..%2Fsecret.txt");
    expect(encoded.statusCode).toBe(404);
  });

  it("rejects symlink escapes via realpath containment", async () => {
    hf.files.set("/work/a/link.html", "symlink");
    // The entry itself sits inside the root, but realpath resolves outside.
    hf.symlinks.set("/work/a/link.html", "/etc/passwd");
    const server = new HtmlPreviewServer();
    await server.acquire(
      "pane-1",
      "/work/a",
      "/work/a/link.html",
      "/work/a/link.html",
    );

    const res = await serve(0, "GET", "/link.html");
    expect(res.statusCode).toBe(404);
    expect(res.end).toHaveBeenCalledWith();
  });

  it("answers 404 for missing files and 405 for non-GET methods", async () => {
    hf.files.set("/work/a/report.html", "a");
    const server = new HtmlPreviewServer();
    await server.acquire(
      "pane-1",
      "/work/a",
      "/work/a/report.html",
      "/work/a/report.html",
    );

    expect((await serve(0, "GET", "/nope.html")).statusCode).toBe(404);
    expect((await serve(0, "POST", "/report.html")).statusCode).toBe(405);
    expect((await serve(0, "DELETE", "/report.html")).statusCode).toBe(405);
  });

  it("answers 413 past the byte cap", async () => {
    hf.files.set("/work/a/big.html", "x");
    hf.sizes.set("/work/a/big.html", 8 * 1024 * 1024 + 1);
    const server = new HtmlPreviewServer();
    await server.acquire(
      "pane-1",
      "/work/a",
      "/work/a/big.html",
      "/work/a/big.html",
    );

    expect((await serve(0, "GET", "/big.html")).statusCode).toBe(413);
  });

  it("HEAD answers headers without a body", async () => {
    hf.files.set("/work/a/report.html", "abc");
    const server = new HtmlPreviewServer();
    await server.acquire(
      "pane-1",
      "/work/a",
      "/work/a/report.html",
      "/work/a/report.html",
    );

    const res = await serve(0, "HEAD", "/report.html");
    expect(res.statusCode).toBe(200);
    expect(res.setHeader).toHaveBeenCalledWith("Content-Length", 3);
    expect(res.end).toHaveBeenCalledWith(); // no body
  });

  it("URL-encodes segments so spaces and CJK filenames survive", async () => {
    hf.files.set("/work/a/我的 页面.html", "x");
    const server = new HtmlPreviewServer();

    const url = await server.acquire(
      "pane-1",
      "/work/a",
      "/work/a/我的 页面.html",
      "/work/a/我的 页面.html",
    );
    expect(url).toBe(
      `http://127.0.0.1:45000/${encodeURIComponent("我的")}%20${encodeURIComponent("页面")}.html`,
    );
  });

  it("dispose closes every live server", async () => {
    hf.files.set("/work/a/report.html", "a");
    hf.files.set("/work/b/other.html", "b");
    const server = new HtmlPreviewServer();
    await server.acquire(
      "pane-1",
      "/work/a",
      "/work/a/report.html",
      "/work/a/report.html",
    );
    await server.acquire(
      "pane-1",
      "/work/b",
      "/work/b/other.html",
      "/work/b/other.html",
    );

    server.dispose();
    expect(hf.servers[0].close).toHaveBeenCalledTimes(1);
    expect(hf.servers[1].close).toHaveBeenCalledTimes(1);
  });

  it("release for an unknown key is a no-op", async () => {
    const server = new HtmlPreviewServer();
    expect(() => server.release("pane-1", "/nope.html")).not.toThrow();
  });
});
