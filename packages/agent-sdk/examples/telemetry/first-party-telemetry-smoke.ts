#!/usr/bin/env tsx

/**
 * 首方遥测端到端冒烟：真实 Agent 请求 → 上报测试环境 → 服务端查回对照
 *
 * 三件事：
 *   1. 在一个**临时 git 仓库**里跑真实 Agent 请求（走 {serverUrl}/api/v1 网关，真实计费）
 *   2. 显式打开首方上报通道，把 `wave.*` 指标与事件发到 `{serverUrl}/otel`
 *   3. 调企业端查询接口把数据查回来，逐条对照「本机发出去的」与「服务端看到的」
 *
 * 为什么要临时 git 仓库：`vcs.repository.*` 归属由 `git remote get-url origin` 派生
 * （src/telemetry/attributes.ts），且**默认关闭**。取一个名字唯一的远程地址，既能打开
 * `includeRepository` 验证仓库维度，又不会和真实仓库的数据混在一起。
 *
 * 前提：
 *   - 本机已登录（`~/.wave/auth.json` 里有 SSO_TOKEN）
 *   - 该账号是**企业管理员** —— 上报只要求普通成员，但查询面
 *     （/api/enterprise/telemetry/*）要求 `enterprise_admin`，所以查回对照需要管理员身份
 *   - `WAVE_SERVER_URL` 指向已部署收端的测试环境
 *
 * 用法（在 packages/agent-sdk 下）：
 *   pnpm exec tsx examples/telemetry/first-party-telemetry-smoke.ts
 *   WAVE_SMOKE_VERIFY=0  只发不查（不需要管理员权限）
 *   WAVE_SMOKE_KEEP=1    保留临时仓库，便于人工查看
 *   WAVE_SERVER_URL=...  换环境（默认测试环境）
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { Agent } from "../../src/agent.js";
import { flushTelemetry } from "../../src/telemetry/instrumentation.js";

const execFileAsync = promisify(execFile);

const SERVER_URL =
  process.env.WAVE_SERVER_URL ?? "https://codechat.codewave-test.163yun.com";
const VERIFY = process.env.WAVE_SMOKE_VERIFY !== "0";
const KEEP = process.env.WAVE_SMOKE_KEEP === "1";
/** 显式给了 `WAVE_MODEL` 就用它，否则交给本机配置的默认模型。 */
const MODEL = process.env.WAVE_MODEL;

/** 流式文本的落点：callbacks 在 Agent.create 时就要给定，只能先放一个盒子。 */
const transcript = { value: "" };
/** 供顶层 finally 兜底销毁。 */
let agent: Agent | undefined;

/** 服务端 `/api/enterprise/telemetry/*` 的返回形状（只声明用到的字段）。 */
interface UsageTotals {
  sessions: number;
  requests: number;
  errors: number;
  commits: number;
  pullRequests: number;
  tokens: {
    input: number;
    output: number;
    cache_read: number;
    cache_creation: number;
  };
  lines: { added: number; removed: number };
}

interface Slice {
  key: string;
  totals: UsageTotals;
}

interface Summary {
  totals: UsageTotals;
  byUser: Slice[];
  byRepository: Slice[];
  byModel: Slice[];
}

interface SessionRow {
  sessionId: string;
  userEmail: string;
  repository: string;
  model: string;
}

interface LogRow {
  eventName: string;
}

interface Check {
  label: string;
  pass: boolean;
  detail: string;
}

const step = (text: string): void => console.log(`\n\x1b[1m▸ ${text}\x1b[0m`);
const ok = (text: string): void => console.log(`  \x1b[32m✓\x1b[0m ${text}`);
const bad = (text: string): void => console.log(`  \x1b[31m✗\x1b[0m ${text}`);

/**
 * 建一个临时 git 仓库当 workdir。
 *
 * 远程地址用保留域名 `.invalid`（永远解析不到），路径最后一段带时间戳 —— 服务端把它
 * 折成 `vcs.repository.name`，于是 `byRepository` 里能精确定位到这一次冒烟的数据。
 */
