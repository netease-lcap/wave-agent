/**
 * Runtime dependencies the CLI installs on demand.
 *
 * ## Why this exists
 *
 * Four dependencies live here: `sharp` (the image codec behind outbound image
 * resizing, ~19MB unpacked), `@vscode/ripgrep` (the search binary behind the
 * Grep tool, ~5MB with its platform package), `wave-search-tools` (the ugrep /
 * bfs binaries that shadow `grep` / `find` inside the Bash tool) and
 * `@anthropic-ai/sandbox-runtime` (the Bash sandbox, ~12MB of vendored
 * binaries). All of them are too big to ship in every host bundle and useless
 * to users who never send an image, run a search or enable the sandbox. The
 * first three are installed on every launch; the sandbox row is opt-in per call
 * (`includeSandbox`) so it is only fetched once the user has actually turned the
 * sandbox on. Two of the three ways of getting the CLI can simply use npm:
 *
 * | how the CLI was installed | where the dependencies come from | what this does |
 * | --- | --- | --- |
 * | `npm i -g wave-code`, project install | plain npm dependencies (npm picks the matching platform package; sharp's libvips arrives through the platform package's own optionalDependencies) | step 1 short-circuits, nothing is downloaded |
 * | desktop / VS Code / JetBrains (the host copies the CLI into `~/.wave/cli/<end>/`) | nothing ships them — the copy is three files (entry, package.json, bundle) | downloads into the shared `~/.wave/cli/node_modules` |
 * | in-repo dev (`pnpm run wave`) | the repo's node_modules | step 1 short-circuits |
 *
 * It is deliberately CLI-side rather than per-host: the platform key is computed
 * by the *same* runtime that later loads the module (a JVM-side arch guess
 * cannot be), and one implementation covers the TUI, stdio (all three hosts),
 * remote and daemon paths. ripgrep used to be the counter-example — each of the
 * three hosts downloaded it before spawning the CLI, and the remote path shelled
 * out to `npm install --prefix` — so the table replaced four implementations.
 *
 * ## Layout
 *
 * ```
 * ~/.wave/cli/node_modules/          <- shared by all three hosts, survives CLI upgrades
 *   sharp/  semver/  detect-libc/  @img/colour/
 *   @img/sharp-<key>/                key = linux-x64 | linuxmusl-x64 | darwin-arm64 | win32-x64
 *   @img/sharp-libvips-<key>/        Linux/darwin only. Must stay a sibling of the
 *                                    above: its .node has rpath
 *                                    `$ORIGIN/../../sharp-libvips-<key>/lib`. Windows
 *                                    has no such package — its DLLs are inside
 *                                    `@img/sharp-win32-<arch>`. Neither does wasm.
 *   @vscode/ripgrep/                 the wrapper (ESM, no dependencies of its own)
 *   @vscode/ripgrep-<platform>-<arch>/  holds bin/rg, published with the exec bit
 *   @anthropic-ai/sandbox-runtime/    only when the sandbox was turned on; keyed
 *                                    by version, its vendor/ carries the platform
 *                                    binaries (macOS/Linux/Windows)
 *   <sandbox-runtime deps>           socks5-server, commander, node-forge, zod
 *   .wave-runtime-deps.json          <- marker, written last: present means this
 *                                       batch completed
 * ```
 *
 * Lookups do not rely on that walk-up alone: `utils/cliHome.ts` probes the
 * module's own position first and this `node_modules` second, so an install
 * whose layout hides transitive dependencies (a pnpm global install,
 * `npm --install-strategy=nested`) still finds what was downloaded here.
 *
 * ## Where the version ranges come from
 *
 * Each row carries its own {@link RuntimeDependency.range}; no `package.json` is
 * read at runtime. The manifest lookup this replaced could only ever see the
 * CLI's manifest — a host copies just `bin`, `dist` and `package.json` — so a
 * row added on the SDK side found no range at all, was skipped with a one-line
 * warning, and the feature silently degraded. That is how the Windows grep
 * shadow never installed. `packages/agent-sdk/package.json` remains the
 * authority for what `npm i wave-agent-sdk` pulls in, and a test keeps each
 * row's range equal to it.
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
 *
 * A row can opt out of the libc family (`libcAwarePlatformKey: false`):
 * `@vscode/ripgrep` publishes only `@vscode/ripgrep-linux-x64`, so a musl key
 * would match nothing.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { maxSatisfying } from "semver";
import { cliHomeDir } from "./cliHome.js";
import { logWarn, logger } from "./globalLogger.js";
import {
  getImageProcessor,
  resetImageProcessor,
  resolveSharp,
} from "./imageProcessor.js";
import { extractNpmTarball } from "./npmTarball.js";
import { getRgPath, resetRipgrep, resolveRipgrep } from "./ripgrep.js";
import {
  getSearchTools,
  resetSearchTools,
  resolveSearchTools,
} from "./searchTools.js";
import {
  SANDBOX_RUNTIME_PACKAGE,
  isSandboxRuntimeAvailable,
  isSandboxRuntimeOnDisk,
  resetSandboxRuntime,
} from "./sandboxRuntime.js";
import type { StartupStage } from "../types/stdioProtocol.js";

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
 * keeps this generic: a second row is a row, not a second implementation.
 */
