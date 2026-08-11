#!/usr/bin/env tsx

/**
 * Artifact 工具端到端示例（真实服务端）
 *
 * 覆盖链路：
 * 1. 发布本地 .md 文件为 artifact（Artifact 工具，POST /api/frame/deploy/direct）
 * 2. 从会话消息历史中提取发布 URL
 * 3. 直接校验 artifact 内容可读（GET /api/frame/{slug}/content?v={version}）
 * 4. WebFetch 拦截读取 artifact URL（via=model_read 专用通道）
 * 5. 同一会话重新发布（版本升级，自动允许不弹确认）
 *
 * 前置条件：
 * - 已登录（~/.wave/auth.json 存在有效 SSO token）
 * - 已配置服务端地址：WAVE_SERVER_URL 环境变量（或 settings.json env），
 *   例如 https://codechat.codewave-test.163yun.com
 * - 服务端 frame 后端已上线（POST /api/frame/deploy/direct 可用）
 *
 * 运行：
 *   cd packages/agent-sdk && pnpm exec tsx examples/tools/artifact-demo.ts
 */

import fs from "fs/promises";
import path from "path";
import os from "os";
import { Agent } from "../../src/agent.js";
import {
  authService,
  createAuthAwareFetch,
} from "../../src/services/authService.js";
import type { Message, ToolBlock } from "../../src/types/messaging.js";
import { ARTIFACT_TOOL_NAME } from "../../src/constants/tools.js";

// Use WAVE_FAST_MODEL for cheaper and faster testing
process.env.WAVE_MODEL = process.env.WAVE_FAST_MODEL;

let tempDir: string;
let agent: Agent;

/** 从消息历史中提取最近一次成功的 Artifact 工具调用结果。 */
function findArtifactResult(messages: Message[]): ToolBlock | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const block = messages[i].blocks.find(
      (b): b is ToolBlock =>
        b.type === "tool" &&
        b.name === "Artifact" &&
        b.stage === "end" &&
        b.success === true,
    );
    if (block) return block;
  }
  return undefined;
}

/** 从 Artifact 工具结果中提取 artifact URL。 */
function extractArtifactUrl(result: ToolBlock): string | null {
  const text = `${result.shortResult || ""}\n${result.result || ""}`;
  const match = text.match(/https?:\/\/[^\s]+\/code\/artifact\/[^\s]+/);
  return match ? match[0] : null;
}

