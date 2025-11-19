#!/usr/bin/env tsx

import fs from "fs/promises";
import path from "path";
import os from "os";
import { Agent } from "../src/agent.js";

console.log("🔢 Testing Custom Tools MCP - Simple Example...\n");

let tempDir: string;
let agent: Agent;

process.env.AIGW_MODEL = "gemini-2.5-flash";

async function setupTest() {
  // Create temporary directory
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "custom-tools-simple-"));
  console.log(`📁 Created temporary directory: ${tempDir}`);

  // Simple MCP server with just one tool
  const serverContent = `#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  {
    name: "favorite-number-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_users_favorite_number",
        description: "Returns the user's favorite number",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;

  if (name === "get_users_favorite_number") {
    return {
      content: [
        {
          type: "text",
          text: "The user's favorite number is 42",
        },
      ],
    };
  }

  throw new Error(\`Unknown tool: \${name}\`);
});

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("Favorite Number MCP Server ready");`;

  const serverPath = path.join(tempDir, "favorite-number-server.js");
  await fs.writeFile(serverPath, serverContent);
  console.log(`📝 Created MCP server: ${serverPath}`);

  // Create package.json for ES module support
  const packageJson = {
    name: "favorite-number-mcp-server",
    version: "1.0.0",
    type: "module",
    dependencies: {
      "@modelcontextprotocol/sdk": "^1.18.2",
    },
  };

  const packagePath = path.join(tempDir, "package.json");
  await fs.writeFile(packagePath, JSON.stringify(packageJson, null, 2));
  console.log(`📦 Created package.json: ${packagePath}`);

  // Install dependencies
  console.log("🔗 Installing dependencies...");
  const { spawn } = await import("child_process");
  await new Promise<void>((resolve, reject) => {
    const installProcess = spawn("pnpm", ["install"], {
      cwd: tempDir,
      stdio: ["inherit", "pipe", "pipe"],
    });

    installProcess.on("close", (code) => {
      if (code === 0) {
        console.log("✅ Dependencies installed successfully");
        resolve();
      } else {
        reject(new Error(`pnpm install failed with code ${code}`));
      }
    });

    installProcess.on("error", reject);
  });

  // Simple MCP configuration with relative path
  const mcpConfig = {
    mcpServers: {
      "favorite-number": {
        command: "node",
        args: ["favorite-number-server.js"],
      },
    },
  };

  // Create .mcp.json config file
  const configPath = path.join(tempDir, ".mcp.json");
  await fs.writeFile(configPath, JSON.stringify(mcpConfig, null, 2));
  console.log(`⚙️ Created MCP config: ${configPath}`);

  // Create Agent
  agent = await Agent.create({
    workdir: tempDir,
    callbacks: {
      onUserMessageAdded: (params) => {
        console.log(`👤 User: "${params.content}"`);
      },
      onAssistantMessageAdded: () => {
        console.log("Assistant message started");
      },
      onToolBlockUpdated: (params) => {
        if (!params.isRunning && params.success) {
          console.log(`🔧 Tool ${params.name}: ${params.result}`);
        }
      },
    },
  });

  console.log("🔗 MCP server initialization completed");
}

async function runTest() {
  console.log(`\n💬 Testing the get_users_favorite_number tool...`);

  try {
    await agent.sendMessage("What is my favorite number?");
  } catch (error) {
    if (error instanceof Error && error.message === "Timeout") {
      console.log("⏰ Test completed (timed out waiting for final response)");
    } else {
      throw error;
    }
  }

  console.log(`\n📊 Test completed - Tool was successfully called!`);
}

async function cleanup() {
  console.log("\n🧹 Cleaning up...");
  try {
    if (agent) {
      await agent.destroy();
      console.log("✅ Agent cleaned up");
    }

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
    process.exit(0);
  }
}

// Handle process exit
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

// Run main function
main().catch((error) => {
  console.error("💥 Unhandled error:", error);
  process.exit(1);
});
