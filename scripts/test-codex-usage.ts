import { AIManager, type AIManagerCallbacks } from "@/services/aiManager";
import { addUserMessageToMessages } from "@/utils/messageOperations";
import type { Message } from "@/types";

function extractLatestAssistantText(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== "assistant") {
      continue;
    }

    for (let j = message.blocks.length - 1; j >= 0; j--) {
      const block = message.blocks[j];
      if (block.type === "text") {
        return block.content;
      }
    }
  }
  return null;
}

async function testCodexUsageViaAiManager() {
  console.log("🧪 通过 aiManager 测试 gpt-5-codex 模型的 usage 传输...\n");

  let messages: Message[] = [];

  const callbacks: AIManagerCallbacks = {
    onMessagesChange: (updatedMessages) => {
      messages = updatedMessages;
      process.stdout.write(".");
    },
    onLoadingChange: () => {
      // Handle loading state changes if needed
    },
  };

  const aiManager = new AIManager(process.cwd(), callbacks);

  try {
    const initialState = aiManager.getState();
    console.log(`📊 初始 totalTokens: ${initialState.totalTokens}`);

    const prompt = "hi";

    messages = addUserMessageToMessages(messages, prompt);
    aiManager.setMessages(messages);

    console.log("\n🤖 正在通过 aiManager 发送消息...");
    await aiManager.sendAIMessage();

    const finalState = aiManager.getState();
    const tokensDiff = finalState.totalTokens - initialState.totalTokens;

    console.log("\n=== aiManager 调用结果 ===");
    console.log(`📦 会话消息数量: ${finalState.messages.length}`);
    console.log(`📈 更新后的 totalTokens: ${finalState.totalTokens}`);
    console.log(`   ↳ 本次调用 token 增量: ${tokensDiff}`);

    if (!finalState.totalTokens) {
      console.warn(
        "⚠️ totalTokens 仍为 0，可能未获取到 usage 数据。请检查 OpenAI 响应中是否包含 usage 字段，或联系模型服务支持。",
      );
    }

    const latestAssistantText = extractLatestAssistantText(messages);
    if (latestAssistantText) {
      const preview =
        latestAssistantText.length > 400
          ? `${latestAssistantText.slice(0, 400)}...`
          : latestAssistantText;
      console.log("\n💡 助手回复预览:\n");
      console.log(preview);
    } else {
      console.log("\n⚠️ 未找到助手回复文本");
    }

    const toolBlocks = messages.flatMap((message) =>
      message.blocks.filter((block) => block.type === "tool"),
    );
    if (toolBlocks.length > 0) {
      console.log("\n🛠️ 工具调用详情:");
      toolBlocks.forEach((block, index) => {
        if (block.type !== "tool") {
          return;
        }
        console.log(`  ${index + 1}. ${block.attributes?.name || "unknown"}`);
        if (block.parameters) {
          console.log(`     参数: ${block.parameters}`);
        }
        if (block.result) {
          const resultPreview =
            block.result.length > 200
              ? `${block.result.slice(0, 200)}...`
              : block.result;
          console.log(`     结果: ${resultPreview}`);
        }
        if (block.shortResult) {
          console.log(`     摘要: ${block.shortResult}`);
        }
        if (block.images && block.images.length > 0) {
          console.log(`     图片数量: ${block.images.length}`);
        }
        if (block.attributes?.error) {
          console.log(`     错误: ${block.attributes.error}`);
        }
      });
    } else {
      console.log("\nℹ️ 没有工具调用记录");
    }
  } catch (error) {
    console.error("❌ 测试失败:", error);
  } finally {
    await aiManager.destroy();
    console.log("\n🧹 已清理 aiManager 资源");
  }
}

// 运行测试
testCodexUsageViaAiManager().catch((error) => {
  console.error("❌ 未捕获的错误:", error);
  process.exit(1);
});
