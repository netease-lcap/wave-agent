export interface MarketplaceAddFormState {
  source: string;
  scopeIndex: number;
  step: "source" | "scope";
}

export type MarketplaceAddFormAction =
  | { type: "SET_SOURCE"; source: string }
  | { type: "SET_SCOPE_INDEX"; index: number }
  | { type: "SET_STEP"; step: "source" | "scope" }
  | { type: "INSERT_CHAR"; text: string }
  | { type: "DELETE_CHAR" }
  | { type: "BACK_TO_SOURCE" };

export function marketplaceAddFormReducer(
  state: MarketplaceAddFormState,
  action: MarketplaceAddFormAction,
): MarketplaceAddFormState {
  switch (action.type) {
    case "SET_SOURCE":
      return { ...state, source: action.source };
    case "SET_SCOPE_INDEX":
      return { ...state, scopeIndex: action.index };
    case "SET_STEP":
      return { ...state, step: action.step };
    case "INSERT_CHAR":
      return { ...state, source: state.source + action.text };
    case "DELETE_CHAR":
      return { ...state, source: state.source.slice(0, -1) };
    case "BACK_TO_SOURCE":
      return { ...state, step: "source" };
    default:
      return state;
  }
}
