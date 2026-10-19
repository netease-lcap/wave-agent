#!/usr/bin/env node
/**
 * 把 `pack:remote` 打出来的 remote-page.zip 传到 ops 的远端页上传接口。
 *
 * 上传契约（只有一条路由，没有删除/回滚接口）：
 *   POST {ops}/api/ops/remote-page/upload   multipart：zip（filename 带 .zip）+ version（可选）
 *   鉴权 = POST {ops}/api/auth/login 换 JWT（Bearer），并带 ops 的亲和 cookie。
 *   成功 = 201 + fileKeys（= 产物文件数 + 1，多出来的是 version.txt）。
 *
 * 三环境来自 envs.mjs 的常量表、用 `--env` 选，不接受任意 host（打错域名**不会报错**，
 * 对象会静默写进另一个环境）；生产额外要求 `--confirm-prod`（用户明确说「传生产」才加）。
 *
 * 只打印状态码 / 字节数 / 键名：账号、密码、JWT 一律不上屏。
 *
 * 用法：
 *   node .wave/skills/ops-upload/upload-remote-page.mjs --env test
 *   node .wave/skills/ops-upload/upload-remote-page.mjs --env test --check        # 只预检，不写
 *   node .wave/skills/ops-upload/upload-remote-page.mjs --env prod --confirm-prod
 *   [--zip <path>] [--version <label>]
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { ENV_BASES, ENV_NAMES, ENV_SITES } from "./envs.mjs";

// ─── 环境表 ────────────────────────────────────────────────────────────────
// ops = 上传面（neteasecc.*），site = 访问面（企业端 codechat.*，对象落地即可见）；
// 两个域名都来自 envs.mjs，与 upload.mjs 同一份，不各写各的。
const ENVS = Object.fromEntries(
  ENV_NAMES.map((name) => [
    name,
    { ops: ENV_BASES[name], site: ENV_SITES[name] },
  ]),
);

const USAGE = `用法：node upload-remote-page.mjs --env <test|drill|prod> [选项]

  --env <e>        目标环境（必填）：test / drill / prod
  --confirm-prod   传生产时必须显式加上（防止手滑）
  --zip <路径>     默认仓库内 packages/webview/remote/dist/remote-page.zip
  --version <标签> 默认 \`<webview 版本>-<分支|main>.<sha8>\`；写入 codechat/remote/version.txt
  --check          只做预检（host 断言 / zip 形状 / 登录 / 亲和 cookie / 上传前状态），不发上传
  -h, --help       显示本帮助`;

function die(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// ─── 参数 ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opts = { check: false };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const next = () => {
    const v = argv[++i];
    if (v === undefined) die(`参数 ${a} 缺少取值`);
    return v;
  };
  switch (a) {
    case "--env":
      opts.env = next();
      break;
    case "--zip":
      opts.zip = next();
      break;
    case "--version":
      opts.version = next();
      break;
    case "--check":
      opts.check = true;
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

if (!ENVS[opts.env])
  die(`--env 只能是 ${Object.keys(ENVS).join(" / ")}\n\n${USAGE}`);
const env = ENVS[opts.env];

// ─── 自保断言（打错环境不报错，所以先自己咬） ──────────────────────────────
// host 只来自 envs.mjs（envs.mjs 自己会校验域名形状），这里只需守住「生产要显式确认」。
if (opts.env === "prod" && !opts.confirmProd) {
  die("传生产必须显式加 --confirm-prod（用户明确说「传生产」才加）");
}

const ROOT = path.resolve(import.meta.dirname, "../../..");
const zip =
  opts.zip ?? path.join(ROOT, "packages/webview/remote/dist/remote-page.zip");
if (!fs.existsSync(zip))
  die(`zip 不存在：${zip}（先 pnpm -F wave-webview run pack:remote）`);
if (!zip.endsWith(".zip")) die(`只接受 .zip：${zip}`);

const buf = fs.readFileSync(zip);
const ageSec = Math.round((Date.now() - fs.statSync(zip).mtimeMs) / 1000);

/** 压缩包清单：收端准入要求根层有 index.html。拿不到 unzip 时只警告，不阻断。 */
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

