import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { MockInstance } from "vitest";
import type { SharpFactory } from "../../src/utils/imageProcessor.js";

const probe = vi.hoisted(() => ({
  processor: undefined as SharpFactory | undefined,
  reset: vi.fn(),
}));

/**
 * Only availability is faked: `resolveSharp` stays real, so the installer's
 * "verify through the cli home" step genuinely has to resolve the packages it
 * just unpacked.
 */
vi.mock("../../src/utils/imageProcessor.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/utils/imageProcessor.js")>();
  return {
    ...actual,
    getImageProcessor: () => probe.processor,
    resetImageProcessor: probe.reset,
  };
});

const rgProbe = vi.hoisted(() => ({ path: "/mock/rg" as string | undefined }));

/**
 * Same rule as sharp above: only availability is faked, `resolveRipgrep` stays
 * real, so the verify step really does require the wrapper it just unpacked.
 * Defaults to available, like a checkout that has the platform package.
 */
vi.mock("../../src/utils/ripgrep.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/utils/ripgrep.js")>();
  return { ...actual, getRgPath: () => rgProbe.path };
});

import {
  __resetRuntimeDepsForTesting,
  ensureRuntimeDeps,
  isManagedCliInstall,
  RUNTIME_DEPS_REGISTRY,
  verifyIntegrity,
} from "../../src/utils/runtimeDeps.js";

/**
 * Installer tests. Everything is hermetic: a private cli home under the OS temp
 * dir (never the real `~/.wave`), an injected `fetch` that serves in-memory
 * tarballs, and no network. The cli home is injected rather than derived from
 * `HOME` because `os.homedir()` ignores `HOME` on Windows — stubbing it would
 * aim these writes at the developer's real profile.
 *
 * Each test gets its own cli home: the installer verifies by `require`-ing what
 * it unpacked, and Node caches modules by resolved path — a shared path would
 * let a previous test's packages answer for a broken rebuild.
 */
const TEST_ROOT = path.join(
  os.tmpdir(),
  `wave-runtime-deps-test-${process.pid}`,
);
let cliHome: string;
let installDir: string;
let moduleUrl: string;
let cliHomeCounter = 0;
let warnSpy: MockInstance<typeof console.warn>;

/** Platform key the fake `detect-libc` makes the installer compute. */
function keyFromDetectLibc(musl: boolean): string {
  return `${process.platform}${musl ? "musl" : ""}-${process.arch}`;
}

// --- in-memory npm tarballs -------------------------------------------------

