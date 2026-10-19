#!/usr/bin/env node
/**
 * 桌面端安装包 / 文档包 / 远控 Web 页 → CodeChat 运营平台的产物上传脚本。
 *
 * 三条产物线，一个脚本（`--type` 选）：
 *   - 桌面端（`--type desktop`，默认）：`/api/ops/downloads/chunked/*` 的**分片直传**。
 *     为什么用脚本而不是浏览器：生产 codechat-ops 是多副本，分片会话存在服务端进程内存 +
 *     本 pod 的 os.tmpdir()，靠 ingress 的 cookie 亲和（`codechat-ops-route`）固定落到同一
 *     pod。该 cookie 对**任何**请求都会下发，脚本自己收一次即可；而浏览器走 HTTP/2 复用单条
 *     连接，连接级抖动会一次性打死所有在飞请求（2026-09-20 生产实测 3/3 失败）。node fetch
 *     是 HTTP/1.1、每片独立连接，同一套分片参数下 20 片 + 3 次 complete 全部一次成功。
 *   - 文档包（`--type docs`）：`/api/ops/docs/upload` 的**单次 multipart**（2026-10-19 起）。
 *     文档包只有 1–3MB，服务端一次收包、解包、逐文件传 file-center（`codechat/docs/`），
 *     不写下载项台账、也没有跨请求的会话状态 ⇒ 既不分片，也不需要亲和 cookie。
 *   - 远控 Web 页（`--type remote`）：`/api/ops/remote-page/upload` 的**单次 multipart**
 *     （字段 `zip`），落到 file-center `codechat/remote/`，企业端 `/remote/` 立即可见。
 *     2026-10-19 前它是独立脚本 upload-remote-page.mjs，现并入本脚本统一出口：
 *     同一份环境表、同一份凭证、同一套登录/重试/退出码。
 *
 * 零第三方依赖（Node 20+ 内置 fetch/FormData/Blob/fs；远控页的包清单校验借用系统 unzip，
 * 没有 unzip 时只跳过校验、不阻断上传）。
 *
 * 用法：
 *   node .wave/skills/ops-upload/upload.mjs \
 *     --file /tmp/wave-desktop-1.2.6/CodeWave.IDE-1.2.6-arm64.dmg \
 *     --version 1.2.6 --platform mac-dmg --channel stable --type desktop
 *   node .wave/skills/ops-upload/upload.mjs --file docs-1.3.0.tar.gz --type docs
 *   node .wave/skills/ops-upload/upload.mjs --type remote --env test
 *
 * 退出码：0 = 成功（含 --dry-run）；1 = 失败。
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ENV_BASES, ENV_SITES } from "./envs.mjs";

const ROOT = path.resolve(import.meta.dirname, "../../..");

/** 三环境上传面共用 envs.mjs 那一张表；`--base` 只留作兜底/冒烟（例如指向临时环境）。 */
const DEFAULT_BASE = ENV_BASES.prod;
const DEFAULT_CREDENTIALS = path.join(os.homedir(), ".wave", "neteasecc.json");
/** 远控页默认取 `pack:remote` 的产物 */
const DEFAULT_REMOTE_ZIP = path.join(
  ROOT,
  "packages/webview/remote/dist/remote-page.zip",
);

const TYPES = ["desktop", "docs", "remote", "plugin-market"];
const PLATFORMS = ["mac-dmg", "mac-zip", "win-exe"];
const CHANNELS = ["stable", "beta"];
const REQUIRED_EXT = {
  "mac-dmg": [".dmg"],
  "mac-zip": [".zip"],
  "win-exe": [".exe"],
  docs: [".tar.gz", ".zip"],
  remote: [".zip"],
  "plugin-market": [".zip"],
};

/** multipart 分片字段名（后端 multer `chunkUpload.single('chunk')`） */
const CHUNK_FIELD = "chunk";
/** 分片会话丢失的响应文案，来源 backend-ops/src/routes/downloads.ts */
const SESSION_LOST_TEXT = "上传会话不存在或已过期";

/** 文档包上传端点与 multipart 字段名，来源 backend-ops/src/routes/docs.ts（单次、不分片） */
const DOCS_UPLOAD_PATH = "/api/ops/docs/upload";
const DOCS_ARCHIVE_FIELD = "archive";

/** 远控页上传端点与 multipart 字段名，来源 backend-ops/src/routes/remotePage.ts（单次） */
const REMOTE_UPLOAD_PATH = "/api/ops/remote-page/upload";
const REMOTE_ZIP_FIELD = "zip";

/** 插件市场端点/字段/落地前缀，来源 backend-ops/src/routes/pluginMarket.ts（单次、内容寻址） */
const PLUGIN_MARKET_UPLOAD_PATH = "/api/ops/plugin-market/upload";
const PLUGIN_MARKET_ZIP_FIELD = "zip";
const PLUGIN_MARKET_FILE_PREFIX = "codechat/wave-plugins-official";
/** 收端准入：zip 根必须含这个文件条目 */
const PLUGIN_MARKET_MANIFEST = ".wave-plugin/marketplace.json";
/** 线上版本指针（企业端 ingress 精确 rewrite 到 latest.txt，返回纯文本 sha，no-cache） */
const PLUGIN_MARKET_LATEST_PATH = "/wave-plugins-official/latest";