interface RuntimeDependency {
  /** npm package this row installs. */
  name: string;
  /**
   * Version range to resolve against the registry.
   *
   * Kept here rather than read from a `package.json` at runtime: a host copies
   * only the CLI's `bin`/`dist`/`package.json`, and the row lives in the SDK —
   * so a manifest lookup found either nothing (the CLI copy) or the wrong
   * owner's declaration, and the row was skipped with a warning. The SDK's own
   * `dependencies` remains the authoritative range; a test keeps the two equal.
   */
  range: string;
  /** Packages needed on every platform (the JS side). */
  sharedPackages(entry: VersionMeta): PackageRequest[];
  /** Packages for the native build of [platformKey]. */
  platformPackages(entry: VersionMeta, platformKey: string): PackageRequest[];
  /**
   * Whether [platformKey] carries the libc family (`linuxmusl-x64`). Defaults to
   * true; false for packages that publish a single Linux build.
   */
  libcAwarePlatformKey?: boolean;
  /** True when this process can already use the dependency. */
  isAvailable(): boolean;
  /**
   * True when [requireBase]'s `node_modules` can load the dependency — the only
   * require base that proves the layout works for the bundle that will use it.
   */
  loadsFrom(requireBase: string): boolean;
  /** Called after a successful install. */
  onInstalled(): void;
}

const sharpDependency: RuntimeDependency = {
  name: "sharp",
  range: "^0.35.4",
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
    const native = `@img/sharp-${platformKey}`;
    const nativeRange = optional[native];
    if (!nativeRange) {
      throw new Error(`sharp 不支持当前平台（${platformKey}）：缺 ${native}`);
    }
    const requests: PackageRequest[] = [{ name: native, range: nativeRange }];
    // libvips is a *separate* package only where the platform links it
    // dynamically: Linux/darwin publish `@img/sharp-libvips-<key>` and the
    // .node's rpath is `$ORIGIN/../../sharp-libvips-<key>/lib`. Windows bundles
    // the DLLs inside `@img/sharp-win32-<arch>` (`libvips-42.dll` sits next to
    // the .node) and sharp publishes no `@img/sharp-libvips-win32-*` at all.
    // Demanding both halves unconditionally made every Windows install fail
    // with "缺 @img/sharp-libvips-win32-x64"; the same holds for the wasm
    // builds. So follow what sharp actually declares instead of the pairing.
    const libvips = `@img/sharp-libvips-${platformKey}`;
    const libvipsRange = optional[libvips];
    if (libvipsRange) requests.push({ name: libvips, range: libvipsRange });
    return requests;
  },
  isAvailable: () => getImageProcessor() !== undefined,
  loadsFrom: (requireBase) =>
    resolveSharp(requireFnFor(requireBase)) !== undefined,
  onInstalled: () => resetImageProcessor(),
};

/**
 * ripgrep row. The wrapper declares no dependencies of its own — only the
 * platform packages in `optionalDependencies` — and keys them by
 * `<platform>-<arch>` with no libc family.
 */
