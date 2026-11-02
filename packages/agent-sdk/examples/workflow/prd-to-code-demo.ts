#!/usr/bin/env tsx

import fs from "fs/promises";
import path from "path";
import os from "os";
import { Agent } from "../../src/agent.js";

/**
 * PRD → code demo — one prompt, one dynamic workflow run.
 *
 * Writes a small product spec into a temp dir, then hands the agent a single
 * prompt that asks it to: (1) split the spec into numbered requirements,
 * (2) stand up the skeleton, (3) implement each requirement with a Workflow,
 * (4) report a done / not-done table.
 *
 * Run: pnpm exec tsx examples/workflow/prd-to-code-demo.ts
 * The generated project is left on disk — the point of the demo is to look at it.
 */

const PRD = `# 社区图书角借阅服务 v1

技术约束：Node.js 原生 ESM，零第三方依赖。

## 接口
1. 登录：POST /auth/login，body {username}，返回 {token}。预置 alice / bob / admin（admin 是管理员）。
   除登录外，所有 /api 接口都要 Authorization: Bearer token。
2. 图书列表：GET /api/books，支持 q 按标题不区分大小写过滤，支持 page / pageSize
   （默认 1 和 10，pageSize 最多 50），返回 {items, total}。
3. 录入图书：POST /api/books，body {title, author}，仅管理员可用。
4. 借书：POST /api/loans，body {bookId}，返回借阅记录（id / bookId / borrowedAt / dueDate / returnedAt）。
5. 还书：POST /api/loans/{id}/return。
6. 借阅列表：GET /api/loans，返回 {items}，每条带 overdue 布尔。

## 业务规则
7. 借期默认 14 天，可用环境变量 LOAN_DAYS 覆盖。
8. 每人最多同时借 5 本。
9. 已被借走的书不能再借；不能还别人的借阅；重复还书要被挡住。
10. 当天到期不算逾期。

## 通用
11. 端口默认 8787，可用 PORT 覆盖；配置值非法时回落默认并打一条 WARN，不能起不来。
12. 数据落盘，重启后图书和借阅记录都还在。
13. 出错统一返回 {error: {code, message}}，message 用中文；5xx 不暴露堆栈。
14. 每个请求打一行日志（方法、路径、状态码、耗时）。
`;

function buildPrompt(prdPath: string, appDir: string) {
  return [
    `这是从 0 到 1 的新项目，不是改现有仓库：Node.js 22 原生 ESM，零第三方依赖；`,
    `目标目录 ${appDir}；需求稿在 ${prdPath}。`,
    ``,
    `1. 先读完整份需求稿，把功能拆成编号清单（一条一句话，可验证）。`,
    `2. 搭好项目骨架和公共部分（配置、错误处理、公共组件、鉴权这类），保证能跑起来。`,
    `3. 用 dynamic workflow（Workflow 工具）把清单逐条落成代码：一条需求一个 agent，用 pipeline 跑；`,
    `   同一个文件的多条需求按顺序串行，别让多个 agent 并发改同一个文件。`,
    `4. 跑完给我一张表：每条需求 → 已实现 / 未实现 / 为什么没实现，未实现的逐条说理由。`,
  ].join("\n");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The agent starts the workflow in the background, so poll `getWorkflowRuns()`
 * until everything it started has settled. Returns once no run is active, or
 * after the timeout — whichever comes first.
 */
async function waitForWorkflows(
  agent: Awaited<ReturnType<typeof Agent.create>>,
  timeoutMs = 25 * 60 * 1000,
) {
  const started = Date.now();
  let seen = 0;
  while (Date.now() - started < timeoutMs) {
    const runs = await agent.getWorkflowRuns();
    seen = Math.max(seen, runs.length);
    const active = runs.filter(
      (run) => run.status === "running" || run.status === "paused",
    );
    if (seen > 0 && active.length === 0) {
      console.log(
        `\n[workflow] 全部结束，用时 ${Math.round((Date.now() - started) / 1000)}s`,
      );
      return runs;
    }
    if (seen === 0 && Date.now() - started > 120000) {
      console.log("\n[workflow] 等了 120s 还没起来，按当前状态继续");
      return runs;
    }
    await sleep(5000);
  }
  console.log("\n[workflow] 等待超时，按当前状态收尾");
  return agent.getWorkflowRuns();
}

async function main() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wave-prd-to-code-"));
  const prdPath = path.join(tempDir, "PRD.md");
  const appDir = path.join(tempDir, "app");
  await fs.writeFile(prdPath, PRD);
  await fs.mkdir(appDir, { recursive: true });

  console.log(`Spec:  ${prdPath}`);
  console.log(`App:   ${appDir}\n`);

  const agent = await Agent.create({
    workdir: tempDir,
    // The whole point is letting it write files and run them unattended.
    permissionMode: "bypassPermissions",
    callbacks: {
      onAssistantContentUpdated: (params) => {
        process.stdout.write(params.chunk);
      },
      onToolBlockUpdated: (params) => {
        if (params.stage === "start") {
          console.log(`\n[Tool: ${params.name}]`);
        }
        if (params.stage === "end" && params.shortResult) {
          console.log(`  -> ${params.shortResult}`);
        }
      },
    },
  });

  try {
    await agent.sendMessage(buildPrompt(prdPath, appDir));

    // The workflow runs in the background. Wait for it by watching its real
    // status instead of guessing a duration — a 19-requirement run takes far
    // longer than a fixed sleep, and cutting it short leaves half a project.
    const runs = await waitForWorkflows(agent);
    for (const run of runs) {
      console.log(
        `\n[workflow] ${run.meta.name} (${run.runId}) → ${run.status}`,
      );
    }
    if (runs.length === 0) {
      console.log("\n[workflow] 没有检测到 workflow 运行记录，直接要结论");
    }

    await agent.sendMessage(
      "Workflow 跑完了吗？跑完了就按第 4 步给我那张表；没跑完就说还差哪几条。",
    );
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await agent.destroy();
    console.log(`\n--- generated project kept at ${appDir} ---`);
    process.exit(0);
  }
}

process.on("SIGINT", async () => {
  process.exit(0);
});
process.on("SIGTERM", async () => {
  process.exit(0);
});

main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