const names = zipNames(zip);
if (names) {
  if (!names.includes("index.html")) die("zip 根层没有 index.html（收端会拒）");
  console.log(
    `zip ${buf.length} B / ${names.length} 个文件，打包于 ${ageSec}s 前`,
  );
} else {
  console.log(
    `zip ${buf.length} B，打包于 ${ageSec}s 前（未装 unzip，跳过清单校验）`,
  );
}
if (ageSec > 3600) {
  console.log(
    `⚠️ 这个包一小时以上没重新打过 —— dist 里常躺着旧构建，确认不是陈旧产物`,
  );
}

// ─── version 标签 ──────────────────────────────────────────────────────────
function git(args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function defaultVersion() {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "packages/webview/package.json"), "utf8"),
  ).version;
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const slug =
    !branch || branch === "HEAD" || branch === "main"
      ? "main"
      : branch
          .split("/")
          .pop()
          .replace(/[^A-Za-z0-9._-]/g, "-");
  const sha = git(["rev-parse", "--short=8", "HEAD"]) || "nogit";
  return `${pkg}-${slug}.${sha}`.slice(0, 64);
}

const VERSION = opts.version ?? defaultVersion();
if (!/^[A-Za-z0-9._-]{1,64}$/.test(VERSION)) {
  die(`version 标签不合法（只允许 [A-Za-z0-9._-]，≤64）：${VERSION}`);
}
console.log(
  `环境 ${opts.env}：上传面 ${env.ops} / 访问面 ${env.site}，version=${VERSION}`,
);

// ─── 上传前的公网状态（回滚账：记下这版之前线上是什么） ─────────────────────
try {
  const before = await fetch(`${env.site}/remote/version.txt`, {
    cache: "no-store",
  });
  const body =
    before.status === 200 ? (await before.text()).trim().slice(0, 64) : "";
  console.log(
    `上传前 ${env.site}/remote/version.txt -> ${before.status} ${body}`,
  );
} catch (e) {
  console.log(`上传前 version.txt 探测失败：${e.message}`);
}

// ─── 登录 + 亲和 cookie（凭证不说话） ──────────────────────────────────────
const credsPath = path.join(process.env.HOME, ".wave/neteasecc.json");
if (!fs.existsSync(credsPath)) die(`凭证文件不存在：${credsPath}`);
const creds = JSON.parse(fs.readFileSync(credsPath, "utf8"));

const loginRes = await fetch(`${env.ops}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: creds.email, password: creds.password }),
});
console.log(`登录 -> ${loginRes.status}`);
if (!loginRes.ok) die("登录失败（401 常见原因是密码过期或环境用错）");
const { token } = await loginRes.json();
if (!token) die("登录成功但响应里没有 token");

// ops 多副本，亲和 cookie 决定后续请求落到哪个 pod；缺了可能被拒。
const cookieRes = await fetch(`${env.ops}/api/ops/downloads`, {
  headers: { Authorization: `Bearer ${token}` },
});
const affinity = (cookieRes.headers.getSetCookie?.() ?? [])
  .map((c) => c.split(";")[0])
  .filter((c) => c.startsWith("codechat-ops-route"))
  .join("; ");
console.log(
  `亲和 cookie：${affinity ? `已获取（长度 ${affinity.length}）` : "未获取"}`,
);

if (opts.check) {
  console.log("\n--check：预检通过，未发起上传。");
  process.exit(0);
}

// ─── 上传 ──────────────────────────────────────────────────────────────────
const form = new FormData();
form.append(
  "zip",
  new Blob([buf], { type: "application/zip" }),
  "remote-page.zip",
);
form.append("version", VERSION);

const res = await fetch(`${env.ops}/api/ops/remote-page/upload`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    ...(affinity ? { Cookie: affinity } : {}),
  },
  body: form,
});
console.log(`上传 -> ${res.status}`);
const text = await res.text();
let keys = null;
try {
  const body = JSON.parse(text);
  keys = body.fileKeys ?? body.files ?? body.keys ?? null;
  if (!keys) console.log(`响应（无 fileKeys）：${text.slice(0, 200)}`);
} catch {
  console.log(`响应体 ${text.length} B，首段：${text.slice(0, 120)}`);
}

if (!res.ok) die(`上传失败：HTTP ${res.status}`);
if (keys) {
  // fileKeys = 产物文件数 + 1（version.txt）。
  console.log(`fileKeys ${keys.length} 个（期望 = 文件数 + 1）：`);
  for (const k of keys) console.log("  " + String(k).split("/").pop());
}

console.log(
  `\n完成。手机端刷新即取新构建（入口 no-cache）；回滚账看上方「上传前 version.txt」。`,
);
