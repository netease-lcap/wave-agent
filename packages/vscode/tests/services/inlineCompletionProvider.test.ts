import { describe, it, expect, vi, beforeEach } from "vitest";
import * as vscode from "vscode";

const windowMock = vi.hoisted(() => ({
  activeTextEditor: undefined as unknown,
}));

vi.mock("vscode", () => {
  class Position {
    constructor(
      public line: number,
      public character: number,
    ) {}
  }
  class Range {
    constructor(
      public start: Position,
      public end: Position,
    ) {}
  }
  class InlineCompletionItem {
    constructor(
      public insertText: string,
      public range?: Range,
    ) {}
  }
  class InlineCompletionList {
    constructor(public items: InlineCompletionItem[]) {}
  }
  return {
    Position,
    Range,
    InlineCompletionItem,
    InlineCompletionList,
    InlineCompletionTriggerKind: { Automatic: 0, Invoke: 1 },
    window: windowMock,
    workspace: {
      fs: {
        isWritableFileSystem: vi.fn().mockResolvedValue(true),
      },
    },
    languages: { registerInlineCompletionItemProvider: vi.fn() },
    // The provider only reads these two off the namespace object.
    Uri: { file: (fsPath: string) => ({ scheme: "file", fsPath }) },
  };
});

import {
  WaveInlineCompletionProvider,
  registerInlineCompletion,
} from "../../src/services/inlineCompletionProvider";
import type { InlineCompletionService } from "../../src/services/inlineCompletionService";

interface FakeDocument {
  uri: { scheme: string; fsPath: string; toString: () => string };
  version: number;
  languageId: string;
  lineCount: number;
  isClosed: boolean;
  getText: () => string;
}

function createDocument(overrides: Partial<FakeDocument> = {}): FakeDocument {
  return {
    uri: {
      scheme: "file",
      fsPath: "/repo/a.ts",
      toString: () => "file:///repo/a.ts",
    },
    version: 1,
    languageId: "typescript",
    lineCount: 10,
    isClosed: false,
    getText: () => "const a = ;",
    ...overrides,
  };
}

function createEditor(
  document: FakeDocument,
  overrides: Record<string, unknown> = {},
) {
  return {
    document,
    options: {},
    selections: [{ isEmpty: true }],
    selection: { isEmpty: true },
    ...overrides,
  };
}

const position = { line: 0, character: 10 } as unknown as vscode.Position;
const token = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => {} }),
} as unknown as vscode.CancellationToken;

function createProvider(suggestion: string | undefined = "42") {
  const getCompletion = vi.fn().mockResolvedValue(suggestion);
  const provider = new WaveInlineCompletionProvider({
    getCompletion,
  } as unknown as InlineCompletionService);
  return { provider, getCompletion };
}

async function callProvider(
  provider: WaveInlineCompletionProvider,
  document: FakeDocument,
  triggerKind: number = vscode.InlineCompletionTriggerKind.Automatic,
) {
  return provider.provideInlineCompletionItems(
    document as unknown as vscode.TextDocument,
    position,
    { triggerKind } as vscode.InlineCompletionContext,
    token,
  );
}

