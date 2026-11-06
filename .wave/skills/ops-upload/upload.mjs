#!/usr/bin/env node
/**
 * 桌面端安装包 / 文档包 / 远控 Web 页 / 插件市场快照 → CodeChat 制品发布接口。
 *
 * 四条产物线，一个脚本（`--type` 选）。**所有请求都打 `/api/publish/*`，鉴权只有一把
 * `Authorization: Bearer $PUBLISH_TOKEN` 静态令牌**（issue #2750）：
 *   - 运营端旧接口（`ops` 命名空间下的 downloads / docs / plugin-market / remote-page 四条）
 *     与「下载管理 / 制品管理」页面已整条删除，线上 404；邮箱密码换 JWT 的登录链路同时作废。
 *   - 同一份路径与语义在两种部署下逐字一致，**只换 host**：两种部署都打**企业端域名**
 *     （写入口跟着读入口走，2026-11-04 起）；私有化就是客户自己的企业端域名。
 *     运营端（neteasecc.*）不再挂这组接口（同路径 404），脚本也不再默认用。
 *
 *   - 桌面端（`--type desktop`，默认）：`POST /api/publish/desktop/init` →
 *     逐片 `POST /api/publish/desktop/:uploadId/chunk/:index` →
 *     `POST /api/publish/desktop/:uploadId/complete`（**分片**，20MiB 一片由服务端下发）。
 *     为什么用脚本而不是浏览器：分片会话存在服务端**进程内存 + 本 pod 的 os.tmpdir()**，
 *     副本数 >1 时靠 ingress 的 cookie 亲和（`codechat-ops-route`）固定落到同一 pod。而浏览器
 *     走 HTTP/2 复用单条连接，连接级抖动会一次性打死所有在飞请求（2026-09-20 生产实测 3/3
 *     失败）；node fetch 是 HTTP/1.1、每片独立连接，同一套分片参数下全部一次成功。
 *   - 文档包（`--type docs`）：`POST /api/publish/docs` 的**单次 multipart**（字段 `archive`）。
 *     服务端一次收包、解包、逐文件传 file-center（`codechat/docs/`，入口 `index.html` 最后写），
 *     不写台账、没有跨请求的会话状态 ⇒ 既不分片，也不需要亲和 cookie。
 *   - 远控 Web 页（`--type remote`）：`POST /api/publish/remote-page` 的**单次 multipart**
 *     （字段 `zip`），落到 file-center `codechat/remote/`，企业端 `/remote/` 立即可见。
 *   - 插件市场（`--type plugin-market`）：`POST /api/publish/plugin-market` 的**单次 multipart**
 *     （字段 `zip`），内容寻址落 `codechat/wave-plugins-official/<sha>.zip` + 覆写 `latest.txt`。
 *
 * 另有两条台账动作（发布页下线后，回退只能走这里）：
 *   - `--list`：`GET /api/publish/desktop` 读台账（桌面端安装包的发布记录）；
 *   - `--delete <id>`：`DELETE /api/publish/desktop/:id` 删一条记录 = 回退一个桌面版本。
 *
 * 零第三方依赖（Node 20+ 内置 fetch/FormData/Blob/fs；远控页的包清单校验借用系统 unzip，
 * 没有 unzip 时只跳过校验、不阻断上传）。
 *
 * 用法：
 *   node .wave/skills/ops-upload/upload.mjs \
 *     --file /tmp/wave-desktop-1.2.6/CodeWave.IDE-1.2.6-arm64.dmg \
 *     --version 1.2.6 --platform mac-dmg --channels stable,beta --type desktop
 *   node .wave/skills/ops-upload/upload.mjs --file docs-1.3.0.tar.gz --type docs
 *   node .wave/skills/ops-upload/upload.mjs --type remote --env test
 *   node .wave/skills/ops-upload/upload.mjs --list
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

/** 三环境共用 envs.mjs 那一张表；`--base` 指向私有化环境（客户企业端域名）或临时环境。 */
const DEFAULT_BASE = ENV_BASES.prod;
/**
 * 发布令牌文件（按环境分别存放）。形如：
 *   { "prod": "…", "test": "…", "drill": "…", "https://客户企业端": "…", "default": "…" }
 * 取值顺序：`--token` > 环境变量 `PUBLISH_TOKEN` > 本文件。值绝不打印。
 */
const DEFAULT_TOKEN_FILE = path.join(
  os.homedir(),
  ".wave",
  "publish-token.json",
);
/** 远控页默认取 `pack:remote` 的产物 */
const DEFAULT_REMOTE_ZIP = path.join(
  ROOT,
  "packages/webview/remote/dist/remote-page.zip",
);

const TYPES = ["desktop", "docs", "remote", "plugin-market"];
const PLATFORMS = ["mac-dmg", "mac-zip", "win-exe"];
const CHANNELS = ["stable", "beta"];
/** 单个版本的变更记录上限：feed 里最近 20 个版本的记录共用一份预算，单版本超了会把
 *  整份数组挤爆（服务端按 16KB 截断，见 vusion/codechat#50）。 */
