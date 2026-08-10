import * as vscode from 'vscode';

export interface SelectionInfo {
    filePath: string;
    fileName: string;
    startLine: number;
    endLine: number;
    lineCount: number;
    selectedText: string;
    isEmpty: boolean;
}

export class SelectionService {
    private _onSelectionChange = new vscode.EventEmitter<SelectionInfo | undefined>();
    public readonly onSelectionChange = this._onSelectionChange.event;

    constructor(context: vscode.ExtensionContext) {
        context.subscriptions.push(
            vscode.window.onDidChangeTextEditorSelection(() => this.updateSelection()),
            vscode.window.onDidChangeActiveTextEditor(() => this.updateSelection())
        );
        // Initial update
        setTimeout(() => this.updateSelection(), 500);
    }

    private updateSelection() {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            this._onSelectionChange.fire(undefined);
            return;
        }

        const selection = editor.selection;
        const document = editor.document;
        const filePath = document.uri.fsPath;
        
        // Get relative path if possible
        const fileName = vscode.workspace.asRelativePath(document.uri);
        
        const startLine = selection.start.line + 1;
        const endLine = selection.end.line + 1;
        const lineCount = Math.abs(selection.end.line - selection.start.line) + 1;
        const selectedText = document.getText(selection);
        const isEmpty = selection.isEmpty;

        this._onSelectionChange.fire({
            filePath,
            fileName,
            startLine,
            endLine,
            lineCount,
            selectedText,
            isEmpty
        });
    }

    public getSelection(): SelectionInfo | undefined {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return undefined;

        const selection = editor.selection;
        const document = editor.document;
        const filePath = document.uri.fsPath;
        const fileName = vscode.workspace.asRelativePath(document.uri);
        
        const startLine = selection.start.line + 1;
        const endLine = selection.end.line + 1;
        const lineCount = Math.abs(selection.end.line - selection.start.line) + 1;
        const selectedText = document.getText(selection);
        const isEmpty = selection.isEmpty;

        return {
            filePath,
            fileName,
            startLine,
            endLine,
            lineCount,
            selectedText,
            isEmpty
        };
    }
}
