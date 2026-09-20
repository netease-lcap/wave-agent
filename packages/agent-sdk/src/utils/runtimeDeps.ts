/**
 * Runtime dependencies the CLI installs on demand.
 *
 * ## Why this exists
 *
 * `sharp` (the image codec behind outbound image resizing) is a native module
 * of ~19MB unpacked — too big to ship in every host bundle, and unnecessary for
 * users who never send an image. Two of the three ways of getting the CLI can
 * simply use npm:
 *
 * | how the CLI was installed | where sharp comes from | what this does |
 * | --- | --- | --- |
 * | `npm i -g wave-code`, project install | a plain npm dependency (npm picks the one platform package via its `os`/`cpu`/`libc` fields; libvips arrives through the platform package's own optionalDependencies) | step 1 short-circuits, nothing is downloaded |
 * | desktop / VS Code / JetBrains (the host copies the CLI into `~/.wave/cli/<end>/`) | nothing ships it | downloads into the shared `~/.wave/cli/node_modules` |
 * | in-repo dev (`pnpm run wave`) | the repo's node_modules | step 1 short-circuits |
 *
 * It is deliberately CLI-side rather than per-host: the platform key is computed
 * by the *same* runtime that later loads the module (a JVM-side arch guess
 * cannot be), and one implementation covers the TUI, stdio (all three hosts),
 * remote and daemon paths.
 *
 * ## Layout
 *
 * ```
 * ~/.wave/cli/node_modules/          <- shared by all three hosts, survives CLI upgrades
 *   sharp/  semver/  detect-libc/  @img/colour/
 *   @img/sharp-<key>/                key = linux-x64 | linuxmusl-x64 | darwin-arm64 | win32-x64
 *   @img/sharp-libvips-<key>/        must stay a sibling of the above: its .node has
 *                                    rpath `$ORIGIN/../../sharp-libvips-<key>/lib`
 *   .wave-runtime-deps.json          <- marker, written last: present means this
 *                                       batch completed
 * ```
 *
 * Node resolves the modules from `~/.wave/cli/<end>/dist/bundle/wave.mjs` by
 * walking up, which lands on this `node_modules` — the same mechanism the
 * ripgrep download relies on.
 *
 * ## Why detect-libc decides the platform key
 *
 * `linux-x64` and `linuxmusl-x64` are different downloads, and a wrong guess
 * means a `.node` that refuses to dlopen. The key is therefore computed *by*
 * `detect-libc` (the very module sharp consults, `dist/libvips.cjs`:
 * `` `${process.platform}${isNonGlibcLinuxSync() ? familySync() : ""}-${process.arch}` ``)
 * rather than by a copy of that logic. A future sharp that renames or drops a
 * dependency is followed automatically; only a *renamed* dependency needs a
 * code change here.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { maxSatisfying } from "semver";
import { logWarn, logger } from "./globalLogger.js";
import {
  getImageProcessor,
  resetImageProcessor,
  resolveSharp,
} from "./imageProcessor.js";
import { extractNpmTarball } from "./npmTarball.js";

/** npm registry mirror for China users (same choice as the ripgrep download). */
export const RUNTIME_DEPS_REGISTRY = "https://registry.npmmirror.com";

const MARKER_FILE = ".wave-runtime-deps.json";

export interface RuntimeDepsResult {
  available: boolean;
  reason?: string;
}

/** One npm package to fetch; `range` is resolved against the registry. */
interface PackageRequest {
  name: string;
  range: string;
}

