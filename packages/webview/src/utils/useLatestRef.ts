import { useRef } from "react";

/**
 * Ref that always holds the latest value handed in.
 *
 * Effects and stable handlers read callbacks through this instead of listing
 * them in their dependencies, so an inline arrow from the parent — a new
 * identity on every render — cannot re-run the effect for a reason unrelated to
 * the data it guards (`useRovingMenu` keeps its options the same way).
 *
 * The ref is written during render, not in an effect: effects of the same
 * commit have to see the value the render they belong to just passed in. It is
 * only read from effects/handlers, never during render, so the render output
 * does not depend on it.
 */
export function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
