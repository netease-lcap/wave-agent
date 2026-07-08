import { Key } from "ink";

export const SCOPES = ["user", "project", "local"] as const;
export type Scope = (typeof SCOPES)[number];

export interface MarketplaceAddFormState {
  source: string;
  scopeIndex: number;
  step: "source" | "scope";
  pendingAction:
    | { type: "submit"; source: string; scope: Scope }
    | { type: "cancel" }
    | null;
}

export type MarketplaceAddFormAction =
  | { type: "HANDLE_KEY"; key: Key; input: string; isLoading: boolean }
  | { type: "CLEAR_PENDING_ACTION" };

export function marketplaceAddFormReducer(
  state: MarketplaceAddFormState,
  action: MarketplaceAddFormAction,
): MarketplaceAddFormState {
  switch (action.type) {
    case "HANDLE_KEY": {
      const { key, input, isLoading } = action;

      // Escape always works, even during loading
      if (key.escape) {
        if (state.step === "scope") {
          return { ...state, step: "source" };
        }
        return { ...state, pendingAction: { type: "cancel" } };
      }

      // Ignore all other input during loading
      if (isLoading) return state;

      if (state.step === "source") {
        if (key.return) {
          if (state.source.trim()) {
            return { ...state, step: "scope" };
          }
          return state;
        }
        if (key.backspace || key.delete) {
          return { ...state, source: state.source.slice(0, -1) };
        }
        if (input && !key.ctrl && !key.meta && !("alt" in key && key.alt)) {
          return { ...state, source: state.source + input };
        }
        return state;
      }

      // step === "scope"
      if (key.upArrow) {
        return { ...state, scopeIndex: Math.max(0, state.scopeIndex - 1) };
      }
      if (key.downArrow) {
        return {
          ...state,
          scopeIndex: Math.min(SCOPES.length - 1, state.scopeIndex + 1),
        };
      }
      if (key.return) {
        return {
          ...state,
          pendingAction: {
            type: "submit",
            source: state.source.trim(),
            scope: SCOPES[state.scopeIndex],
          },
        };
      }
      return state;
    }
    case "CLEAR_PENDING_ACTION":
      return { ...state, pendingAction: null };
    default:
      return state;
  }
}
