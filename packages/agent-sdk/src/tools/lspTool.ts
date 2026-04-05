import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { relative, join, isAbsolute } from "path";
import * as fs from "fs";
import { logger } from "../utils/globalLogger.js";
import { getDisplayPath } from "../utils/path.js";
import { LSP_TOOL_NAME } from "../constants/tools.js";
import type {
  LspLocation as Location,
  LspLocationLink as LocationLink,
  LspHover as Hover,
  LspSymbolInformation as SymbolInformation,
  LspDocumentSymbol as DocumentSymbol,
  LspCallHierarchyItem as CallHierarchyItem,
  LspCallHierarchyIncomingCall as CallHierarchyIncomingCall,
  LspCallHierarchyOutgoingCall as CallHierarchyOutgoingCall,
} from "../types/lsp.js";
import { validationError, requireString } from "./validation.js";

export const MAX_RESULTS = 1000;
export const MAX_FILES = 100;

/**
 * Formats an LSP URI into a readable file path
 */
function formatUri(uri: string, workdir?: string): string {
  if (!uri) {
    logger.warn(
      "formatUri called with undefined URI - indicates malformed LSP server response",
    );
    return "<unknown location>";
  }

  let path = uri.replace(/^file:\/\//, "");
  try {
    path = decodeURIComponent(path);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.warn(
      `Failed to decode LSP URI '${uri}': ${message}. Using un-decoded path: ${path}`,
    );
  }

  if (workdir) {
    const relativePath = relative(workdir, path);
    if (
      relativePath.length < path.length &&
      !relativePath.startsWith("../../")
    ) {
      return relativePath;
    }
  }
  return path;
}

/**
 * Formats an error message when no results are found, including context from the file
 */
function formatNoResultError(
  message: string,
  filePath: string,
  line: number,
  character: number,
  workdir?: string,
): string {
  let absolutePath = filePath;
  if (!isAbsolute(filePath) && workdir) {
    absolutePath = join(workdir, filePath);
  }

  let lineContent = "";
  try {
    const content = fs.readFileSync(absolutePath, "utf-8");
    const lines = content.split("\n");
    if (line > 0 && line <= lines.length) {
      lineContent = lines[line - 1];
    }
  } catch {
    // Ignore file read errors
  }

  const displayPath = getDisplayPath(filePath, workdir || "");
  const baseMessage = `${message}\n\nPlease check if the character offset is correct and points to a valid symbol.`;

  if (lineContent) {
    const pointer = " ".repeat(Math.max(0, character - 1)) + "^";
    return `${message}\n\nContext at ${displayPath}:${line}:${character}:\n${lineContent}\n${pointer}\n\nPlease check if the character offset is correct and points to a valid symbol.`;
  }

  return baseMessage;
}

/**
 * Groups items by their URI
 */
function groupItemsByUri<
  T extends { uri: string } | { location: Location } | LocationLink,
>(items: T[], workdir?: string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    let uri: string;
    if ("uri" in item) {
      uri = item.uri;
    } else if ("location" in item) {
      uri = item.location.uri;
    } else {
      uri = item.targetUri;
    }
    const path = formatUri(uri, workdir);
    const existing = map.get(path);
    if (existing) {
      existing.push(item);
    } else {
      map.set(path, [item]);
    }
  }
  return map;
}

/**
 * Formats a single location as path:line:character
 */
function formatLocation(loc: Location, workdir?: string): string {
  const path = formatUri(loc.uri, workdir);
  const line = loc.range.start.line + 1;
  const character = loc.range.start.character + 1;
  return `${path}:${line}:${character}`;
}

/**
 * Converts a LocationLink to a Location
 */
function locationLinkToLocation(link: LocationLink): Location {
  return {
    uri: link.targetUri,
    range: link.targetSelectionRange || link.targetRange,
  };
}

/**
 * Checks if an object is a LocationLink
 */
function isLocationLink(loc: Location | LocationLink): loc is LocationLink {
  return "targetUri" in loc;
}

/**
 * Formats the result of a goToDefinition operation
 */
