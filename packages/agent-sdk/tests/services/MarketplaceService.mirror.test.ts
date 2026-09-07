import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from "vitest";
import * as http from "node:http";
import { promises as fs, existsSync } from "node:fs";
import * as path from "node:path";
import { strToU8, zipSync } from "fflate";

import { MarketplaceService } from "../../src/services/MarketplaceService.js";
import { GitService } from "../../src/services/GitService.js";
import {
  fetchOfficialMarketplaceFromMirror,
  parseZipModes,
  resolveOfficialMarketplaceMirrorBaseUrl,
  OFFICIAL_MARKET_MIRROR_BASE_URL_ENV,
} from "../../src/services/officialMarketplaceMirror.js";
import { getPluginsDir } from "../../src/utils/configPaths.js";

vi.mock("../../src/services/GitService.js");

vi.mock("../../src/utils/configPaths.js", () => ({
  getPluginsDir: vi.fn(),
}));

vi.mock("../../src/services/configurationService.js", () => {
  return {
    ConfigurationService: class MockConfigService {
      getMergedMarketplaces = vi.fn(() => ({
        "wave-plugins-official": {
          source: {
            source: "github",
            repo: "netease-lcap/wave-plugins-official",
          },
          autoUpdate: true,
        },
      }));
      getScopedMarketplaces = vi.fn(() => ({}));
      addMarketplaceToScope = vi.fn(() => Promise.resolve());
      removeMarketplaceFromScope = vi.fn(() => Promise.resolve());
      getMergedEnabledPlugins = vi.fn(() => ({}));
    },
  };
});

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const MARKETPLACE_MANIFEST = JSON.stringify({
  name: "wave-plugins-official",
  owner: { name: "wave" },
  plugins: [
    { name: "demo-plugin", source: "./plugins/demo-plugin", description: "" },
  ],
});

const PLUGIN_JSON = JSON.stringify({ name: "demo-plugin", version: "1.0.0" });

/** Builds a zip via fflate (deflate) for the given { path: content } entries. */
function buildZip(entries: Record<string, string>): Buffer {
  const zippable: Record<string, Uint8Array> = {};
  for (const [p, content] of Object.entries(entries)) {
    zippable[p] = strToU8(content);
  }
  return Buffer.from(zipSync(zippable));
}

/** Builds a valid official-marketplace snapshot zip. */
function buildMarketZip(extra?: Record<string, string>): Buffer {
  return buildZip({
    ".wave-plugin/marketplace.json": MARKETPLACE_MANIFEST,
    "plugins/demo-plugin/.wave-plugin/plugin.json": PLUGIN_JSON,
    ...(extra ?? {}),
  });
}

/**
 * Patches the central directory of an fflate-built zip so entries get Unix
 * modes (versionMadeBy host=3, externalAttr = mode << 16) — fflate's zipSync
 * doesn't expose external attrs, so parseZipModes/exec-bit restore can't be
 * exercised without this.
 */