/** 以下四个常量与前端 frontend-ops/src/views/Downloads.tsx 对齐 */
const MAX_ATTEMPTS = 5;
const RETRY_BASE_MS = 400;
const RETRY_MAX_MS = 4000;
const REQUEST_TIMEOUT_MS = 300_000;
/** 会话丢失后整轮重启（重新 init + 重传全部新分片）的上限 */
const MAX_ROUNDS = 3;

const AFFINITY_COOKIE_NAME = "codechat-ops-route";

// ─── 基础工具 ──────────────────────────────────────────────────────────────

class UploadError extends Error {
  constructor(message, { kind = "unknown", status = null, body = "" } = {}) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.body = body;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)}MB`;

/** 可重试：无响应（网络中断/超时）、5xx、429。业务 4xx 不重试（重试只会重复失败） */
function isRetryable(err) {
  if (!(err instanceof UploadError)) return false;
  if (err.kind === "net") return true;
  return err.status >= 500 || err.status === 429;
}

function isSessionLost(err) {
  return (
    err instanceof UploadError &&
    err.status === 404 &&
    err.body.includes(SESSION_LOST_TEXT)
  );
}

/**
 * 发一次请求并解析 JSON。网络层异常统一转成 kind='net' 的 UploadError——
 * 默认的 fetch 异常只给一句 "fetch failed"，真实原因在 err.cause 里。
 */
async function request(
  url,
  { method = "GET", headers = {}, body, timeout = REQUEST_TIMEOUT_MS } = {},
) {
  let res;
  let text;
  try {
    res = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeout),
    });
    text = await res.text();
  } catch (err) {
    const code = err?.cause?.code ?? err?.name ?? String(err);
    const reason =
      err?.name === "TimeoutError"
        ? `请求超时（>${timeout / 1000}s）`
        : `网络错误（${code}）`;
    throw new UploadError(reason, { kind: "net" });
  }
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* 非 JSON 响应（网关错误页等），保留原文用于报错 */
  }
  if (!res.ok) {
    const msg = json?.error || text.slice(0, 300) || res.statusText;
    throw new UploadError(`HTTP ${res.status}：${msg}`, {
      kind: "http",
      status: res.status,
      body: msg,
    });
  }
  return { status: res.status, json, text };
}

/** 使用同样的重试策略跑一个请求工厂；onRetry 用于打印退避提示 */
async function withRetry(label, send, log) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await send();
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS || !isRetryable(err)) throw err;
      const delay = Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_MAX_MS);
      await sleep(delay / 2 + Math.random() * (delay / 2));
      log(
        `  ${label} 第 ${attempt} 次失败（${err.message}），重试 ${attempt + 1}/${MAX_ATTEMPTS} …`,
      );
    }
  }
}

// ─── 参数 ──────────────────────────────────────────────────────────────────

const USAGE = `用法：node upload.mjs --type <desktop|docs|remote|plugin-market> [选项]

必需：
  --file <路径>          要上传的本地文件（远控页可省略，默认取 pack:remote 产物）

桌面端（--type desktop，默认）：
  --version <X.Y.Z>      版本号（后端按它作 fileKey 与落库版本）
  --platform <平台>      ${PLATFORMS.join(" | ")}
  --channel <通道>       ${CHANNELS.join(" | ")}（默认 stable）

文档包（--type docs）：
  不传 --version / --platform / --channel（文件名须 .tar.gz 或 .zip）
  走 POST /api/ops/docs/upload 的单次 multipart（字段 archive），不进分片链路

远控 Web 页（--type remote）：
  不传 --version / --platform / --channel（文件名须 .zip，根层要有 index.html）
  走 POST /api/ops/remote-page/upload 的单次 multipart（字段 zip）

插件市场（--type plugin-market）：
  不传 --version / --platform / --channel（文件名须 .zip）
  上 wave-plugins-official 整树快照，zip 根须含 ${PLUGIN_MARKET_MANIFEST}
  走 POST /api/ops/plugin-market/upload 的单次 multipart（字段 zip）；落成
  ${PLUGIN_MARKET_FILE_PREFIX}/<sha256>.zip 并覆写 latest.txt

  --confirm-prod         传生产时必须显式加上（防止手滑）

