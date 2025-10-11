#!/usr/bin/env tsx

import { Agent } from "../src/agent.js";

console.log("🚀 Starting Agent hi test...");

// 创建 Agent 实例，监听所有可用的回调
const agent = await Agent.create({
  callbacks: {
    // 增量回调
    onUserMessageAdded: (
      content: string,
      images?: Array<{ path: string; mimeType: string }>,
    ) => {
      console.log(`👤 User message added: "${content}"`);
      if (images && images.length > 0) {
        console.log(`🖼️  With ${images.length} images`);
      }
    },
    onAssistantMessageAdded: () => {
      console.log("🤖 Assistant message started");
    },
    onAnswerBlockAdded: () => {
      console.log("💬 Answer block added");
    },
    onAnswerBlockUpdated: (content: string) => {
      const preview = content.slice(0, 100).replace(/\n/g, "\\n");
      console.log(
        `📝 Answer updated: "${preview}${content.length > 100 ? "..." : ""}"`,
      );
    },
    onToolBlockAdded: (tool: { id: string; name: string }) => {
      console.log(`🔧 Tool started: ${tool.name} (${tool.id})`);
    },
    onToolBlockUpdated: (params) => {
      const status = params.isRunning
        ? "running"
        : params.success
          ? "success"
          : "failed";
      console.log(`🔧 Tool ${params.toolId}: ${status}`);
      if (params.result && !params.isRunning) {
        const preview = (params.shortResult || params.result)
          .slice(0, 100)
          .replace(/\n/g, "\\n");
        console.log(
          `   Result: "${preview}${params.result.length > 100 ? "..." : ""}"`,
        );
      }
      if (params.error) {
        console.log(`   Error: ${params.error}`);
      }
    },
    onDiffBlockAdded: (filePath: string) => {
      console.log(`📄 Diff block added for: ${filePath}`);
    },
    onErrorBlockAdded: (error: string) => {
      console.log(`❌ Error block added: ${error}`);
    },
    onCompressBlockAdded: (content: string) => {
      console.log(`🗜️  Compress block added (${content.length} chars)`);
    },
    onMemoryBlockAdded: (
      content: string,
      success: boolean,
      type: "project" | "user",
    ) => {
      console.log(
        `🧠 Memory ${type} ${success ? "saved" : "failed"}: ${content}`,
      );
    },
  },
});

async function main() {
  // agent 已经在顶层创建
  try {
    console.log("\n💬 Sending 'hi' message to AI...\n");

    // 发送 "hi" 消息
    await agent.sendMessage("hi");

    // 获取当前状态
    console.log("\n📊 Final state:");
    console.log(`   Session ID: ${agent.sessionId}`);
    console.log(`   Messages: ${agent.messages.length}`);
    console.log(`   Total tokens: ${agent.latestTotalTokens}`);
    console.log(`   Is loading: ${agent.isLoading}`);
    console.log(`   Input history: ${agent.userInputHistory.length} entries`);
  } catch (error) {
    console.error("❌ Error occurred:", error);
  } finally {
    // 清理资源
    console.log("\n🧹 Cleaning up...");
    await agent.destroy();
    console.log("👋 Done!");
  }
}

// 处理进程退出
process.on("SIGINT", async () => {
  console.log("\n\n🛑 Received SIGINT, cleaning up...");
  await agent.destroy();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n\n🛑 Received SIGTERM, cleaning up...");
  await agent.destroy();
  process.exit(0);
});

// 运行主函数
main().catch((error) => {
  console.error("💥 Unhandled error:", error);
  process.exit(1);
});
