#!/usr/bin/env tsx

/**
 * Artifact 工具「分享状态文案」端到端示例（真实服务端，不走模型）
 *
 * 目的：分享文案的输入是**服务端返回的 `perm`**，而 `perm` 的真实形状
 * （`mode` / `role` 到底给不给、给哪些值）只有真机能证。本示例把每一步模型
 * 实际看到的内容原样打印，并把元数据探针的原始 JSON 一并打出来对账。
 *
 * 覆盖链路：
 * 1. `publish` 新页面 → 文案应说明「私有、别人打不开」+ 固定句
 * 2. 原始元数据探针（`?via=model_read`）→ 打印真实 `perm`，并用
 *    `formatArtifactSharing` 单独渲染一次做对照
 * 3. `read` 读回 → 文案应与 publish 的那一行**逐字一致**
 * 4. 带 `url` 重发布 → 仍走探测路径，文案不得退化成「你是读者」
 * 5. `list scope: all` → 若账号里有他人分享 artifact，就读一篇，验证读者文案
 * 6. 收尾：打印服务端留下的 artifact（工具没有删除动作，这是真实限制）
 *
 * 前置条件：
 * - 已登录（~/.wave/auth.json 存在有效 SSO token）
 * - 服务端地址已配置：WAVE_SERVER_URL 环境变量（或走默认值）
 *
 * 运行：
 *   cd packages/agent-sdk && pnpm exec tsx examples/tools/artifact-sharing-demo.ts
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import { artifactTool } from "../../src/tools/artifactTool.js";
import { authService } from "../../src/services/authService.js";
import {
  fetchFrameMeta,
  formatArtifactSharing,
} from "../../src/services/artifactContent.js";
import { clearArtifactSession } from "../../src/services/artifactSession.js";
import type { ToolContext, ToolResult } from "../../src/tools/types.js";

const SESSION_ID = `artifact-sharing-demo-${process.pid}`;
const READONLY_NOTE =
  "You cannot change sharing; that is done from the page's Share menu.";

let failures = 0;

/** 打印模型实际看到的工具结果。 */
function show(label: string, result: ToolResult) {
  const status = result.success ? "OK  " : "FAIL";
  console.log(`\n${"─".repeat(72)}\n[${status}] ${label}`);
  if (result.shortResult) console.log(`  shortResult: ${result.shortResult}`);
  if (result.error) console.log(`  error: ${result.error}`);
  if (result.content) {
    console.log(
      result.content
        .split("\n")
        .map((line) => `  | ${line}`)
        .join("\n"),
    );
  }
  return result;
}

/** 断言成功；失败则计入统计并继续，方便一次跑完看到全貌。 */
function expectSuccess(label: string, result: ToolResult): ToolResult {
  if (!result.success) {
    failures++;
    console.log(
      `  ✗ ${label}：期望成功，但失败了 → ${result.error ?? "(无 error)"}`,
    );
  }
  return result;
}

/** 取结果里的分享块（`Sharing:` 行 + 紧随其后的固定句），没有则 null。 */
function sharingBlock(content: string | undefined): string | null {
  return (
    /^Sharing:[^\n]*\nYou cannot change sharing;[^\n]*$/m.exec(
      content ?? "",
    )?.[0] ?? null
  );
}

/** 断言分享块存在且包含给定片段。 */
function expectSharing(
  label: string,
  result: ToolResult,
  mustContain: string,
): string | null {
  const block = sharingBlock(result.content);
  if (!block) {
    failures++;
    console.log(`  ✗ ${label}：结果里没有分享块`);
    return null;
  }
  if (!block.includes(mustContain)) {
    failures++;
    console.log(`  ✗ ${label}：分享块里没有「${mustContain}」`);
  }
  if (!block.includes(READONLY_NOTE)) {
    failures++;
    console.log(`  ✗ ${label}：分享块没有以固定句收尾`);
  }
  return block;
}

/**
 * 最小可用的 ToolContext：权限管理器只做两件事——把确认文案打印出来（模拟用户在
 * CLI 看到的确认框），以及按 workdir 判断可读区（两种拼写都放行，与工具真机口径一致）。
 */
function makeContext(workdir: string): ToolContext {
  let confirmations = 0;
  const permissionContext = { warning: "", hidePersistentOption: false };
  const permissionManager = {
    createContext: () => permissionContext,
    checkPermission: async () => {
      confirmations++;
      console.log(
        `\n  ⚠ 需要确认 #${confirmations}` +
          (permissionContext.warning
            ? `（隐藏「始终允许」）: ${permissionContext.warning}`
            : "（publish）"),
      );
      return { behavior: "allow" as const };
    },
    isPathInSafeZone: (target: string) => target.startsWith(workdir),
  };
  return {
    workdir,
    sessionId: SESSION_ID,
    permissionMode: "default",
    toolCallId: "demo-tool-call",
    permissionManager:
      permissionManager as unknown as ToolContext["permissionManager"],
    // 读者路径会走「小模型摘要」；示例不打真模型，给它一个固定答案，
    // 这样分享块与摘要的拼接顺序也能在真机路径上看到。
    aiManager: {
      getModelConfig: () => ({ model: "stub-model", fastModel: "stub-fast" }),
      getGatewayConfig: () => ({ apiKey: "stub-key" }),
    },
    aiService: {
      processWebContent: async () => ({ content: "(stub summary)" }),
    },
  } as unknown as ToolContext;
}

