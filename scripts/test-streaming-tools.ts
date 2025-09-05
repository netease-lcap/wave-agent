#!/usr/bin/env -S pnpm tsx

import { toolRegistry } from "@/plugins/tools";
import OpenAI from "openai";

const openai = new OpenAI();

async function runStreamingTest() {
  const runner = await openai.chat.completions
    .stream({
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
    })
    .on("tool_calls.function.arguments.delta", (diff) =>
      console.log(JSON.stringify(diff)),
    )
    .on("content", (diff) => process.stdout.write(diff));

  const result = await runner.finalChatCompletion();
  console.log("\nresult\n", result);
}

// 运行测试
console.log("⏳ 启动中...\n");
runStreamingTest();