function formatGoToDefinitionResult(
  result: Location | Location[] | LocationLink | LocationLink[] | null,
  filePath: string,
  line: number,
  character: number,
  operation: string,
  workdir?: string,
): string {
  const message =
    operation === "goToImplementation"
      ? "No implementation found. This may occur if the cursor is not on a symbol, or if the implementation is in an external library not indexed by the LSP server."
      : "No definition found. This may occur if the cursor is not on a symbol, or if the definition is in an external library not indexed by the LSP server.";

  if (!result) {
    return formatNoResultError(message, filePath, line, character, workdir);
  }

  if (Array.isArray(result)) {
    const locations = result.map((loc) =>
      isLocationLink(loc) ? locationLinkToLocation(loc) : loc,
    );
    const validLocations = locations.filter((loc) => loc && loc.uri);

    if (validLocations.length === 0) {
      return formatNoResultError(message, filePath, line, character, workdir);
    }

    if (validLocations.length === 1) {
      return `Defined in ${formatLocation(validLocations[0], workdir)}`;
    }

    const shownLocations = validLocations.slice(0, MAX_RESULTS);
    const formatted = shownLocations
      .map((loc) => `  ${formatLocation(loc, workdir)}`)
      .join("\n");

    let header = `Found ${validLocations.length} definitions:`;
    if (validLocations.length > MAX_RESULTS) {
      header += ` (showing first ${MAX_RESULTS})`;
    }
    return `${header}\n${formatted}`;
  }

  const loc = isLocationLink(result) ? locationLinkToLocation(result) : result;
  return `Defined in ${formatLocation(loc, workdir)}`;
}

/**
 * Formats the result of a findReferences operation
 */
function formatFindReferencesResult(
  result: Location[] | null,
  filePath: string,
  line: number,
  character: number,
  workdir?: string,
): string {
  const message =
    "No references found. This may occur if the symbol has no usages, or if the LSP server has not fully indexed the workspace.";

  if (!result || result.length === 0) {
    return formatNoResultError(message, filePath, line, character, workdir);
  }

  const validLocations = result.filter((loc) => loc && loc.uri);
  if (validLocations.length === 0) {
    return formatNoResultError(message, filePath, line, character, workdir);
  }

  if (validLocations.length === 1) {
    return `Found 1 reference:\n  ${formatLocation(validLocations[0], workdir)}`;
  }

  const grouped = groupItemsByUri(validLocations, workdir);
  const totalResults = validLocations.length;
  const totalFiles = grouped.size;

  let resultsShown = 0;
  let filesShown = 0;
  const lines: string[] = [];

  for (const [path, locs] of grouped) {
    if (resultsShown >= MAX_RESULTS || filesShown >= MAX_FILES) break;

    filesShown++;
    const remainingResults = MAX_RESULTS - resultsShown;
    const locsToShow = locs.slice(0, remainingResults);
    const isTruncated = locsToShow.length < locs.length;

    lines.push(`\n${path}:`);
    for (const loc of locsToShow) {
      const line = loc.range.start.line + 1;
      const character = loc.range.start.character + 1;
      lines.push(`  Line ${line}:${character}`);
    }

    if (isTruncated) {
      lines.push(
        `  ... and ${locs.length - locsToShow.length} more in this file`,
      );
    }

    resultsShown += locsToShow.length;
  }

  let header = `Found ${totalResults} references across ${totalFiles} files:`;
  if (totalResults > resultsShown || totalFiles > filesShown) {
    header += ` (showing first ${resultsShown} results and ${filesShown} files)`;
  }
  lines.unshift(header);

  return lines.join("\n");
}

/**
 * Formats hover contents
 */
function formatHoverContents(contents: Hover["contents"]): string {
  if (Array.isArray(contents)) {
    return contents
      .map((c) => (typeof c === "string" ? c : c.value))
      .join("\n\n");
  }
  if (typeof contents === "string") {
    return contents;
  }
  return contents.value;
}

/**
 * Formats the result of a hover operation
 */
function formatHoverResult(
  result: Hover | null,
  filePath: string,
  line: number,
  character: number,
  workdir?: string,
): string {
  if (!result) {
    return formatNoResultError(
      "No hover information available. This may occur if the cursor is not on a symbol, or if the LSP server has not fully indexed the file.",
      filePath,
      line,
      character,
      workdir,
    );
  }

  const contents = formatHoverContents(result.contents);
  if (result.range) {
    const line = result.range.start.line + 1;
    const character = result.range.start.character + 1;
    return `Hover info at ${line}:${character}:\n\n${contents}`;
  }
  return contents;
}

