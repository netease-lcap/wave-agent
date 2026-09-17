import { vi } from "vitest";

/**
 * How long a keypress-driven assertion may wait for Ink to react. The default
 * 1s waitFor is tight when the whole monorepo suite runs in parallel, and the
 * budget has to stay below the per-test timeout.
 */
export const KEYPRESS_TIMEOUT = { timeout: 10_000, interval: 25 } as const;

/**
 * Press a key until the component reacts to it.
 *
 * Ink hands input to `useInput` through a subscription that the component
 * registers in a passive effect, while the frame is painted during the commit
 * that precedes it. A component mounted from an async state update — a session
 * list load, a panel that opens once its data arrives — therefore has a window
 * where its content is on screen but a key is dropped without a trace (verified
 * by instrumenting the handler: the key never arrives). Re-sending the key
 * inside `waitFor` closes that window; `reaction` is what pins the behavior,
 * and re-sending after it took effect is harmless for the callers here, because
 * the target either unmounts or ignores the extra key.
 */
export const pressKey = async (
  stdin: { write: (data: string) => void },
  key: string,
  reaction: () => void,
) => {
  await vi.waitFor(() => {
    stdin.write(key);
    reaction();
  }, KEYPRESS_TIMEOUT);
};
