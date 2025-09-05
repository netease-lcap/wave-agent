import { toolRegistry } from "@/plugins/tools";
import OpenAI from "openai";

const openai = new OpenAI();

async function runStreamingTest() {
  const runner = await openai.chat.completions
    .stream({
      // model: "claude-sonnet-4-20250514",
      model: "gemini-2.5-flash",
      messages: [
        {
          role: "user",
          content: "demostrate two tools in tool_calls array directly",
        },
      ],
      tools: toolRegistry.getToolsConfig(),
      stream: true,
    })
    .on("tool_calls.function.arguments.delta", (tool) =>
      console.log(JSON.stringify(tool)),
    )
    .on("tool_calls.function.arguments.done", (tool) =>
      console.log("done", tool),
    )
    .on("content", (diff) => process.stdout.write(diff));

  const result = await runner.finalChatCompletion();
  console.log("\nresult\n", result);
}

// 运行测试
console.log("⏳ 启动中...\n");
runStreamingTest();