describe("WaveInlineCompletionProvider", () => {
  beforeEach(() => {
    windowMock.activeTextEditor = undefined;
  });

  it("renders the suggestion at the caret", async () => {
    const document = createDocument();
    windowMock.activeTextEditor = createEditor(document);
    const { provider } = createProvider("42");

    const result = await callProvider(provider, document);

    expect(result?.items).toHaveLength(1);
    expect(result?.items[0].insertText).toBe("42");
    expect(result?.items[0].range).toMatchObject({
      start: { line: 0, character: 10 },
      end: { line: 0, character: 10 },
    });
  });

  it("asks for no debounce when the user triggered it manually", async () => {
    const document = createDocument();
    windowMock.activeTextEditor = createEditor(document);
    const { provider, getCompletion } = createProvider();

    await callProvider(
      provider,
      document,
      vscode.InlineCompletionTriggerKind.Invoke,
    );

    expect(getCompletion).toHaveBeenCalledWith(document, position, token, true);
  });

  it("shows nothing when the model declined", async () => {
    const document = createDocument();
    windowMock.activeTextEditor = createEditor(document);
    const { provider } = createProvider("");

    await expect(callProvider(provider, document)).resolves.toBeUndefined();
  });

  it("skips untitled buffers and virtual documents", async () => {
    const document = createDocument({
      uri: {
        scheme: "untitled",
        fsPath: "",
        toString: () => "untitled:Untitled-1",
      },
    });
    windowMock.activeTextEditor = createEditor(document);
    const { provider, getCompletion } = createProvider();

    await expect(callProvider(provider, document)).resolves.toBeUndefined();
    expect(getCompletion).not.toHaveBeenCalled();
  });

  it("skips a read-only file system", async () => {
    const document = createDocument();
    windowMock.activeTextEditor = createEditor(document);
    vi.mocked(vscode.workspace.fs.isWritableFileSystem).mockResolvedValueOnce(
      false,
    );
    const { provider, getCompletion } = createProvider();

    await expect(callProvider(provider, document)).resolves.toBeUndefined();
    expect(getCompletion).not.toHaveBeenCalled();
  });

  it("skips oversized documents", async () => {
    const document = createDocument({ lineCount: 20001 });
    windowMock.activeTextEditor = createEditor(document);
    const { provider, getCompletion } = createProvider();

    await expect(callProvider(provider, document)).resolves.toBeUndefined();
    expect(getCompletion).not.toHaveBeenCalled();
  });

  it("skips a document whose text exceeds the size budget", async () => {
    const document = createDocument({
      getText: () => "x".repeat(1024 * 1024 + 1),
    });
    windowMock.activeTextEditor = createEditor(document);
    const { provider, getCompletion } = createProvider();

    await expect(callProvider(provider, document)).resolves.toBeUndefined();
    expect(getCompletion).not.toHaveBeenCalled();
  });

  it("skips multiple cursors", async () => {
    const document = createDocument();
    windowMock.activeTextEditor = createEditor(document, {
      selections: [{ isEmpty: true }, { isEmpty: true }],
    });
    const { provider, getCompletion } = createProvider();

    await expect(callProvider(provider, document)).resolves.toBeUndefined();
    expect(getCompletion).not.toHaveBeenCalled();
  });

  it("skips a non-empty selection", async () => {
    const document = createDocument();
    windowMock.activeTextEditor = createEditor(document, {
      selection: { isEmpty: false },
    });
    const { provider, getCompletion } = createProvider();

    await expect(callProvider(provider, document)).resolves.toBeUndefined();
    expect(getCompletion).not.toHaveBeenCalled();
  });

  it("skips when the focused editor is not the document being completed", async () => {
    const document = createDocument();
    windowMock.activeTextEditor = createEditor(createDocument());
    const { provider, getCompletion } = createProvider();

    await expect(callProvider(provider, document)).resolves.toBeUndefined();
    expect(getCompletion).not.toHaveBeenCalled();
  });
});

describe("registerInlineCompletion", () => {
  it("registers a provider for every file and keeps it in the subscriptions", () => {
    const register = vi.mocked(
      vscode.languages.registerInlineCompletionItemProvider,
    );
    const subscription = { dispose: vi.fn() };
    register.mockReturnValue(subscription as unknown as vscode.Disposable);
    const context = { subscriptions: [] as unknown[] };

    registerInlineCompletion(
      context as unknown as vscode.ExtensionContext,
      { requestInlineCompletion: vi.fn() } as never,
    );

    expect(register).toHaveBeenCalledWith(
      { pattern: "**" },
      expect.any(WaveInlineCompletionProvider),
    );
    expect(context.subscriptions).toContain(subscription);
  });
});
