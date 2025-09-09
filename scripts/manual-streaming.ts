import { toolRegistry } from "@/tools";
import OpenAI from "openai";
import { ChatCompletionMessageFunctionToolCall } from "openai/resources";

const openai = new OpenAI({
  apiKey: process.env.AIGW_TOKEN,
  baseURL: process.env.AIGW_URL,
});

async function runManualStreamingTest() {
  console.log("⏳ 启动手动流式工具调用测试...\n");

  const stream = await openai.chat.completions.create({
    model: "claude-sonnet-4-20250514",
    messages: [
      {
        role: "user",
        content: "请使用两个不同的工具来演示工具调用数组的流式处理",
      },
    ],
    tools: toolRegistry.getToolsConfig(),
    stream: true,
  });

  // 使用数组来管理工具调用
  const toolCalls: ChatCompletionMessageFunctionToolCall[] = [];
  let contentBuffer = "";

  console.log("📡 开始接收流式数据...\n");

  // 手动处理每个 chunk
  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    if (!choice) continue;

    // 处理内容流
    if (choice.delta.content) {
      contentBuffer += choice.delta.content;
      process.stdout.write(choice.delta.content);
    }

    // 手动处理工具调用流
    if (choice.delta.tool_calls) {
      for (const toolCallDelta of choice.delta.tool_calls) {
        console.log(
          `\n🔧 工具调用 Delta:`,
          JSON.stringify(toolCallDelta, null, 2),
        );

        let targetToolCall: ChatCompletionMessageFunctionToolCall | undefined;

        // 使用 ID 来标识工具调用
        if (toolCallDelta.id) {
          // 有 ID，在数组中查找现有的工具调用
          targetToolCall = toolCalls.find((tc) => tc.id === toolCallDelta.id);
        } else {
          // 没有 ID，取最后一个工具调用
          targetToolCall =
            toolCalls.length > 0 ? toolCalls[toolCalls.length - 1] : undefined;
        }

        // 如果没有找到现有的工具调用，创建新的
        if (!targetToolCall) {
          targetToolCall = {
            id: toolCallDelta.id || `temp_${toolCalls.length}_${Date.now()}`,
            type: "function",
            function: {
              name: "",
              arguments: "",
            },
          };
          toolCalls.push(targetToolCall);
        }

        // 更新工具调用信息
        if (toolCallDelta.id) {
          targetToolCall.id = toolCallDelta.id;
        }

        if (toolCallDelta.type) {
          targetToolCall.type = toolCallDelta.type as "function";
        }

        if (toolCallDelta.function?.name) {
          targetToolCall.function.name = toolCallDelta.function.name;
        }

        if (toolCallDelta.function?.arguments) {
          targetToolCall.function.arguments += toolCallDelta.function.arguments;
        }
      }
    }
  }

  // 最终结果
  console.log("\n\n🎉 流式处理完成！");
  console.log("\n📄 最终内容:");
  console.log(contentBuffer);

  console.log("\n🛠️ 最终工具调用:");
  toolCalls.forEach((toolCall, index) => {
    console.log(`\n工具 [${index}] ${toolCall.id}:`);
    console.log(`  名称: ${toolCall.function.name}`);
    console.log(`  参数: ${toolCall.function.arguments}`);
    console.log(
      `  完整性: ${isToolCallComplete(toolCall) ? "✅ 完整" : "❌ 不完整"}`,
    );

    // 尝试解析参数
    if (toolCall.function.arguments) {
      try {
        const parsedArgs = JSON.parse(toolCall.function.arguments);
        console.log(`  解析后的参数:`, JSON.stringify(parsedArgs, null, 2));
      } catch (e) {
        console.log(
          `  ⚠️ 参数解析失败: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  });

  console.log(`\n📊 总计: ${toolCalls.length} 个工具调用`);
}

function isToolCallComplete(
  toolCall: ChatCompletionMessageFunctionToolCall,
): boolean {
  return !!(
    toolCall.id &&
    toolCall.function?.name &&
    toolCall.function?.arguments &&
    toolCall.function.arguments.trim().endsWith("}")
  );
}

// 运行测试
runManualStreamingTest().catch(console.error);
