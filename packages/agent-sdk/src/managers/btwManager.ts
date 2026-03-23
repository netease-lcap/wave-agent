import { Container } from "../utils/container.js";
import { SubagentManager, SubagentInstance } from "./subagentManager.js";
import { MessageManager } from "./messageManager.js";

export class BtwManager {
  private sideAgentId: string | null = null;

  constructor(private container: Container) {}

  private get subagentManager(): SubagentManager {
    return this.container.get<SubagentManager>("SubagentManager")!;
  }

  private get mainMessageManager(): MessageManager {
    return this.container.get<MessageManager>("MessageManager")!;
  }

  /**
   * Ask a side question without blocking the main task
   * @param question - The user's question
   * @returns Promise that resolves to the side agent's instance ID
   */
  public async btw(question: string): Promise<string> {
    let instance: SubagentInstance | null = null;

    if (this.sideAgentId) {
      instance = this.subagentManager.getInstance(this.sideAgentId);
      // If instance is errored or aborted, we'll create a new one
      if (
        instance &&
        (instance.status === "error" || instance.status === "aborted")
      ) {
        instance = null;
        this.sideAgentId = null;
      }
    }

    if (!instance) {
      const configurations = await this.subagentManager.loadConfigurations();
      const exploreConfig = configurations.find((c) => c.name === "Explore");
      if (!exploreConfig) {
        throw new Error("Explore subagent configuration not found");
      }

      instance = await this.subagentManager.createInstance(exploreConfig, {
        description: "Side agent for /btw questions",
        prompt: question,
        subagent_type: "btw",
      });
      this.sideAgentId = instance.subagentId;

      // Inherit context from main MessageManager
      const mainMessages = this.mainMessageManager.getMessages();
      instance.messageManager.setMessages(mainMessages);
    }

    // Execute the agent with the question in the background
    // Note: executeAgent will add the question as a user message
    await this.subagentManager.executeAgent(
      instance,
      question,
      undefined,
      true,
    );

    return instance.subagentId;
  }

  /**
   * Dismiss the current side agent
   */
  public dismiss(): void {
    this.sideAgentId = null;
  }

  /**
   * Check if a subagent ID is the current side agent
   * @param id - The subagent ID to check
   */
  public isSideAgent(id: string): boolean {
    return id === this.sideAgentId;
  }
}