function tarHeader(name: string, size: number, mode = 0o644): Buffer {
  const block = Buffer.alloc(512);
  block.write(name, 0, 100, "utf8");
  block.write(`${mode.toString(8).padStart(7, "0")}\0`, 100, 8, "ascii");
  block.write(`${size.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
  block.write("0", 156, 1, "ascii");
  block.write("ustar\0", 257, 6, "ascii");
  block.write("00", 263, 2, "ascii");
  return block;
}

/** A file's bytes plus the tar permission bits npm would publish. */
interface FileFixture {
  content: string;
  mode: number;
}

/** An npm-style tarball: every entry wrapped in the top-level `package/`. */
function tarballOf(files: Record<string, string | FileFixture>): Buffer {
  const chunks: Buffer[] = [];
  for (const [relative, file] of Object.entries(files)) {
    const content = typeof file === "string" ? file : file.content;
    const mode = typeof file === "string" ? 0o644 : file.mode;
    const data = Buffer.from(content, "utf8");
    chunks.push(
      tarHeader(`package/${relative}`, data.length, mode),
      data,
      Buffer.alloc((512 - (data.length % 512)) % 512),
    );
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}

// --- fake registry ----------------------------------------------------------

interface FakePackage {
  version: string;
  files: Record<string, string | FileFixture>;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  /** Override the advertised digest, to model a corrupted download. */
  integrity?: string;
}

interface RegisteredPackage extends FakePackage {
  integrity: string;
  tarball: Buffer;
  tarballUrl: string;
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

function notFound(): Response {
  return {
    ok: false,
    status: 404,
    json: async () => ({}),
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

function fakeRegistry() {
  const byName = new Map<string, RegisteredPackage[]>();
  const byUrl = new Map<string, RegisteredPackage>();
  const urls: string[] = [];

  /** Register [pkg]; a later call for the same version replaces it. */
  const add = (name: string, pkg: FakePackage): RegisteredPackage => {
    const tarball = tarballOf(pkg.files);
    const entry: RegisteredPackage = {
      ...pkg,
      integrity:
        pkg.integrity ??
        `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
      tarball,
      tarballUrl: `${RUNTIME_DEPS_REGISTRY}/${name}/-/${name.replace("/", "-")}-${pkg.version}.tgz`,
    };
    byName.set(name, [
      ...(byName.get(name) ?? []).filter(
        (existing) => existing.version !== pkg.version,
      ),
      entry,
    ]);
    byUrl.set(entry.tarballUrl, entry);
    return entry;
  };

  const fetchImpl = (async (input: string | URL) => {
    const url = String(input);
    urls.push(url);
    const pkg = byUrl.get(url);
    if (pkg) {
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        arrayBuffer: async () =>
          pkg.tarball.buffer.slice(
            pkg.tarball.byteOffset,
            pkg.tarball.byteOffset + pkg.tarball.byteLength,
          ),
      } as unknown as Response;
    }
    const versions = byName.get(url.slice(RUNTIME_DEPS_REGISTRY.length + 1));
    if (!versions) return notFound();
    return jsonResponse({
      versions: Object.fromEntries(
        versions.map((entry) => [
          entry.version,
          {
            dist: { tarball: entry.tarballUrl, integrity: entry.integrity },
            dependencies: entry.dependencies,
            optionalDependencies: entry.optionalDependencies,
          },
        ]),
      ),
    });
  }) as unknown as typeof fetch;

  return { add, fetchImpl, urls };
}

// --- fixtures ---------------------------------------------------------------

const SHARP_RANGE = "^0.35.4";
const PLATFORM_KEY_MUSL = keyFromDetectLibc(true);
const PLATFORM_KEY_GLIBC = keyFromDetectLibc(false);

/** A registry holding a full, installable sharp closure. */
function registryWithSharp(options?: {
  musl?: boolean;
  omit?: string;
  optionalDependencies?: Record<string, string>;
}) {
  const registry = fakeRegistry();
  const key = keyFromDetectLibc(options?.musl ?? true);
  const omit = options?.omit;
  const put = (name: string, pkg: FakePackage) => {
    if (name !== omit) registry.add(name, pkg);
  };

  put("sharp", {
    version: "0.35.4",
    // The fake sharp requires all three JS deps at load time, exactly like the
    // real one (`@img/colour`, `detect-libc`, `semver`).
    files: {
      "package.json": JSON.stringify({
        name: "sharp",
        version: "0.35.4",
        main: "index.js",
      }),
      // Siblings are loaded by relative path: exactly the flat layout the
      // installer produces, with no node_modules search that could wander off
      // and find some other copy.
      "index.js": [
        'const detectLibc = require("../detect-libc");',
        'const semver = require("../semver");',
        'const colour = require("../@img/colour");',
        "module.exports = function sharp() { return {}; };",
        "module.exports.versions = {",
        '  vips: "8.18.6",',
        "  detectLibc: typeof detectLibc.isNonGlibcLinuxSync,",
        "  semver: typeof semver.satisfies,",
        "  colour: typeof colour,",
        "};",
      ].join("\n"),
    },
    dependencies: {
      "@img/colour": "^1.1.0",
      "detect-libc": "^2.1.2",
      semver: "^7.8.5",
    },
    optionalDependencies: options?.optionalDependencies ?? {
      [`@img/sharp-${key}`]: "0.35.4",
      [`@img/sharp-libvips-${key}`]: "1.3.3",
    },
  });

  put("detect-libc", {
    version: "2.1.2",
    files: {
      "package.json": JSON.stringify({
        name: "detect-libc",
        version: "2.1.2",
        main: "index.js",
      }),
      "index.js": [
        `module.exports = { familySync: () => "musl", isNonGlibcLinuxSync: () => ${options?.musl ?? true} };`,
      ].join("\n"),
    },
  });
  put("semver", {
    version: "7.8.5",
    files: {
      "package.json": JSON.stringify({
        name: "semver",
        version: "7.8.5",
        main: "index.js",
      }),
      "index.js": "module.exports = { satisfies: () => true };",
    },
  });
  put("@img/colour", {
    version: "1.1.0",
    files: {
      "package.json": JSON.stringify({
        name: "@img/colour",
        version: "1.1.0",
        main: "index.js",
      }),
      "index.js": "module.exports = {};",
    },
  });
  // The libvips version (1.3.3) differs from sharp's own (0.35.4) on purpose:
  // it only exists in sharp's optionalDependencies.
  put(`@img/sharp-${key}`, {
    version: "0.35.4",
    files: {
      "package.json": JSON.stringify({
        name: `@img/sharp-${key}`,
        version: "0.35.4",
        main: "index.js",
      }),
      "index.js": "module.exports = {};",
    },
  });
  put(`@img/sharp-libvips-${key}`, {
    version: "1.3.3",
    files: {
      "package.json": JSON.stringify({
        name: `@img/sharp-libvips-${key}`,
        version: "1.3.3",
        main: "index.js",
      }),
      "index.js": "module.exports = {};",
    },
  });
  return registry;
}

