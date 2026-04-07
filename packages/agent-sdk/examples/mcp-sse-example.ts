import { Agent } from "../src/agent.js";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";

async function main() {
  const workDir = await fs.mkdtemp(join(tmpdir(), "wave-mcp-sse-test-"));
  const mcpConfigPath = join(workDir, ".mcp.json");
  const sseUrl =
    "https://pmmcp.netease-official.lcap.163yun.com/sse?apiKey=bbbac5a49d9e416d9f6514080d31b968";

  console.log(`Using temporary directory: ${workDir}`);

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
      name: "sse-test-agent",
      agentModel: "gemini-2.0-flash", // Use a fast model for testing
    });

    console.log("Agent initialized. Checking MCP servers...");

    // Wait a bit for background connection
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const servers = agent.getMcpServers();
    const pmmcp = servers.find((s) => s.name === "pmmcp");

    if (pmmcp) {
      console.log(`Server pmmcp status: ${pmmcp.status}`);
      if (pmmcp.error) {
        console.error(`Server error: ${pmmcp.error}`);
      }
      if (pmmcp.tools) {
        console.log(`Available tools (${pmmcp.tools.length}):`);
        pmmcp.tools.forEach((t) =>
          console.log(`- ${t.name}: ${t.description || "No description"}`),
        );
      }
    } else {
      console.error("Server pmmcp not found in agent.");
    }

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