async function makeSandboxRepo(): Promise<{ dir: string; repoName: string }> {
  const dir = await mkdtemp(join(tmpdir(), "wave-otel-smoke-"));
  const repoName = `wave-otel-smoke-${Date.now()}`;
  await execFileAsync("git", ["init", "-q"], { cwd: dir });
  await execFileAsync(
    "git",
    [
      "remote",
      "add",
      "origin",
      `https://gitlab.invalid/wave-smoke/${repoName}.git`,
    ],
    { cwd: dir },
  );
  return { dir, repoName };
}

/** 从 ~/.wave/auth.json 取 SSO token —— 值只在本进程内使用，绝不打印。 */
async function readSsoToken(): Promise<string> {
  const authPath = join(homedir(), ".wave", "auth.json");
  const parsed: unknown = JSON.parse(await readFile(authPath, "utf8"));
  const token =
    typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>).SSO_TOKEN
      : undefined;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error(
      `${authPath} 里没有可用的 SSO_TOKEN —— 先在本机跑一次 wave 登录`,
    );
  }
  return token;
}

async function apiGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(
      `GET ${path} -> ${res.status} ${(await res.text()).slice(0, 200)}`,
    );
  }
  return (await res.json()) as T;
}

/** 两轮真实请求：纯问答产生 api.requests / tokens，写文件才产生 wave.lines.changed。 */
async function sendTurns(current: Agent): Promise<void> {
  const prompts = [
    "用一句中文回答：1+1 等于几？不要调用任何工具。",
    "在当前目录创建 hello.txt，内容为 wave telemetry smoke，然后只回复文件名。",
  ];
  for (const [i, prompt] of prompts.entries()) {
    transcript.value = "";
    step(`第 ${i + 1}/${prompts.length} 轮真实请求`);
    console.log(`  提示词：${prompt}`);
    await current.sendMessage(prompt);
    const reply = transcript.value.trim().replace(/\s+/g, " ");
    console.log(
      `  回复：${reply.length > 160 ? `${reply.slice(0, 160)}…` : reply}`,
    );
  }
}