const RG_RANGE = "^1.18.0";

/**
 * The ripgrep closure: the wrapper plus this platform's binary package. The
 * wrapper behaves like the real one — it resolves the platform package by name
 * and throws when it is absent — except that it is CommonJS (the real one is
 * ESM; what is under test is the exported path, not the module format).
 */
function addRipgrep(registry: ReturnType<typeof fakeRegistry>): void {
  const platformName = `@vscode/ripgrep-${process.platform}-${process.arch}`;
  registry.add("@vscode/ripgrep", {
    version: "1.18.0",
    files: {
      "package.json": JSON.stringify({
        name: "@vscode/ripgrep",
        version: "1.18.0",
        main: "index.js",
      }),
      "index.js": [
        `const platform = ${JSON.stringify(platformName)};`,
        "module.exports = { rgPath: require.resolve(`${platform}/bin/rg`) };",
      ].join("\n"),
    },
    optionalDependencies: { [platformName]: "1.18.0" },
  });
  registry.add(platformName, {
    version: "1.18.0",
    files: {
      "package.json": JSON.stringify({ name: platformName, version: "1.18.0" }),
      // The real package publishes bin/rg at 0755.
      "bin/rg": { content: "rg-binary", mode: 0o755 },
    },
  });
}

/**
 * `detect-libc` reaches the cli home as a sharp dependency and answers for the
 * machine it was installed on. This copy claims a musl host, which is what makes
 * a libc-aware platform key diverge from the plain `<platform>-<arch>` one.
 */
function seedMuslDetectLibc(): void {
  const dir = path.join(installDir, "detect-libc");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "detect-libc", version: "2.1.2", main: "index.js" }),
  );
  fs.writeFileSync(
    path.join(dir, "index.js"),
    [
      "exports.isNonGlibcLinuxSync = () => true;",
      "exports.familySync = () => 'musl';",
      "",
    ].join("\n"),
  );
}

function writeCliPackageJson(dependencies: Record<string, string>): void {
  const endDir = path.join(cliHome, "desktop");
  fs.mkdirSync(path.join(endDir, "dist", "bundle"), { recursive: true });
  fs.writeFileSync(
    path.join(endDir, "package.json"),
    JSON.stringify({ name: "wave-code", dependencies }),
  );
  moduleUrl = pathToFileURL(
    path.join(endDir, "dist", "bundle", "wave.mjs"),
  ).href;
}

beforeEach(() => {
  // Failures are logged, not printed: assertions read `result.reason`.
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
  cliHome = path.join(TEST_ROOT, `home-${++cliHomeCounter}`);
  installDir = path.join(cliHome, "node_modules");
  writeCliPackageJson({ sharp: SHARP_RANGE });
  __resetRuntimeDepsForTesting();
  probe.processor = undefined;
  probe.reset.mockClear();
  rgProbe.path = "/mock/rg";
});

