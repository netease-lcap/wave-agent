import { Agent } from "../src/agent.js";

async function main() {
  const agent = await Agent.create({
    workdir: process.cwd(),
    agentModel: "gemini-2.5-flash",
    callbacks: {
      onSubagentAssistantMessageAdded: (subagentId) => {
        const instance = agent.getSubagentInstance(subagentId);
        const name = instance?.configuration.name || subagentId;
        console.log(`[Subagent ${name}] Assistant started responding...`);
      },
      onSubagentAssistantContentUpdated: (subagentId, chunk) => {
        const instance = agent.getSubagentInstance(subagentId);
        const name = instance?.configuration.name || subagentId;
        process.stdout.write(`[Subagent ${name}] ${chunk}`);
      },
      onSubagentToolBlockUpdated: (subagentId, params) => {
        const instance = agent.getSubagentInstance(subagentId);
        const name = instance?.configuration.name || subagentId;
        if (params.stage === "running") {
          console.log(`\n[Subagent ${name}] Calling tool: ${params.name}...`);
        } else if (params.stage === "end") {
          console.log(
            `[Subagent ${name}] Tool ${params.name} ${params.success ? "success" : "failed"}.`,
          );
        }
      },
      onAssistantContentUpdated: (chunk) => {
        process.stdout.write(chunk);
      },
    },
  });

  console.log("Testing general-purpose subagent via user prompt...");

  try {
    // Sending a prompt that should trigger the Task tool with the general-purpose subagent
    // agent.sendMessage returns a Promise that resolves when the AI response cycle (including tool calls) is complete
    await agent.sendMessage(
      "Use the general-purpose subagent to read the README.md file in the root directory and provide a 1-sentence summary. You must use the Task tool to delegate this.",
    );

    console.log("\nTask completed.");
  } catch (error) {
    console.error("Error sending message:", error);
    process.exit(1);
  } finally {
    await agent.destroy();
  }
}

main().catch(console.error);
