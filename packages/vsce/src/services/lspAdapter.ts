import * as vscode from 'vscode';
import * as path from 'path';
import { ILspManager } from 'wave-agent-sdk';

const LSP_TIMEOUT = 30000; // 30 seconds

export class VscodeLspAdapter implements ILspManager {
  private async executeWithTimeout<T>(command: string, ...args: unknown[]): Promise<T> {
    let timeoutId: NodeJS.Timeout;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Command '${command}' timed out after ${LSP_TIMEOUT}ms`));
      }, LSP_TIMEOUT);
    });

    try {
      return await Promise.race([
        vscode.commands.executeCommand<T>(command, ...args),
        timeoutPromise
      ]);
    } finally {
      clearTimeout(timeoutId!);
    }
  }

  async execute(args: {
    operation: string;
    filePath: string;
    line: number;
    character: number;
  }) {
    try {
      const uri = this.resolveUri(args.filePath);
      const position = new vscode.Position(args.line - 1, args.character - 1);

      let result: unknown;
      switch (args.operation) {
        case "goToDefinition":
          result = await this.executeWithTimeout('vscode.executeDefinitionProvider', uri, position);
          break;
        case "hover": {
          const hovers = await this.executeWithTimeout<vscode.Hover[]>('vscode.executeHoverProvider', uri, position);
          // The SDK expects a single Hover object, not an array.
          // We take the first one if available.
          result = (hovers && hovers.length > 0) ? hovers[0] : null;
          break;
        }
        case "findReferences":
          result = await this.executeWithTimeout('vscode.executeReferenceProvider', uri, position, { includeDeclaration: true });
          break;
        case "documentSymbol":
          result = await this.executeWithTimeout('vscode.executeDocumentSymbolProvider', uri);
          break;
        case "workspaceSymbol": {
          // The SDK might pass a query in some cases, but for now we use the symbol at position if possible
          // or a generic search. However, executeWorkspaceSymbolProvider usually takes a string query.
          // Since the tool args only provide filePath/line/character, we might need to get the word at that position.
          const document = await vscode.workspace.openTextDocument(uri);
          const range = document.getWordRangeAtPosition(position);
          const query = range ? document.getText(range) : '';
          result = await this.executeWithTimeout('vscode.executeWorkspaceSymbolProvider', query);
          break;
        }
        case "goToImplementation":
          result = await this.executeWithTimeout('vscode.executeImplementationProvider', uri, position);
          break;
        case "prepareCallHierarchy":
          result = await this.executeWithTimeout('vscode.prepareCallHierarchy', uri, position);
          break;
        case "incomingCalls": {
          const itemsIn = await this.executeWithTimeout<vscode.CallHierarchyItem[]>('vscode.prepareCallHierarchy', uri, position);
          if (itemsIn && itemsIn.length > 0) {
            result = await this.executeWithTimeout('vscode.provideIncomingCalls', itemsIn[0]);
          } else {
            result = null;
          }
          break;
        }
        case "outgoingCalls": {
          const itemsOut = await this.executeWithTimeout<vscode.CallHierarchyItem[]>('vscode.prepareCallHierarchy', uri, position);
          if (itemsOut && itemsOut.length > 0) {
            result = await this.executeWithTimeout('vscode.provideOutgoingCalls', itemsOut[0]);
          } else {
            result = null;
          }
          break;
        }
        default:
          return { success: false, content: `VSCode adapter does not support ${args.operation}` };
      }

      return { 
        success: true, 
        content: JSON.stringify(this.transformResult(result) || null) 
      };
    } catch (error: unknown) {
      console.error(`LSP operation ${args.operation} failed:`, error);
      return {
        success: false,
        content: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private resolveUri(filePath: string): vscode.Uri {
    if (filePath.startsWith('file://') || filePath.startsWith('vscode-remote://')) {
      return vscode.Uri.parse(filePath);
    }

    if (path.isAbsolute(filePath)) {
      return vscode.Uri.file(filePath);
    }

    // Try to resolve relative to workspace folders
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      return vscode.Uri.joinPath(workspaceFolders[0].uri, filePath);
    }

    return vscode.Uri.file(filePath);
  }

  private transformResult(result: unknown): unknown {
    if (result === undefined || result === null) {
      return result;
    }

    if (Array.isArray(result)) {
      return result.map(item => this.transformResult(item));
    }

    // Handle VS Code Uri
    if (result instanceof vscode.Uri) {
      return result.toString();
    }

    // Handle VS Code Position
    if (result instanceof vscode.Position) {
      return {
        line: result.line,
        character: result.character
      };
    }

    // Handle VS Code Range
    if (result instanceof vscode.Range) {
      return {
        start: this.transformResult(result.start),
        end: this.transformResult(result.end)
      };
    }

    // Handle VS Code Location
    if (result instanceof vscode.Location) {
      return {
        uri: this.transformResult(result.uri),
        range: this.transformResult(result.range)
      };
    }

    // Handle VS Code LocationLink
    if (typeof result === 'object' && result !== null && 'targetUri' in result && 'targetRange' in result) {
      const link = result as Record<string, unknown>;
      return {
        targetUri: this.transformResult(link.targetUri),
        targetRange: this.transformResult(link.targetRange),
        targetSelectionRange: this.transformResult(link.targetSelectionRange),
        originSelectionRange: this.transformResult(link.originSelectionRange)
      };
    }

    // Handle VS Code Hover
    if (result instanceof vscode.Hover) {
      return {
        contents: this.transformHoverContents(result.contents),
        range: this.transformResult(result.range)
      };
    }

    // Handle VS Code DocumentSymbol
    if (result instanceof vscode.DocumentSymbol) {
      return {
        name: result.name,
        detail: result.detail,
        kind: result.kind,
        range: this.transformResult(result.range),
        selectionRange: this.transformResult(result.selectionRange),
        children: this.transformResult(result.children)
      };
    }

    // Handle VS Code CallHierarchyItem
    if (result instanceof vscode.CallHierarchyItem) {
      return {
        name: result.name,
        kind: result.kind,
        detail: result.detail,
        uri: this.transformResult(result.uri),
        range: this.transformResult(result.range),
        selectionRange: this.transformResult(result.selectionRange)
      };
    }

    // Handle VS Code CallHierarchyIncomingCall
    if (typeof result === 'object' && result !== null && 'from' in result && 'fromRanges' in result) {
      const incoming = result as Record<string, unknown>;
      return {
        from: this.transformResult(incoming.from),
        fromRanges: this.transformResult(incoming.fromRanges)
      };
    }

    // Handle VS Code CallHierarchyOutgoingCall
    if (typeof result === 'object' && result !== null && 'to' in result && 'fromRanges' in result) {
      const outgoing = result as Record<string, unknown>;
      return {
        to: this.transformResult(outgoing.to),
        fromRanges: this.transformResult(outgoing.fromRanges)
      };
    }

    // Handle SymbolInformation
    if (typeof result === 'object' && result !== null && 'location' in result && 'name' in result && 'kind' in result) {
        const sym = result as Record<string, unknown>;
        return {
            name: sym.name,
            kind: sym.kind,
            location: this.transformResult(sym.location),
            containerName: sym.containerName
        };
    }

    // Generic object transformation
    if (typeof result === 'object') {
      const transformed: Record<string, unknown> = {};
      const obj = result as Record<string, unknown>;
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          transformed[key] = this.transformResult(obj[key]);
        }
      }
      return transformed;
    }

    return result;
  }

  private transformHoverContents(contents: unknown): unknown {
    if (Array.isArray(contents)) {
      return contents.map(c => this.transformHoverContents(c));
    }

    if (typeof contents === 'string') {
      return contents;
    }

    // Handle MarkdownString
    if (contents && typeof contents === 'object' && 'value' in contents) {
      const md = contents as Record<string, unknown>;
      return {
        kind: 'markdown',
        value: md.value
      };
    }

    // Handle MarkedString (deprecated but still used)
    if (contents && typeof contents === 'object' && 'language' in contents) {
        const marked = contents as Record<string, unknown>;
        return `\`\`\`${marked.language}\n${marked.value}\n\`\`\``;
    }

    return String(contents);
  }
}