/** 从 artifact URL 提取 slug（{host}/code/artifact/{slug}）。 */
function extractSlug(url: string): string | null {
  try {
    const match = new URL(url).pathname.match(/^\/code\/artifact\/([^/]+)\/?$/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

async function setupTest() {
  // 创建临时目录作为工作目录
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "artifact-demo-"));
  console.log(`📁 Created temporary directory: ${tempDir}`);

  // 项目级 settings.json 开启 Artifact（未设置时跟随代码默认值，当前默认禁用）
  await fs.mkdir(path.join(tempDir, ".wave"), { recursive: true });
  await fs.writeFile(
    path.join(tempDir, ".wave", "settings.json"),
    JSON.stringify({ enableArtifact: true }, null, 2),
  );

  // 创建要发布的 Markdown 文件
  const md = `# Wave Artifact Demo

This page was published by the **Artifact tool** end-to-end example.

- Supports Markdown rendering
- Private by default
- Redeployable in the same session

\`\`\`ts
const published = await artifactTool.execute(...);
\`\`\`
`;
  await fs.writeFile(path.join(tempDir, "guide.md"), md, "utf-8");
  console.log(`📝 Created guide.md (${md.length} chars)`);

  if (!authService.getSSOToken()) {
    throw new Error(
      "Not authenticated — run /login first, or ensure ~/.wave/auth.json has a valid token.",
    );
  }
  console.log(`🔑 Authenticated. Server: ${authService.getServerUrl()}`);

  // 创建 Agent
  agent = await Agent.create({
    workdir: tempDir,
    model: process.env.WAVE_FAST_MODEL,
    permissionMode: "bypassPermissions", // 示例自动运行，跳过确认弹窗
    callbacks: {
      onAssistantContentUpdated: (params: { chunk: string }) => {
        process.stdout.write(params.chunk);
      },
      onToolBlockUpdated: (params) => {
        if (params.stage === "start") {
          console.log(`\n🔧 Calling tool ${params.name}...`);
        } else if (params.stage === "end") {
          if (params.success) {
            console.log(`\n✅ Tool ${params.name} succeeded`);
          } else {
            console.log(`\n❌ Tool ${params.name} failed: ${params.error}`);
          }
        }
      },
    },
  });

  // 确认 Artifact 工具已注册（enableArtifact 生效）
  const available = agent.getAvailableToolNames();
  if (!available.includes(ARTIFACT_TOOL_NAME)) {
    throw new Error(
      `Artifact tool is NOT registered. Available tools: ${available.join(", ")}.\n` +
        "Check that the project .wave/settings.json contains enableArtifact: true.",
    );
  }
  console.log(`🧩 Artifact tool registered (${available.length} tools total)`);
}

async function runTest() {
  // ---- 1. 发布 ----
  console.log("\n💬 Step 1: Publishing guide.md as an artifact...");
  await agent.sendMessage(
    'You MUST call the Artifact tool directly with file_path="guide.md" and favicon="📘". ' +
      "The Artifact tool is already registered and is the ONLY acceptable way to publish. " +
      "Do NOT use Bash, curl, Read, Write, or any other tool to publish the file. " +
      "After the Artifact tool returns, report the URL it returned.",
  );

  const publishResult = findArtifactResult(agent.messages);
  const publishUrl = publishResult ? extractArtifactUrl(publishResult) : null;
  if (!publishUrl) {
    throw new Error(
      "Failed to extract artifact URL from tool result.\n" +
        `Tool result: ${JSON.stringify(publishResult?.result || publishResult?.shortResult || publishResult?.error)}`,
    );
  }
  console.log(`🔗 Published artifact URL: ${publishUrl}`);

  const slug = extractSlug(publishUrl);
  if (!slug) throw new Error(`Cannot parse slug from URL: ${publishUrl}`);

  // ---- 2. 直接校验内容可读 ----
  console.log("\n💬 Step 2: Verifying artifact content is readable...");
  const authFetch = createAuthAwareFetch(globalThis.fetch);
  const serverUrl = authService.getServerUrl();
  const metaRes = await authFetch(
    `${serverUrl}/api/frame/${encodeURIComponent(slug)}?via=model_read`,
    { method: "GET" },
  );
  if (!metaRes.ok) {
    throw new Error(`Metadata probe failed: HTTP ${metaRes.status}`);
  }
  const meta = (await metaRes.json()) as {
    version: number;
    contentUrl?: string;
    perm?: { mode: string };
  };
  console.log(`   Metadata: version=${meta.version}, perm=${meta.perm?.mode}`);
  if (!meta.contentUrl) throw new Error("Metadata missing contentUrl");

  const contentRes = await authFetch(meta.contentUrl, { method: "GET" });
  if (!contentRes.ok) {
    throw new Error(`Content fetch failed: HTTP ${contentRes.status}`);
  }
  const html = await contentRes.text();
  if (!html.includes("Wave Artifact Demo") || !html.includes("<h1>")) {
    throw new Error("Published content does not match the source markdown");
  }
  console.log(`   Content OK (${html.length} bytes, contains title + <h1>)`);

  // ---- 3. WebFetch 拦截读取 artifact URL ----
  console.log("\n💬 Step 3: WebFetch reading the artifact URL...");
  await agent.sendMessage(
    `You MUST use the WebFetch tool to fetch ${publishUrl} and tell me what the artifact page contains. ` +
      "Do NOT use Bash or curl — WebFetch is the only acceptable way to read the page.",
  );

  // ---- 4. 同一会话重新发布 ----
  console.log("\n💬 Step 4: Republishing with updated content...");
  const updated = `# Wave Artifact Demo v2

Updated in the same session — the version should bump and the old URL stays valid.
`;
  await fs.writeFile(path.join(tempDir, "guide.md"), updated, "utf-8");
  await agent.sendMessage(
    `You MUST call the Artifact tool directly to republish "guide.md" to the same artifact URL: ${publishUrl}. ` +
      "The Artifact tool is the ONLY acceptable way to republish — do NOT use Bash, curl, Read, Write, or any other tool. " +
      "After the Artifact tool returns, report the URL it returned.",
  );

  const redeployResult = findArtifactResult(agent.messages);
  const redeployUrl = redeployResult
    ? extractArtifactUrl(redeployResult)
    : null;
  if (!redeployUrl) {
    throw new Error(
      "Failed to extract redeploy URL from tool result.\n" +
        `Tool result: ${JSON.stringify(redeployResult?.result || redeployResult?.shortResult || redeployResult?.error)}`,
    );
  }
  console.log(`🔗 Redeployed artifact URL: ${redeployUrl}`);
  if (redeployUrl !== publishUrl) {
    throw new Error(
      `Redeploy URL mismatch: expected ${publishUrl}, got ${redeployUrl}`,
    );
  }

  // 校验版本升级 + 新内容
  const metaRes2 = await authFetch(
    `${serverUrl}/api/frame/${encodeURIComponent(slug)}?via=model_read`,
    { method: "GET" },
  );
  const meta2 = (await metaRes2.json()) as {
    version: number;
    contentUrl?: string;
  };
  if (meta2.version <= meta.version) {
    throw new Error(
      `Version did not bump: expected > ${meta.version}, got ${meta2.version}`,
    );
  }
  console.log(`   Version bumped: ${meta.version} → ${meta2.version}`);

  const contentRes2 = await authFetch(meta2.contentUrl!, { method: "GET" });
  const html2 = await contentRes2.text();
  if (!html2.includes("v2")) {
    throw new Error("Redeployed content does not contain the updated text");
  }
  console.log(`   Redeployed content OK (${html2.length} bytes)`);

  console.log("\n🎉 All artifact checks passed!");
}

async function cleanup() {
  console.log("\n🧹 Cleaning up...");
  try {
    if (agent) {
      await agent.destroy();
      console.log("✅ Agent cleaned up");
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      console.log(`🗑️ Cleaned up temporary directory: ${tempDir}`);
    }
  } catch (cleanupError) {
    console.error("❌ Cleanup failed:", cleanupError);
  }
}

async function main() {
  try {
    await setupTest();
    await runTest();
  } catch (error) {
    console.error("❌ Test failed:", error);
  } finally {
    await cleanup();
    console.log("👋 Done!");
    process.exit(0);
  }
}

// Handle process exit
process.on("SIGINT", async () => {
  console.log("\n\n🛑 Received SIGINT, cleaning up...");
  await cleanup();
  process.exit(0);
});

// Run main function
main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Unhandled error:", error);
    process.exit(1);
  });