/**
 * Gets the name of a symbol kind
 */
function getSymbolKindName(kind: number): string {
  const kinds: Record<number, string> = {
    1: "File",
    2: "Module",
    3: "Namespace",
    4: "Package",
    5: "Class",
    6: "Method",
    7: "Property",
    8: "Field",
    9: "Constructor",
    10: "Enum",
    11: "Interface",
    12: "Function",
    13: "Variable",
    14: "Constant",
    15: "String",
    16: "Number",
    17: "Boolean",
    18: "Array",
    19: "Object",
    20: "Key",
    21: "Null",
    22: "EnumMember",
    23: "Struct",
    24: "Event",
    25: "Operator",
    26: "TypeParameter",
  };
  return kinds[kind] || "Unknown";
}

/**
 * Formats a single document symbol recursively
 */
function formatDocumentSymbol(
  symbol: DocumentSymbol,
  state: { count: number; total: number },
  depth = 0,
): string[] {
  state.total++;
  const results: string[] = [];

  if (state.count < MAX_RESULTS) {
    const indent = "  ".repeat(depth);
    const kindName = getSymbolKindName(symbol.kind);
    let line = `${indent}${symbol.name} (${kindName})`;

    if (symbol.detail) {
      line += ` ${symbol.detail}`;
    }

    const startLine = symbol.range.start.line + 1;
    line += ` - Line ${startLine}`;
    results.push(line);
    state.count++;
  }

  if (symbol.children && symbol.children.length > 0) {
    for (const child of symbol.children) {
      results.push(...formatDocumentSymbol(child, state, depth + 1));
    }
  }

  return results;
}

/**
 * Formats the result of a documentSymbol operation
 */
function formatDocumentSymbolResult(
  result: DocumentSymbol[] | SymbolInformation[] | null,
  workdir?: string,
): string {
  if (!result || result.length === 0) {
    return "No symbols found in document. This may occur if the file is empty, not supported by the LSP server, or if the server has not fully indexed the file.";
  }

  const first = result[0];
  if (first && "location" in first) {
    return formatWorkspaceSymbolResult(result as SymbolInformation[], workdir);
  }

  const state = { count: 0, total: 0 };
  const lines: string[] = [];
  for (const symbol of result as DocumentSymbol[]) {
    lines.push(...formatDocumentSymbol(symbol, state));
  }

  let header = "Document symbols:";
  if (state.total > MAX_RESULTS) {
    header += ` (showing first ${MAX_RESULTS} of ${state.total})`;
  }
  lines.unshift(header);

  return lines.join("\n");
}

/**
 * Formats the result of a workspaceSymbol operation
 */
function formatWorkspaceSymbolResult(
  result: SymbolInformation[] | null,
  workdir?: string,
): string {
  if (!result || result.length === 0) {
    return "No symbols found in workspace. This may occur if the workspace is empty, or if the LSP server has not finished indexing the project.";
  }

  const validSymbols = result.filter((s) => s && s.location && s.location.uri);
  if (validSymbols.length === 0) {
    return "No symbols found in workspace. This may occur if the workspace is empty, or if the LSP server has not finished indexing the project.";
  }

  const grouped = groupItemsByUri(validSymbols, workdir);
  const totalResults = validSymbols.length;
  const totalFiles = grouped.size;

  let resultsShown = 0;
  let filesShown = 0;
  const lines: string[] = [];

  for (const [path, symbols] of grouped) {
    if (resultsShown >= MAX_RESULTS || filesShown >= MAX_FILES) break;

    filesShown++;
    const remainingResults = MAX_RESULTS - resultsShown;
    const symbolsToShow = symbols.slice(0, remainingResults);
    const isTruncated = symbolsToShow.length < symbols.length;

    lines.push(`\n${path}:`);
    for (const s of symbolsToShow) {
      const kindName = getSymbolKindName(s.kind);
      const startLine = s.location.range.start.line + 1;
      let line = `  ${s.name} (${kindName}) - Line ${startLine}`;
      if (s.containerName) {
        line += ` in ${s.containerName}`;
      }
      lines.push(line);
    }

    if (isTruncated) {
      lines.push(
        `  ... and ${symbols.length - symbolsToShow.length} more in this file`,
      );
    }

    resultsShown += symbolsToShow.length;
  }

  let header = `Found ${totalResults} symbol${totalResults === 1 ? "" : "s"} in workspace:`;
  if (totalResults > resultsShown || totalFiles > filesShown) {
    header += ` (showing first ${resultsShown} results and ${filesShown} files)`;
  }
  lines.unshift(header);

  return lines.join("\n");
}

