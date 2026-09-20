#!/usr/bin/env node
/**
 * 桌面端安装包 / 文档包 → CodeChat 运营平台「下载管理」分片直传脚本。
 *
 * 为什么用脚本而不是浏览器：生产 codechat-ops 是多副本，分片会话存在服务端进程内存 +
 * 本 pod 的 os.tmpdir()，靠 ingress 的 cookie 亲和（`codechat-ops-route`）固定落到同一 pod。
 * 该 cookie 对**任何**请求都会下发，脚本自己收一次即可；而浏览器走 HTTP/2 复用单条连接，
 * 连接级抖动会一次性打死所有在飞请求（2026-09-20 生产实测 3/3 失败）。node fetch 是
 * HTTP/1.1、每片独立连接，同一套分片参数下 20 片 + 3 次 complete 全部一次成功。
 *
 * 零第三方依赖（Node 20+ 内置 fetch/FormData/Blob/fs）。
 *
 * 用法：
 *   node .wave/skills/desktop-upload/upload.mjs \
 *     --file /tmp/wave-desktop-1.2.6/CodeWave.IDE-1.2.6-arm64.dmg \
 *     --version 1.2.6 --platform mac-dmg --channel stable --type desktop
 *
 * 退出码：0 = 成功（含 --dry-run）；1 = 失败。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** 默认生产环境。测试环境仅在用户当次明确点名时用 --base 覆盖（打错不报错、会静默写错环境） */
const DEFAULT_BASE = "https://neteasecc.codewave.163.com";
const DEFAULT_CREDENTIALS = path.join(os.homedir(), ".wave", "neteasecc.json");

const TYPES = ["desktop", "docs"];
const PLATFORMS = ["mac-dmg", "mac-zip", "win-exe"];
const CHANNELS = ["stable", "beta"];
const REQUIRED_EXT = {
  "mac-dmg": [".dmg"],
  "mac-zip": [".zip"],
  "win-exe": [".exe"],
  docs: [".tar.gz", ".zip"],
};

/** multipart 分片字段名（后端 multer `chunkUpload.single('chunk')`） */
const CHUNK_FIELD = "chunk";
/** 分片会话丢失的响应文案，来源 backend-ops/src/routes/downloads.ts */
const SESSION_LOST_TEXT = "上传会话不存在或已过期";

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

const USAGE = `用法：node upload.mjs --file <路径> [选项]

必需：
  --file <路径>          要上传的本地文件（三件套或文档包）

桌面端（--type desktop，默认）：
  --version <X.Y.Z>      版本号（后端按它作 fileKey 与落库版本）
  --platform <平台>      ${PLATFORMS.join(" | ")}
  --channel <通道>       ${CHANNELS.join(" | ")}（默认 stable）

文档包（--type docs）：
  不传 --version / --platform / --channel（文件名须 .tar.gz 或 .zip）

其它：
  --type <desktop|docs>  上传类型（默认 desktop）
  --base <URL>           运营平台地址（默认生产 ${DEFAULT_BASE}）
  --credentials <路径>   凭证文件（默认 ~/.wave/neteasecc.json）
  --dry-run              只做 init + 第一片，绝不调 complete（不写库、不留可见记录）
  -h, --help             显示本帮助`;

function parseArgs(argv) {
  const opts = {
    type: "desktop",
    channel: "stable",
    base: DEFAULT_BASE,
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
      case "--base":
        opts.base = next();
        break;
      case "--credentials":
        opts.credentials = next();
        break;
      case "--dry-run":
        opts.dryRun = true;
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
  if (!opts.file) die(`缺少 --file\n\n${USAGE}`);
  if (!fs.existsSync(opts.file)) die(`文件不存在：${opts.file}`);
  const stat = fs.statSync(opts.file);
  if (!stat.isFile()) die(`不是普通文件：${opts.file}`);
  if (stat.size <= 0) die(`文件大小为 0：${opts.file}`);
  if (!TYPES.includes(opts.type)) die(`--type 只能是 ${TYPES.join(" / ")}`);

  const name = path.basename(opts.file).toLowerCase();
  const required = REQUIRED_EXT[opts.type === "docs" ? "docs" : opts.platform];
  if (opts.type === "desktop") {
    if (!opts.version) die("桌面端必须传 --version");
    if (!PLATFORMS.includes(opts.platform))
      die(`--platform 只能是 ${PLATFORMS.join(" / ")}`);
    if (!CHANNELS.includes(opts.channel))
      die(`--channel 只能是 ${CHANNELS.join(" / ")}`);
  } else if (opts.platform || opts.version) {
    die("--type docs 不接受 --platform / --version");
  }
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
    type: opts.type,
    fileName: opts.fileName,
    fileSize: opts.fileSize,
  };
  if (opts.type === "desktop") {
    body.version = opts.version;
    body.platform = opts.platform;
    body.channels = [opts.channel];
  }
  return body;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  validate(opts);

  const credsPathShown = opts.credentials.replace(os.homedir(), "~");
  console.log(`平台地址   ${opts.base}`);
  console.log(
    `上传类型   ${opts.type}${opts.type === "desktop" ? ` / ${opts.platform} / ${opts.channel}` : ""}`,
  );
  console.log(`文件       ${opts.file}（${mb(opts.fileSize)}）`);
  if (opts.type === "desktop") console.log(`版本号     ${opts.version}`);
  console.log(`凭证       ${credsPathShown}`);
  console.log(
    `模式       ${opts.dryRun ? "DRY-RUN（只传第一片，绝不调 complete）" : "正式上传"}`,
  );
  console.log();

  const creds = readCredentials(opts.credentials);
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