const RELEASE_NOTES_MAX_BYTES = 16 * 1024;
const REQUIRED_EXT = {
  "mac-dmg": [".dmg"],
  "mac-zip": [".zip"],
  "win-exe": [".exe"],
  docs: [".tar.gz", ".zip"],
  remote: [".zip"],
  "plugin-market": [".zip"],
};

/**
 * 发布接口的公共前缀。两种部署都挂在**企业端域名**（写入口跟着读入口走，2026-11-04 起），
 * **路径逐字一致** —— 同一份命令只换 host（issue #2750 的核心承诺）。
 */
const PUBLISH_PREFIX = "/api/publish";
const DESKTOP_INIT_PATH = `${PUBLISH_PREFIX}/desktop/init`;
/** 台账：`GET` 读列表 / `DELETE /:id` 回退一条记录（发布页下线后的唯一入口） */
const DESKTOP_LEDGER_PATH = `${PUBLISH_PREFIX}/desktop`;
const desktopChunkPath = (uploadId, index) =>
  `${PUBLISH_PREFIX}/desktop/${uploadId}/chunk/${index}`;
const desktopCompletePath = (uploadId) =>
  `${PUBLISH_PREFIX}/desktop/${uploadId}/complete`;
const desktopRowPath = (id) =>
  `${PUBLISH_PREFIX}/desktop/${encodeURIComponent(id)}`;

/** multipart 分片字段名（服务端 `singleFileParser('chunk')`） */
const CHUNK_FIELD = "chunk";
/** 分片会话丢失的响应文案，来源 packages/shared/src/publish/router.ts */
const SESSION_LOST_TEXT = "上传会话不存在或已过期";

/** 文档包上传端点与 multipart 字段名（单次、不分片） */
const DOCS_UPLOAD_PATH = `${PUBLISH_PREFIX}/docs`;
const DOCS_ARCHIVE_FIELD = "archive";

/** 远控页上传端点与 multipart 字段名（单次） */
const REMOTE_UPLOAD_PATH = `${PUBLISH_PREFIX}/remote-page`;
const REMOTE_ZIP_FIELD = "zip";

/** 插件市场端点/字段/落地前缀（单次、内容寻址） */
const PLUGIN_MARKET_UPLOAD_PATH = `${PUBLISH_PREFIX}/plugin-market`;
const PLUGIN_MARKET_ZIP_FIELD = "zip";
const PLUGIN_MARKET_FILE_PREFIX = "codechat/wave-plugins-official";
/** 收端准入：zip 根必须含这个文件条目 */
const PLUGIN_MARKET_MANIFEST = ".wave-plugin/marketplace.json";
/** 线上版本指针（企业端 ingress 精确 rewrite 到 latest.txt，返回纯文本 sha，no-cache） */
const PLUGIN_MARKET_LATEST_PATH = "/wave-plugins-official/latest";

/** 单文件上限（服务端 ARCHIVE_MAX_BYTES，docs / plugin-market / remote-page 共用） */
const ARCHIVE_MAX_BYTES = 100 * 1024 * 1024;
/** 令牌最短长度，与服务端 PUBLISH_TOKEN_MIN_LENGTH 同口径 */
const MIN_TOKEN_LENGTH = 16;

/** 重试参数：每片最多 5 次尝试、400ms 起指数退避（上限 4s） */
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
const kb = (bytes) => `${(bytes / 1024).toFixed(1)}KB`;
const home = (p) => p.replace(os.homedir(), "~");

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
 * 回传 headers（取亲和 cookie 用）。
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
  return { status: res.status, json, text, headers: res.headers };
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

/**
 * 失败的统一口径：**先给 HTTP 状态，再给「这种情况是什么」**。旧技能把 404 一律解释成
 * 「该环境还没部署这个端点」，新契约下 404 的含义已经换了（见各条提示），别再猜。
 */