const ripgrepDependency: RuntimeDependency = {
  name: "@vscode/ripgrep",
  range: "^1.18.0",
  sharedPackages(entry) {
    return [{ name: "@vscode/ripgrep", range: entry.version }];
  },
  platformPackages(entry, platformKey) {
    const name = `@vscode/ripgrep-${platformKey}`;
    const range = entry.optionalDependencies?.[name];
    if (!range) {
      throw new Error(`ripgrep 不支持当前平台（${platformKey}）：缺 ${name}`);
    }
    return [{ name, range }];
  },
  libcAwarePlatformKey: false,
  isAvailable: () => getRgPath() !== undefined,
  loadsFrom: (requireBase) =>
    resolveRipgrep(requireFnFor(requireBase)) !== undefined,
  onInstalled: () => resetRipgrep(),
};

/**
 * 内嵌搜索工具行（`wave-search-tools`）：Bash 工具里 `grep` / `find` 影子背后
 * 的 ugrep 与 bfs（`core/fs-tools.md`「搜索命令的内嵌化」）。
 *
 * 与 ripgrep 行同形：主包无依赖，平台包按 `<platform>-<arch>` 键在
 * `optionalDependencies` 里，Linux 每个架构只发一份（不算 libc 家族）。
 *
 * Windows 也走这一行，但平台包只发 ugrep：msys 自带的 GNU grep 没有
 * `.gitignore` 概念（仓库根一次 `grep -r` 会把 `dist/`、`node_modules/`、并行
 * worktree 全扫进来，实测约 52 秒、文件数多 4 倍），所以 `grep` 影子照样要接；
 * `find` 不接——bfs 没有 Windows 构建，而 msys 的 find 本身就是 GNU find，
 * 正是 `find` 影子要复现的那一套。
 */
const searchToolsDependency: RuntimeDependency = {
  name: "wave-search-tools",
  range: "^0.3.0",
  sharedPackages(entry) {
    return [{ name: "wave-search-tools", range: entry.version }];
  },
  platformPackages(entry, platformKey) {
    const name = `wave-search-tools-${platformKey}`;
    const range = entry.optionalDependencies?.[name];
    if (!range) {
      throw new Error(`搜索工具不支持当前平台（${platformKey}）：缺 ${name}`);
    }
    return [{ name, range }];
  },
  libcAwarePlatformKey: false,
  isAvailable: () => getSearchTools() !== undefined,
  loadsFrom: (requireBase) =>
    resolveSearchTools(requireFnFor(requireBase)) !== undefined,
  onInstalled: () => resetSearchTools(),
};

/**
 * Bash 沙箱运行时行。
 *
 * `@anthropic-ai/sandbox-runtime` 是 12MB 的 vendor 负载（其中 7.3MB 是 Windows
 * 后端，而我们在 Windows 上根本不用它），宿主 bundle 装不下，宿主副本的 CLI
 * 也没有 node_modules。所以它走同一条按需下载路径，但**默认不参与批次**：
 * 只有真的启用沙箱的调用方（`SandboxManager`、会话启动时读到 `sandbox.enabled`
 * 的预取）传 `includeSandbox` 才会装上，没开沙箱的人既不付下载也不拖慢启动。
 *
 * 它没有平台子包（二进制在 vendor/ 里，平台判定在运行时做），所以
 * `platformPackages` 为空、平台键也不算 libc 家族。
 */
const sandboxRuntimeDependency: RuntimeDependency = {
  name: SANDBOX_RUNTIME_PACKAGE,
  range: "^0.0.81",
  sharedPackages(entry) {
    // 四个 JS 依赖来自它自己的 ranges，它加/减一个依赖不需要改这里。
    return [
      { name: SANDBOX_RUNTIME_PACKAGE, range: entry.version },
      ...Object.entries(entry.dependencies ?? {}).map(([name, range]) => ({
        name,
        range,
      })),
    ];
  },
  platformPackages: () => [],
  libcAwarePlatformKey: false,
  isAvailable: () => isSandboxRuntimeAvailable(),
  loadsFrom: (requireBase) => isSandboxRuntimeOnDisk(requireFnFor(requireBase)),
  onInstalled: () => resetSandboxRuntime(),
};

