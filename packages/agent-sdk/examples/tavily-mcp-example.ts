import { Agent } from "../src/agent.js";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";

/**
 * Example demonstrating how to use Tavily's remote MCP server.
 * Tavily's MCP server is a remote server that supports the "Streamable HTTP" transport
 * and requires an API key passed in the headers.
 *
 * Documentation: https://docs.tavily.com/documentation/mcp
 */
async function main() {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    console.error("TAVILY_API_KEY environment variable is required.");
    console.log("Get one at: https://tavily.com/");
    process.exit(1);
  }

  // Create a temporary directory for the agent
  const workDir = await fs.mkdtemp(join(tmpdir(), "wave-tavily-mcp-"));
  const mcpConfigPath = join(workDir, ".mcp.json");

  console.log(`Using temporary directory: ${workDir}`);

  // Configure the Tavily MCP server using env var expansion
  const mcpConfig = {
    mcpServers: {
      tavily: {
        url: "https://mcp.tavily.com/mcp/",
        // Authenticate using the Authorization header with ${TAVILY_API_KEY} env var expansion
        headers: {
          Authorization: "Bearer ${TAVILY_API_KEY}",
        },
      },
    },
  };

  let agent: Agent | undefined;

  try {
    // Write the .mcp.json file
    await fs.writeFile(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));

    // Create the agent
    agent = await Agent.create({
      workdir: workDir,
      name: "tavily-test-agent",
      model: process.env.WAVE_FAST_MODEL, // Using a fast model for the demo
      permissionMode: "bypassPermissions", // Bypass permissions for the demo to allow tool usage
      systemPrompt:
        "You are a helpful assistant. When asked to search, use the tavily_search tool. Answer briefly.",
    });

    console.log("Agent initialized. Connecting to Tavily MCP server...");

    // Wait for the background connection to complete
    let attempts = 0;
    let tavilyServer;
    while (attempts < 30) {
      const servers = agent.getMcpServers();
      tavilyServer = servers.find((s) => s.name === "tavily");
      if (
        tavilyServer?.status === "connected" ||
        tavilyServer?.status === "error"
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      attempts++;
    }

    if (tavilyServer?.status === "connected") {
      console.log("Successfully connected to Tavily MCP server!");
      console.log(`Available tools (${tavilyServer.tools?.length || 0}):`);
      tavilyServer.tools?.forEach((t) => {
        console.log(`- ${t.name}: ${t.description || "No description"}`);
      });

      // Example of sending a message to the agent that uses the tool
      console.log("\nSending query to agent...");
      await agent.sendMessage(
        "Search for the latest news about TypeScript 5.4",
      );

      // Since sendMessage is async and backgrounded, we can wait for the response in messages
      console.log("\nWaiting for agent response...");
      let attempts = 0;
      while (attempts < 60) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const messages = agent.messages;
        if (messages.length > 0) {
          const lastMessage = messages[messages.length - 1];
          if (lastMessage.role === "assistant" && !agent.isLoading) {
            console.log("\nAgent Response:");
            const textBlocks = lastMessage.blocks.filter(
              (b) => b.type === "text",
            );
            textBlocks.forEach((b) => console.log(b.content));
            break;
          }
        }
        attempts++;
      }
    } else {
      console.error(
        `Failed to connect to Tavily MCP server. Status: ${tavilyServer?.status}`,
      );
      if (tavilyServer?.error) {
        console.error(`Error: ${tavilyServer.error}`);
      }
    }
  } catch (error) {
    console.error("Error occurred:", error);
  } finally {
    if (agent) {
      await agent.destroy();
    }
    try {
      await fs.rm(workDir, { recursive: true, force: true });
      console.log(`Cleaned up temporary directory: ${workDir}`);
    } catch (cleanupError) {
      console.error("Failed to clean up temporary directory:", cleanupError);
    }
  }
}

main().catch(console.error);
