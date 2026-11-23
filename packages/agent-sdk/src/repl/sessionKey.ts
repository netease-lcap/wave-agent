/**
 * The identity of one REPL context: one `(session, agent)` pair.
 *
 * A context is long-lived — variables, functions and timers survive across scripts
 * and turns — so the key has to be stable for as long as the agent lives, and has to
 * separate a subagent from the agent that spawned it. Session alone is not enough:
 * a subagent runs in the same session as its parent, and sharing one context would
 * let two conversations overwrite each other's variables.
 *
 * The session half is recomputed from `MessageManager` on every call rather than
 * cached, because `/clear` and session resume replace it; the agent half is fixed
 * for the manager's lifetime.
 */
let nextAgentSlot = 1;

/** A slot number for one agent manager. Unique within the process. */
export function allocateAgentSlot(): number {
  const slot = nextAgentSlot;
  nextAgentSlot += 1;
  return slot;
}

/** The key one agent's context is filed under. */
export function replSessionKey(sessionId: string, agentSlot: number): string {
  return `${sessionId}::${agentSlot}`;
}
