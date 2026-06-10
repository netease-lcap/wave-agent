import { Container } from "../utils/container.js";
import type { MessageManager } from "./messageManager.js";
import type { AIManager } from "./aiManager.js";
import type { Usage } from "../types/index.js";
import { evaluateGoal as aiEvaluateGoal } from "../services/aiService.js";
import { convertMessagesForAPI } from "../utils/convertMessagesForAPI.js";
import { logger } from "../utils/globalLogger.js";

export interface GoalState {
  condition: string;
  startedAt: number;
  turnCount: number;
  tokenBaseline: number;
  lastReason?: string;
  consecutiveEvalFailures: number;
}

const MAX_GOAL_TURNS = 50;
const MAX_GOAL_DURATION_MS = 30 * 60 * 1000; // 30 minutes
const MAX_CONSECUTIVE_EVAL_FAILURES = 3;
const MAX_CONDITION_LENGTH = 4000;

export class GoalManager {
  private state: GoalState | null = null;
  private onGoalStateChange?: (
    active: boolean,
    condition?: string,
    elapsed?: string,
  ) => void;
  private onGoalEvaluating?: (evaluating: boolean) => void;

  constructor(private container: Container) {}

  private get messageManager(): MessageManager {
    return this.container.get<MessageManager>("MessageManager")!;
  }

  private get aiManager(): AIManager {
    return this.container.get<AIManager>("AIManager")!;
  }

  public setOnGoalStateChange(
    callback: (active: boolean, condition?: string, elapsed?: string) => void,
  ): void {
    this.onGoalStateChange = callback;
  }

  public setOnGoalEvaluating(callback: (evaluating: boolean) => void): void {
    this.onGoalEvaluating = callback;
  }

  public setGoal(condition: string): void {
    if (condition.length > MAX_CONDITION_LENGTH) {
      throw new Error(
        `Goal condition exceeds maximum length of ${MAX_CONDITION_LENGTH} characters`,
      );
    }

    const totalTokens = this.messageManager.getLatestTotalTokens?.() ?? 0;

    this.state = {
      condition,
      startedAt: Date.now(),
      turnCount: 0,
      tokenBaseline: totalTokens,
      consecutiveEvalFailures: 0,
    };

    this.onGoalStateChange?.(true, condition, "0m");
    logger?.info(`[Goal] Set goal: ${condition}`);
  }

  public clearGoal(): void {
    if (this.state) {
      logger?.info(`[Goal] Cleared goal: ${this.state.condition}`);
      this.state = null;
      this.onGoalStateChange?.(false);
    }
  }

  public getGoal(): GoalState | null {
    return this.state;
  }

  public isGoalActive(): boolean {
    return this.state !== null;
  }

  public incrementTurnCount(): void {
    if (this.state) {
      this.state.turnCount++;
    }
  }

  public getStatusString(): string {
    if (!this.state) return "No active goal";
    const elapsed = this.formatElapsed(Date.now() - this.state.startedAt);
    let status = `Goal: ${this.state.condition}\nElapsed: ${elapsed}\nTurns: ${this.state.turnCount}`;
    if (this.state.lastReason) {
      status += `\nLast evaluation: ${this.state.lastReason}`;
    }
    return status;
  }

  /**
   * Check circuit breakers. Returns a clear reason if goal should be force-cleared, null otherwise.
   */
  public checkCircuitBreakers(): string | null {
    if (!this.state) return null;

    if (this.state.turnCount >= MAX_GOAL_TURNS) {
      return `Goal cancelled: maximum turns (${MAX_GOAL_TURNS}) exceeded`;
    }

    if (Date.now() - this.state.startedAt >= MAX_GOAL_DURATION_MS) {
      return `Goal cancelled: time limit (${MAX_GOAL_DURATION_MS / 60000} minutes) exceeded`;
    }

    if (this.state.consecutiveEvalFailures >= MAX_CONSECUTIVE_EVAL_FAILURES) {
      return `Goal cancelled: ${MAX_CONSECUTIVE_EVAL_FAILURES} consecutive evaluation failures`;
    }

    return null;
  }

  /**
   * Evaluate whether the goal has been met using the fast model.
   */
  public async evaluateGoal(abortSignal?: AbortSignal): Promise<{
    isMet: boolean;
    reason: string;
  }> {
    if (!this.state) {
      return { isMet: false, reason: "No active goal" };
    }

    try {
      const messages = this.messageManager.getMessages();
      const apiMessages = convertMessagesForAPI(messages);
      const gatewayConfig = this.aiManager.getGatewayConfig();
      const modelConfig = this.aiManager.getModelConfig();
      const fastModel = modelConfig.fastModel || modelConfig.model;
      if (!fastModel) {
        return {
          isMet: false,
          reason: "No model configured for goal evaluation",
        };
      }

      this.onGoalEvaluating?.(true);
      const result = await aiEvaluateGoal({
        gatewayConfig,
        modelConfig,
        model: fastModel,
        goalCondition: this.state.condition,
        messages: apiMessages,
        abortSignal,
      });

      // Track evaluation tokens separately
      if (result.usage) {
        const usage: Usage = {
          ...result.usage,
          operation_type: "goal_evaluation",
          model: fastModel,
        };
        this.messageManager.addUsage(usage);
      }

      // Reset failure counter on success
      this.state.consecutiveEvalFailures = 0;

      this.onGoalEvaluating?.(false);

      // Parse the response
      return this.parseEvaluationResponse(result.content);
    } catch (error) {
      this.onGoalEvaluating?.(false);
      this.state.consecutiveEvalFailures++;
      logger?.warn(
        `[Goal] Evaluation failed (${this.state.consecutiveEvalFailures}/${MAX_CONSECUTIVE_EVAL_FAILURES}): ${(error as Error).message}`,
      );
      return {
        isMet: false,
        reason: `Evaluation failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Parse the evaluation response from the fast model.
   */
  private parseEvaluationResponse(content: string): {
    isMet: boolean;
    reason: string;
  } {
    // Try direct JSON parse
    try {
      const parsed = JSON.parse(content);
      if (typeof parsed.met === "boolean") {
        return {
          isMet: parsed.met,
          reason: parsed.reason || "No reason provided",
        };
      }
    } catch {
      // Fall through to regex
    }

    // Try regex extraction
    const metMatch = content.match(/"met"\s*:\s*(true|false)/);
    const reasonMatch = content.match(/"reason"\s*:\s*"([^"]*)"/);
    if (metMatch) {
      return {
        isMet: metMatch[1] === "true",
        reason: reasonMatch?.[1] || "No reason provided",
      };
    }

    // Default: not met
    return { isMet: false, reason: "Could not parse evaluation response" };
  }

  private formatElapsed(ms: number): string {
    const minutes = Math.floor(ms / 60000);
    if (minutes < 1) return "<1m";
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMin = minutes % 60;
    return `${hours}h${remainingMin}m`;
  }
}