function explainFailure(label, err) {
  const status = err instanceof UploadError ? err.status : null;
  console.error(
    `\n✗ ${label}失败：${err instanceof UploadError ? err.message : err?.stack || err}`,
  );
  console.error(
    `  HTTP 状态：${status === null ? "无响应（网络层失败）" : status}`,
  );
  if (status === 401) {
    console.error(
      "  提示：401 = 发布令牌错/缺失。服务端只认静态令牌 `Authorization: Bearer $PUBLISH_TOKEN`，" +
        "不认任何登录态 JWT；核对 --token / PUBLISH_TOKEN / 令牌文件里该环境的值。",
    );
  } else if (status === 503) {
    console.error(
      "  提示：503 = 该部署没配 PUBLISH_TOKEN（后端 env，至少 16 位），制品发布接口当前不可用——" +
        "这不是令牌填错，要运维补环境变量后重启后端。",
    );
  } else if (status === 404) {
    console.error(
      "  提示：404 = 这组接口在该 host 上不存在。旧运营端上传接口（`ops` 命名空间那四条）已整条删除，" +
        "所以要么 host 打错（两种部署都是**企业端域名**，路径 /api/publish/*），" +
        "要么该环境后端还没部署这版代码（2026-11-04 之前的镜像只在运营端挂这组接口，" +
        "此时用 --base https://neteasecc.<环境> 临时指向运营端）。别再往「单个端点没上线」上猜。",
    );
  } else if (status === 502) {
    console.error(
      "  提示：502 = 服务端写 file-center 失败（或整包中途失败已回滚），重跑同一条命令通常可解。",
    );
  } else if (status === 413) {
    console.error(
      "  提示：413 = 请求体超过网关上限。安装包必须走分片；文档包/插件市场/远控页单文件上限 100MiB。",
    );
  } else if (err instanceof UploadError && err.kind === "net") {
    console.error(
      "  提示：网络层失败已按前端口径重试过；每片是独立 HTTP/1.1 连接，先确认 host 可达。",
    );
  }
}

// ─── 参数 ──────────────────────────────────────────────────────────────────

const USAGE = `用法：node upload.mjs --type <desktop|docs|remote|plugin-market> [选项]
       node upload.mjs --list
       node upload.mjs --delete <台账 id> [--confirm-prod]

必需：
  --file <路径>          要上传的本地文件（远控页可省略，默认取 pack:remote 产物；
                         --list / --delete 不需要）

桌面端（--type desktop，默认）：
  --version <X.Y.Z>      版本号（服务端按它作 fileKey 与落库版本）
  --platform <平台>      ${PLATFORMS.join(" | ")}
  --channels <通道>      ${CHANNELS.join(" | ")}，可用逗号多选（如 stable,beta）：一次落两条记录、
                         安装包只传一次。默认 stable
  --channel <通道>       --channels 的单值写法（可重复），保留兼容
  --release-notes-file <路径>
                         本版本的变更记录（markdown，由
                         \`node packages/desktop/scripts/release-notes.mjs\` 生成）。
                         一次上传只提交一份，与通道无关（stable/beta 共用）；不带则
                         该版本没有记录，客户端 S4 不展示记录块

文档包（--type docs）：
  不传 --version / --platform / --channel（文件名须 .tar.gz 或 .zip）
  走 POST ${DOCS_UPLOAD_PATH} 的单次 multipart（字段 archive），不进分片链路

远控 Web 页（--type remote）：
  不传 --version / --platform / --channel（文件名须 .zip，根层要有 index.html）
  走 POST ${REMOTE_UPLOAD_PATH} 的单次 multipart（字段 zip）

插件市场（--type plugin-market）：
  不传 --version / --platform / --channel（文件名须 .zip）
  上 wave-plugins-official 整树快照，zip 根须含 ${PLUGIN_MARKET_MANIFEST}
  走 POST ${PLUGIN_MARKET_UPLOAD_PATH} 的单次 multipart（字段 zip）；落成
  ${PLUGIN_MARKET_FILE_PREFIX}/<sha256>.zip 并覆写 latest.txt

台账（发布页已下线，回退只能走这里）：
  --list                 读发布台账（GET ${DESKTOP_LEDGER_PATH}）
  --delete <id>          删一条台账记录 = 回退一个桌面版本；file_key 仍被另一通道引用时
                         只删行、不删 file-center 对象

鉴权 / 环境：
  --token <令牌>         发布令牌；也可用环境变量 PUBLISH_TOKEN
  --token-file <路径>    令牌文件（默认 ${home(DEFAULT_TOKEN_FILE)}），按环境分键
  --env <环境>           目标环境：${Object.keys(ENV_BASES).join(" / ")}（默认 prod）
  --base <URL>           直接指定地址（与 --env 二选一）：私有化环境必须用它 +
                         该环境令牌（私有化没有 --env 预设）
  --confirm-prod         对生产做写操作（上传远控页/插件市场、删除台账）时必须显式加上

其它：
  --type <desktop|docs|remote|plugin-market>
                         上传类型（默认 desktop）
  --dry-run              只做验证、绝不写入：
                           桌面端 = init + 第一片，不调 complete；
                           文档包 / 远控页 / 插件市场 = 令牌校验 + 本地预检，不发上传
  --check                同 --dry-run（远控页时代的旧名，保留兼容）
  -h, --help             显示本帮助`;

