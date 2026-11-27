/**
 * Unhandled rejections the REPL owns, plus the note a host logs for them.
 *
 * A script that leaves a promise unread — `Promise.reject(...)` on its own line,
 * a loop inside an async function nobody awaited — rejects after `run()` has
 * already answered. The run promise the caller holds is `pending`, the wrapper's
 * own; the promises script code creates have nobody holding them, so Node
 * reports them on `unhandledRejection`, where a host that treats that event as a
 * crash loses the whole process over a script that merely forgot an `await`.
 *
 * Two kinds are ours, and neither one is a guess:
 *
 * - the error a stop threw (step budget / wall clock), marked at the throw site
 *   by {@link markStoppedError};
 * - any promise created inside a sandbox realm, recognised by its prototype.
 *
 * Same split as Claude Code's claim table and its `markStop` WeakSet.
 */

/** Logged instead of crashing: a stop that script code threw and never observed. */
export const REPL_STOPPED_REJECTION_NOTE =
  "REPL: swallowed an unhandled rejection (not exiting): the step budget or the wall clock stopped script code that nothing awaited";

/** Logged instead of crashing: a promise the script left unread was rejected. */
export const REPL_UNREAD_REJECTION_NOTE =
  "REPL: swallowed an unhandled rejection (not exiting): a promise that a script left unread was rejected";

const stoppedErrors = new WeakSet<object>();
/** What a realm owns: its `Promise.prototype` and `Error.prototype`. */
const realmPrototypes = new WeakSet<object>();

const isObject = (value: unknown): value is object =>
  typeof value === "object" && value !== null;

/**
 * Mark the error a stop threw, so a later rejection carrying it is claimed
 * below. Called from inside the realm, on the realm's own error: object
 * identity crosses the boundary, so the marker lands on the value Node reports.
 */
export function markStoppedError(error: unknown): void {
  if (isObject(error)) stoppedErrors.add(error);
}

/** Register what a realm owns, so values created inside it are recognisable. */
export function markRealmPrototype(prototype: unknown): void {
  if (isObject(prototype)) realmPrototypes.add(prototype);
}

/** A promise or an error reaches its realm's prototype within two links. */
const MAX_PROTOTYPE_DEPTH = 4;

function isFromRealm(value: unknown): boolean {
  if (!isObject(value)) return false;
  let prototype: unknown = Object.getPrototypeOf(value);
  for (
    let depth = 0;
    depth < MAX_PROTOTYPE_DEPTH && isObject(prototype);
    depth++
  ) {
    if (realmPrototypes.has(prototype)) return true;
    prototype = Object.getPrototypeOf(prototype);
  }
  return false;
}

/**
 * The note to log for a rejection the REPL owns, or `null` when the rejection is
 * the host's to crash on. `promise` is the second `unhandledRejection`
 * argument: it settles which realm created the rejected promise, while the
 * reason settles whether a stop threw it.
 */
export function claimUnhandledRejection(
  reason: unknown,
  promise?: unknown,
): string | null {
  if (isObject(reason) && stoppedErrors.has(reason)) {
    return REPL_STOPPED_REJECTION_NOTE;
  }
  if (isFromRealm(promise) || isFromRealm(reason)) {
    return REPL_UNREAD_REJECTION_NOTE;
  }
  return null;
}
