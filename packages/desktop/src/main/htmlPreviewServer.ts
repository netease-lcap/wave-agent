import http from "node:http";
import path from "node:path";
import { promises as fs } from "node:fs";

/**
 * Local HTML file re-hosting for the desktop preview pane (spec:
 * docs/specs/desktop/desktop-preview.md「本地 HTML 文件预览」).
 *
 * A <webview> guest cannot load `file://` URLs (the will-attach-webview gate
 * is localhost-http-only by design), and srcdoc injection breaks relative
 * references. Instead, the main process serves the file's parent directory
 * over a loopback-only HTTP server, so `report.html` plus its sibling
 * `./style.css` / `./app.js` / `./img/*` all resolve naturally — the same
 * approach Claude Desktop's `loadHtmlPreview` host bridge takes.
 *
 * One server per served root directory (multiple preview tabs with different
 * roots coexist — spec scenario 2), ref-counted per (pane, requested path):
 * when the last consumer of a root releases, that root's server closes; other
 * roots are untouched. Directory-traversal escapes are 404, non-GET is 405,
 * and every server binds 127.0.0.1 only.
 */
interface PreviewEntry {
  url: string;
  root: string;
  /** Ref keys (`${paneId}:${requestPath}`), one per previewing tab. */
  refs: Set<string>;
  server: http.Server;
}

export class HtmlPreviewServer {
  private static readonly MAX_SERVE_BYTES = 8 * 1024 * 1024;

  /** Live servers keyed by served root directory. */
  private entries = new Map<string, PreviewEntry>();

  /**
   * Serve `rootDir` (starting a server for it if none yet) and get the URL for
   * `servePath` (must live inside `rootDir`). `requestPath` is the path the
   * user clicked — the ref-count key so the matching `release` cancels this
   * exact acquire even after a remote fetch re-homed the bytes into a cache.
   */
  async acquire(
    paneId: string,
    rootDir: string,
    servePath: string,
    requestPath: string,
  ): Promise<string> {
    let entry = this.entries.get(rootDir);
    if (!entry) {
      const server = await this.startServer(rootDir);
      const address = server.address();
      if (address === null || typeof address === "string") {
        void server.close();
        throw new Error("预览服务启动失败");
      }
      entry = {
        url: `http://127.0.0.1:${address.port}`,
        root: rootDir,
        refs: new Set(),
        server,
      };
      this.entries.set(rootDir, entry);
    }
    entry.refs.add(`${paneId}:${requestPath}`);
    return this.previewUrl(entry, servePath);
  }

  /**
   * Drop one (pane, path) reference. Only the root whose last reference went
   * away closes its server — other roots keep serving their tabs.
   */
  release(paneId: string, requestPath: string): void {
    const key = `${paneId}:${requestPath}`;
    for (const [root, entry] of this.entries) {
      if (entry.refs.delete(key) && entry.refs.size === 0) {
        this.entries.delete(root);
        void this.closeServer(entry);
      }
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) void this.closeServer(entry);
    this.entries.clear();
  }

  private previewUrl(entry: PreviewEntry, filePath: string): string {
    // URL-encode each segment so spaces / CJK names survive; forward slashes
    // are kept as separators.
    const rel = path
      .relative(entry.root, filePath)
      .split(path.sep)
      .map((seg) => encodeURIComponent(seg))
      .join("/");
    return rel ? `${entry.url}/${rel}` : `${entry.url}/`;
  }

  private startServer(rootDir: string): Promise<http.Server> {
    const server = http.createServer((req, res) => {
      void this.handleRequest(rootDir, req, res);
    });
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      // Port 0 → OS-assigned ephemeral port; bind loopback only.
      server.listen(0, "127.0.0.1", () => resolve(server));
    });
  }

  private async handleRequest(
    rootDir: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.statusCode = 405;
        res.end();
        return;
      }
      const rawPath = (req.url ?? "/").split("?")[0].split("#")[0];
      const decoded = decodeURIComponent(rawPath);
      const resolved = path.resolve(rootDir, `.${decoded}`);
      // Lexical containment is not enough for symlinks — the resolved real
      // path must stay under the served root.
      const [realRoot, realPath] = await Promise.all([
        fs.realpath(rootDir),
        fs
          .realpath(resolved)
          .then((p) => p)
          .catch(() => null),
      ]);
      if (
        realPath === null ||
        (realPath !== realRoot && !realPath.startsWith(realRoot + path.sep))
      ) {
        res.statusCode = 404;
        res.end();
        return;
      }
      const stat = await fs.stat(realPath).catch(() => null);
      if (!stat || !stat.isFile()) {
        res.statusCode = 404;
        res.end();
        return;
      }
      if (stat.size > HtmlPreviewServer.MAX_SERVE_BYTES) {
        res.statusCode = 413;
        res.end();
        return;
      }
      res.setHeader("Content-Type", contentTypeFor(realPath));
      res.setHeader("Content-Length", stat.size);
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      const data = await fs.readFile(realPath);
      res.end(data);
    } catch {
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    }
  }

  private closeServer(entry: PreviewEntry): Promise<void> {
    return new Promise<void>((resolve) => {
      entry.server.close(() => resolve());
      // In-flight keep-alive sockets keep a server "open" — destroy them so
      // the port is actually released once the last consumer is gone.
      entry.server.closeAllConnections?.();
    });
  }
}

const MIME_BY_EXT: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

function contentTypeFor(filePath: string): string {
  return (
    MIME_BY_EXT[path.extname(filePath).toLowerCase()] ??
    "application/octet-stream"
  );
}
