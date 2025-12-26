import { Agent } from "../src/agent.js";

/**
 * This example demonstrates how to use the `fetch` option to dynamically add HTTP headers
 * based on the agent's configuration, such as the system prompt.
 */

async function main() {
  const customFetch: typeof fetch = async (url, options) => {
    const headers = new Headers(options?.headers);

    // Intercept and parse the request body to find the system prompt
    if (options?.body && typeof options.body === "string") {
      try {
        const body = JSON.parse(options.body);
        const messages =
          (body.messages as { role: string; content: string }[]) || [];
        const systemMessage = messages.find((m) => m.role === "system");

        if (systemMessage?.content?.includes("special-agent")) {
          headers.set("X-Agent-Type", "Special");
          console.log(
            "🚀 Added X-Agent-Type: Special header (detected from body)",
          );
        } else {
          headers.set("X-Agent-Type", "Standard");
          console.log(
            "🚀 Added X-Agent-Type: Standard header (detected from body)",
          );
        }
      } catch {
        // Fallback if body is not JSON
      }
    }

    // Log the request for demonstration
    console.log(`🌐 Fetching ${url}`);

    return fetch(url, {
      ...options,
      headers,
    });
  };

  try {
    console.log("--- Request 1 (Standard Agent) ---");
    const standardAgent = await Agent.create({
      systemPrompt: "You are a helpful assistant.",
      fetch: customFetch,
      callbacks: {
        onAssistantContentUpdated: (chunk: string) => {
          process.stdout.write(chunk);
        },
      },
    });
    await standardAgent.sendMessage("echo standard");
    await standardAgent.destroy();
    console.log("\n");

    console.log("--- Request 2 (Special Agent) ---");
    const specialAgent = await Agent.create({
      systemPrompt: "You are a special-agent.",
      fetch: customFetch,
      callbacks: {
        onAssistantContentUpdated: (chunk: string) => {
          process.stdout.write(chunk);
        },
      },
    });
    await specialAgent.sendMessage("echo special");
    await specialAgent.destroy();
    console.log("\n");
  } catch (error) {
    console.error("❌ Error occurred:", error);
  } finally {
    console.log("👋 Done!");
  }
}

main().catch((error) => {
  console.error("💥 Unhandled error:", error);
  process.exit(1);
});
