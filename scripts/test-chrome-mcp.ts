import fs from "fs/promises";
import path from "path";
import os from "os";
import { AIManager, type AIManagerCallbacks } from "../src/services/aiManager";
import { addUserMessageToMessages } from "../src/utils/messageOperations";
import type { Message } from "../src/types";

async function testChromeScreenshot() {
  console.log("🌐 Testing Chrome MCP screenshot functionality...\n");

  // 创建临时目录
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "chrome-mcp-test-"));
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

  // 准备回调函数
  let messages: Message[] = [];

  const callbacks: AIManagerCallbacks = {
    onMessagesChange: (newMessages: Message[]) => {
      messages = newMessages;
    },
    onLoadingChange: () => {
      // Handle loading state changes if needed
    },
  };

  // 创建 AI Manager
  console.log(`🔧 Initializing aiManager with workdir: ${tempDir}`);
  const aiManager = new AIManager(tempDir, callbacks);

  try {
    // 等待一点时间让 MCP 服务器初始化
    console.log("⏳ Waiting for MCP servers to initialize...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // 添加用户消息：让 AI 访问 example.com 并总结
    const userMessage =
      "请访问 example.com 网站，获取页面内容并总结一下这个页面的信息。不需要截图。";
    console.log(`💬 Sending message: ${userMessage}`);

    messages = addUserMessageToMessages(messages, userMessage);
    aiManager.setMessages(messages);

    // 发送 AI 消息
    console.log("🤖 Sending to AI...");
    await aiManager.sendAIMessage();

    console.log("\n📄 Final conversation:");
    console.log("=".repeat(50));

    // 打印对话内容
    messages.forEach((message, index) => {
      console.log(`\n${message.role.toUpperCase()} MESSAGE ${index + 1}:`);
      message.blocks.forEach((block, blockIndex) => {
        console.log(`  Block ${blockIndex + 1} (${block.type}):`);
        switch (block.type) {
          case "text":
            console.log(`    ${block.content}`);
            break;
          case "tool":
            if (block.attributes?.name) {
              console.log(`    Tool: ${block.attributes.name}`);
            }
            if (block.parameters) {
              console.log(`    Parameters: ${block.parameters}`);
            }
            if (block.result) {
              console.log(`    Result: ${block.result.substring(0, 200)}...`);
            }
            if (block.images && block.images.length > 0) {
              console.log(
                `    📸 Images: ${block.images.length} screenshot(s) captured`,
              );
            }
            break;
          case "error":
            console.log(`    ❌ Error: ${block.content}`);
            break;
          case "image":
            if (block.attributes?.imageUrls) {
              console.log(
                `    🖼️ Images: ${block.attributes.imageUrls.length} file(s)`,
              );
            }
            break;
          default:
            console.log(
              `    Content: ${JSON.stringify(block).substring(0, 100)}...`,
            );
        }
      });
    });
  } catch (error) {
    console.error("❌ Error during test:", error);
  } finally {
    // 清理
    console.log("\n🧹 Cleaning up...");
    try {
      // 销毁 AI Manager (包含 MCP 清理)
      await aiManager.destroy();
      console.log("✅ AI Manager and MCP connections cleaned up");

      // 删除临时目录
      await fs.rm(tempDir, { recursive: true, force: true });
      console.log(`🗑️ Cleaned up temporary directory: ${tempDir}`);

      // 强制退出进程
      console.log("👋 Exiting process...");
      process.exit(0);
    } catch (cleanupError) {
      console.error("Failed to cleanup:", cleanupError);
      process.exit(1);
    }
  }
}

// 运行测试
testChromeScreenshot().catch(console.error);
