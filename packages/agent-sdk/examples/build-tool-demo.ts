#!/usr/bin/env tsx

import { Agent, buildTool, type ToolResult } from "../src/index.js";

// Use a cheaper/faster model for testing
process.env.WAVE_MODEL = process.env.WAVE_FAST_MODEL;

// Define custom tools using buildTool()
const weatherTool = buildTool({
  name: "GetWeather",
  description: "Get the current weather for a given city",
  parameters: {
    city: { type: "string", description: "The city name" },
  },
  required: ["city"],
  execute: async (args): Promise<ToolResult> => {
    const city = args.city as string;
    // Simulated weather data
    const weatherData: Record<string, string> = {
      Beijing: "Sunny, 25°C",
      Shanghai: "Cloudy, 22°C",
      Hangzhou: "Rainy, 20°C",
    };
    const weather = weatherData[city] || `Unknown weather for ${city}`;
    return { success: true, content: `Weather in ${city}: ${weather}` };
  },
});

const calculatorTool = buildTool({
  name: "Calculator",
  description: "Perform basic arithmetic operations",
  parameters: {
    operation: {
      type: "string",
      description: "The operation to perform: add, subtract, multiply, divide",
    },
    a: { type: "number", description: "First number" },
    b: { type: "number", description: "Second number" },
  },
  required: ["operation", "a", "b"],
  execute: async (args): Promise<ToolResult> => {
    const { operation, a, b } = args;
    let result: number;
    switch (operation) {
      case "add":
        result = (a as number) + (b as number);
        break;
      case "subtract":
        result = (a as number) - (b as number);
        break;
      case "multiply":
        result = (a as number) * (b as number);
        break;
      case "divide":
        if ((b as number) === 0) {
          return {
            success: false,
            content: "",
            error: "Cannot divide by zero",
          };
        }
        result = (a as number) / (b as number);
        break;
      default:
        return {
          success: false,
          content: "",
          error: `Unknown operation: ${operation}`,
        };
    }
    return { success: true, content: `${a} ${operation} ${b} = ${result}` };
  },
});

// Create Agent with custom tools
const agent = await Agent.create({
  customTools: [weatherTool, calculatorTool],
  callbacks: {
    onAssistantContentUpdated: (params: { chunk: string }) => {
      process.stdout.write(params.chunk);
    },
    onToolBlockUpdated: (params) => {
      if (params.stage === "start") {
        console.log(`\n🔧 Tool call: ${params.name}`);
      }
      if (params.stage === "end" && params.success) {
        console.log(`✅ ${params.result}`);
      }
    },
  },
  permissionMode: "bypassPermissions",
});

async function main() {
  try {
    await agent.sendMessage(
      "What's the weather in Beijing? Also, what is 42 multiply 7?",
    );
  } catch (error) {
    console.error("\n❌ Error occurred:", error);
  } finally {
    console.log("\n🧹 Cleaning up...");
    await agent.destroy();
    console.log("✅ Cleanup complete.");
  }
}

// Handle process exit
process.on("SIGINT", async () => {
  await agent.destroy();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await agent.destroy();
  process.exit(0);
});

main().catch((error) => {
  console.error("💥 Unhandled error:", error);
  process.exit(1);
});