const RUNTIME_DEPENDENCIES: RuntimeDependency[] = [
  sharpDependency,
  ripgrepDependency,
  searchToolsDependency,
];

/**
 * The packages this installer knows how to fetch, with the range each one is
 * resolved at.
 *
 * Exported for the test that keeps every range equal to the one
 * `packages/agent-sdk/package.json` declares — that manifest is what
 * `npm i wave-agent-sdk` installs from, so drifting apart would mean fetching a
 * version the SDK itself does not ship with.
 */
export const RUNTIME_DEPENDENCY_RANGES: Record<string, string> =
  Object.fromEntries(
    RUNTIME_DEPENDENCIES.map((dependency) => [
      dependency.name,
      dependency.range,
    ]),
  );

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
 * A `require` rooted at [requireBase] — the cli home when the packages are
 * already on disk, the temp dir mid-install. Used both to ask `detect-libc`
 * which build to fetch and to verify an install afterwards.
 */
function requireFnFor(requireBase: string): NodeRequire {
  return createRequire(path.join(requireBase, "index.js"));
}

/**
 * Platform key of the native build. With [libcFamily] (the default) the key
 * carries the libc family — `linuxmusl-x64` vs `linux-x64` — decided by
 * `detect-libc`, resolved from `[requireBase]/node_modules` and falling back to
 * Node's own report when it cannot be loaded. Dependencies that publish a single
 * Linux build pass `false`.
 */
