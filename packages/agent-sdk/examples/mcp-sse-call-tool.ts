import { Agent } from "../src/agent.js";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";

async function main() {
  const objectId = process.argv[2] || "3360247716707328";
  const workDir = await fs.mkdtemp(join(tmpdir(), "wave-mcp-sse-call-"));
  const mcpConfigPath = join(workDir, ".mcp.json");
  const sseUrl =
    "https://pmmcp.netease-official.lcap.163yun.com/sse?apiKey=bbbac5a49d9e416d9f6514080d31b968";

  console.log(`Using temporary directory: ${workDir}`);
  console.log(`Calling getObjectByObjectId with ID: ${objectId}`);

  const mcpConfig = {
    mcpServers: {
      pmmcp: {
        url: sseUrl,
      },
    },
  };

  try {
    await fs.writeFile(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));

    const agent = await Agent.create({
      workdir: workDir,
      name: "sse-call-agent",
      model: "gemini-2.5-flash",
      permissionMode: "bypassPermissions", // Auto-approve for non-interactive test
    });

    console.log("Agent initialized. Waiting for MCP connection...");
    // Wait a bit for background connection
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const servers = agent.getMcpServers();
    const pmmcp = servers.find((s) => s.name === "pmmcp");
    if (pmmcp) {
      console.log(`Server pmmcp status: ${pmmcp.status}`);
      if (pmmcp.tools) {
        console.log(`Available tools (${pmmcp.tools.length})`);
      }
    }

    console.log("Sending message to call multiple tools...");

    await agent.sendMessage(`You have access to MCP tools from the "pmmcp" server. 
1. Use mcp__pmmcp__getObjectByObjectId with objectId="${objectId}".
2. From the result, find the 'objectOwner' ID and use mcp__pmmcp__getStaffById with that ID.
Summarize both results.`);

    // Wait for a bit to ensure all messages are processed if needed,
    // though sendMessage should wait for the full interaction.

    const messages = agent.messages;
    console.log("\n--- Interaction History ---");
    messages.forEach((msg) => {
      console.log(`[${msg.role.toUpperCase()}]`);
      msg.blocks.forEach((block) => {
        if (block.type === "text") {
          console.log(block.content);
        } else if (block.type === "tool") {
          console.log(
            `Tool: ${block.name}(${block.parameters}) -> ${block.success ? "Success" : "Error"}`,
          );
          if (block.result) {
            console.log(`Result: ${block.result}`);
          }
        } else {
          console.log(`Block type: ${block.type}`);
        }
      });
      console.log("---------------------------");
    });

    await agent.destroy();
  } catch (error) {
    console.error("Test failed:", error);
  } finally {
    try {
      await fs.rm(workDir, { recursive: true, force: true });
      console.log(`Cleaned up temporary directory: ${workDir}`);
    } catch (cleanupError) {
      console.error("Failed to clean up temporary directory:", cleanupError);
    }
  }
}

main().catch(console.error);