/**
 * Formats a call hierarchy item
 */
function formatCallHierarchyItem(
  item: CallHierarchyItem,
  workdir?: string,
): string {
  if (!item.uri) {
    logger.warn("formatCallHierarchyItem: CallHierarchyItem has undefined URI");
    return `${item.name} (${getSymbolKindName(item.kind)}) - <unknown location>`;
  }

  const path = formatUri(item.uri, workdir);
  const startLine = item.range.start.line + 1;
  const kindName = getSymbolKindName(item.kind);
  let line = `${item.name} (${kindName}) - ${path}:${startLine}`;

  if (item.detail) {
    line += ` [${item.detail}]`;
  }
  return line;
}

/**
 * Formats the result of a prepareCallHierarchy operation
 */
function formatPrepareCallHierarchyResult(
  result: CallHierarchyItem[] | null,
  filePath: string,
  line: number,
  character: number,
  workdir?: string,
): string {
  if (!result || result.length === 0) {
    return formatNoResultError(
      "No call hierarchy item found at this position",
      filePath,
      line,
      character,
      workdir,
    );
  }

  if (result.length === 1) {
    return `Call hierarchy item: ${formatCallHierarchyItem(result[0], workdir)}`;
  }

  const shownItems = result.slice(0, MAX_RESULTS);
  const lines: string[] = [];
  for (const item of shownItems) {
    lines.push(`  ${formatCallHierarchyItem(item, workdir)}`);
  }

  let header = `Found ${result.length} call hierarchy items:`;
  if (result.length > MAX_RESULTS) {
    header += ` (showing first ${MAX_RESULTS})`;
  }
  lines.unshift(header);

  return lines.join("\n");
}

/**
 * Formats the result of an incomingCalls operation
 */
function formatIncomingCallsResult(
  result: CallHierarchyIncomingCall[] | null,
  workdir?: string,
): string {
  if (!result || result.length === 0) {
    return "No incoming calls found (nothing calls this function)";
  }

  const grouped = new Map<string, CallHierarchyIncomingCall[]>();
  const totalResults = result.length;

  for (const call of result) {
    if (!call.from) {
      logger.warn(
        "formatIncomingCallsResult: CallHierarchyIncomingCall has undefined from field",
      );
      continue;
    }
    const path = formatUri(call.from.uri, workdir);
    const existing = grouped.get(path);
    if (existing) {
      existing.push(call);
    } else {
      grouped.set(path, [call]);
    }
  }

  const totalFiles = grouped.size;
  let resultsShown = 0;
  let filesShown = 0;
  const lines: string[] = [];

  for (const [path, calls] of grouped) {
    if (resultsShown >= MAX_RESULTS || filesShown >= MAX_FILES) break;

    filesShown++;
    const remainingResults = MAX_RESULTS - resultsShown;
    const callsToShow = calls.slice(0, remainingResults);
    const isTruncated = callsToShow.length < calls.length;

    lines.push(`\n${path}:`);
    for (const call of callsToShow) {
      if (!call.from) continue;
      const kindName = getSymbolKindName(call.from.kind);
      const startLine = call.from.range.start.line + 1;
      let line = `  ${call.from.name} (${kindName}) - Line ${startLine}`;

      if (call.fromRanges && call.fromRanges.length > 0) {
        const ranges = call.fromRanges
          .map((r) => `${r.start.line + 1}:${r.start.character + 1}`)
          .join(", ");
        line += ` [calls at: ${ranges}]`;
      }
      lines.push(line);
    }

    if (isTruncated) {
      lines.push(
        `  ... and ${calls.length - callsToShow.length} more in this file`,
      );
    }

    resultsShown += callsToShow.length;
  }

  let header = `Found ${totalResults} incoming call${totalResults === 1 ? "" : "s"}:`;
  if (totalResults > resultsShown || totalFiles > filesShown) {
    header += ` (showing first ${resultsShown} results and ${filesShown} files)`;
  }
  lines.unshift(header);

  return lines.join("\n");
}

