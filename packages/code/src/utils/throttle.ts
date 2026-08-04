export interface ThrottleOptions {
  leading?: boolean;
  trailing?: boolean;
}

export interface ThrottledFunction<A extends unknown[]> {
  (...args: A): void;
  cancel: () => void;
  flush: () => void;
}

/**
 * Creates a throttled function that only invokes `func` at most once per
 * every `wait` milliseconds.
 */
export function throttle<A extends unknown[]>(
  func: (...args: A) => void,
  wait: number,
  options: ThrottleOptions = { leading: true, trailing: true },
): ThrottledFunction<A> {
  let timeoutId: NodeJS.Timeout | null = null;
  let lastArgs: A | null = null;
  let lastCallTime = 0;

  const invokeFunc = () => {
    if (lastArgs) {
      func(...lastArgs);
      lastCallTime = Date.now();
      lastArgs = null;
    }
  };

  const throttled = (...args: A) => {
    const now = Date.now();
    const remaining = wait - (now - lastCallTime);

    lastArgs = args;

    if (remaining <= 0 || remaining > wait) {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (options.leading !== false || lastCallTime !== 0) {
        invokeFunc();
      } else {
        lastCallTime = now;
      }
    } else if (!timeoutId && options.trailing !== false) {
      timeoutId = setTimeout(() => {
        timeoutId = null;
        invokeFunc();
      }, remaining);
    }
  };

  throttled.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    lastArgs = null;
    lastCallTime = 0;
  };

  throttled.flush = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    invokeFunc();
  };

  return throttled as ThrottledFunction<A>;
}