function parseArgs(argv) {
  const opts = {
    type: "desktop",
    channels: [],
    base: DEFAULT_BASE,
    baseGiven: false,
    tokenFile: DEFAULT_TOKEN_FILE,
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
        opts.channels.push(next());
        break;
      case "--channels":
        opts.channels.push(...next().split(","));
        break;
      case "--release-notes-file":
        opts.releaseNotesFile = next();
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
      case "--token":
        opts.token = next();
        break;
      case "--token-file":
      case "--credentials": // 旧名（邮箱密码凭证文件时代），留一层兼容
        opts.tokenFile = next();
        break;
      case "--list":
        opts.list = true;
        break;
      case "--delete":
        opts.deleteId = next();
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
        break;
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

/** 变更记录的本地预检。内容随 init 一并提交，服务端按**版本维度**存一份并写进 feed 的
 *  `releaseNotes` 数组（vusion/codechat#50）；与分发通道无关，同一次
 *  `--channels stable,beta` 只传这一份。 */
function readReleaseNotes(file) {
  if (!fs.existsSync(file)) die(`变更记录文件不存在：${file}`);
  if (!fs.statSync(file).isFile()) die(`变更记录不是普通文件：${file}`);
  const text = fs.readFileSync(file, "utf8").trim();
  if (!text) {
    die(
      `变更记录为空：${file}\n没有条目就别传这个参数（不要用空文件冒充「有记录」）`,
    );
  }
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > RELEASE_NOTES_MAX_BYTES) {
    die(
      `变更记录 ${kb(bytes)} 超过单版本上限 ${kb(RELEASE_NOTES_MAX_BYTES)}：feed 里所有版本的记录共用一份预算，请收紧生成脚本的过滤口径`,
    );
  }
  return text;
}

function validate(opts) {
  if (!TYPES.includes(opts.type)) die(`--type 只能是 ${TYPES.join(" / ")}`);
  if (opts.env !== undefined) {
    if (!Object.hasOwn(ENV_BASES, opts.env)) {
      die(`--env 只能是 ${Object.keys(ENV_BASES).join(" / ")}`);
    }
    if (opts.baseGiven) die("--env 与 --base 只能二选一");
    opts.base = ENV_BASES[opts.env];
  }
  opts.base = opts.base.replace(/\/+$/, "");

  // 台账动作不需要产物文件，先收口
  if (opts.list || opts.deleteId) {
    if (opts.list && opts.deleteId) die("--list 与 --delete 只能二选一");
    if (opts.file) die("--list / --delete 不接受 --file");
    if (opts.releaseNotesFile) {
      die("--list / --delete 不接受 --release-notes-file");
    }
    if (opts.deleteId && opts.env === "prod" && !opts.confirmProd) {
      die("删生产台账行 = 回退线上版本，必须显式加 --confirm-prod");
    }
    return;
  }

  // 远控页默认取 pack:remote 的产物，不必每次手写 --file
  if (!opts.file && opts.type === "remote") opts.file = DEFAULT_REMOTE_ZIP;
  if (!opts.file) die(`缺少 --file\n\n${USAGE}`);
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
    // 去空、按服务端固定顺序（stable, beta）排列 —— 台账与响应里的 channels 就是这个顺序
    const picked = [
      ...new Set(opts.channels.map((c) => c.trim()).filter(Boolean)),
    ];
    const bad = picked.filter((c) => !CHANNELS.includes(c));
    if (bad.length)
      die(
        `--channels 只能是 ${CHANNELS.join(" / ")}（收到 ${bad.join(", ")}）`,
      );
    opts.channels = CHANNELS.filter((c) => picked.includes(c));
    if (opts.channels.length === 0) opts.channels = ["stable"];
    if (opts.releaseNotesFile) {
      opts.releaseNotes = readReleaseNotes(opts.releaseNotesFile);
    }
  } else if (opts.platform || opts.version || opts.releaseNotesFile) {
    die(
      `--type ${opts.type} 不接受 --platform / --version / --release-notes-file`,
    );
  } else if (opts.channels.length) {
    die(`--type ${opts.type} 不接受 --channel / --channels`);
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
  // 单次 multipart 的产物先按服务端上限挡一次，别白传 100MB 才拿到 400
  if (opts.type !== "desktop" && stat.size > ARCHIVE_MAX_BYTES) {
    die(
      `文件 ${mb(stat.size)} 超过服务端单文件上限 ${mb(ARCHIVE_MAX_BYTES)}（100MiB）`,
    );
  }
  opts.fileSize = stat.size;
  opts.fileName = path.basename(opts.file);
}

// ─── 发布令牌 ──────────────────────────────────────────────────────────────

/** 令牌文件里可能命中本次目标的键，按优先级排列 */
function tokenLookupKeys(opts) {
  const keys = [];
  if (opts.env) keys.push(opts.env);
  else {
    const name = Object.keys(ENV_BASES).find((n) => ENV_BASES[n] === opts.base);
    if (name) keys.push(name);
  }
  // 私有化环境：没有 --env 预设，只能按显式 --base 存（整条地址或 host 都认）
  keys.push(opts.base);
  try {
    keys.push(new URL(opts.base).host);
  } catch {
    /* base 不是合法 URL 时跳过 */
  }
  keys.push("default");
  return [...new Set(keys)];
}

/**
 * 解析发布令牌：`--token` > 环境变量 `PUBLISH_TOKEN` > 令牌文件。
 * **令牌值绝不打印**，只回传来源描述，方便核对「这次用的是哪个环境的令牌」。
 */
function resolveToken(opts) {
  if (opts.token) return { token: opts.token.trim(), source: "--token" };
  const fromEnv = (process.env.PUBLISH_TOKEN || "").trim();
  if (fromEnv) return { token: fromEnv, source: "环境变量 PUBLISH_TOKEN" };

  const shown = home(opts.tokenFile);
  let raw;
  try {
    raw = fs.readFileSync(opts.tokenFile, "utf8");
  } catch (err) {
    die(
      `没有可用的发布令牌：未传 --token、环境变量 PUBLISH_TOKEN 为空，且读不到令牌文件 ${shown}（${err.code}）。\n` +
        `  文件形状（按环境分键）：{ "prod": "…", "test": "…", "drill": "…", "https://客户企业端": "…" }`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    die(`令牌文件不是合法 JSON：${shown}`);
  }
  if (typeof parsed?.token === "string" && parsed.token.trim()) {
    return { token: parsed.token.trim(), source: `${shown}（token 键）` };
  }
  for (const key of tokenLookupKeys(opts)) {
    const value = parsed?.[key];
    if (typeof value === "string" && value.trim()) {
      return { token: value.trim(), source: `${shown}（${key}）` };
    }
  }
  die(
    `令牌文件 ${shown} 里没有本次目标的键。\n` +
      `  试过的键：${tokenLookupKeys(opts).join(" / ")}；` +
      `私有化环境按 --base 的地址或 host 存，或直接传 --token / 设 PUBLISH_TOKEN。`,
  );
}

/** 令牌形状先挡一次：太短的一定不对，别拿它去换一句含义模糊的 401 */
function assertTokenShape(token, source) {
  if (token.length < MIN_TOKEN_LENGTH) {
    die(
      `发布令牌太短（${token.length} 位，来源 ${source}）：服务端要求至少 ${MIN_TOKEN_LENGTH} 位，` +
        `多半是占位符或复制截断了。`,
    );
  }
}

// ─── 亲和 cookie / 台账 ────────────────────────────────────────────────────

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
 * 读发布台账。这一条请求同时承担三件事：
 *   1. 验证令牌（401/503/404 在启动阶段就说清楚，不等传完几百 MB 才发现）；
 *   2. 收下 ingress 下发的亲和 cookie（分片直传的硬前提）；
 *   3. `--list` 与上传后的对照。
 */
async function fetchLedger(opts, token) {
  return withRetry(
    "台账",
    () =>
      request(`${opts.base}${DESKTOP_LEDGER_PATH}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      }),
    console.log,
  );
}

// ─── 入口 ──────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  validate(opts);

  const { token, source } = resolveToken(opts);
  assertTokenShape(token, source);

  console.log(
    `平台地址   ${opts.base}${opts.env ? `（--env ${opts.env}）` : ""}`,
  );
  if (opts.list || opts.deleteId) {
    console.log(
      `动作       ${opts.list ? "读发布台账" : "删除台账行（回退）"}`,
    );
  } else {
    console.log(
      `上传类型   ${opts.type}${opts.type === "desktop" ? ` / ${opts.platform} / ${opts.channels.join(",")}` : ""}`,
    );
    console.log(`文件       ${opts.file}（${mb(opts.fileSize)}）`);
    if (opts.type === "desktop") {
      console.log(`版本号     ${opts.version}`);
      console.log(
        opts.releaseNotes
          ? `变更记录   ${opts.releaseNotes.split("\n").length} 条（${mb(Buffer.byteLength(opts.releaseNotes, "utf8"))}，随 init 提交）`
          : "变更记录   未提供（该版本不展示记录块）",
      );
    }
  }
  console.log(
    `发布令牌   已加载（来源 ${source}，长度 ${token.length}，值不显示）`,
  );
  if (!opts.list && !opts.deleteId)
    console.log(`模式       ${describeMode(opts)}`);
  console.log();

  let ledger;
  try {
    ledger = await fetchLedger(opts, token);
  } catch (err) {
    explainFailure("发布接口连通性", err);
    return 1;
  }
  console.log(
    `发布接口   ${DESKTOP_LEDGER_PATH} 可读（台账 ${ledger.json?.desktopDownloads?.length ?? 0} 条）`,
  );

  const cookie = pickAffinityCookie(ledger.headers);
  const authHeaders = { Authorization: `Bearer ${token}` };
  if (cookie) authHeaders.Cookie = cookie;

  if (opts.list) return await listLedger(opts, ledger.json);
  if (opts.deleteId)
    return await deleteLedgerRow(opts, authHeaders, token, ledger.json);

  if (opts.type === "desktop") {
    // 亲和 cookie 只影响桌面端分片（会话在 init 那个 pod 的内存与临时目录里）。
    // 副本数 >1 且没带 cookie ⇒ 随机 404 会话不存在；只告警不阻断：两端部署清单目前都是
    // replicas: 1，而私有化环境的 ingress 未必原样下发这个 cookie。
    console.log(
      cookie
        ? `亲和 cookie ${AFFINITY_COOKIE_NAME} 已获取（长度 ${cookie.length}，值不显示）`
        : `⚠️ 未取到 ${AFFINITY_COOKIE_NAME} 亲和 cookie：副本数 >1 时会被 LB 打到别的 pod，分片可能随机 404（会话丢失会自动整轮重启，最多 ${MAX_ROUNDS} 轮）`,
    );
    return await uploadDesktop(opts, authHeaders);
  }
  if (opts.type === "docs") return await uploadDocs(opts, authHeaders);
  if (opts.type === "remote")
    return await uploadRemotePage(opts, authHeaders, cookie);
  return await uploadPluginMarket(opts, authHeaders);
}

/** `模式` 那行的文案：--dry-run 对四种产物的「不写」含义各不相同 */
function describeMode(opts) {
  if (!opts.dryRun) return "正式上传";
  if (opts.type === "docs")
    return "DRY-RUN（令牌校验 + 本地预检，不发上传：文档包是单次请求）";
  if (opts.type === "remote") {
    return "DRY-RUN（预检：包形状 / 令牌 / 上传前线上版本，不发上传）";
  }
  if (opts.type === "plugin-market") {
    return "DRY-RUN（预检：manifest / 本地 sha / 线上 latest，不发上传）";
  }
  return "DRY-RUN（只传第一片，绝不调 complete）";
}

// ─── 台账：列表 / 删除（回退） ─────────────────────────────────────────────

function listLedger(opts, json) {
  const rows = json?.desktopDownloads ?? [];
  console.log();
  if (rows.length === 0) {
    console.log("台账为空（这个环境还没通过发布接口传过桌面端安装包）。");
    return 0;
  }
  for (const d of rows) {
    console.log(
      `${String(d.version ?? "?").padEnd(12)} ${String(d.platform ?? "?").padEnd(8)} ${String(d.channel ?? "?").padEnd(7)} ${mb(Number(d.fileSize) || 0).padStart(10)}  ${d.fileName ?? "(无)"}`,
    );
    console.log(
      `  id ${d.id ?? "(无)"}  sha512 ${String(d.sha512 ?? "(无)").slice(0, 16)}…  上传人 ${d.uploaderEmail ?? "(无)"}  ${d.createdAt ?? ""}`,
    );
    console.log(`  ${d.downloadUrl ?? "(无下载地址)"}`);
  }
  console.log(
    `\n共 ${rows.length} 条。回退一条：node upload.mjs --delete <id>（生产要加 --confirm-prod）。`,
  );
  console.log(
    `台账里的上传人恒为 ops-api（令牌没有身份），追人看发布记录/工单，不要看这个字段。`,
  );
  return 0;
}

async function deleteLedgerRow(opts, headers, token, json) {
  const rows = json?.desktopDownloads ?? [];
  const row = rows.find((d) => d.id === opts.deleteId);
  if (!row) {
    die(
      `台账里没有 id=${opts.deleteId} 的记录（该环境共 ${rows.length} 条，先用 --list 看）。`,
    );
  }
  console.log(
    `\n将删除：${row.version} / ${row.platform} / ${row.channel} / ${row.fileName}（${row.downloadUrl}）`,
  );
  if (opts.dryRun) {
    console.log(
      "\nDRY-RUN：未发起删除。删除会同时回退下载页/feed 到上一版本（file_key 仍被另一通道引用时只删行）。",
    );
    return 0;
  }
  try {
    const { status } = await withRetry(
      "删除",
      () =>
        request(`${opts.base}${desktopRowPath(opts.deleteId)}`, {
          method: "DELETE",
          headers,
        }),
      console.log,
    );
    console.log(`删除 ${status}`);
  } catch (err) {
    explainFailure("删除台账行", err);
    return 1;
  }
  try {
    const after = await fetchLedger(opts, token);
    const still = (after.json?.desktopDownloads ?? []).some(
      (d) => d.id === opts.deleteId,
    );
    console.log(
      still
        ? "⚠️ 删除后台账里仍有这条记录，别当成成功"
        : `已从台账移除；该环境现在 ${after.json?.desktopDownloads?.length ?? 0} 条记录。`,
    );
    console.log("下载页 / feed 的读路径会立刻反映（企业端按版本取最新一行）。");
  } catch (err) {
    console.log(`删除后排账失败（删除本身可能已成功）：${err.message}`);
  }
  return 0;
}

// ─── 文档包（单次 multipart） ──────────────────────────────────────────────

/**
 * 文档包上传：一个请求把整包交给 `/api/publish/docs`，服务端解包后逐文件传 file-center。
 *
 * 与桌面端的两处关键差别：
 *   - **不分片、不带亲和 cookie**：服务端没有跨请求的会话状态，请求落到哪个 pod 都一样。
 *   - **不写台账**：文档站永远只有「最新版」一个状态，传完**没有可回读的记录**
 *     （`GET /api/publish/desktop` 里没有 docs 行）——判据只有 201 与响应里的
 *     `fileCount` / `fileKeys`，以及企业端 `/docs/` 上的对象。
 *
 * 失败可以直接重跑：服务端中途失败会回滚本次已传对象，整包重传本身是幂等覆盖。
 */
async function uploadDocs(opts, headers) {
  console.log(
    `端点       POST ${DOCS_UPLOAD_PATH}（单次 multipart，字段 ${DOCS_ARCHIVE_FIELD}）`,
  );

  if (opts.dryRun) {
    console.log(
      `\nDRY-RUN：令牌可用、本地包合法（${mb(opts.fileSize)}）；文档包是单次 multipart，` +
        `请求发出即整站覆盖（没有「只传一片」的中间态）⇒ 不发起上传。`,
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
          headers,
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
      `\n文档站不入台账 ⇒ 没有可回读的记录；核验看企业端 /docs/ 上的对象（见技能「二、文档站包」）。`,
    );
    return 0;
  } catch (err) {
    explainFailure("文档包上传", err);
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
 * 远控页上传：一个请求把 zip 交给 `/api/publish/remote-page`（multipart 字段 `zip`），
 * 服务端解包后逐文件传 file-center `codechat/remote/`（入口 `index.html` 最后写）。
 *
 * 与另外两条的差别（全部保留自 upload-remote-page.mjs，2026-10-19 并入本脚本）：
 *   - **页面不发版**：传完企业端 `/remote/` 立即可见，后端不转发、不重建镜像；
 *     但「页面已更新」≠「机器侧已更新」——服务端方法白名单在服务那个会话的进程里。
 *   - **没有删除/回滚接口**：回滚只能另打一份覆盖同名文件；旧 hash 名永不清理。
 *   - **`--env prod` 必须 `--confirm-prod`**：打错环境不报错，对象会静默写进别处。
 *   - **成功判据 = 201 + fileKeys 数量 = 产物文件数**（不再有 version.txt 指针）。
 */
async function uploadRemotePage(opts, headers, cookie) {
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

  if (opts.dryRun) {
    console.log("\nDRY-RUN：令牌可用、预检通过，未发起上传。");
    return 0;
  }

  const buffer = await fs.promises.readFile(opts.file);
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
    if (!cookie) {
      console.log(
        `（本次未带 ${AFFINITY_COOKIE_NAME} cookie —— 远控页是单请求，落在哪个 pod 都一样）`,
      );
    }
    console.log(
      `\n完成。手机端刷新即取新构建（入口 no-cache）；回滚账看上方「线上构建」。`,
    );
    return 0;
  } catch (err) {
    explainFailure("远控页上传", err);
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
 * `/api/publish/plugin-market`（multipart 字段 `zip`）。
 *
 * 与另外三条的差别：
 *   - **内容寻址**：服务端按 zip 全文 sha256 落 `codechat/wave-plugins-official/<sha>.zip`，
 *     再覆写 `latest.txt` 指向它 ⇒ 同内容重传幂等，「线上是哪份」只由那条指针决定。
 *   - **收端先校验**：zip 根必须含 `.wave-plugin/marketplace.json`（轻校验，不展开内容）。
 *   - **不写台账、没有删除/回滚接口**：回滚 = 拿旧 zip 重传一次（旧 sha 对象永不清理）。
 *   - **`--env prod` 必须 `--confirm-prod`**：一传就对全体用户生效，且打错环境不报错。
 */
async function uploadPluginMarket(opts, headers) {
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

  if (opts.dryRun) {
    console.log("\nDRY-RUN：令牌可用、预检通过，未发起上传。");
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
          headers,
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
    explainFailure("插件市场上传", err);
    console.error(
      `  提示：{sha}.zip 内容寻址、同包重传幂等；重跑同一条命令即可。`,
    );
    return 1;
  }
}

// ─── 桌面端（分片直传） ────────────────────────────────────────────────────

/** 本地文件的 sha512（base64）——与服务端 complete 回传的 `sha512` 同编码，可直接比 */
async function sha512Base64(file) {
  const hash = crypto.createHash("sha512");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("base64");
}

/** 桌面端安装包：init → 逐片 chunk → complete（分片会话靠 cookie 亲和固定到同一 pod）。 */
async function uploadDesktop(opts, headers) {
  const fh = await fs.promises.open(opts.file, "r");
  const state = { chunk: null, totalChunks: null, uploadId: null };
  try {
    const result = await uploadRounds(opts, headers, fh, state);
    console.log(
      opts.dryRun
        ? "\nDRY-RUN 摘要（未调用 complete）："
        : "\n完成。complete 响应：",
    );
    console.log(JSON.stringify(result, null, 2));

    if (opts.dryRun) {
      console.log(
        `\nDRY-RUN：已在第 1 片之后停止，**未调用 complete** ⇒ 未写库、未生成用户可见记录。`,
      );
      console.log(
        `临时会话 uploadId=${state.uploadId} 只存在于服务端内存（TTL 2h 后自动清理分片）。`,
      );
      return 0;
    }

    // ── 回包字段核对：落库通道、大小、sha512（base64，与本地可直接比） ──
    const landed = [...new Set(result.channels ?? [])].sort();
    const asked = [...opts.channels].sort();
    if (landed.join(",") !== asked.join(",")) {
      console.error(
        `✗ 请求落库通道 ${asked.join("/")}，服务端实际写成 ${landed.join("/") || "(空)"} —— 先别当成成功`,
      );
      return 1;
    }
    if (result.version !== opts.version || result.platform !== opts.platform) {
      console.error(
        `✗ 落库版本/平台与请求不一致：请求 ${opts.version}/${opts.platform}，服务端 ${result.version}/${result.platform}`,
      );
      return 1;
    }
    if (result.sizeBytes !== undefined && result.sizeBytes !== opts.fileSize) {
      console.error(
        `✗ 服务端记录的大小 ${result.sizeBytes} 与本地 ${opts.fileSize} 不一致`,
      );
      return 1;
    }
    const localSha = await sha512Base64(opts.file);
    if (result.sha512 && result.sha512 !== localSha) {
      console.error(
        `✗ sha512 不一致：\n  本地   ${localSha}\n  服务端 ${result.sha512}\n  上传的字节与本地文件不同，别当成成功`,
      );
      return 1;
    }
    console.log(
      `\n字段核对   ✅ version/platform/channels/size/sha512 全部一致（sha512 ${localSha.slice(0, 16)}…）`,
    );
    console.log(`台账 id    ${(result.ids ?? []).join(", ") || "(未返回)"}`);
    console.log(`下载地址   ${result.downloadUrl ?? "(未返回)"}`);
    console.log(
      `\n下一步：客户端是否真能更新看企业端 feed（见技能「一、桌面端三件套」验证要点第 4 步）；` +
        `回退一条记录用 --list / --delete <id>。`,
    );
    return 0;
  } catch (err) {
    explainFailure("上传", err);
    if (state.chunk !== null)
      console.error(
        `  失败位置：第 ${state.chunk}/${state.totalChunks} 片（uploadId=${state.uploadId}）`,
      );
    else if (state.uploadId)
      console.error(
        `  失败位置：complete（uploadId=${state.uploadId}，全 ${state.totalChunks} 片已传完）`,
      );
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

/** init 请求体：新契约只认 `channels` 数组（一次可发两通道，安装包只传一次） */
function initBody(opts) {
  return {
    platform: opts.platform,
    version: opts.version,
    fileName: opts.fileName,
    fileSize: opts.fileSize,
    channels: opts.channels,
    // 只有 ops 显式给了记录才带这个字段 —— 服务端支持该字段（vusion/codechat#50）
    // 之前不带，老服务端收到未知字段的行为无需赌。
    ...(opts.releaseNotes ? { releaseNotes: opts.releaseNotes } : {}),
  };
}

async function uploadOnce(opts, headers, fh, state) {
  const init = await withRetry(
    "init",
    async () => {
      const { json } = await request(`${opts.base}${DESKTOP_INIT_PATH}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(initBody(opts)),
      });
      return json;
    },
    console.log,
  );

  const { uploadId, chunkSize, totalChunks } = init;
  if (!uploadId || !chunkSize || !totalChunks) {
    throw new UploadError(
      `init 回包缺字段（uploadId/chunkSize/totalChunks）：${JSON.stringify(init).slice(0, 200)}`,
    );
  }
  state.uploadId = uploadId;
  state.totalChunks = totalChunks;
  console.log(
    `init ok：uploadId=${uploadId} chunkSize=${mb(chunkSize)} totalChunks=${totalChunks}（通道 ${opts.channels.join(",")}）`,
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
          return request(`${opts.base}${desktopChunkPath(uploadId, i)}`, {
            method: "POST",
            headers,
            body: form,
          });
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
      channels: opts.channels,
    };

  state.chunk = null;
  const { status, json } = await withRetry(
    "complete",
    () =>
      request(`${opts.base}${desktopCompletePath(uploadId)}`, {
        method: "POST",
        headers,
      }),
    console.log,
  );
  console.log(`complete ${status}`);
  return json;
}

process.exit(await main());