function withUnixModes(zip: Buffer, modes: Record<string, number>): Buffer {
  const buf = Buffer.from(zip);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("no EOCD");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    const mode = modes[name];
    if (mode !== undefined) {
      buf.writeUInt16LE(3 << 8, off + 4); // versionMadeBy: host = Unix(3)
      buf.writeUInt32LE(mode << 16, off + 38); // external attrs: st_mode
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Local HTTP mirror server
// ---------------------------------------------------------------------------

let server: http.Server;
let serverPort = 0;
/** latest pointer body; empty string means "return empty". */
let latestBody = "";
/** HTTP status for /latest (200 default; 404 simulates prod not yet online). */
let latestStatus = 200;
const zipBySha = new Map<string, Buffer>();
/** Request URLs hit on the server since the last clear. */
let requestLog: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    requestLog.push(url);
    if (url === "/latest") {
      res.writeHead(latestStatus, { "content-type": "text/plain" });
      res.end(latestBody);
      return;
    }
    const m = url.match(/^\/(.+)\.zip$/);
    const sha = m ? decodeURIComponent(m[1]) : null;
    if (sha && zipBySha.has(sha)) {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(zipBySha.get(sha));
      return;
    }
    res.writeHead(404);
    res.end("not found");
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no server addr");
  serverPort = addr.port;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

function mirrorBaseUrl(): string {
  return `http://127.0.0.1:${serverPort}`;
}

function clearMirrorState(): void {
  latestBody = "";
  latestStatus = 200;
  zipBySha.clear();
  requestLog = [];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("officialMarketplaceMirror (zip snapshot)", () => {
  const mockPluginsDir = path.join(process.cwd(), "tmp-test-plugins-mirror");
  const marketplacesDir = path.join(mockPluginsDir, "marketplaces");
  const installLocation = path.join(
    marketplacesDir,
    "netease-lcap",
    "wave-plugins-official",
  );
  let service: MarketplaceService;
  let mockGitService: {
    clone: ReturnType<typeof vi.fn>;
    pull: ReturnType<typeof vi.fn>;
    isGitAvailable: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getPluginsDir).mockReturnValue(mockPluginsDir);
    if (existsSync(mockPluginsDir)) {
      await fs.rm(mockPluginsDir, { recursive: true, force: true });
    }
    await fs.mkdir(mockPluginsDir, { recursive: true });
    await fs.writeFile(
      path.join(mockPluginsDir, "known_marketplaces.json"),
      JSON.stringify({ builtinSeeded: true, marketplaces: [] }),
    );

    mockGitService = {
      clone: vi.fn().mockResolvedValue(undefined),
      pull: vi.fn().mockResolvedValue(undefined),
      isGitAvailable: vi.fn().mockResolvedValue(true),
    };
    vi.mocked(GitService).mockImplementation(function () {
      return mockGitService as unknown as GitService;
    });

    service = new MarketplaceService();
    await (service as unknown as { _seedComplete: Promise<void> })
      ._seedComplete;
    (
      MarketplaceService as unknown as { isLockedInProcess: boolean }
    ).isLockedInProcess = false;

    delete process.env[OFFICIAL_MARKET_MIRROR_BASE_URL_ENV];
    clearMirrorState();
  });

  afterEach(async () => {
    delete process.env[OFFICIAL_MARKET_MIRROR_BASE_URL_ENV];
    try {
      if (existsSync(mockPluginsDir)) {
        await fs.rm(mockPluginsDir, { recursive: true, force: true });
      }
    } catch {
      // ignore cleanup races with async constructor ops
    }
    vi.restoreAllMocks();
  });

  describe("resolveOfficialMarketplaceMirrorBaseUrl", () => {
    it("returns the prod default base URL when env is not configured", () => {
      expect(resolveOfficialMarketplaceMirrorBaseUrl()).toBe(
        "https://codechat.codewave.163.com/wave-plugins-official",
      );
    });

    it("prefers the env var over the default constant", () => {
      process.env[OFFICIAL_MARKET_MIRROR_BASE_URL_ENV] =
        "https://example.com/base/";
      expect(resolveOfficialMarketplaceMirrorBaseUrl()).toBe(
        "https://example.com/base",
      );
    });
  });

  describe("fetchOfficialMarketplaceFromMirror", () => {
    it("no-ops when the local sentinel already matches the latest sha", async () => {
      await fs.mkdir(installLocation, { recursive: true });
      await fs.writeFile(
        path.join(installLocation, ".wave-market-sha"),
        "sha-aaaa",
      );
      latestBody = "sha-aaaa";
      zipBySha.set("sha-aaaa", buildMarketZip());

      const result = await fetchOfficialMarketplaceFromMirror(
        installLocation,
        marketplacesDir,
        mirrorBaseUrl(),
      );

      expect(result).toBe("sha-aaaa");
      // Only the tiny /latest probe — the zip must never be downloaded.
      expect(requestLog).toEqual(["/latest"]);
    });

    it("downloads a new sha once and atomically swaps it into place", async () => {
      // First fetch: full download.
      latestBody = "sha-aaaa";
      zipBySha.set("sha-aaaa", buildMarketZip({ "README.md": "v1" }));

      const first = await fetchOfficialMarketplaceFromMirror(
        installLocation,
        marketplacesDir,
        mirrorBaseUrl(),
      );
      expect(first).toBe("sha-aaaa");
      expect(requestLog).toEqual(["/latest", "/sha-aaaa.zip"]);
      expect(
        await fs.readFile(path.join(installLocation, "README.md"), "utf8"),
      ).toBe("v1");
      expect(
        await fs.readFile(
          path.join(installLocation, ".wave-market-sha"),
          "utf8",
        ),
      ).toBe("sha-aaaa");
      expect(
        existsSync(
          path.join(installLocation, ".wave-plugin", "marketplace.json"),
        ),
      ).toBe(true);

      // No stray staging residue after success.
      expect(existsSync(`${installLocation}.staging`)).toBe(false);

      // Second fetch with a changed sha replaces content atomically.
      clearMirrorState();
      latestBody = "sha-bbbb";
      zipBySha.set("sha-bbbb", buildMarketZip({ "README.md": "v2" }));
      const second = await fetchOfficialMarketplaceFromMirror(
        installLocation,
        marketplacesDir,
        mirrorBaseUrl(),
      );
      expect(second).toBe("sha-bbbb");
      expect(requestLog).toEqual(["/latest", "/sha-bbbb.zip"]);
      expect(
        await fs.readFile(path.join(installLocation, "README.md"), "utf8"),
      ).toBe("v2");
      expect(
        await fs.readFile(
          path.join(installLocation, ".wave-market-sha"),
          "utf8",
        ),
      ).toBe("sha-bbbb");
    });

    it("returns null on an empty /latest body (mirror misconfigured)", async () => {
      latestBody = "   \n"; // whitespace-only body trims to empty
      const result = await fetchOfficialMarketplaceFromMirror(
        installLocation,
        marketplacesDir,
        mirrorBaseUrl(),
      );
      expect(result).toBeNull();
      expect(existsSync(installLocation)).toBe(false); // nothing installed
    });

    it("returns null on a 404 from /latest", async () => {
      // No routes configured — server returns 404 for everything.
      const result = await fetchOfficialMarketplaceFromMirror(
        installLocation,
        marketplacesDir,
        mirrorBaseUrl(),
      );
      expect(result).toBeNull();
    });

    it("returns null on a corrupt zip and leaves existing content untouched", async () => {
      await fs.mkdir(installLocation, { recursive: true });
      await fs.writeFile(path.join(installLocation, "keep.txt"), "keep");
      await fs.writeFile(
        path.join(installLocation, ".wave-market-sha"),
        "sha-aaaa",
      );
      latestBody = "sha-corrupt";
      zipBySha.set("sha-corrupt", Buffer.from("this is not a zip archive"));

      const result = await fetchOfficialMarketplaceFromMirror(
        installLocation,
        marketplacesDir,
        mirrorBaseUrl(),
      );
      expect(result).toBeNull();
      expect(
        await fs.readFile(path.join(installLocation, "keep.txt"), "utf8"),
      ).toBe("keep");
      // Sentinel unchanged → sentinel mismatch persists → retry on next run.
      expect(
        await fs.readFile(
          path.join(installLocation, ".wave-market-sha"),
          "utf8",
        ),
      ).toBe("sha-aaaa");
    });

    it("rejects zips with path traversal entries", async () => {
      const evil = buildZip({
        "../escaped.txt": "oops",
        ".wave-plugin/marketplace.json": MARKETPLACE_MANIFEST,
      });
      latestBody = "sha-evil";
      zipBySha.set("sha-evil", evil);

      const result = await fetchOfficialMarketplaceFromMirror(
        installLocation,
        marketplacesDir,
        mirrorBaseUrl(),
      );
      expect(result).toBeNull();
      // Nothing escaped into the plugins dir (or anywhere else).
      expect(existsSync(path.join(mockPluginsDir, "escaped.txt"))).toBe(false);
      expect(existsSync(path.join(marketplacesDir, "escaped.txt"))).toBe(false);
      expect(existsSync(installLocation)).toBe(false);
    });

    it("rejects zips with absolute-path entries", async () => {
      const evil = buildZip({
        "/tmp/wave-escaped.txt": "oops",
        ".wave-plugin/marketplace.json": MARKETPLACE_MANIFEST,
      });
      latestBody = "sha-abs";
      zipBySha.set("sha-abs", evil);
      const result = await fetchOfficialMarketplaceFromMirror(
        installLocation,
        marketplacesDir,
        mirrorBaseUrl(),
      );
      expect(result).toBeNull();
      expect(existsSync("/tmp/wave-escaped.txt")).toBe(false);
    });

    it("restores executable bits from zip external attrs (hooks/scripts)", async () => {
      const zip = withUnixModes(
        buildZip({
          ".wave-plugin/marketplace.json": MARKETPLACE_MANIFEST,
          "plugins/demo-plugin/hooks/run.sh": "#!/bin/sh\necho ok\n",
        }),
        { "plugins/demo-plugin/hooks/run.sh": 0o755 },
      );
      const modes = parseZipModes(zip);
      expect(modes["plugins/demo-plugin/hooks/run.sh"] & 0o111).toBeTruthy();

      latestBody = "sha-exec";
      zipBySha.set("sha-exec", zip);
      const result = await fetchOfficialMarketplaceFromMirror(
        installLocation,
        marketplacesDir,
        mirrorBaseUrl(),
      );
      expect(result).toBe("sha-exec");

      const scriptPath = path.join(
        installLocation,
        "plugins/demo-plugin/hooks/run.sh",
      );
      const stat = await fs.stat(scriptPath);
      expect(stat.mode & 0o111).toBeTruthy();
      // Plain file without exec bits stays non-executable.
      const jsonStat = await fs.stat(
        path.join(installLocation, ".wave-plugin", "marketplace.json"),
      );
      expect(jsonStat.mode & 0o111).toBeFalsy();
    });

    it("refuses an install location outside the marketplaces cache dir", async () => {
      const outside = path.join(mockPluginsDir, "not-marketplaces", "evil");
      latestBody = "sha-aaaa";
      zipBySha.set("sha-aaaa", buildMarketZip());
      const result = await fetchOfficialMarketplaceFromMirror(
        outside,
        marketplacesDir,
        mirrorBaseUrl(),
      );
      expect(result).toBeNull();
      expect(existsSync(outside)).toBe(false);
    });
  });

  describe("MarketplaceService.updateMarketplace mirror routing", () => {
    it("falls back to git when the mirror 404s (prod content not yet online)", async () => {
      process.env[OFFICIAL_MARKET_MIRROR_BASE_URL_ENV] = mirrorBaseUrl();
      await fs.mkdir(path.join(installLocation, ".wave-plugin"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(installLocation, ".wave-plugin", "marketplace.json"),
        MARKETPLACE_MANIFEST,
      );

      // Prod ingress/content is not yet live → /latest returns 404.
      latestStatus = 404;
      await service.updateMarketplace("wave-plugins-official");

      // Mirror tried, failed → git fallback (kill switch defaults to allowed).
      expect(requestLog).toEqual(["/latest"]);
      expect(mockGitService.pull).toHaveBeenCalledWith(installLocation);
      expect(mockGitService.clone).not.toHaveBeenCalled();
    });

    it("falls back to git pull when the mirror zip is corrupt", async () => {
      process.env[OFFICIAL_MARKET_MIRROR_BASE_URL_ENV] = mirrorBaseUrl();
      await fs.mkdir(path.join(installLocation, ".wave-plugin"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(installLocation, ".wave-plugin", "marketplace.json"),
        MARKETPLACE_MANIFEST,
      );
      latestBody = "sha-corrupt";
      zipBySha.set("sha-corrupt", Buffer.from("garbage-not-a-zip"));

      await service.updateMarketplace("wave-plugins-official");

      // Mirror tried, failed → git fallback (kill switch defaults to allowed).
      expect(requestLog).toEqual(["/latest", "/sha-corrupt.zip"]);
      expect(mockGitService.pull).toHaveBeenCalledWith(installLocation);
      expect(mockGitService.clone).not.toHaveBeenCalled();
    });

    it("falls back to git clone when the mirror fails and no local copy exists", async () => {
      process.env[OFFICIAL_MARKET_MIRROR_BASE_URL_ENV] = mirrorBaseUrl();
      latestBody = "sha-corrupt";
      zipBySha.set("sha-corrupt", Buffer.from("garbage-not-a-zip"));

      // No local copy → git clone is attempted (and fails here since the mock
      // clone does not materialize a marketplace) → update reports failure.
      mockGitService.clone.mockResolvedValue(undefined);
      await expect(
        service.updateMarketplace("wave-plugins-official"),
      ).rejects.toThrow("Some marketplaces failed to update");
      expect(mockGitService.clone).toHaveBeenCalledWith(
        "netease-lcap/wave-plugins-official",
        installLocation,
        undefined,
      );
    });

    it("updates the official marketplace entirely via the mirror when it succeeds", async () => {
      process.env[OFFICIAL_MARKET_MIRROR_BASE_URL_ENV] = mirrorBaseUrl();
      latestBody = "sha-aaaa";
      zipBySha.set("sha-aaaa", buildMarketZip());

      await service.updateMarketplace("wave-plugins-official");

      expect(requestLog).toEqual(["/latest", "/sha-aaaa.zip"]);
      // No git interaction at all.
      expect(mockGitService.pull).not.toHaveBeenCalled();
      expect(mockGitService.clone).not.toHaveBeenCalled();
      // Marketplace usable by the existing plugin installation flow.
      const manifest = await service.loadMarketplaceManifest(installLocation);
      expect(manifest.name).toBe("wave-plugins-official");
      expect(manifest.plugins).toHaveLength(1);
      const sentinel = await fs.readFile(
        path.join(installLocation, ".wave-market-sha"),
        "utf8",
      );
      expect(sentinel).toBe("sha-aaaa");
    });

    it("skips the official marketplace when the mirror fails and git is unavailable", async () => {
      process.env[OFFICIAL_MARKET_MIRROR_BASE_URL_ENV] = mirrorBaseUrl();
      mockGitService.isGitAvailable.mockResolvedValue(false);
      await service.updateMarketplace("wave-plugins-official");
      // Mirror probed (local server /latest 404s), then git skip applies.
      expect(requestLog).toEqual(["/latest"]);
      expect(mockGitService.pull).not.toHaveBeenCalled();
      expect(mockGitService.clone).not.toHaveBeenCalled();
    });
  });
});
