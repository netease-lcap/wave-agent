#!/usr/bin/env -S pnpm tsx

import { toolRegistry } from "@/plugins/tools";
import OpenAI from "openai";
import { ChatCompletionMessage } from "openai/resources";

const openai = new OpenAI();

async function runStreamingTest() {
  const stream = await openai.chat.completions.create({
    model: "claude-sonnet-4-20250514",
    // model: 'gemini-2.5-flash',
    messages: [
      {
        role: "user",
        content: "demostrate two tools in tool_calls array directly",
      },
    ],
    tools: toolRegistry.getToolsConfig(),
    stream: true,
  });

  const message: ChatCompletionMessage = {
    role: "assistant",
    content: "",
    refusal: null,
    tool_calls: [],
  };
  for await (const chunk of stream) {
    message.content += chunk.choices[0].delta.content || "";
    const toolCall = chunk.choices[0].delta.tool_calls?.[0];
    if (toolCall) {
      const lastToolCall = message.tool_calls?.[toolCall.index || 0];

      if (lastToolCall) {
        if (lastToolCall.type === "function")
          lastToolCall.function.arguments += toolCall.function?.arguments || "";
      } else {
        message.tool_calls = message.tool_calls || [];
        message.tool_calls[toolCall.index || 0] = {
          id: toolCall.id || "",
          type: toolCall.type || "function",
          function: {
            name: toolCall.function?.name || "",
            arguments: toolCall.function?.arguments || "",
          },
        };
      }
    }

    console.log(JSON.stringify(chunk.choices[0]));
  }

  console.log("\n💭 [AI 回复]");
  console.log("-".repeat(40));

  // 等待完成
  // const finalResult = await runner.finalChatCompletion();

  console.log("finalResult", JSON.stringify(message, null, 2));
}

// 运行测试
console.log("⏳ 启动中...\n");
runStreamingTest();
