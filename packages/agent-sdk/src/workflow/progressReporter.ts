import type {
  WorkflowPhaseState,
  WorkflowMeta,
  WorkflowProgressEvent,
} from "./types.js";

export class ProgressReporter {
  private phases: WorkflowPhaseState[] = [];
  private currentPhaseIndex = -1;
  private agentCounter = 0;
  private listeners: Array<(event: WorkflowProgressEvent) => void> = [];
  private runId: string;

  constructor(
    private meta: WorkflowMeta,
    runId?: string,
  ) {
    this.runId = runId || "";
    // Pre-initialize phases from meta so they appear even if the script
    // doesn't call phase() explicitly
    if (meta.phases?.length) {
      for (const p of meta.phases) {
        this.phases.push({
          title: p.title,
          agentCount: 0,
          tokens: 0,
          elapsed: 0,
          startTime: Date.now(),
        });
      }
      // Default to the first phase so agentStarted/agentCompleted
      // track into it even without an explicit phase() call
      this.currentPhaseIndex = 0;
    }
  }

  setPhase(title: string): void {
    // Emit phase_completed for the previous phase
    if (this.currentPhaseIndex >= 0) {
      this.emit({
        type: "phase_completed",
        phaseIndex: this.currentPhaseIndex,
      });
    }

    const existing = this.phases.findIndex((p) => p.title === title);
    if (existing >= 0) {
      this.currentPhaseIndex = existing;
    } else {
      this.phases.push({
        title,
        agentCount: 0,
        tokens: 0,
        elapsed: 0,
        startTime: Date.now(),
      });
      this.currentPhaseIndex = this.phases.length - 1;
    }

    this.emit({
      type: "phase_started",
      phaseIndex: this.currentPhaseIndex,
    });
  }

  agentStarted(): void {
    this.agentCounter++;
    if (this.currentPhaseIndex >= 0) {
      this.phases[this.currentPhaseIndex].agentCount++;
    }
    this.emit({
      type: "agent_started",
      phaseIndex: this.currentPhaseIndex,
      agentIndex: this.agentCounter - 1,
    });
  }

  agentCompleted(tokens: number): void {
    if (this.currentPhaseIndex >= 0) {
      this.phases[this.currentPhaseIndex].tokens += tokens;
      this.phases[this.currentPhaseIndex].elapsed =
        Date.now() - this.phases[this.currentPhaseIndex].startTime;
    }
    this.emit({
      type: "agent_completed",
      phaseIndex: this.currentPhaseIndex,
      agentIndex: this.agentCounter - 1,
    });
  }

  agentFailed(agentIndex: number): void {
    this.emit({
      type: "agent_failed",
      phaseIndex: this.currentPhaseIndex,
      agentIndex,
    });
  }

  formatSummary(): string {
    const phaseInfo =
      this.currentPhaseIndex >= 0
        ? `Phase ${this.currentPhaseIndex + 1}/${this.phases.length}: ${this.phases[this.currentPhaseIndex].title}`
        : "Initializing";
    const totalTokens = this.phases.reduce((sum, p) => sum + p.tokens, 0);
    const elapsed = this.phases.reduce((sum, p) => sum + p.elapsed, 0);
    return `${phaseInfo} | ${this.agentCounter} agents | ${(totalTokens / 1000).toFixed(1)}k tokens | ${Math.round(elapsed / 1000)}s`;
  }

  getPhaseStates(): WorkflowPhaseState[] {
    return [...this.phases];
  }

  get totalAgents(): number {
    return this.agentCounter;
  }

  get totalTokens(): number {
    return this.phases.reduce((sum, p) => sum + p.tokens, 0);
  }

  onEvent(listener: (event: WorkflowProgressEvent) => void): void {
    this.listeners.push(listener);
  }

  private emit(
    event: Omit<WorkflowProgressEvent, "runId" | "timestamp">,
  ): void {
    const fullEvent: WorkflowProgressEvent = {
      ...event,
      runId: this.runId,
      timestamp: Date.now(),
    };
    for (const listener of this.listeners) {
      try {
        listener(fullEvent);
      } catch {
        // Swallow listener errors
      }
    }
  }
}
