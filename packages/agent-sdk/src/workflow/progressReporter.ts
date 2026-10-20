import type {
  WorkflowPhaseState,
  WorkflowMeta,
  WorkflowProgressEvent,
} from "./types.js";

export class ProgressReporter {
  private phases: WorkflowPhaseState[] = [];
  private currentPhaseIndex = -1;
  private agentCounter = 0;
  /**
   * Run-level token tally, kept apart from the per-phase sums: a script that
   * never calls `phase()` and declares no `meta.phases` has no active phase at
   * all (`currentPhaseIndex === -1`), and its spend still belongs in the run's
   * total — the completion notification's `<subagent_tokens>` and the size
   * warning both read this number.
   */
  private tokenCounter = 0;
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
      this.closeCurrentPhase();
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
    this.tokenCounter += tokens;
    if (this.currentPhaseIndex >= 0) {
      this.phases[this.currentPhaseIndex].tokens += tokens;
      this.closeCurrentPhase();
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

  /**
   * Settle the phase that is still open when the run ends early — a stop, an
   * abort, or a script throwing mid-agent. `agentCompleted` is otherwise the
   * only writer of `elapsed`, so a run stopped while its agents were in flight
   * snapshotted the phase it was actually in as `0ms` (the phase's tokens stay
   * at what finished agents reported: an interrupted agent never reports its
   * spend, so there is nothing to add).
   */
  finalize(): void {
    if (this.currentPhaseIndex >= 0) this.closeCurrentPhase();
  }

  private closeCurrentPhase(): void {
    const phase = this.phases[this.currentPhaseIndex];
    if (phase) phase.elapsed = Date.now() - phase.startTime;
  }

  formatSummary(): string {
    const phaseInfo =
      this.currentPhaseIndex >= 0
        ? `Phase ${this.currentPhaseIndex + 1}/${this.phases.length}: ${this.phases[this.currentPhaseIndex].title}`
        : "Initializing";
    const elapsed = this.phases.reduce((sum, p) => sum + p.elapsed, 0);
    return `${phaseInfo} | ${this.agentCounter} agents | ${(this.tokenCounter / 1000).toFixed(1)}k tokens | ${Math.round(elapsed / 1000)}s`;
  }

  getPhaseStates(): WorkflowPhaseState[] {
    return [...this.phases];
  }

  get totalAgents(): number {
    return this.agentCounter;
  }

  get totalTokens(): number {
    return this.tokenCounter;
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
