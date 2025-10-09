#!/usr/bin/env tsx

import { AIManager } from "../src/services/aiManager.js";
import type { Message } from "../src/types.js";

console.log("🚀 Starting AIManager hi test...");

// 创建 AIManager 实例，监听所有可用的回调
const aiManager = new AIManager({
  // 基础回调
  onMessagesChange: (messages: Message[]) => {
    console.log(`📝 Messages updated: ${messages.length} messages`);
  },
  onLoadingChange: (isLoading: boolean) => {
    console.log(`⏳ Loading state: ${isLoading ? "Loading..." : "Idle"}`);
  },

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
  onToolBlockUpdated: (
    toolId: string,
    args?: string,
    result?: string,
    success?: boolean,
    error?: string,
    isRunning?: boolean,
    shortResult?: string,
  ) => {
    const status = isRunning ? "running" : success ? "success" : "failed";
    console.log(`🔧 Tool ${toolId}: ${status}`);
    if (result && !isRunning) {
      const preview = (shortResult || result)
        .slice(0, 100)
        .replace(/\n/g, "\\n");
      console.log(`   Result: "${preview}${result.length > 100 ? "..." : ""}"`);
    }
    if (error) {
      console.log(`   Error: ${error}`);
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
});

async function main() {
  try {
    console.log("\n💬 Sending 'hi' message to AI...\n");

    // 发送 "hi" 消息
    await aiManager.sendMessage("hi");

    console.log("\n✅ Message sent successfully!");

    // 等待一段时间让 AI 处理完成
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // 获取当前状态
    const state = aiManager.getState();
    console.log("\n📊 Final state:");
    console.log(`   Session ID: ${state.sessionId}`);
    console.log(`   Messages: ${state.messages.length}`);
    console.log(`   Total tokens: ${state.totalTokens}`);
    console.log(`   Is loading: ${state.isLoading}`);
    console.log(`   Input history: ${state.userInputHistory.length} entries`);
  } catch (error) {
    console.error("❌ Error occurred:", error);
  } finally {
    // 清理资源
    console.log("\n🧹 Cleaning up...");
    await aiManager.destroy();
    console.log("👋 Done!");
  }
}

// 处理进程退出
process.on("SIGINT", async () => {
  console.log("\n\n🛑 Received SIGINT, cleaning up...");
  await aiManager.destroy();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n\n🛑 Received SIGTERM, cleaning up...");
  await aiManager.destroy();
  process.exit(0);
});

// 运行主函数
main().catch((error) => {
  console.error("💥 Unhandled error:", error);
  process.exit(1);
});
