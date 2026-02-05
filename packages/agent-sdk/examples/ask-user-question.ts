#!/usr/bin/env tsx

/**
 * Ask User Question Example
 *
 * This example demonstrates how to use the `AskUserQuestion` tool in the Wave Agent SDK.
 * It shows how an SDK user can implement the `canUseTool` callback to handle
 * structured questions from the agent and provide answers.
 */

import {
  Agent,
  type PermissionDecision,
  type ToolPermissionContext,
  type AskUserQuestionInput,
  type AskUserQuestionOption,
} from "../src/index.js";

async function main() {
  console.log("❓ Wave Agent SDK AskUserQuestion Example\n");

  // 1. Create an agent with a custom permission callback to handle questions
  const agent = await Agent.create({
    permissionMode: "default",
    // The canUseTool callback is where we handle the AskUserQuestion tool
    canUseTool: async (
      context: ToolPermissionContext,
    ): Promise<PermissionDecision> => {
      try {
        if (context.toolName === "AskUserQuestion") {
          console.log("\n🤖 Agent is asking questions:");

          // The questions are passed in the toolInput
          const { questions } =
            context.toolInput as unknown as AskUserQuestionInput;
          const answers: Record<string, string> = {};

          for (const q of questions) {
            console.log(`   [${q.header}] ${q.question}`);
            q.options.forEach((opt: AskUserQuestionOption, i: number) => {
              console.log(
                `     ${i + 1}. ${opt.label}${opt.isRecommended ? " (Recommended)" : ""}`,
              );
              if (opt.description) console.log(`        └─ ${opt.description}`);
            });

            // In a real application, you would show a UI to the user.
            // Here we simulate the user selecting the first option (or the recommended one).
            const selectedOption =
              q.options.find(
                (opt: AskUserQuestionOption) => opt.isRecommended,
              ) || q.options[0];
            console.log(`   👤 User selects: ${selectedOption.label}\n`);

            answers[q.question] = selectedOption.label;
          }

          // Return the answers as a JSON string in the message field
          return {
            behavior: "allow",
            message: JSON.stringify(answers),
          };
        }

        // For other tools, we just allow them in this example
        return { behavior: "allow" };
      } catch (error) {
        console.error("Error in permission callback:", error);
        return {
          behavior: "deny",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    callbacks: {
      onAssistantContentUpdated: (chunk) => {
        process.stdout.write(chunk);
      },
      onToolBlockUpdated: (params) => {
        if (params.stage === "end") {
          if (params.success) {
            console.log(`\n✅ Tool ${params.name} executed successfully`);
            if (params.name === "AskUserQuestion") {
              console.log(`📥 Answers received: ${params.result}`);
            }
          } else {
            console.log(`\n❌ Tool ${params.name} failed: ${params.error}`);
          }
        }
      },
    },
  });

  try {
    // 2. Send a message that triggers the agent to ask for clarification
    console.log("💬 Sending ambiguous request to agent...");
    await agent.sendMessage(
      "I want to create a new web project. Should I use React or Vue? Also ask me about the styling library.",
    );

    console.log("\n\n✨ Example completed successfully!");
  } catch (error) {
    console.error("\n💥 Error during example execution:", error);
  } finally {
    await agent.destroy();
    process.exit(0);
  }
}

main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
