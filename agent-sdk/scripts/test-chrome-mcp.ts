#!/usr/bin/env tsx

import fs from "fs/promises";
import path from "path";
import os from "os";
import { AIManager } from "../src/services/aiManager.js";

console.log("🌐 Testing Chrome MCP screenshot functionality...\n");

let tempDir: string;
let aiManager: AIManager;
let mcpInitialized = false;
let mcpInitializedResolve: (() => void) | null = null;

// 创建一个 Promise 来等待 MCP 初始化完成
const mcpInitializedPromise = new Promise<void>((resolve) => {
  mcpInitializedResolve = resolve;
});

async function setupTest() {
  // 创建临时目录
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "chrome-mcp-test-"));
  console.log(`📁 Created temporary directory: ${tempDir}`);

  // Chrome MCP 配置
  const mcpConfig = {
    mcpServers: {
      "chrome-devtools": {
        command: "npx",
        args: ["chrome-devtools-mcp@latest"],
      },
    },
  };

  // 创建 .mcp.json 配置文件
  const configPath = path.join(tempDir, ".mcp.json");
  await fs.writeFile(configPath, JSON.stringify(mcpConfig, null, 2));
  console.log(`⚙️ Created MCP config: ${configPath}`);

  // 设置工作目录
  console.log(`🔧 Setting working directory: ${tempDir}`);
  process.chdir(tempDir);

  // 创建 AI Manager with comprehensive callbacks
  aiManager = new AIManager({
    // MCP 服务器初始化回调
    onMcpServersInitialized: () => {
      console.log("🔗 MCP servers initialization completed");
      mcpInitialized = true;
      mcpInitializedResolve?.();
    },

    // 增量回调
    onUserMessageAdded: (content: string) => {
      console.log(`👤 User message: "${content}"`);
    },
    onAssistantMessageAdded: () => {
      console.log("🤖 Assistant message started");
    },
    onAnswerBlockAdded: () => {
      console.log("💬 Answer block added");
    },
    onAnswerBlockUpdated: (content: string) => {
      const preview = content.slice(0, 150).replace(/\n/g, "\\n");
      console.log(
        `📝 Answer: "${preview}${content.length > 150 ? "..." : ""}"`,
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
      console.log(`🔧 Tool ${params.name || params.toolId}: ${status}`);
      if (params.result && !params.isRunning) {
        const preview = (params.shortResult || params.result)
          .slice(0, 200)
          .replace(/\n/g, "\\n");
        console.log(
          `   Result: "${preview}${params.result.length > 200 ? "..." : ""}"`,
        );
      }
      if (params.error) {
        console.log(`   ❌ Error: ${params.error}`);
      }
    },
    onErrorBlockAdded: (error: string) => {
      console.log(`❌ Error block: ${error}`);
    },
  });
}

async function runTest() {
  // 等待 MCP 服务器初始化完成
  if (!mcpInitialized) {
    console.log("⏳ Waiting for MCP servers to initialize...");
    await mcpInitializedPromise;
  }

  // 发送消息：让 AI 访问 example.com 并总结
  const userMessage =
    "请访问 example.com 网站，获取页面内容并总结一下这个页面的信息。不需要截图。";
  console.log(`\n💬 Sending message: ${userMessage}\n`);

  // 使用 sendMessage 方法，避免手动操作 messages
  await aiManager.sendMessage(userMessage);

  // 获取最终状态和结果
  const state = aiManager.getState();
  console.log("\n📊 Final state:");
  console.log(`   Session ID: ${state.sessionId}`);
  console.log(`   Messages: ${state.messages.length}`);
  console.log(`   Total tokens: ${state.totalTokens}`);
  console.log(`   Is loading: ${state.isLoading}`);
  console.log(`   Input history: ${state.userInputHistory.length} entries`);
}

async function cleanup() {
  console.log("\n🧹 Cleaning up...");
  try {
    // 销毁 AI Manager (包含 MCP 清理)
    if (aiManager) {
      await aiManager.destroy();
      console.log("✅ AI Manager and MCP connections cleaned up");
    }

    // 删除临时目录
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
  }
}

// 处理进程退出
process.on("SIGINT", async () => {
  console.log("\n\n🛑 Received SIGINT, cleaning up...");
  await cleanup();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n\n🛑 Received SIGTERM, cleaning up...");
  await cleanup();
  process.exit(0);
});

// 运行主函数
main().catch((error) => {
  console.error("💥 Unhandled error:", error);
  process.exit(1);
});
