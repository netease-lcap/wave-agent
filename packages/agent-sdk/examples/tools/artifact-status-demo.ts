#!/usr/bin/env tsx

/**
 * Artifact 工具 `status` 动作端到端示例（真实服务端 + 真实模型）
 *
 * 目的：`status` 是"模型自己查监听状态"的入口，它的价值不在于接口能不能通，
 * 而在于**模型会不会用它**、以及**它报出来的东西模型读得懂读不懂**。所以本
 * 示例全程用自然语言发起（不写 MUST / ONLY 强推工具），让模型自己选路；选错
 * 或答错就抛错——那本身就是「顺不顺」的结论。
 *
 * 覆盖链路：
 * 1. 什么都没监听时问「你在监听哪些页面」→ 模型应调 `status` 并答"没有"
 * 2. 发布一个页面并让它 watch → `watching`（或 `connecting`）
 * 3. watch 一个**不存在的 slug** → 服务端 404，管理器把该条目留在表里标 `stopped`
 * 4. 再问「哪条监听有问题」→ `status` 应同时报出 `watching` 与 `stopped`，
 *    并说出 stopped 的原因（404）与恢复路径（重新 watch）
 * 5. unwatch 真页面后再问 → 只剩那条 `stopped`
 *
 * 第 3~4 步是本示例的重点：`stopped` 的条目仍然在监听表里，此时重发一次
 * `watch` 会重建流并回报"已开始监听"，模型若拿它当探测就会误判成"我之前从没
 * 监听"。`status` 必须把这件事说清楚。
 *
 * 前置条件：
 * - 已登录（~/.wave/auth.json 存在有效 SSO token）
 * - 服务端地址已配置：WAVE_SERVER_URL 环境变量（或走默认值）
 *
 * 注意：每跑一次会在账号里真实发布一个 artifact，而 Artifact 工具没有删除动作
 * （与 artifact-sharing-demo 同一限制）。
 *
 * 运行：
 *   cd packages/agent-sdk && pnpm exec tsx examples/tools/artifact-status-demo.ts
 */

import fs from "fs/promises";
import path from "path";
import os from "os";
import { Agent } from "../../src/agent.js";
import { authService } from "../../src/services/authService.js";
import type { Message, ToolBlock } from "../../src/types/messaging.js";
import { ARTIFACT_TOOL_NAME } from "../../src/constants/tools.js";

let tempDir: string;
let agent: Agent;

/** 消息区间里所有成功的 Artifact 工具调用（按时间顺序）。 */
function artifactBlocks(messages: Message[]): ToolBlock[] {
  const blocks: ToolBlock[] = [];
  for (const message of messages) {
    for (const block of message.blocks) {
      if (
        block.type === "tool" &&
        block.name === ARTIFACT_TOOL_NAME &&
        block.stage === "end"
      ) {
        blocks.push(block);
      }
    }
  }
  return blocks;
}

function blockText(block: ToolBlock): string {
  return `${block.shortResult || ""}\n${block.result || ""}`;
}

/**
 * The `status` receipt, recognised by its own opening line. Rendering is what
 * the model reads, so the probe keys on it rather than on the action argument
 * (tool blocks do not carry the arguments).
 */
function statusBlocks(messages: Message[]): ToolBlock[] {
  return artifactBlocks(messages).filter((block) => {
    const text = blockText(block);
    return (
      text.includes("Comment watches in this session") ||
      text.includes("Not watching any pages")
    );
  });
}

function extractArtifactUrl(block: ToolBlock): string | null {
  const match = blockText(block).match(
    /https?:\/\/[^\s]+\/code\/artifact\/[^\s]+/,
  );
  return match ? match[0] : null;
}

