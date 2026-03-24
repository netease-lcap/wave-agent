import { Container } from "../utils/container.js";
import { MessageManager } from "./messageManager.js";
import { AIManager } from "./aiManager.js";
import { BTW_SUBAGENT_SYSTEM_PROMPT } from "../prompts/index.js";
import { randomUUID } from "node:crypto";
import { AgentOptions } from "../types/index.js";

export class BtwManager {
  private sideAgentId: string | null = null;
  private messageManager: MessageManager | null = null;
  private aiManager: AIManager | null = null;

  constructor(
    private container: Container,
    private workdir: string,
  ) {}

  private get mainMessageManager(): MessageManager {
    return this.container.get<MessageManager>("MessageManager")!;
  }

  /**
   * Ask a side question without blocking the main task
   * @param question - The user's question
   * @returns Promise that resolves to the side agent's instance ID
   */
  public async btw(question: string): Promise<string> {
    if (!this.aiManager || !this.messageManager) {
      const subagentContainer = this.container.createChild();
      const agentOptions = this.container.get<AgentOptions>("AgentOptions");

      this.messageManager = new MessageManager(subagentContainer, {
        callbacks: {
          onMessagesChange: (messages) => {
            agentOptions?.callbacks?.onSideAgentUpdated?.(messages);
          },
        },
        workdir: this.workdir,
        sessionType: "subagent",
        subagentType: "btw",
      });
      subagentContainer.register("MessageManager", this.messageManager);

      this.aiManager = new AIManager(subagentContainer, {
        workdir: this.workdir,
        systemPrompt: BTW_SUBAGENT_SYSTEM_PROMPT,
        subagentType: "btw",
        stream: agentOptions?.stream ?? true,
        callbacks: {
          onUsageAdded: (usage) => {
            this.mainMessageManager.addUsage(usage);
          },
        },
      });
      subagentContainer.register("AIManager", this.aiManager);

      this.sideAgentId = randomUUID();

      // Inherit context from main MessageManager
      const mainMessages = this.mainMessageManager.getMessages();
      this.messageManager.setMessages(mainMessages);
    }

    // Add the user's question as a message
    this.messageManager.addUserMessage({ content: question });

    // Execute the AI request with no tools
    // sendAIMessage will handle the rest
    this.aiManager.sendAIMessage({ tools: [] }).catch((error) => {
      this.messageManager?.addErrorBlock(
        error instanceof Error ? error.message : String(error),
      );
    });

    return this.sideAgentId!;
  }

  /**
   * Dismiss the current side agent
   */
  public dismiss(): void {
    this.sideAgentId = null;
    this.messageManager = null;
    this.aiManager = null;
  }

  /**
   * Check if a subagent ID is the current side agent
   * @param id - The subagent ID to check
   */
  public isSideAgent(id: string): boolean {
    return id === this.sideAgentId;
  }
}
