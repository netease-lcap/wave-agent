import { vi } from "vitest";

// vitest spells the polling interval out inside `waitFor` itself
// (`const { interval = 50, timeout = 1e3 } = options`), so there is no config
// knob — wrapping `vi.waitFor` in a setup file is the only way to change the
// default without editing every call site.
const WAIT_FOR_INTERVAL_MS = 5;

const waitForWithDefaultInterval = vi.waitFor.bind(vi);

/**
 * Poll every 5ms instead of vitest's 50ms.
 *
 * Ink components settle within a frame or two, so the default interval charged
 * every `vi.waitFor` a full 50ms tick even when the frame was already painted:
 * on this package's unit suite it accounted for ~26s of the ~78s of test time
 * (1138 calls, 932 of which needed a second attempt). Callers that pass their
 * own `interval`/`timeout` keep them.
 */
vi.waitFor = ((callback, options) =>
  waitForWithDefaultInterval(callback, {
    interval: WAIT_FOR_INTERVAL_MS,
    ...(typeof options === "number" ? { timeout: options } : options),
  })) as typeof vi.waitFor;
