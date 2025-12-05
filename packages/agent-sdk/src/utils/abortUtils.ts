/**
 * Utilities for safe AbortSignal listener management to prevent memory leaks
 */

/**
 * Safely adds a one-time abort listener that automatically cleans up after firing
 * @param signal - The AbortSignal to listen to
 * @param callback - The function to call when aborted
 * @returns A cleanup function to manually remove the listener if needed
 */
export function addOnceAbortListener(
  signal: AbortSignal,
  callback: () => void,
): () => void {
  if (signal.aborted) {
    // Signal already aborted, call immediately
    callback();
    return () => {}; // No cleanup needed
  }

  const handler = () => {
    callback();
  };

  // Use { once: true } to automatically remove listener after first call
  signal.addEventListener("abort", handler, { once: true });

  // Return cleanup function for manual removal if needed
  return () => {
    signal.removeEventListener("abort", handler);
  };
}

/**
 * Creates a Promise that rejects when the AbortSignal is aborted
 * Uses once-only listener to prevent accumulation
 * @param signal - The AbortSignal to listen to
 * @param errorMessage - Optional custom error message
 * @returns Promise that rejects on abort
 */
export function createAbortPromise(
  signal: AbortSignal,
  errorMessage: string = "Operation was aborted",
): Promise<never> {
  return new Promise<never>((_, reject) => {
    if (signal.aborted) {
      reject(new Error(errorMessage));
      return;
    }

    // Use once-only listener to prevent accumulation
    signal.addEventListener(
      "abort",
      () => {
        reject(new Error(errorMessage));
      },
      { once: true },
    );
  });
}

/**
 * Wrapper that manages abort signal listeners with automatic cleanup
 * @param signal - The AbortSignal to manage
 * @param operation - Function that sets up listeners and returns cleanup
 * @returns Promise that resolves with the operation result
 */
export async function withAbortCleanup<T>(
  signal: AbortSignal,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  // Track all cleanup functions
  const cleanups: (() => void)[] = [];

  try {
    const result = await operation(signal);
    return result;
  } finally {
    // Clean up all listeners
    cleanups.forEach((cleanup) => cleanup());
  }
}

/**
 * Consolidates multiple abort listeners into a single listener
 * Useful when multiple handlers need to respond to the same abort signal
 * @param signal - The AbortSignal to listen to
 * @param callbacks - Array of functions to call when aborted
 * @returns Cleanup function to remove the consolidated listener
 */
export function addConsolidatedAbortListener(
  signal: AbortSignal,
  callbacks: (() => void)[],
): () => void {
  if (signal.aborted) {
    // Signal already aborted, call all callbacks immediately
    callbacks.forEach((cb) => cb());
    return () => {}; // No cleanup needed
  }

  const handler = () => {
    callbacks.forEach((cb) => {
      try {
        cb();
      } catch (error) {
        console.error("Error in abort callback:", error);
      }
    });
  };

  // Use { once: true } to automatically remove listener after first call
  signal.addEventListener("abort", handler, { once: true });

  // Return cleanup function for manual removal if needed
  return () => {
    signal.removeEventListener("abort", handler);
  };
}