function runtimePlatformKey(
  requireBase: string | undefined,
  libcFamily = true,
): string {
  if (!libcFamily) return `${process.platform}-${process.arch}`;
  if (requireBase) {
    try {
      const detect = requireFnFor(requireBase)("detect-libc") as {
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
    if (entry.kind !== "file") continue;
    fs.writeFileSync(target, entry.data);
    // npm publishes executables (the ripgrep binary) as 0755; without the exec
    // bit every spawn fails with EACCES. Only the exec bit is worth restoring —
    // the rest is umask's business. A no-op on Windows, where there is no mode.
    if (entry.mode & 0o111) fs.chmodSync(target, entry.mode & 0o777);
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
    const platformKey = runtimePlatformKey(
      tempDir,
      dependency.libcAwarePlatformKey ?? true,
    );
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

export interface RuntimeDepsOptions {
  fetchImpl?: typeof fetch;
  cliHome?: string;
  /**
   * Include the Bash-sandbox runtime (`@anthropic-ai/sandbox-runtime`) in this
   * batch. Off by default and off for every CLI start-up call: only the caller
   * that is about to sandbox something asks for it, so a user who never enables
   * the sandbox never pays its 12MB.
   */
  includeSandbox?: boolean;
  /**
   * Called once, right before this batch starts downloading, with
   * `"downloadingToolDeps"` — the CLI's startup path relays it to the host so
   * the loading animation can say what the ~25MB is for. Never called when the
   * batch is already satisfied (a warm cache must not claim it is downloading
   * anything, spec `ui/stdio-transport.md` 场景 3). Report-only: the callback's
   * outcome is ignored, and throwing from it must not abort the install.
   */
  onStage?: (stage: StartupStage) => void;
}

const inFlight = new Map<string, Promise<RuntimeDepsResult>>();
const settled = new Map<string, RuntimeDepsResult>();

/**
 * Make sure the runtime dependencies are installed. Never throws: the long-lived
 * CLI entry points await it before serving, so a first pasted image (or a first
 * search) cannot race a download — the same reason the hosts used to block on
 * ripgrep before spawning the CLI. A failed install is reported once and only
 * degrades images, grep and (when it was requested) the Bash sandbox.
 *
 * The outcome is memoised for the process lifetime, failures included — one
 * attempt per launch, so a broken network does not retry on every image. The
 * sandbox batch is memoised separately from the always-on batch: a start-up call
 * that did not want the sandbox must not answer for the later call that does.
 */
export function ensureRuntimeDeps(
  options?: RuntimeDepsOptions,
): Promise<RuntimeDepsResult> {
  const dependencies = options?.includeSandbox
    ? [...RUNTIME_DEPENDENCIES, sandboxRuntimeDependency]
    : RUNTIME_DEPENDENCIES;
  const key = options?.includeSandbox ? "with-sandbox" : "base";
  const done = settled.get(key);
  if (done) return Promise.resolve(done);
  let pending = inFlight.get(key);
  if (!pending) {
    pending = runInstall(options, dependencies).then(
      (result) => {
        settled.set(key, result);
        return result;
      },
      (error: unknown) => {
        const result: RuntimeDepsResult = {
          available: false,
          reason: error instanceof Error ? error.message : String(error),
        };
        settled.set(key, result);
        return result;
      },
    );
    inFlight.set(key, pending);
  }
  return pending;
}

async function runInstall(
  options: RuntimeDepsOptions | undefined,
  dependencies: RuntimeDependency[],
): Promise<RuntimeDepsResult> {
  const fetchImpl = options?.fetchImpl ?? fetch;
  const cliHome = options?.cliHome ?? cliHomeDir();

  if (dependencies.every((dependency) => dependency.isAvailable())) {
    return { available: true };
  }

  const installDir = path.join(cliHome, "node_modules");
  // Past this point something is genuinely missing, so the batch is about to hit
  // the network. Report it before the first await — the host's loading animation
  // is what this caption is for, and it must appear while the download runs, not
  // after (spec ui/stdio-transport.md 场景 4).
  notifyStage(options, "downloadingToolDeps");
  // One dependency failing must not skip the others: they degrade independently
  // (a broken image codec has nothing to do with grep).
  const failures: string[] = [];
  for (const dependency of dependencies) {
    if (dependency.isAvailable()) continue;
    try {
      // A batch that completed but still will not load is a platform problem
      // (wrong libc, unsupported CPU). Downloading ~19MB again on every launch
      // would not fix it, so report instead.
      if (readMarker(installDir)[dependency.name] === dependency.range) {
        fail(
          failures,
          `${dependency.name} 已安装但无法加载（平台 ${runtimePlatformKey(
            cliHome,
            dependency.libcAwarePlatformKey ?? true,
          )}）`,
        );
        continue;
      }

      const meta = await resolveVersion(
        dependency.name,
        dependency.range,
        fetchImpl,
      );
      const platformKey = await installDependency(
        dependency,
        meta,
        cliHome,
        fetchImpl,
      );

      // Verify through the cli home itself: that is the anchor the lookups fall
      // back to (`cliHome.ts`), so a package that resolves here is one the
      // running process will actually see.
      if (!dependency.loadsFrom(cliHome)) {
        fs.rmSync(path.join(installDir, MARKER_FILE), { force: true });
        fail(
          failures,
          `${dependency.name} 安装后仍无法加载（平台 ${platformKey}）`,
        );
        continue;
      }
      dependency.onInstalled();
      fs.writeFileSync(
        path.join(installDir, MARKER_FILE),
        `${JSON.stringify(
          { ...readMarker(installDir), [dependency.name]: dependency.range },
          null,
          2,
        )}\n`,
      );
      logger.info(
        `[Wave] 已安装 ${dependency.name} ${meta.version}（平台 ${platformKey}）到 ${installDir}`,
      );
    } catch (error) {
      fail(
        failures,
        `安装 ${dependency.name} 失败：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  if (failures.length > 0)
    return { available: false, reason: failures.join("；") };
  return { available: true };
}

/** Log and record one dependency's failure, without aborting the batch. */
function fail(failures: string[], reason: string): void {
  logWarn(`[Wave] ${reason}`);
  failures.push(reason);
}

/**
 * Forward a startup stage to the caller's observer. Report-only: a throwing
 * observer (a host whose write failed, say) must not turn a cosmetic caption
 * into a failed install.
 */
function notifyStage(
  options: RuntimeDepsOptions | undefined,
  stage: StartupStage,
): void {
  try {
    options?.onStage?.(stage);
  } catch {
    // Ignored on purpose — see the doc comment.
  }
}

/** Forget the memoised outcome, and the settled results (tests). */
export function __resetRuntimeDepsForTesting(): void {
  inFlight.clear();
  settled.clear();
}
