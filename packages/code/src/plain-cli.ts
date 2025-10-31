import { Agent, AgentCallbacks } from "wave-agent-sdk";
import { logger } from "./utils/logger.js";

export interface PlainCliOptions {
  restoreSessionId?: string;
  continueLastSession?: boolean;
  message?: string;
}

export async function startPlainCli(options: PlainCliOptions): Promise<void> {
  const { restoreSessionId, continueLastSession, message } = options;

  if (
    (!message || message.trim() === "") &&
    !continueLastSession &&
    !restoreSessionId
  ) {
    console.error(
      "Plain mode requires a message: use --plain 'your message' or -p 'your message'",
    );
    process.exit(1);
  }

  let agent: Agent;

  // Setup callbacks for agent
  const callbacks: AgentCallbacks = {
    onAssistantMessageAdded: (content?: string) => {
      // Only output the content field, not tool calls
      if (content) {
        console.log(content);
      }
    },
  };

  try {
    // Initialize agent
    agent = await Agent.create({
      callbacks,
      restoreSessionId,
      continueLastSession,
      logger,
    });

    // Send message if provided and not empty
    if (message && message.trim() !== "") {
      await agent.sendMessage(message);
    }

    // Destroy agent and exit after sendMessage completes
    agent.destroy();
    process.exit(0);
  } catch (error) {
    console.error("Failed to send message:", error);
    if (agent!) {
      agent.destroy();
    }
    process.exit(1);
  }
}