/** 发数据 +（可选）查回对照，返回没对上的项数。 */
async function run(): Promise<number> {
  console.log(`服务端：${SERVER_URL}`);
  console.log(`模型：${MODEL ?? "(由本机配置决定)"}`);
  console.log(`查回对照：${VERIFY ? "开" : "关（WAVE_SMOKE_VERIFY=0）"}`);

  const { dir: workdir, repoName } = await makeSandboxRepo();
  const checks: Check[] = [];
  let sessionId = "";
  const startedAt = Date.now();

  try {
    step("创建 Agent（打开首方上报 + 仓库归属）");
    agent = await Agent.create({
      serverUrl: SERVER_URL,
      workdir,
      permissionMode: "acceptEdits",
      entrypoint: "cli",
      ...(MODEL ? { model: MODEL } : {}),
      telemetry: {
        // 首方通道现已默认开启；这里显式写上，让冒烟脚本不随默认值变化而变
        firstPartyEnabled: true,
        // vcs.repository.* 默认关闭，打开才能在 byRepository 里看到归属
        includeRepository: true,
      },
      callbacks: {
        onAssistantContentUpdated: ({ chunk }) => {
          transcript.value += chunk;
        },
      },
    });
    sessionId = agent.sessionId;
    ok(`session.id = ${sessionId}`);
    ok(`上报落点 = ${SERVER_URL}/otel`);

    await sendTurns(agent);
    console.log(`\n  临时仓库：${workdir}`);

    step("flush 遥测 → 销毁 Agent");
    await flushTelemetry();
    ok("已 flush");
    await agent.destroy();
    agent = undefined;
    ok("已销毁");
  } catch (error) {
    if (!KEEP)
      await rm(workdir, { recursive: true, force: true }).catch(
        () => undefined,
      );
    throw error;
  }

  console.log(`\n本机侧耗时 ${Date.now() - startedAt} ms`);

  if (!VERIFY) {
    console.log(
      "\n（未开启查回对照；数据已上报，可在企业端「研发效能」页面查看）",
    );
    if (!KEEP)
      await rm(workdir, { recursive: true, force: true }).catch(
        () => undefined,
      );
    return 0;
  }

  // ── 以下是服务端对照，走 codechat 企业端接口，仅测试环境可用 ──
  step("等服务端落库…");
  await new Promise((resolve) => setTimeout(resolve, 3_000));

  const token = await readSsoToken();
  const from = new Date(startedAt - 120_000).toISOString();
  const to = new Date(Date.now() + 60_000).toISOString();
  const range = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

  step("查回：会话列表（按 session.id 精确定位）");
  const sessions = await apiGet<{ sessions: SessionRow[] }>(
    `/api/enterprise/telemetry/sessions?${range}&limit=200`,
    token,
  );
  const mine = sessions.sessions.find((s) => s.sessionId === sessionId);
  checks.push({
    label: "本次 session 出现在 /sessions",
    pass: mine !== undefined,
    detail: mine
      ? `userEmail=${mine.userEmail} · model=${mine.model} · repository=${mine.repository || "(空)"}`
      : `未找到 ${sessionId}`,
  });

  step("查回：本会话的事件流");
  const logs = await apiGet<{ logs: LogRow[] }>(
    `/api/enterprise/telemetry/logs?${range}&sessionId=${encodeURIComponent(sessionId)}&limit=200`,
    token,
  );
  const counts = new Map<string, number>();
  for (const row of logs.logs) {
    counts.set(row.eventName, (counts.get(row.eventName) ?? 0) + 1);
  }
  checks.push({
    label: "事件流里有 session_start / user_prompt",
    pass: counts.has("session_start") && counts.has("user_prompt"),
    detail:
      [...counts.entries()].map(([name, n]) => `${name}×${n}`).join(" ") ||
      "(无事件)",
  });

  step("查回：按模型 / 按仓库 / 按用户切片");
  const summary = await apiGet<Summary>(
    `/api/enterprise/telemetry/summary?${range}`,
    token,
  );
  const modelSlice = summary.byModel.find((s) => s.key === mine?.model);
  const repoSlice = summary.byRepository.find((s) => s.key === repoName);
  const userSlice = summary.byUser.find((s) => s.key === mine?.userEmail);

  checks.push({
    label: `byRepository 里出现本次临时仓库 ${repoName}`,
    pass: repoSlice !== undefined,
    detail: repoSlice
      ? `requests=${repoSlice.totals.requests} lines=+${repoSlice.totals.lines.added}/-${repoSlice.totals.lines.removed}`
      : `未找到；现有仓库切片：${summary.byRepository.map((s) => s.key).join(", ") || "(空)"}`,
  });

  // a59e5c0「按模型表只列有归属的指标」的口径：模型维度不该出现 commits / PR / 行数
  const outputMetrics = modelSlice
    ? modelSlice.totals.commits +
      modelSlice.totals.pullRequests +
      modelSlice.totals.lines.added +
      modelSlice.totals.lines.removed
    : -1;
  checks.push({
    label: "byModel 不含 commits / PR / 行数（归属口径）",
    pass: modelSlice !== undefined && outputMetrics === 0,
    detail: modelSlice
      ? `requests=${modelSlice.totals.requests} errors=${modelSlice.totals.errors} tokens.in=${modelSlice.totals.tokens.input} commits=${modelSlice.totals.commits} pr=${modelSlice.totals.pullRequests}`
      : `未找到模型切片 ${mine?.model ?? "(未知)"}`,
  });

  checks.push({
    label: "byUser 里有本次请求，且行数落在用户维度",
    pass: userSlice !== undefined && userSlice.totals.requests > 0,
    detail: userSlice
      ? `requests=${userSlice.totals.requests} lines=+${userSlice.totals.lines.added}/-${userSlice.totals.lines.removed}`
      : `未找到用户切片 ${mine?.userEmail ?? "(未知)"}`,
  });

  console.log("\n" + "─".repeat(72));
  for (const check of checks)
    (check.pass ? ok : bad)(`${check.label} — ${check.detail}`);
  const failed = checks.filter((check) => !check.pass).length;
  console.log("─".repeat(72));
  console.log(
    failed === 0
      ? "\x1b[32m链路通畅：本机发出的数据在服务端都能查到，且归属口径正确。\x1b[0m"
      : `\x1b[31m有 ${failed} 项没对上 —— 若事件流为空，先确认服务端镜像版本已包含 otel intake。\x1b[0m`,
  );

  if (!KEEP)
    await rm(workdir, { recursive: true, force: true }).catch(() => undefined);
  return failed;
}

run()
  .then((failed) => {
    process.exitCode = failed > 0 ? 1 : 0;
  })
  .catch((error) => {
    console.error("\n💥 冒烟失败：", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (agent) await agent.destroy().catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  });