其它：
  --type <desktop|docs|remote|plugin-market>
                         上传类型（默认 desktop）
  --env <环境>           目标环境：${Object.keys(ENV_BASES).join(" / ")}（默认 prod）
  --base <URL>           直接指定平台地址（与 --env 二选一，兜底/冒烟用）
  --credentials <路径>   凭证文件（默认 ~/.wave/neteasecc.json）
  --dry-run              只做验证、绝不写入：
                           桌面端 = init + 第一片，不调 complete；
                           文档包 = 只登录（单次请求，没有「只传一片」的中间态）；
                           远控页 = 预检（包形状 / 本次构建 / 线上版本），不发上传；
                           插件市场 = 预检（manifest / 本地 sha / 线上 latest），不发上传
  --check                同 --dry-run（远控页时代的旧名，保留兼容）
  -h, --help             显示本帮助`;

function parseArgs(argv) {
  const opts = {
    type: "desktop",
    channel: "stable",
    base: DEFAULT_BASE,
    baseGiven: false,
    credentials: DEFAULT_CREDENTIALS,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) die(`参数 ${a} 缺少取值`);
      return v;
    };
    switch (a) {
      case "--file":
        opts.file = next();
        break;
      case "--version":
        opts.version = next();
        break;
      case "--platform":
        opts.platform = next();
        break;
      case "--channel":
        opts.channel = next();
        break;
      case "--type":
        opts.type = next();
        break;
      case "--env":
        opts.env = next();
        break;
      case "--base":
        opts.base = next();
        opts.baseGiven = true;
        break;
      case "--credentials":
        opts.credentials = next();
        break;
      case "--dry-run":
      case "--check": // 远控页独立脚本时代的旧名，等价于 --dry-run
        opts.dryRun = true;
        break;
      case "--confirm-prod":
        opts.confirmProd = true;
        break;
      case "-h":
      case "--help":
        console.log(USAGE);
        process.exit(0);
      default:
        die(`未知参数：${a}\n\n${USAGE}`);
    }
  }
  return opts;
}

function die(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function validate(opts) {
  if (!TYPES.includes(opts.type)) die(`--type 只能是 ${TYPES.join(" / ")}`);
  // 远控页默认取 pack:remote 的产物，不必每次手写 --file
  if (!opts.file && opts.type === "remote") opts.file = DEFAULT_REMOTE_ZIP;
  if (!opts.file) die(`缺少 --file\n\n${USAGE}`);
  if (opts.env !== undefined) {
    if (!Object.hasOwn(ENV_BASES, opts.env)) {
      die(`--env 只能是 ${Object.keys(ENV_BASES).join(" / ")}`);
    }
    if (opts.baseGiven) die("--env 与 --base 只能二选一");
    opts.base = ENV_BASES[opts.env];
  }
  if (!fs.existsSync(opts.file)) {
    die(
      opts.type === "remote" && opts.file === DEFAULT_REMOTE_ZIP
        ? `远控页产物不存在：${opts.file}（先 pnpm -F wave-webview run pack:remote）`
        : `文件不存在：${opts.file}`,
    );
  }
  const stat = fs.statSync(opts.file);
  if (!stat.isFile()) die(`不是普通文件：${opts.file}`);
  if (stat.size <= 0) die(`文件大小为 0：${opts.file}`);

  const name = path.basename(opts.file).toLowerCase();
  if (opts.type === "desktop") {
    if (!opts.version) die("桌面端必须传 --version");
    if (!PLATFORMS.includes(opts.platform))
      die(`--platform 只能是 ${PLATFORMS.join(" / ")}`);
    if (!CHANNELS.includes(opts.channel))
      die(`--channel 只能是 ${CHANNELS.join(" / ")}`);
  } else if (opts.platform || opts.version) {
    die(`--type ${opts.type} 不接受 --platform / --version`);
  }
  // 托管类产物（远控页 / 插件市场）打错环境不报错、对象静默写进别处，且一传就对用户生效，
  // 多一道闸（桌面端/文档包历史上没有这道，保持原样）
  if (
    ["remote", "plugin-market"].includes(opts.type) &&
    opts.env === "prod" &&
    !opts.confirmProd
  ) {
    die("传生产必须显式加 --confirm-prod（用户明确说「传生产」才加）");
  }
  const required =
    opts.type === "desktop"
      ? REQUIRED_EXT[opts.platform]
      : REQUIRED_EXT[opts.type];
  if (required && !required.some((ext) => name.endsWith(ext))) {
    die(
      `文件扩展名与类型不符：${path.basename(opts.file)} 需要 ${required.join(" 或 ")}`,
    );
  }
  opts.fileSize = stat.size;
  opts.fileName = path.basename(opts.file);
  opts.base = opts.base.replace(/\/+$/, "");
}

// ─── 凭证 / 亲和 cookie ────────────────────────────────────────────────────

/** 读凭证；只回传值，调用方绝不允许打印它们 */
function readCredentials(credentialsPath) {
  let raw;
  try {
    raw = fs.readFileSync(credentialsPath, "utf8");
  } catch (err) {
    die(`读取凭证文件失败：${credentialsPath}（${err.code}）`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    die(`凭证文件不是合法 JSON：${credentialsPath}`);
  }
  if (!parsed.email || !parsed.password)
    die(`凭证文件缺少 email / password 字段：${credentialsPath}`);
  return { email: parsed.email, password: parsed.password };
}

async function login(base, creds) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 200);
    try {
      msg = JSON.parse(text).error || msg;
    } catch {
      /* 保留原文 */
    }
    die(`登录失败（HTTP ${res.status}）：${msg}`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    die("登录成功但响应不是合法 JSON");
  }
  if (!json.token) die("登录响应缺少 token 字段");
  return json.token;
}

/** 从 set-cookie 里摘出亲和 cookie 的完整键值对（值不回显，只用于回传） */
function pickAffinityCookie(headers) {
  const all =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [headers.get("set-cookie")].filter(Boolean);
  for (const raw of all) {
    const [pair] = String(raw).split(";");
    if (pair?.startsWith(`${AFFINITY_COOKIE_NAME}=`)) return pair;
  }
  return null;
}

/**
 * 亲和 cookie 是分片直传的硬前提：不带它会被 LB 打到别的 pod，随机 404「上传会话不存在或已过期」。
 * ingress 对任意请求都回 Set-Cookie（实测未鉴权请求也回），所以随便打一次就能拿到。
 */
async function acquireAffinityCookie(base) {
  const res = await fetch(`${base}/api/ops/downloads`, {
    method: "GET",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  await res.arrayBuffer().catch(() => {});
  return pickAffinityCookie(res.headers);
}

// ─── 分片直传 ──────────────────────────────────────────────────────────────

function initBody(opts) {
  const body = {
    // 2026-10-19 起后端不再读 type（分片链路只服务桌面端，多传会被忽略）；
    // 留着是为了兼容还没升级的旧 pod。
    type: opts.type,
    fileName: opts.fileName,
    fileSize: opts.fileSize,
  };
  if (opts.type === "desktop") {
    body.version = opts.version;
    body.platform = opts.platform;
    // 通道字段存在两代契约，必须同时发：**线上生产跑的是旧代，只读单数 `channel`**，
    // 收到 `channels` 数组会静默忽略并回落默认值 stable（2026-09-21 实测：`channel:"bogus"`
    // → 400「未知的通道」，而 `channels:["bogus"]` → 201 被无视，于是 `--channel beta`
    // 把包传进了正式通道）。新代后端读 `channels ?? channel`，两个都给即可同时兼容。
    body.channel = opts.channel;
    body.channels = [opts.channel];
  }
  return body;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  validate(opts);

  const credsPathShown = opts.credentials.replace(os.homedir(), "~");
  console.log(
    `平台地址   ${opts.base}${opts.env ? `（--env ${opts.env}）` : ""}`,
  );
  console.log(
    `上传类型   ${opts.type}${opts.type === "desktop" ? ` / ${opts.platform} / ${opts.channel}` : ""}`,
  );
  console.log(`文件       ${opts.file}（${mb(opts.fileSize)}）`);
  if (opts.type === "desktop") console.log(`版本号     ${opts.version}`);
  console.log(`凭证       ${credsPathShown}`);
  console.log(`模式       ${describeMode(opts)}`);
  console.log();

  const creds = readCredentials(opts.credentials);
  if (opts.type === "docs") return await uploadDocs(opts, creds);
  if (opts.type === "remote") return await uploadRemotePage(opts, creds);
  if (opts.type === "plugin-market")
    return await uploadPluginMarket(opts, creds);
  return await uploadDesktop(opts, creds);
}

/** `模式` 那行的文案：--dry-run 对四种产物的「不写」含义各不相同 */
function describeMode(opts) {
  if (!opts.dryRun) return "正式上传";
  if (opts.type === "docs")
    return "DRY-RUN（只登录，不发上传：文档包是单次请求）";
  if (opts.type === "remote") {
    return "DRY-RUN（预检：包形状 / 登录 / 上传前线上版本，不发上传）";
  }
  if (opts.type === "plugin-market") {
    return "DRY-RUN（预检：manifest / 本地 sha / 线上 latest，不发上传）";
  }
  return "DRY-RUN（只传第一片，绝不调 complete）";
}

// ─── 文档包（单次 multipart） ──────────────────────────────────────────────

/**
 * 文档包上传：一个请求把整包交给 `/api/ops/docs/upload`，服务端解包后逐文件传 file-center。
 *
 * 与桌面端的两处关键差别：
 *   - **不分片、不带亲和 cookie**：服务端没有跨请求的会话状态，请求落到哪个 pod 都一样。
 *   - **不写下载项台账**：文档站永远只有「最新版」一个状态，传完**没有可回读的记录**
 *     （`GET /api/ops/downloads` 里不再有 docs 行）——判据只有 201 与响应里的
 *     `fileCount` / `fileKeys`，以及企业端 `/docs/` 上的对象。
 *
 * 失败可以直接重跑：服务端中途失败会回滚本次已传对象，整包重传本身是幂等覆盖。
 */
async function uploadDocs(opts, creds) {
  const token = await login(opts.base, creds);
  console.log("登录成功（token 不显示）");
  console.log(
    `端点       POST ${DOCS_UPLOAD_PATH}（单次 multipart，字段 ${DOCS_ARCHIVE_FIELD}）`,
  );

  if (opts.dryRun) {
    console.log(
      `\nDRY-RUN：文档包是单次 multipart 上传，请求发出即写对象（没有「只传一片」的中间态）⇒ 不发起上传。`,
    );
    console.log(
      `准备好的请求：${opts.fileName}（${mb(opts.fileSize)}）→ ${DOCS_UPLOAD_PATH}`,
    );
    return 0;
  }

  const buffer = await fs.promises.readFile(opts.file);
  const startedAt = Date.now();
  try {
    // 单次请求也复用同一套重试：无响应 / 5xx / 429 可重试，业务 4xx 直接失败。
    const { status, json } = await withRetry(
      "上传",
      () => {
        // 每次尝试重建请求体：FormData/Blob 不复用（与分片链路同一处理）
        const form = new FormData();
        form.append(DOCS_ARCHIVE_FIELD, new Blob([buffer]), opts.fileName);
        return request(`${opts.base}${DOCS_UPLOAD_PATH}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
      },
      console.log,
    );
    console.log(
      `上传 ${status}（${((Date.now() - startedAt) / 1000).toFixed(2)}s）`,
    );
    const fileCount = json?.fileCount ?? json?.fileKeys?.length ?? "?";
    console.log(
      `文件数     ${fileCount}；prefix ${json?.prefix ?? "(未返回)"}；入口 ${json?.entryFileKey ?? "(未返回)"}`,
    );
    console.log("\n完成。响应：");
    console.log(JSON.stringify(json, null, 2));
    console.log(
      `\n文档站不入下载项台账 ⇒ 没有可回读的记录；核验看企业端 /docs/ 上的对象（见技能「二、文档站包」）。`,
    );
    return 0;
  } catch (err) {
    console.error(
      `\n✗ 文档包上传失败：${err instanceof UploadError ? err.message : err?.stack || err}`,
    );
    console.error(
      `  HTTP 状态：${err instanceof UploadError && err.status !== null ? err.status : "无响应（网络层失败）"}`,
    );
    if (err instanceof UploadError && err.status === 404) {
      console.error(
        `  提示：404 通常意味着该环境后端还没部署 /api/ops/docs/upload（2026-10-19 新增的端点），不是脚本或压缩包的问题。`,
      );
    }
    console.error(
      `  提示：服务端中途失败会回滚本次已传对象；重跑同一条命令即可（整包重传是幂等覆盖）。`,
    );
    return 1;
  }
}