async function setupTest() {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "artifact-status-demo-"));
  console.log(`📁 Created temporary directory: ${tempDir}`);

  await fs.mkdir(path.join(tempDir, ".wave"), { recursive: true });
  await fs.writeFile(
    path.join(tempDir, ".wave", "settings.json"),
    JSON.stringify({ enableArtifact: true }, null, 2),
  );

  const md = `# Wave Artifact Status Demo

This page exists so the demo has something real to watch.
`;
  await fs.writeFile(path.join(tempDir, "guide.md"), md, "utf-8");
  console.log(`📝 Created guide.md (${md.length} chars)`);

  if (!authService.getSSOToken()) {
    throw new Error(
      "Not authenticated — run /login first, or ensure ~/.wave/auth.json has a valid token.",
    );
  }
  console.log(`🔑 Authenticated. Server: ${authService.getServerUrl()}`);

  agent = await Agent.create({
    workdir: tempDir,
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

  const available = agent.getAvailableToolNames();
  if (!available.includes(ARTIFACT_TOOL_NAME)) {
    throw new Error(
      `Artifact tool is NOT registered. Available tools: ${available.join(", ")}.`,
    );
  }
  console.log(`🧩 Artifact tool registered (${available.length} tools total)`);
}

async function runTest() {
  const serverUrl = authService.getServerUrl();
  const missingUrl = `${serverUrl}/code/artifact/wave-status-demo-missing-${process.pid}`;

  // ---- 1. 什么都没监听 ----
  console.log(
    "\n💬 Step 1: Asking what is being watched before anything is watched...",
  );
  const beforeFirst = agent.messages.length;
  await agent.sendMessage(
    "你现在正在监听哪些 artifact 页面的评论？如果一条都没有，直接说没有就行。",
  );
  const firstStatus = statusBlocks(agent.messages.slice(beforeFirst)).pop();
  if (!firstStatus) {
    throw new Error(
      "模型没有用 Artifact(action=status) 回答这个问题（可能凭记忆作答了）。",
    );
  }
  if (!blockText(firstStatus).includes("Not watching any pages")) {
    throw new Error(
      `空监听表应回答 Not watching any pages，实际：\n${blockText(firstStatus)}`,
    );
  }
  console.log("   ✔ Empty table reported as such");

  // ---- 2. 发布并监听一个真实页面 ----
  console.log("\n💬 Step 2: Publishing guide.md...");
  const beforePublish = agent.messages.length;
  await agent.sendMessage(
    "把 guide.md 发布成可分享的网页吧，图标用 📘，然后把链接发我。",
  );
  const publishBlock = artifactBlocks(agent.messages.slice(beforePublish)).find(
    (block) => block.success && blockText(block).includes("Artifact published"),
  );
  const publishUrl = publishBlock ? extractArtifactUrl(publishBlock) : null;
  if (!publishUrl) {
    throw new Error("发布失败：没有拿到 artifact URL。");
  }
  console.log(`🔗 Published: ${publishUrl}`);

  console.log("\n💬 Step 3: Watching the published page...");
  const beforeWatch = agent.messages.length;
  await agent.sendMessage(
    `监听一下 ${publishUrl} 的评论吧，有人留言就告诉我。`,
  );
  const watchBlock = artifactBlocks(agent.messages.slice(beforeWatch)).find(
    (block) => blockText(block).includes("Watching comments on"),
  );
  if (!watchBlock) {
    throw new Error("模型没有对发布出来的页面调用 Artifact(action=watch)。");
  }
  console.log("   ✔ Watching the real page");

  // ---- 3. 监听一个不存在的页面：404 让条目停在 stopped ----
  console.log(
    "\n💬 Step 4: Watching a page that does not exist (expect 404)...",
  );
  const beforeMissing = agent.messages.length;
  await agent.sendMessage(
    `另外也帮我监听 ${missingUrl} 吧，那是我另一个草稿页。`,
  );
  const missingBlock = artifactBlocks(agent.messages.slice(beforeMissing)).find(
    (block) => !block.success && blockText(block).includes("404"),
  );
  if (!missingBlock) {
    throw new Error(
      "watch 一个不存在的 slug 应当以 404 失败，这一段里没有失败的回执：\n" +
        artifactBlocks(agent.messages.slice(beforeMissing))
          .map(
            (block) =>
              `${block.success ? "OK" : "FAIL"} ${blockText(block).slice(0, 200)}`,
          )
          .join("\n---\n"),
    );
  }
  console.log(`   ✔ Rejected as expected: ${missingBlock.error}`);

  // ---- 4. 关键一步：status 必须同时报出 watching 与 stopped ----
  console.log(
    "\n💬 Step 5: Asking which watches are healthy (the point of this demo)...",
  );
  const beforeStatus = agent.messages.length;
  await agent.sendMessage(
    "现在你一共在监听哪些页面？每条监听还健康吗？有没有哪条已经断了、不会再叫你了？",
  );
  // A model that already ran `status` on the previous turn may answer from that
  // instead of running it again; either turn's receipt is the current table.
  const thisTurnStatus = statusBlocks(agent.messages.slice(beforeStatus)).pop();
  const statusBlock = thisTurnStatus ?? statusBlocks(agent.messages).pop();
  if (!statusBlock) {
    throw new Error(
      "模型没有用 Artifact(action=status) 回答，而是凭记忆/再发一次 watch 去试探了。",
    );
  }
  if (!thisTurnStatus) {
    console.log(
      "   (answered from the status it ran on the previous turn — reusing that receipt)",
    );
  }
  const statusText = blockText(statusBlock);
  console.log("\n--- status 回执原文 ---");
  console.log(statusText);
  console.log("--- end ---\n");

  if (!/watching|connecting/.test(statusText)) {
    throw new Error(`status 没有报出健康的那条监听：\n${statusText}`);
  }
  if (!statusText.includes("stopped")) {
    throw new Error(`status 没有报出 404 那条的 stopped 状态：\n${statusText}`);
  }
  if (!statusText.includes("404")) {
    throw new Error(`status 没有带出 stopped 的失败原因：\n${statusText}`);
  }
  if (!statusText.includes("will not wake you")) {
    throw new Error(
      `status 没有说明 stopped 的后果（不会再叫醒）：\n${statusText}`,
    );
  }
  if (!statusText.includes("2 of 8")) {
    throw new Error(`status 的计数不对（应为 2 of 8）：\n${statusText}`);
  }
  console.log(
    "   ✔ watching + stopped reported side by side, with the reason",
  );

  // ---- 5. unwatch 之后只剩 stopped 那条 ----
  console.log("\n💬 Step 6: Unwatching the real page...");
  const beforeUnwatch = agent.messages.length;
  await agent.sendMessage(`停止监听 ${publishUrl} 吧。`);
  const unwatchBlock = artifactBlocks(agent.messages.slice(beforeUnwatch)).find(
    (block) => blockText(block).includes("Stopped watching"),
  );
  if (!unwatchBlock) {
    throw new Error("模型没有调用 Artifact(action=unwatch)。");
  }

  console.log("\n💬 Step 7: Asking again after unwatch...");
  const beforeLast = agent.messages.length;
  await agent.sendMessage("那现在还剩哪些监听？");
  const lastStatus = statusBlocks(agent.messages.slice(beforeLast)).pop();
  if (!lastStatus) {
    throw new Error("模型没有用 Artifact(action=status) 复查。");
  }
  const lastText = blockText(lastStatus);
  console.log("\n--- status 回执原文 ---");
  console.log(lastText);
  console.log("--- end ---\n");

  if (lastText.includes(publishUrl)) {
    throw new Error(`unwatch 之后 status 仍在报被停掉的那条：\n${lastText}`);
  }
  if (!lastText.includes("1 of 8")) {
    throw new Error(`status 计数应为 1 of 8：\n${lastText}`);
  }

  console.log("\n🎉 All status checks passed!");
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

process.on("SIGINT", async () => {
  console.log("\n\n🛑 Received SIGINT, cleaning up...");
  await cleanup();
  process.exit(0);
});

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Unhandled error:", error);
    process.exit(1);
  });