async function main() {
  console.log(`Server: ${authService.getServerUrl()}`);
  console.log(
    `Logged in: ${authService.getSSOToken() ? "yes" : "NO — run /login first"}`,
  );
  if (!authService.getSSOToken()) process.exit(1);

  clearArtifactSession(SESSION_ID);

  const workdir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wave-artifact-sharing-"),
  );
  const context = makeContext(workdir);
  console.log(`Workdir: ${workdir}`);

  await fs.writeFile(
    path.join(workdir, "sharing-page.html"),
    "<!DOCTYPE html><html><head><title>Sharing demo</title></head><body><h1>Sharing demo</h1></body></html>",
  );

  try {
    // 1. 首次发布：新 artifact 服务端必然私有，无需探测就该说出来
    const published = expectSuccess(
      "publish sharing-page.html",
      await artifactTool.execute({ file_path: "sharing-page.html" }, context),
    );
    show("publish sharing-page.html", published);
    const publishBlock = expectSharing(
      "publish",
      published,
      "private — only you can open it",
    );

    const url = /https?:\/\/\S+/.exec(published.content ?? "")?.[0] ?? "";
    if (!url) throw new Error("publish 未返回 URL，后续步骤无法继续");
    const slug = url.split("/").pop() ?? "";

    // 2. 原始元数据探针：把服务端真实返回的 perm 打出来对账
    const meta = await fetchFrameMeta(slug);
    console.log(
      `\n${"─".repeat(72)}\n元数据探针 GET /api/frame/${slug}?via=model_read`,
    );
    if (meta.kind === "error") {
      failures++;
      console.log(`  ✗ 探针失败: ${meta.error}`);
    } else {
      console.log(`  perm: ${JSON.stringify(meta.meta.perm ?? null)}`);
      console.log(`  version: ${JSON.stringify(meta.meta.version ?? null)}`);
      console.log(
        `  formatArtifactSharing(meta):\n${String(
          formatArtifactSharing(meta.meta),
        )
          .split("\n")
          .map((line) => `    ${line}`)
          .join("\n")}`,
      );
    }

    // 3. 读回：文案必须与 publish 的那一行逐字一致
    const read = expectSuccess(
      "read（自有 artifact）",
      await artifactTool.execute({ action: "read", url }, context),
    );
    show(`read ${slug}`, read);
    const readBlock = expectSharing(
      "read",
      read,
      "private — only you can open it",
    );
    if (publishBlock && readBlock && publishBlock !== readBlock) {
      failures++;
      console.log(
        `  ✗ publish 与 read 的分享块不一致:\n    publish: ${JSON.stringify(publishBlock)}\n    read:    ${JSON.stringify(readBlock)}`,
      );
    }
    if (!(read.content ?? "").includes("<h1>Sharing demo</h1>")) {
      failures++;
      console.log("  ✗ read 没有返回原文 HTML");
    }

    // 4. 带 url 重发布：走探测路径，文案不得退化成读者口径
    const redeployed = expectSuccess(
      "redeploy（带 url）",
      await artifactTool.execute(
        { file_path: "sharing-page.html", url },
        context,
      ),
    );
    show(`redeploy ${slug}`, redeployed);
    const redeployBlock = expectSharing(
      "redeploy",
      redeployed,
      "private — only you can open it",
    );
    if ((redeployed.content ?? "").includes("you are a reader")) {
      failures++;
      console.log("  ✗ redeploy 把自己误报成了读者");
    }

    // 5. 找一篇他人分享的 artifact，验证读者文案（账号里没有就如实说明）
    const all = expectSuccess(
      "list scope: all",
      await artifactTool.execute(
        { action: "list", scope: "all", limit: 50 },
        context,
      ),
    );
    show("list（scope: all, limit: 50）", all);
    const sharedUrl =
      /https?:\/\/\S+\/code\/artifact\/\S+/.exec(
        (all.content ?? "").split("\n(shared)")[1] ?? "",
      )?.[0] ?? "";
    if (sharedUrl) {
      const sharedSlug = sharedUrl.split("/").pop() ?? "";
      const sharedMeta = await fetchFrameMeta(sharedSlug);
      console.log(`\n${"─".repeat(72)}\n元数据探针（他人分享）${sharedSlug}`);
      console.log(
        sharedMeta.kind === "ok"
          ? `  perm: ${JSON.stringify(sharedMeta.meta.perm ?? null)}\n  formatArtifactSharing(meta):\n${String(
              formatArtifactSharing(sharedMeta.meta),
            )
              .split("\n")
              .map((line) => `    ${line}`)
              .join("\n")}`
          : `  ✗ 探针失败: ${sharedMeta.error}`,
      );
      const sharedRead = show(
        `read ${sharedUrl}（他人分享）`,
        await artifactTool.execute(
          {
            action: "read",
            url: sharedUrl,
            prompt: "How is this page structured?",
          },
          context,
        ),
      );
      expectSharing(
        "read（他人分享）",
        sharedRead,
        "shared with you by someone else",
      );
      if (
        !(sharedRead.content ?? "").includes(
          "this session can never publish to it",
        )
      ) {
        failures++;
        console.log("  ✗ 读者文案没有说明本会话不能发布到它");
      }
    } else {
      console.log(
        "\n  提示：账号里没有他人分享的 artifact，读者口径只由单测覆盖（无法用工具造出分享）",
      );
    }

    console.log(
      `\n${"─".repeat(72)}\n服务端会留下本次发布的 artifact（工具没有删除动作，这是真实限制）：\n  ${url}\n  read 分享块: ${JSON.stringify(readBlock)}\n  redeploy 分享块: ${JSON.stringify(redeployBlock)}`,
    );
  } finally {
    await fs.rm(workdir, { recursive: true, force: true });
    clearArtifactSession(SESSION_ID);
  }

  console.log(
    `\n${failures === 0 ? "全部通过" : `${failures} 处不符合预期`}（临时目录已清理）`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