/**
 * Formats the result of an outgoingCalls operation
 */
function formatOutgoingCallsResult(
  result: CallHierarchyOutgoingCall[] | null,
  workdir?: string,
): string {
  if (!result || result.length === 0) {
    return "No outgoing calls found (this function calls nothing)";
  }

  const grouped = new Map<string, CallHierarchyOutgoingCall[]>();
  const totalResults = result.length;

  for (const call of result) {
    if (!call.to) {
      logger.warn(
        "formatOutgoingCallsResult: CallHierarchyOutgoingCall has undefined to field",
      );
      continue;
    }
    const path = formatUri(call.to.uri, workdir);
    const existing = grouped.get(path);
    if (existing) {
      existing.push(call);
    } else {
      grouped.set(path, [call]);
    }
  }

  const totalFiles = grouped.size;
  let resultsShown = 0;
  let filesShown = 0;
  const lines: string[] = [];

  for (const [path, calls] of grouped) {
    if (resultsShown >= MAX_RESULTS || filesShown >= MAX_FILES) break;

    filesShown++;
    const remainingResults = MAX_RESULTS - resultsShown;
    const callsToShow = calls.slice(0, remainingResults);
    const isTruncated = callsToShow.length < calls.length;

    lines.push(`\n${path}:`);
    for (const call of callsToShow) {
      if (!call.to) continue;
      const kindName = getSymbolKindName(call.to.kind);
      const startLine = call.to.range.start.line + 1;
      let line = `  ${call.to.name} (${kindName}) - Line ${startLine}`;

      if (call.fromRanges && call.fromRanges.length > 0) {
        const ranges = call.fromRanges
          .map((r) => `${r.start.line + 1}:${r.start.character + 1}`)
          .join(", ");
        line += ` [called from: ${ranges}]`;
      }
      lines.push(line);
    }

    if (isTruncated) {
      lines.push(
        `  ... and ${calls.length - callsToShow.length} more in this file`,
      );
    }

    resultsShown += callsToShow.length;
  }

  let header = `Found ${totalResults} outgoing call${totalResults === 1 ? "" : "s"}:`;
  if (totalResults > resultsShown || totalFiles > filesShown) {
    header += ` (showing first ${resultsShown} results and ${filesShown} files)`;
  }
  lines.unshift(header);

  return lines.join("\n");
}

/**
 * LSP tool plugin - interact with LSP servers for code intelligence
 */