// ─── 远控 Web 页（单次 multipart） ──────────────────────────────────────────

/** 包清单：收端要求根层有 `index.html`。拿不到 unzip 时返回 null（只跳过校验，不阻断）。 */
function zipNames(file) {
  try {
    return execFileSync("unzip", ["-Z1", file], { encoding: "utf8" })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

/** 读入口页里构建期注入的 `wave-remote-config`（`version` + 构建 `sha`），读不到返回 null */
function readRemoteConfig(html) {
  const meta = html.match(/name="wave-remote-config" content='([^']*)'/);
  if (!meta) return null;
  try {
    return JSON.parse(meta[1]);
  } catch {
    return null;
  }
}

/** 本地包这次的构建版本与 sha —— 报告里「传的是哪份构建」的硬证据 */
function readLocalBuildInfo(file) {
  try {
    const html = execFileSync("unzip", ["-p", file, "index.html"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    return readRemoteConfig(html);
  } catch {
    return null;
  }
}

/** 线上此刻是哪份构建（回滚账）：入口 `no-cache`，读它自带的 version 即可 */
async function probeRemoteLive(envName) {
  const site = ENV_SITES[envName];
  try {
    const res = await fetch(`${site}/remote/`, { cache: "no-store" });
    let live = "";
    if (res.status === 200) {
      const info = readRemoteConfig(await res.text());
      live = info?.version || "";
    }
    console.log(
      `线上构建   ${site}/remote/ -> ${res.status}，线上版本 ${live || "(读不到)"}`,
    );
  } catch (e) {
    console.log(`线上构建   探测失败：${e.message}（不阻断上传）`);
  }
}

/**
 * 远控页上传：一个请求把 zip 交给 `/api/ops/remote-page/upload`（multipart 字段 `zip`），
 * 服务端解包后逐文件传 file-center `codechat/remote/`（入口 `index.html` 最后写）。
 *
 * 与另外两条的差别（全部保留自 upload-remote-page.mjs，2026-10-19 并入本脚本）：
 *   - **页面不发版**：传完企业端 `/remote/` 立即可见，后端不转发、不重建镜像；
 *     但「页面已更新」≠「机器侧已更新」——服务端方法白名单在服务那个会话的进程里。
 *   - **没有删除/回滚接口**：回滚只能另打一份覆盖同名文件；旧 hash 名永不清理。
 *   - **`--env prod` 必须 `--confirm-prod`**：打错环境不报错，对象会静默写进别处。
 *   - **成功判据 = 201 + fileKeys 数量 = 产物文件数**（不再有 version.txt 指针）。
 */
async function uploadRemotePage(opts, creds) {
  // ── 预检 1：包形状（纯本地） ──
  const names = zipNames(opts.file);
  const ageSec = Math.round(
    (Date.now() - fs.statSync(opts.file).mtimeMs) / 1000,
  );
  if (names) {
    if (!names.includes("index.html"))
      die("zip 根层没有 index.html（收端会拒）");
    console.log(`包形状     ${names.length} 个文件，根层 index.html 存在`);
  } else {
    console.log(
      "包形状     未装 unzip，跳过清单校验（收端仍要求根层 index.html）",
    );
  }
  console.log(`打包时刻   ${ageSec}s 前`);
  if (ageSec > 3600) {
    console.log(
      `⚠️ 这个包一小时以上没重新打过 —— dist 里常躺着旧构建，确认不是陈旧产物`,
    );
  }

  // ── 预检 2：本次构建的 version / sha（构建期注入入口页） ──
  const mine = readLocalBuildInfo(opts.file);
  if (mine) {
    console.log(
      `本次构建   version ${mine.version || "?"} / sha ${mine.sha || "?"}`,
    );
  }

  // ── 预检 3：线上此刻是哪份构建（回滚账） ──
  if (opts.env) await probeRemoteLive(opts.env);
  else console.log("线上构建   （--base 模式跳过访问面探测）");

  // ── 登录 + 亲和 cookie（其余端点单请求无状态，这里沿用远控页一直以来的做法） ──
  const token = await login(opts.base, creds);
  console.log("登录成功（token 不显示）");
  const cookie = await acquireAffinityCookie(opts.base);
  console.log(
    cookie
      ? `亲和 cookie ${AFFINITY_COOKIE_NAME} 已获取（长度 ${cookie.length}，值不显示）`
      : `⚠️ 未取到 ${AFFINITY_COOKIE_NAME} 亲和 cookie（多副本下请求可能被拒）`,
  );

  if (opts.dryRun) {
    console.log("\nDRY-RUN：预检通过，未发起上传。");
    return 0;
  }

  const buffer = await fs.promises.readFile(opts.file);
  const headers = { Authorization: `Bearer ${token}` };
  if (cookie) headers.Cookie = cookie;
  const startedAt = Date.now();
  try {
    const { status, json } = await withRetry(
      "上传",
      () => {
        const form = new FormData();
        form.append(
          REMOTE_ZIP_FIELD,
          new Blob([buffer], { type: "application/zip" }),
          opts.fileName,
        );
        return request(`${opts.base}${REMOTE_UPLOAD_PATH}`, {
          method: "POST",
          headers,
          body: form,
        });
      },
      console.log,
    );
    const keys = json?.fileKeys ?? json?.files ?? json?.keys ?? [];
    console.log(
      `上传 ${status}（${((Date.now() - startedAt) / 1000).toFixed(2)}s）；fileKeys ${keys.length} 个${
        names ? `（包内 ${names.length} 个文件）` : ""
      }`,
    );
    if (names && keys.length > 0 && keys.length !== names.length) {
      console.log("⚠️ fileKeys 数量与包内文件数不一致，别直接当成成功");
    }
    if (keys.length > 0) {
      for (const k of keys) console.log("  " + String(k).split("/").pop());
    } else {
      console.log(`响应体：${JSON.stringify(json).slice(0, 200)}`);
    }
    console.log(
      `\n完成。手机端刷新即取新构建（入口 no-cache）；回滚账看上方「线上构建」。`,
    );
    return 0;
  } catch (err) {
    console.error(
      `\n✗ 远控页上传失败：${err instanceof UploadError ? err.message : err?.stack || err}`,
    );
    console.error(
      `  HTTP 状态：${err instanceof UploadError && err.status !== null ? err.status : "无响应（网络层失败）"}`,
    );
    console.error(
      `  提示：整包重传是幂等覆盖，重跑同一条命令即可；回滚只能另打一份覆盖同名文件（没有删除接口）。`,
    );
    return 1;
  }
}

// ─── wave 官方插件市场（单次 multipart，内容寻址） ─────────────────────────

/** 线上指针：企业端 `/wave-plugins-official/latest` 返回纯文本 sha（no-cache） */
async function probePluginMarketLatest(envName) {
  const site = ENV_SITES[envName];
  try {
    const res = await fetch(`${site}${PLUGIN_MARKET_LATEST_PATH}`, {
      cache: "no-store",
    });
    const text = (await res.text()).trim();
    const ok = res.status === 200 && /^[a-f0-9]{64}$/.test(text);
    console.log(
      `线上指针   ${site}${PLUGIN_MARKET_LATEST_PATH} -> ${res.status}，当前 sha ${
        ok ? text : `(读不到，原文 ${text.slice(0, 40) || "(空)"})`
      }`,
    );
    return ok ? text : null;
  } catch (e) {
    console.log(`线上指针   探测失败：${e.message}（不阻断上传）`);
    return null;
  }
}

/**
 * 插件市场上传：把 wave-plugins-official 的**整树快照 zip** 交给
 * `/api/ops/plugin-market/upload`（multipart 字段 `zip`）。
 *
 * 与另外三条的差别：
 *   - **内容寻址**：服务端按 zip 全文 sha256 落 `codechat/wave-plugins-official/<sha>.zip`，
 *     再覆写 `latest.txt` 指向它 ⇒ 同内容重传幂等，「线上是哪份」只由那条指针决定。
 *   - **收端先校验**：zip 根必须含 `.wave-plugin/marketplace.json`（轻校验，不展开内容）。
 *   - **不写台账、没有删除/回滚接口**：回滚 = 拿旧 zip 重传一次（旧 sha 对象永不清理）。
 *   - **`--env prod` 必须 `--confirm-prod`**：一传就对全体用户生效，且打错环境不报错。
 */
async function uploadPluginMarket(opts, creds) {
  // ── 预检 1：包形状（收端准入条件，纯本地） ──
  const names = zipNames(opts.file);
  if (names) {
    if (!names.includes(PLUGIN_MARKET_MANIFEST))
      die(`zip 根目录缺少 ${PLUGIN_MARKET_MANIFEST}（服务端会拒）`);
    console.log(
      `包形状     ${names.length} 个文件，根层 ${PLUGIN_MARKET_MANIFEST} 存在`,
    );
  } else {
    console.log(
      `包形状     未装 unzip，跳过清单校验（收端仍要求根层 ${PLUGIN_MARKET_MANIFEST}）`,
    );
  }

  // ── 预检 2：本地 sha（服务端的版本标识，也是落地 key） ──
  const buffer = await fs.promises.readFile(opts.file);
  const sha = crypto.createHash("sha256").update(buffer).digest("hex");
  console.log(`本次 sha   ${sha}`);
  console.log(
    `落地       ${PLUGIN_MARKET_FILE_PREFIX}/${sha}.zip + 覆写 latest.txt`,
  );

  // ── 预检 3：线上指针（回滚账；同时能判断「内容有没有变」） ──
  const live = opts.env ? await probePluginMarketLatest(opts.env) : null;
  if (!opts.env) console.log("线上指针   （--base 模式跳过访问面探测）");
  if (live && live === sha) {
    console.log(
      "内容对比   与线上 latest 完全一致（重传只会刷新指针，内容没变）",
    );
  }

  const token = await login(opts.base, creds);
  console.log("登录成功（token 不显示）");

  if (opts.dryRun) {
    console.log("\nDRY-RUN：预检通过，未发起上传。");
    return 0;
  }

  const startedAt = Date.now();
  try {
    const { status, json } = await withRetry(
      "上传",
      () => {
        const form = new FormData();
        form.append(
          PLUGIN_MARKET_ZIP_FIELD,
          new Blob([buffer], { type: "application/zip" }),
          opts.fileName,
        );
        return request(`${opts.base}${PLUGIN_MARKET_UPLOAD_PATH}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
      },
      console.log,
    );
    const serverSha = json?.sha;
    console.log(
      `上传 ${status}（${((Date.now() - startedAt) / 1000).toFixed(2)}s）；服务端 sha ${serverSha ?? "(未返回)"}`,
    );
    if (serverSha && serverSha !== sha) {
      console.error(
        `✗ 服务端算出的 sha 与本地不一致：本地 ${sha}，服务端 ${serverSha} —— 先别当成成功`,
      );
      return 1;
    }
    if (json?.publicUrl) console.log(`publicUrl  ${json.publicUrl}`);
    if (json?.latestUrl) console.log(`latestUrl  ${json.latestUrl}`);

    // 指针生效是「用户能拿到新版」的最后一环：no-cache 下应立刻可见，滞后多为 CDN 边缘
    if (opts.env) {
      const now = await probePluginMarketLatest(opts.env);
      if (now && now !== sha) {
        console.log(
          `⚠️ 线上指针仍是 ${now} —— 多为 CDN 边缘滞后（1–2 分钟后再看），别立刻判定失败`,
        );
      }
    }
    console.log(
      `\n完成。客户端下一轮检查 latest 即取到本次快照；回滚拿旧 zip 重传一次即可。`,
    );
    return 0;
  } catch (err) {
    console.error(
      `\n✗ 插件市场上传失败：${err instanceof UploadError ? err.message : err?.stack || err}`,
    );
    console.error(
      `  HTTP 状态：${err instanceof UploadError && err.status !== null ? err.status : "无响应（网络层失败）"}`,
    );
    if (err instanceof UploadError && err.status === 404) {
      console.error(
        `  提示：404 通常意味着该环境后端还没部署 ${PLUGIN_MARKET_UPLOAD_PATH}，不是压缩包的问题。`,
      );
    }
    console.error(
      `  提示：{sha}.zip 内容寻址、同包重传幂等；重跑同一条命令即可。`,
    );
    return 1;
  }
}

// ─── 桌面端（分片直传） ────────────────────────────────────────────────────

/** 桌面端安装包：init → 逐片 chunk → complete（分片会话靠亲和 cookie 固定到同一 pod）。 */
async function uploadDesktop(opts, creds) {
  const cookie = await acquireAffinityCookie(opts.base);
  if (!cookie)
    die(
      `未取到 ${AFFINITY_COOKIE_NAME} 亲和 cookie —— 无它会被 LB 打到别的 pod，分片随机 404`,
    );
  console.log(
    `亲和 cookie ${AFFINITY_COOKIE_NAME} 已获取（长度 ${cookie.length}，值不显示）`,
  );
  const authHeaders = { Cookie: cookie };

  const token = await login(opts.base, creds);
  authHeaders.Authorization = `Bearer ${token}`;
  console.log("登录成功（token 不显示）");

  const fh = await fs.promises.open(opts.file, "r");
  const state = { chunk: null, totalChunks: null, uploadId: null };
  try {
    const result = await uploadRounds(opts, authHeaders, fh, state);
    console.log(
      opts.dryRun
        ? "\nDRY-RUN 摘要（未调用 complete）："
        : "\n完成。complete 响应：",
    );
    console.log(JSON.stringify(result, null, 2));
    if (result.desktopDownloads?.length) {
      for (const d of result.desktopDownloads)
        console.log(
          `  ${d.version} ${d.channel} ${d.fileName} → ${d.downloadUrl}`,
        );
    }
    // 落库通道必须等于 --channel：旧代后端会**静默忽略**它不认识的通道字段并回落
    // stable，HTTP 却照样 2xx —— 只看状态码会把「传 beta 落到正式通道」当成成功
    // （2026-09-21 实测如此）。这里把它当硬失败，别再静默成功。
    if (
      !opts.dryRun &&
      opts.type === "desktop" &&
      result.desktopDownloads?.length
    ) {
      const landed = [
        ...new Set(result.desktopDownloads.map((d) => d.channel)),
      ];
      if (!landed.includes(opts.channel))
        die(
          `请求落库通道 ${opts.channel}，服务端实际写成 ${landed.join(" / ")}；` +
            `记录已生成，需人工清理（见 initBody 里两代通道字段的注释）`,
        );
    }
    if (opts.dryRun) {
      console.log(
        `\nDRY-RUN：已在第 1 片之后停止，**未调用 complete** ⇒ 未写库、未生成用户可见记录。`,
      );
      console.log(
        `临时会话 uploadId=${state.uploadId} 只存在于服务端内存（TTL 2h 后自动清理分片）。`,
      );
    }
    return 0;
  } catch (err) {
    console.error(
      `\n✗ 上传失败：${err instanceof UploadError ? err.message : err?.stack || err}`,
    );
    if (state.chunk !== null)
      console.error(
        `  失败位置：第 ${state.chunk}/${state.totalChunks} 片（uploadId=${state.uploadId}）`,
      );
    else if (state.uploadId)
      console.error(
        `  失败位置：complete（uploadId=${state.uploadId}，全 ${state.totalChunks} 片已传完）`,
      );
    console.error(
      `  HTTP 状态：${err instanceof UploadError && err.status !== null ? err.status : "无响应（网络层失败）"}`,
    );
    console.error(`  亲和 cookie：已携带（长度 ${cookie.length}）`);
    if (err instanceof UploadError && err.kind === "net") {
      console.error(
        "  提示：网络层失败已按前端同款策略重试过；每片是独立 HTTP/1.1 连接，与浏览器的连接级中断不同。",
      );
    }
    return 1;
  } finally {
    await fh.close();
  }
}

/** 会话丢失（404）时整轮重启：重新 init + 重传全部新分片（与前端 UPLOAD_MAX_ROUNDS 同语义） */
async function uploadRounds(opts, headers, fh, state) {
  for (let round = 1; ; round++) {
    try {
      return await uploadOnce(opts, headers, fh, state);
    } catch (err) {
      if (!isSessionLost(err) || round >= MAX_ROUNDS) throw err;
      console.log(
        `  分片会话丢失（${err.message}），整轮重启 ${round + 1}/${MAX_ROUNDS} …`,
      );
      state.uploadId = null;
      state.chunk = null;
    }
  }
}

async function uploadOnce(opts, headers, fh, state) {
  const init = await withRetry(
    "init",
    async () => {
      const { json } = await request(
        `${opts.base}/api/ops/downloads/chunked/init`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(initBody(opts)),
        },
      );
      return json;
    },
    console.log,
  );

  const { uploadId, chunkSize, totalChunks } = init;
  state.uploadId = uploadId;
  state.totalChunks = totalChunks;
  console.log(
    `init ok：uploadId=${uploadId} chunkSize=${mb(chunkSize)} totalChunks=${totalChunks}`,
  );

  const limit = opts.dryRun ? 1 : totalChunks;
  for (let i = 0; i < limit; i++) {
    state.chunk = i + 1;
    const start = i * chunkSize;
    const size = Math.min(chunkSize, opts.fileSize - start);
    const buffer = Buffer.allocUnsafe(size);
    const { bytesRead } = await fh.read(buffer, 0, size, start);
    const chunk = bytesRead === size ? buffer : buffer.subarray(0, bytesRead);

    const startedAt = Date.now();
    let status = 0;
    try {
      const res = await withRetry(
        `chunk ${i + 1}`,
        async () => {
          // 每次尝试重建请求体：FormData/Blob 不复用（与前端一致）
          const form = new FormData();
          form.append(CHUNK_FIELD, new Blob([chunk]), `chunk-${i}`);
          return request(
            `${opts.base}/api/ops/downloads/chunked/${uploadId}/${i}`,
            { method: "POST", headers, body: form },
          );
        },
        console.log,
      );
      status = res.status;
    } catch (err) {
      if (err instanceof UploadError)
        err.message = `第 ${i + 1}/${totalChunks} 片：${err.message}`;
      throw err;
    }
    console.log(
      `chunk ${String(i + 1).padStart(String(totalChunks).length)}/${totalChunks}  ${status}  ${mb(chunk.length)}  ${((Date.now() - startedAt) / 1000).toFixed(2)}s`,
    );
  }

  if (opts.dryRun)
    return {
      dryRun: true,
      uploadId,
      chunkSize,
      totalChunks,
      uploadedChunks: limit,
    };

  state.chunk = null;
  const { status, json } = await withRetry(
    "complete",
    () =>
      request(`${opts.base}/api/ops/downloads/chunked/${uploadId}/complete`, {
        method: "POST",
        headers,
      }),
    console.log,
  );
  console.log(`complete ${status}`);
  return json;
}

process.exit(await main());