afterEach(() => {
  warnSpy.mockRestore();
});

afterAll(() => {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
});

describe("ensureRuntimeDeps", () => {
  it("installs the whole sharp closure into the shared cli home", async () => {
    const registry = registryWithSharp();

    const result = await ensureRuntimeDeps({
      moduleUrl: moduleUrl,
      cliHome: cliHome,
      fetchImpl: registry.fetchImpl,
    });

    expect(result).toEqual({ available: true });
    expect(warnSpy).not.toHaveBeenCalled();
    for (const name of [
      "sharp",
      "detect-libc",
      "semver",
      "@img/colour",
      `@img/sharp-${PLATFORM_KEY_MUSL}`,
      `@img/sharp-libvips-${PLATFORM_KEY_MUSL}`,
    ]) {
      expect(fs.existsSync(path.join(installDir, name))).toBe(true);
    }
    // The native packages must stay siblings: the .node file's rpath is
    // `$ORIGIN/../../sharp-libvips-<key>/lib`.
    expect(
      path.dirname(path.join(installDir, `@img/sharp-${PLATFORM_KEY_MUSL}`)),
    ).toBe(
      path.dirname(
        path.join(installDir, `@img/sharp-libvips-${PLATFORM_KEY_MUSL}`),
      ),
    );
    // The marker lands last and records what was installed.
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(installDir, ".wave-runtime-deps.json"),
          "utf8",
        ),
      ),
    ).toEqual({ sharp: SHARP_RANGE });
    // The memoised "unavailable" answer is dropped so later turns see the codec.
    expect(probe.reset).toHaveBeenCalledTimes(1);
    // No temp dir left behind.
    expect(
      fs.readdirSync(cliHome).filter((n) => n.startsWith(".wave-runtime-tmp-")),
    ).toEqual([]);
    expect(registry.urls).toContain(
      `${RUNTIME_DEPS_REGISTRY}/@img/sharp-${PLATFORM_KEY_MUSL}`,
    );
  });

  it("takes the platform key from detect-libc, including the glibc branch", async () => {
    const registry = registryWithSharp({ musl: false });

    const result = await ensureRuntimeDeps({
      moduleUrl: moduleUrl,
      cliHome: cliHome,
      fetchImpl: registry.fetchImpl,
    });

    expect(result).toEqual({ available: true });
    expect(
      fs.existsSync(path.join(installDir, `@img/sharp-${PLATFORM_KEY_GLIBC}`)),
    ).toBe(true);
    expect(registry.urls).toContain(
      `${RUNTIME_DEPS_REGISTRY}/@img/sharp-${PLATFORM_KEY_GLIBC}`,
    );
  });

  it("installs ripgrep under a platform key without a libc family", async () => {
    // A sharp install leaves `detect-libc` in the cli home, and on an Alpine
    // machine it answers "musl" — the resolver climbs from the staging dir up to
    // the cli home, so it reads this copy. @vscode/ripgrep publishes no musl
    // build, so a libc-aware key would 404 there instead of the glibc one.
    seedMuslDetectLibc();
    const registry = fakeRegistry();
    addRipgrep(registry);
    writeCliPackageJson({ "@vscode/ripgrep": RG_RANGE });
    probe.processor = (() => ({})) as unknown as SharpFactory; // sharp already there
    rgProbe.path = undefined;

    const result = await ensureRuntimeDeps({
      moduleUrl: moduleUrl,
      cliHome: cliHome,
      fetchImpl: registry.fetchImpl,
    });

    expect(result).toEqual({ available: true });
    const platformName = `@vscode/ripgrep-${process.platform}-${process.arch}`;
    expect(registry.urls).toContain(`${RUNTIME_DEPS_REGISTRY}/${platformName}`);
    expect(registry.urls.some((url) => url.includes("musl"))).toBe(false);

    // The unpacked binary has to be usable, and "usable" is a different
    // observation per platform. npm publishes `bin/rg` as 0755 and a 0644 rg
    // fails every spawn with EACCES, so the installer restores the exec bit
    // from the tarball header — on POSIX that bit is directly readable, and it
    // is the thing a regression would drop.
    //
    // Windows cannot express it: NTFS has no unix permission bits, `chmod` there
    // is effectively a read-only toggle, and `statSync().mode & 0o111` is 0 for
    // *every* file no matter what the installer did. Asserting the mode there
    // fails a perfectly good install (this is exactly what turned the main-only
    // Windows job red). The platform-agnostic half of the same guarantee is that
    // the payload really landed, at the path the wrapper resolves, with the
    // bytes npm published — an empty or truncated rg breaks grep just as badly
    // as a non-executable one — so assert that instead. Both branches are
    // exercised: the case is never skipped or short-circuited per platform.
    const rg = path.join(installDir, platformName, "bin", "rg");
    if (process.platform === "win32") {
      expect(fs.readFileSync(rg, "utf8")).toBe("rg-binary");
    } else {
      expect(fs.statSync(rg).mode & 0o111).toBe(0o111);
    }
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(installDir, ".wave-runtime-deps.json"),
          "utf8",
        ),
      ),
    ).toEqual({ "@vscode/ripgrep": RG_RANGE });
  });

  it("still installs the other dependency when one of them fails", async () => {
    // A broken image codec download must not cost the user grep as well.
    const registry = registryWithSharp({ omit: "sharp" });
    addRipgrep(registry);
    writeCliPackageJson({ sharp: SHARP_RANGE, "@vscode/ripgrep": RG_RANGE });
    rgProbe.path = undefined;

    const result = await ensureRuntimeDeps({
      moduleUrl: moduleUrl,
      cliHome: cliHome,
      fetchImpl: registry.fetchImpl,
    });

    expect(result.available).toBe(false);
    expect(result.reason).toContain("安装 sharp 失败");
    expect(fs.existsSync(path.join(installDir, "@vscode", "ripgrep"))).toBe(
      true,
    );
  });

  it("does nothing when the codec already loads", async () => {
    const registry = registryWithSharp();
    probe.processor = (() => ({})) as unknown as SharpFactory;

    const result = await ensureRuntimeDeps({
      moduleUrl: moduleUrl,
      cliHome: cliHome,
      fetchImpl: registry.fetchImpl,
    });

    expect(result).toEqual({ available: true });
    expect(registry.urls).toEqual([]);
    expect(fs.existsSync(installDir)).toBe(false);
  });

  it("refuses to install for a CLI that is not under the shared cli home", async () => {
    const registry = registryWithSharp();
    const foreign = pathToFileURL(
      path.join(
        os.tmpdir(),
        "npm-prefix",
        "wave-code",
        "dist",
        "bundle",
        "wave.mjs",
      ),
    ).href;

    const result = await ensureRuntimeDeps({
      moduleUrl: foreign,
      cliHome: cliHome,
      fetchImpl: registry.fetchImpl,
    });

    expect(result.available).toBe(false);
    expect(result.reason).toContain("--omit=optional");
    expect(registry.urls).toEqual([]);
    expect(fs.existsSync(installDir)).toBe(false);
  });

  it("fails without throwing when a download does not match its digest", async () => {
    const registry = registryWithSharp();
    // Advertise a digest the served bytes cannot produce.
    registry.add("semver", {
      version: "7.8.5",
      integrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
      files: { "index.js": "module.exports = {};" },
    });

    const result = await ensureRuntimeDeps({
      moduleUrl: moduleUrl,
      cliHome: cliHome,
      fetchImpl: registry.fetchImpl,
    });

    expect(result.available).toBe(false);
    expect(result.reason).toContain("sha512");
    expect(
      fs.existsSync(path.join(installDir, ".wave-runtime-deps.json")),
    ).toBe(false);
  });

  it("fails without throwing when a package cannot be fetched", async () => {
    const registry = registryWithSharp({ omit: "semver" });

    const result = await ensureRuntimeDeps({
      moduleUrl: moduleUrl,
      cliHome: cliHome,
      fetchImpl: registry.fetchImpl,
    });

    expect(result.available).toBe(false);
    expect(
      fs.existsSync(path.join(installDir, ".wave-runtime-deps.json")),
    ).toBe(false);
  });

  it("treats an installed-but-unusable batch as failed without downloading again", async () => {
    const first = registryWithSharp();
    await ensureRuntimeDeps({
      moduleUrl: moduleUrl,
      cliHome: cliHome,
      fetchImpl: first.fetchImpl,
    });

    // A later launch in a process that still cannot load the codec.
    __resetRuntimeDepsForTesting();
    probe.processor = undefined;
    const second = fakeRegistry();
    const result = await ensureRuntimeDeps({
      moduleUrl: moduleUrl,
      cliHome: cliHome,
      fetchImpl: second.fetchImpl,
    });

    expect(result.available).toBe(false);
    expect(result.reason).toContain("已安装但无法加载");
    expect(second.urls).toEqual([]);
  });

  it("reports a CLI whose package.json declares no sharp range", async () => {
    writeCliPackageJson({});
    const registry = registryWithSharp();

    const result = await ensureRuntimeDeps({
      moduleUrl: moduleUrl,
      cliHome: cliHome,
      fetchImpl: registry.fetchImpl,
    });

    expect(result.available).toBe(false);
    expect(result.reason).toContain("sharp");
    expect(registry.urls).toEqual([]);
  });

  it("reports a platform sharp has no build for", async () => {
    const registry = registryWithSharp({
      optionalDependencies: { "@img/sharp-darwin-arm64": "0.35.4" },
    });

    const result = await ensureRuntimeDeps({
      moduleUrl: moduleUrl,
      cliHome: cliHome,
      fetchImpl: registry.fetchImpl,
    });

    expect(result.available).toBe(false);
    expect(result.reason).toContain("不支持当前平台");
  });

  it("fails verification when a JS dependency is unusable, and clears the marker", async () => {
    // `semver` unpacks to a directory without an entry point, so the real
    // resolveSharp (which loads the unpacked sharp, which requires semver)
    // must reject the batch. "Directory exists" is not success.
    const registry = registryWithSharp();
    registry.add("semver", {
      version: "7.8.5",
      files: {
        "package.json": JSON.stringify({ name: "semver", version: "7.8.5" }),
      },
    });

    const result = await ensureRuntimeDeps({
      moduleUrl: moduleUrl,
      cliHome: cliHome,
      fetchImpl: registry.fetchImpl,
    });

    expect(result.available).toBe(false);
    expect(result.reason).toContain("安装后仍无法加载");
    expect(
      fs.existsSync(path.join(installDir, ".wave-runtime-deps.json")),
    ).toBe(false);
  });

  it("only attempts one install per process", async () => {
    const registry = registryWithSharp();

    const [first, second] = await Promise.all([
      ensureRuntimeDeps({
        moduleUrl: moduleUrl,
        cliHome: cliHome,
        fetchImpl: registry.fetchImpl,
      }),
      ensureRuntimeDeps({
        moduleUrl: moduleUrl,
        cliHome: cliHome,
        fetchImpl: registry.fetchImpl,
      }),
    ]);

    expect(first).toEqual({ available: true });
    expect(second).toEqual(first);
    const sharpPackument = registry.urls.filter(
      (url) => url === `${RUNTIME_DEPS_REGISTRY}/sharp`,
    );
    expect(sharpPackument).toHaveLength(1);
  });
});

describe("isManagedCliInstall", () => {
  it("accepts paths inside the cli home and rejects everything else", () => {
    expect(isManagedCliInstall(moduleUrl, cliHome)).toBe(true);
    expect(
      isManagedCliInstall(
        pathToFileURL(path.join(cliHome, "..", "other", "wave.mjs")).href,
        cliHome,
      ),
    ).toBe(false);
    expect(isManagedCliInstall("not-a-url", cliHome)).toBe(false);
  });
});

describe("verifyIntegrity", () => {
  it("accepts a matching sha512 digest and rejects a mismatch", () => {
    const bytes = Buffer.from("payload");
    const digest = createHash("sha512").update(bytes).digest("base64");
    expect(() => verifyIntegrity(bytes, `sha512-${digest}`)).not.toThrow();
    expect(() =>
      verifyIntegrity(bytes, `sha512-${Buffer.alloc(64).toString("base64")}`),
    ).toThrow(/sha512/);
  });
});