export const lspTool: ToolPlugin = {
  name: LSP_TOOL_NAME,
  config: {
    type: "function",
    function: {
      name: LSP_TOOL_NAME,
      description: `Interact with Language Server Protocol (LSP) servers to get code intelligence features.`,
      parameters: {
        type: "object",
        properties: {
          operation: {
            type: "string",
            enum: [
              "goToDefinition",
              "findReferences",
              "hover",
              "documentSymbol",
              "workspaceSymbol",
              "goToImplementation",
              "prepareCallHierarchy",
              "incomingCalls",
              "outgoingCalls",
            ],
            description: "The LSP operation to perform",
          },
          filePath: {
            type: "string",
            description: "The absolute or relative path to the file",
          },
          line: {
            type: "number",
            description: "The line number (1-based, as shown in editors)",
          },
          character: {
            type: "number",
            description: "The character offset (1-based, as shown in editors)",
          },
        },
        required: ["operation", "filePath", "line", "character"],
      },
    },
  },
  prompt:
    () => `Interact with Language Server Protocol (LSP) servers to get code intelligence features.

Supported operations:
- goToDefinition: Find where a symbol is defined
- findReferences: Find all references to a symbol
- hover: Get hover information (documentation, type info) for a symbol
- documentSymbol: Get all symbols (functions, classes, variables) in a document
- workspaceSymbol: Search for symbols across the entire workspace
- goToImplementation: Find implementations of an interface or abstract method
- prepareCallHierarchy: Get call hierarchy item at a position (functions/methods)
- incomingCalls: Find all functions/methods that call the function at a position
- outgoingCalls: Find all functions/methods called by the function at a position

All operations require:
- filePath: The file to operate on
- line: The line number (1-based, as shown in editors)
- character: The character offset (1-based, as shown in editors)

Note: LSP servers must be configured for the file type. If no server is available, an error will be returned.`,
  validate: (args: Record<string, unknown>): ToolResult | null => {
    // Validate operation is required and a string
    const operationError = requireString(args, "operation");
    if (operationError) return operationError;

    // Validate filePath is required and a string
    const filePathError = requireString(args, "filePath");
    if (filePathError) return filePathError;

    // Validate line is required and a number
    const line = args.line;
    if (line === undefined || line === null) {
      return validationError("Missing required parameter: line");
    }
    if (typeof line !== "number" || !Number.isInteger(line)) {
      return validationError(
        `Parameter line must be an integer, got ${typeof line}`,
      );
    }

    // Validate character is required and a number
    const character = args.character;
    if (character === undefined || character === null) {
      return validationError("Missing required parameter: character");
    }
    if (typeof character !== "number" || !Number.isInteger(character)) {
      return validationError(
        `Parameter character must be an integer, got ${typeof character}`,
      );
    }

    return null;
  },
  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const { operation, filePath, line, character } = args as {
      operation: string;
      filePath: string;
      line: number;
      character: number;
    };

    if (!context.lspManager) {
      return {
        success: false,
        content: "",
        error: "LSP manager not available in tool context",
      };
    }

    try {
      const result = await context.lspManager.execute({
        operation,
        filePath,
        line,
        character,
      });

      if (!result.success) {
        return {
          success: false,
          content: "",
          error: result.content,
        };
      }

      const rawResult = JSON.parse(result.content);
      let formattedContent: string;
      switch (operation) {
        case "goToDefinition":
        case "goToImplementation":
          formattedContent = formatGoToDefinitionResult(
            rawResult as
              | Location
              | Location[]
              | LocationLink
              | LocationLink[]
              | null,
            filePath,
            line,
            character,
            operation,
            context.workdir,
          );
          break;
        case "findReferences":
          formattedContent = formatFindReferencesResult(
            rawResult as Location[] | null,
            filePath,
            line,
            character,
            context.workdir,
          );
          break;
        case "hover":
          formattedContent = formatHoverResult(
            rawResult as Hover | null,
            filePath,
            line,
            character,
            context.workdir,
          );
          break;
        case "documentSymbol":
          formattedContent = formatDocumentSymbolResult(
            rawResult as DocumentSymbol[] | SymbolInformation[] | null,
            context.workdir,
          );
          break;
        case "workspaceSymbol":
          formattedContent = formatWorkspaceSymbolResult(
            rawResult as SymbolInformation[] | null,
            context.workdir,
          );
          break;
        case "prepareCallHierarchy":
          formattedContent = formatPrepareCallHierarchyResult(
            rawResult as CallHierarchyItem[] | null,
            filePath,
            line,
            character,
            context.workdir,
          );
          break;
        case "incomingCalls":
          formattedContent = formatIncomingCallsResult(
            rawResult as CallHierarchyIncomingCall[] | null,
            context.workdir,
          );
          break;
        case "outgoingCalls":
          formattedContent = formatOutgoingCallsResult(
            rawResult as CallHierarchyOutgoingCall[] | null,
            context.workdir,
          );
          break;
        default:
          formattedContent = JSON.stringify(rawResult, null, 2);
      }

      return {
        success: true,
        content: formattedContent,
      };
    } catch (error) {
      return {
        success: false,
        content: "",
        error: `LSP operation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
  formatCompactParams: (
    params: Record<string, unknown>,
    context: ToolContext,
  ): string => {
    const { operation, filePath, line, character } = params as {
      operation: string;
      filePath: string;
      line: number;
      character: number;
    };
    const displayPath = getDisplayPath(filePath, context.workdir);
    return `${operation} ${displayPath}:${line}:${character}`;
  },
};