/** Registry metadata for a single version of a package. */
interface VersionMeta {
  version: string;
  /** Where the tarball lives and what its digest is. */
  dist?: { tarball?: string; integrity?: string };
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/**
 * A runtime dependency the CLI knows how to install. The table shape is what
 * keeps this generic: ripgrep is a future row, not a second implementation.
 */
interface RuntimeDependency {
  /** npm package declared in the CLI's package.json. */
  name: string;
  /** Packages needed on every platform (the JS side). */
  sharedPackages(entry: VersionMeta): PackageRequest[];
  /** Packages for the native build of [platformKey]. */
  platformPackages(entry: VersionMeta, platformKey: string): PackageRequest[];
  /** True when this process can already use the dependency. */
  isAvailable(): boolean;
  /** Called after a successful install. */
  onInstalled(): void;
}

const sharpDependency: RuntimeDependency = {
  name: "sharp",
  sharedPackages(entry) {
    const requests: PackageRequest[] = [
      { name: "sharp", range: entry.version },
    ];
    // The plain JS deps come from sharp's own ranges, so a sharp upgrade that
    // adds or drops one is followed without a code change.
    for (const [name, range] of Object.entries(entry.dependencies ?? {})) {
      requests.push({ name, range });
    }
    return requests;
  },
  platformPackages(entry, platformKey) {
    // Platform builds are pinned exactly in sharp's optionalDependencies —
    // including the libvips version, which no other field carries.
    const optional = entry.optionalDependencies ?? {};
    return ["@img/sharp", "@img/sharp-libvips"].map((prefix) => {
      const name = `${prefix}-${platformKey}`;
      const range = optional[name];
      if (!range) {
        throw new Error(`sharp 不支持当前平台（${platformKey}）：缺 ${name}`);
      }
      return { name, range };
    });
  },
  isAvailable: () => getImageProcessor() !== undefined,
  onInstalled: () => resetImageProcessor(),
};

const RUNTIME_DEPENDENCIES: RuntimeDependency[] = [sharpDependency];

/** `<home>/.wave/cli` — where hosts copy the CLI into and share downloads. */
function defaultCliHome(): string {
  return path.join(os.homedir(), ".wave", "cli");
}

/**
 * Whether this code runs from a CLI copy under the shared cli home.
 *
 * An npm-installed CLI (bundle under `<prefix>/lib/node_modules/wave-code/...`)
 * must not self-install: Node would never look in `~/.wave/cli/node_modules`
 * from there, and writing into a global npm prefix may lack permissions and
 * gets pruned by the next `npm install`. Such a setup either already has sharp
 * (the normal case) or degrades with an actionable warning.
 */
export function isManagedCliInstall(
  moduleUrl: string,
  cliHome = defaultCliHome(),
): boolean {
  let file: string;
  try {
    file = fileURLToPath(moduleUrl);
  } catch {
    return false;
  }
  const relative = path.relative(cliHome, file);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

/** Nearest `package.json` upwards from [from] that declares [dependency]. */
function findEntryPackageJson(
  from: string,
  dependency: string,
): { range: string } | undefined {
  let dir = path.dirname(from);
  for (;;) {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(path.join(dir, "package.json"), "utf-8"),
      ) as { dependencies?: Record<string, string> };
      const range = parsed.dependencies?.[dependency];
      if (range) return { range };
    } catch {
      // Unreadable or absent — keep walking towards the filesystem root.
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

async function downloadBuffer(
  url: string,
  fetchImpl: typeof fetch,
): Promise<Buffer> {
  const res = await fetchImpl(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`下载失败（HTTP ${res.status}）：${url}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** sha512/base64 check against the registry's `dist.integrity`. */
export function verifyIntegrity(buffer: Buffer, integrity: string): void {
  for (const part of integrity.split(/\s+/)) {
    const separator = part.indexOf("-");
    if (separator === -1) continue;
    const algorithm = part.slice(0, separator);
    if (algorithm !== "sha512") continue;
    const actual = createHash("sha512").update(buffer).digest("base64");
    if (actual !== part.slice(separator + 1)) {
      throw new Error("下载内容 sha512 校验失败");
    }
    return;
  }
  throw new Error(`不支持的完整性摘要：${integrity}`);
}

/** Registry metadata for the highest version of [name] matching [range]. */
async function resolveVersion(
  name: string,
  range: string,
  fetchImpl: typeof fetch,
): Promise<VersionMeta> {
  const res = await fetchImpl(`${RUNTIME_DEPS_REGISTRY}/${name}`, {
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`获取 ${name} 元数据失败（HTTP ${res.status}）`);
  }
  const metadata = (await res.json()) as {
    versions?: Record<string, Omit<VersionMeta, "version">>;
  };
  const versions = metadata.versions ?? {};
  const best = maxSatisfying(Object.keys(versions), range);
  if (!best) {
    throw new Error(`没有满足 ${range} 的 ${name} 版本`);
  }
  return { version: best, ...versions[best] };
}

/**
 * Platform key for the native build. `detect-libc` is resolved from
 * `[requireBase]/node_modules` — the cli home when the packages are already on
 * disk, the temp dir mid-install — and falls back to Node's own report when it
 * cannot be loaded.
 */
function runtimePlatformKey(requireBase: string | undefined): string {
  if (requireBase) {
    try {
      const requireFn = createRequire(path.join(requireBase, "index.js"));
      const detect = requireFn("detect-libc") as {
        familySync?: () => string | null;
        isNonGlibcLinuxSync?: () => boolean;
      };
      const family = detect.isNonGlibcLinuxSync?.()
        ? (detect.familySync?.() ?? "")
        : "";
      return `${process.platform}${family}-${process.arch}`;
    } catch {
      // Fall through to the report-based fallback.
    }
  }
  let family = "";
  if (process.platform === "linux") {
    const report = process.report?.getReport() as
      | { header?: { glibcVersionRuntime?: string } }
      | undefined;
    if (!report?.header?.glibcVersionRuntime) family = "musl";
  }
  return `${process.platform}${family}-${process.arch}`;
}

/** Write the tarball's entries under [dest], creating parent directories. */
function writeEntries(
  dest: string,
  entries: ReturnType<typeof extractNpmTarball>,
): void {
  for (const entry of entries) {
    const target = path.join(dest, entry.path);
    fs.mkdirSync(entry.kind === "directory" ? target : path.dirname(target), {
      recursive: true,
    });
    if (entry.kind === "file") fs.writeFileSync(target, entry.data);
  }
}

/** Fetch one package and unpack it into `modulesDir/<name>`. */
async function fetchPackage(
  request: PackageRequest,
  modulesDir: string,
  fetchImpl: typeof fetch,
  known?: VersionMeta,
): Promise<void> {
  const meta =
    known ?? (await resolveVersion(request.name, request.range, fetchImpl));
  const tarball = meta.dist?.tarball;
  if (!tarball) {
    throw new Error(`${request.name}@${meta.version} 缺少下载地址`);
  }
  const buffer = await downloadBuffer(tarball, fetchImpl);
  if (meta.dist?.integrity) verifyIntegrity(buffer, meta.dist.integrity);
  writeEntries(path.join(modulesDir, request.name), extractNpmTarball(buffer));
}

/**
 * Install one dependency: download into a temp `node_modules` beside the real
 * one, then move each package into place. A crash mid-way leaves the marker
 * absent, so the next launch redoes the batch — packages already moved are
 * skipped.
 *
 * Returns the platform key the batch was built for.
 */
async function installDependency(
  dependency: RuntimeDependency,
  entry: VersionMeta,
  cliHome: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const installDir = path.join(cliHome, "node_modules");
  fs.mkdirSync(installDir, { recursive: true });
  const tempDir = path.join(
    cliHome,
    `.wave-runtime-tmp-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  const tempModules = path.join(tempDir, "node_modules");
  fs.mkdirSync(tempModules, { recursive: true });
  try {
    const shared = dependency.sharedPackages(entry);
    // detect-libc has to land first: it decides which native build to fetch.
    for (const request of shared) {
      await fetchPackage(
        request,
        tempModules,
        fetchImpl,
        // The entry package's metadata is already in hand — no second round trip.
        request.name === dependency.name ? entry : undefined,
      );
    }
    const platformKey = runtimePlatformKey(tempDir);
    const platform = dependency.platformPackages(entry, platformKey);
    for (const request of platform) {
      await fetchPackage(request, tempModules, fetchImpl);
    }
    for (const { name } of [...shared, ...platform]) {
      const target = path.join(installDir, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      // Already there: either a previous run or a process racing us.
      if (fs.existsSync(target)) continue;
      try {
        fs.renameSync(path.join(tempModules, name), target);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        const raced =
          code === "EEXIST" || code === "ENOTEMPTY" || code === "EPERM";
        if (!raced) throw error;
      }
    }
    return platformKey;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function readMarker(installDir: string): Record<string, string> {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(installDir, MARKER_FILE), "utf-8"),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

let inFlight: Promise<RuntimeDepsResult> | undefined;
let settled: RuntimeDepsResult | undefined;

/**
 * Make sure the runtime dependencies are installed. Never throws: the long-lived
 * CLI entry points await it before serving, so a first pasted image cannot race
 * a download — the same reason the hosts block on ripgrep before spawning the
 * CLI. A failed install is reported once and only degrades images.
 *
 * The outcome is memoised for the process lifetime, failures included — one
 * attempt per launch, so a broken network does not retry on every image.
 */
export function ensureRuntimeDeps(options?: {
  moduleUrl?: string;
  fetchImpl?: typeof fetch;
  cliHome?: string;
}): Promise<RuntimeDepsResult> {
  if (settled) return Promise.resolve(settled);
  if (!inFlight) {
    inFlight = runInstall(options).then(
      (result) => {
        settled = result;
        return result;
      },
      (error: unknown) => {
        settled = {
          available: false,
          reason: error instanceof Error ? error.message : String(error),
        };
        return settled;
      },
    );
  }
  return inFlight;
}

async function runInstall(options?: {
  moduleUrl?: string;
  fetchImpl?: typeof fetch;
  cliHome?: string;
}): Promise<RuntimeDepsResult> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const moduleUrl = options?.moduleUrl ?? import.meta.url;
  const cliHome = options?.cliHome ?? defaultCliHome();

  if (RUNTIME_DEPENDENCIES.every((dependency) => dependency.isAvailable())) {
    return { available: true };
  }

  if (!isManagedCliInstall(moduleUrl, cliHome)) {
    const reason =
      "当前 wave CLI 不是 ~/.wave/cli 下的副本，无法自动安装图像依赖；" +
      "请重装 wave-code（不要使用 --omit=optional）";
    logWarn(`[Wave] ${reason}`);
    return { available: false, reason };
  }

  const installDir = path.join(cliHome, "node_modules");
  for (const dependency of RUNTIME_DEPENDENCIES) {
    if (dependency.isAvailable()) continue;
    try {
      const entry = findEntryPackageJson(
        fileURLToPath(moduleUrl),
        dependency.name,
      );
      if (!entry) {
        return fail(`找不到声明 ${dependency.name} 依赖范围的 package.json`);
      }
      // A batch that completed but still will not load is a platform problem
      // (wrong libc, unsupported CPU). Downloading ~19MB again on every launch
      // would not fix it, so report instead.
      if (readMarker(installDir)[dependency.name] === entry.range) {
        return fail(
          `${dependency.name} 已安装但无法加载（平台 ${runtimePlatformKey(
            cliHome,
          )}）`,
        );
      }

      const meta = await resolveVersion(
        dependency.name,
        entry.range,
        fetchImpl,
      );
      const platformKey = await installDependency(
        dependency,
        meta,
        cliHome,
        fetchImpl,
      );

      // Verify through the cli home itself: the only require base that proves
      // the layout works for the bundle that will load it.
      const requireFn = createRequire(path.join(cliHome, "index.js"));
      if (resolveSharp(requireFn) === undefined) {
        fs.rmSync(path.join(installDir, MARKER_FILE), { force: true });
        return fail(
          `${dependency.name} 安装后仍无法加载（平台 ${platformKey}）`,
        );
      }
      dependency.onInstalled();
      fs.writeFileSync(
        path.join(installDir, MARKER_FILE),
        `${JSON.stringify(
          { ...readMarker(installDir), [dependency.name]: entry.range },
          null,
          2,
        )}\n`,
      );
      logger.info(
        `[Wave] 已安装 ${dependency.name} ${meta.version}（平台 ${platformKey}）到 ${installDir}`,
      );
    } catch (error) {
      return fail(
        `安装 ${dependency.name} 失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return { available: true };
}

function fail(reason: string): RuntimeDepsResult {
  logWarn(`[Wave] ${reason}`);
  return { available: false, reason };
}

/** Forget the memoised outcome, and the settled result (tests). */
export function __resetRuntimeDepsForTesting(): void {
  inFlight = undefined;
  settled = undefined;
}
