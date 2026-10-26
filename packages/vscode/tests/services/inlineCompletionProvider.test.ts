import { describe, it, expect, vi, beforeEach } from "vitest";
import * as vscode from "vscode";

const windowMock = vi.hoisted(() => ({
  activeTextEditor: undefined as unknown,
  createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
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
  class ThemeColor {
    constructor(public id: string) {}
  }
  class Selection {
    constructor(
      public anchor: Position,
      public active: Position,
    ) {}
  }
  return {
    Position,
    Range,
    InlineCompletionItem,
    InlineCompletionList,
    ThemeColor,
    Selection,
    InlineCompletionTriggerKind: { Automatic: 0, Invoke: 1 },
    TextEditorRevealType: { InCenterIfOutsideViewport: 3 },
    window: windowMock,
    workspace: {
      fs: {
        isWritableFileSystem: vi.fn().mockResolvedValue(true),
      },
      // Next-edit keeps an edit trajectory, so the registration also subscribes
      // to document events (spec ui/next-edit-suggestion.md 故事 3).
      onDidChangeTextDocument: vi.fn(() => ({ dispose: () => {} })),
      onDidOpenTextDocument: vi.fn(() => ({ dispose: () => {} })),
      onDidCloseTextDocument: vi.fn(() => ({ dispose: () => {} })),
      textDocuments: [],
    },
    languages: { registerInlineCompletionItemProvider: vi.fn() },
    commands: { registerCommand: vi.fn() },
    // The provider only reads these two off the namespace object.
    Uri: { file: (fsPath: string) => ({ scheme: "file", fsPath }) },
  };
});

import {
  ACCEPT_COMPLETION_COMMAND,
  ACCEPT_NEXT_EDIT_COMMAND,
  NEXT_EDIT_APPLY_COMMAND,
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
  getText: (range?: unknown) => string;
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

function createProvider(
  suggestion: string | undefined = "42",
  report: (outcome: "displayed" | "accepted") => void = () => {},
) {
  const getCompletion = vi.fn().mockResolvedValue(suggestion);
  const provider = new WaveInlineCompletionProvider(
    {
      getCompletion,
    } as unknown as InlineCompletionService,
    report,
  );
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

  it("reports one displayed outcome when it renders a suggestion", async () => {
    const document = createDocument();
    windowMock.activeTextEditor = createEditor(document);
    const report = vi.fn();
    const { provider } = createProvider("42", report);

    await callProvider(provider, document);

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith("displayed");
  });

  it("reports nothing when there is no suggestion to render", async () => {
    const document = createDocument();
    windowMock.activeTextEditor = createEditor(document);
    const report = vi.fn();
    const { provider } = createProvider("", report);

    await expect(callProvider(provider, document)).resolves.toBeUndefined();
    expect(report).not.toHaveBeenCalled();
  });

  it("hangs the accept hook on the item", async () => {
    const document = createDocument();
    windowMock.activeTextEditor = createEditor(document);
    const { provider } = createProvider("42");

    const result = await callProvider(provider, document);

    expect(result?.items[0]?.command?.command).toBe(ACCEPT_COMPLETION_COMMAND);
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

describe("WaveInlineCompletionProvider - next edit", () => {
  beforeEach(() => {
    windowMock.activeTextEditor = undefined;
  });

  function createNextEditProvider(
    render: { range: unknown; text: string } | undefined,
    fresh = true,
  ) {
    const getCompletion = vi.fn().mockResolvedValue("caret text");
    const getSuggestion = vi.fn().mockResolvedValue(render);
    const reportNextEdit = vi.fn();
    const show = vi.fn();
    const provider = new WaveInlineCompletionProvider(
      { getCompletion } as unknown as InlineCompletionService,
      () => {},
      {
        hasFreshTrajectory: () => fresh,
        getSuggestion,
      } as unknown as import("../../src/services/nextEditService").NextEditService,
      {
        show,
        clear: vi.fn(),
      } as unknown as import("../../src/services/nextEditPresenter").NextEditPresenter,
      reportNextEdit,
    );
    return { provider, getCompletion, getSuggestion, reportNextEdit, show };
  }

  /** A rewrite of lines 1-2: not something the editor's API can draw (see below). */
  const replacement = {
    start: { line: 1, character: 0 },
    end: { line: 2, character: 5 },
  };

  it("hands an insertion at the caret to the editor as ghost text", async () => {
    const document = createDocument();
    windowMock.activeTextEditor = createEditor(document);
    const insertion = {
      start: { line: 0, character: 10 },
      end: { line: 0, character: 10 },
    };
    const { provider, getCompletion, getSuggestion, reportNextEdit, show } =
      createNextEditProvider({ range: insertion, text: "return userId;" });

    const result = await callProvider(provider, document);

    expect(getSuggestion).toHaveBeenCalledTimes(1);
    expect(result?.items[0].insertText).toBe("return userId;");
    expect(result?.items[0].range).toBe(insertion);
    // The accept hook is next edit's own command: taking a rewrite must not
    // count towards the caret-completion rate (spec 故事 7).
    const item = (result?.items[0] ?? {}) as unknown as {
      command: { command: string };
    };
    expect(item.command.command).toBe(ACCEPT_NEXT_EDIT_COMMAND);
    // Displayed is reported by the side that actually rendered it.
    expect(reportNextEdit).toHaveBeenCalledWith("displayed");
    // The editor draws it, so the overlay has nothing to add.
    expect(show).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      true,
    );
    // Mutual exclusion: completion never runs for the same invocation
    // (spec ui/next-edit-suggestion.md 边界情况).
    expect(getCompletion).not.toHaveBeenCalled();
  });

  it("draws a rewrite itself, because the editor cannot render one", async () => {
    const document = createDocument();
    windowMock.activeTextEditor = createEditor(document);
    const { provider, getCompletion, reportNextEdit, show } =
      createNextEditProvider({
        range: replacement,
        text: "return userId;",
      });

    // A non-empty range is accepted by the API and then never shown (measured in
    // a real VS Code — `tests-e2e/specs/nextEdit.spec.cjs`), so handing it over
    // would drop the suggestion on the floor.
    const result = await callProvider(provider, document);

    expect(show).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      false,
    );
    // The overlay is the rendering, so it counts as displayed.
    expect(reportNextEdit).toHaveBeenCalledWith("displayed");
    // The caret's own slot stays with completion.
    expect(result?.items[0].insertText).toBe("caret text");
    expect(getCompletion).toHaveBeenCalledTimes(1);
  });

  it("falls back to completion when there is nothing to suggest", async () => {
    const document = createDocument();
    windowMock.activeTextEditor = createEditor(document);
    const { provider, getCompletion, getSuggestion } =
      createNextEditProvider(undefined);

    const result = await callProvider(provider, document);

    expect(getSuggestion).toHaveBeenCalledTimes(1);
    expect(getCompletion).toHaveBeenCalledTimes(1);
    expect(result?.items[0].insertText).toBe("caret text");
  });

  it("does not even ask when the user has not edited recently", async () => {
    const document = createDocument();
    windowMock.activeTextEditor = createEditor(document);
    const { provider, getSuggestion } = createNextEditProvider(
      undefined,
      false,
    );

    await callProvider(provider, document);

    expect(getSuggestion).not.toHaveBeenCalled();
  });
});

describe("registerInlineCompletion", () => {
  it("registers a provider for every file and keeps it in the subscriptions", () => {
    const register = vi.mocked(
      vscode.languages.registerInlineCompletionItemProvider,
    );
    const registerCommand = vi.mocked(vscode.commands.registerCommand);
    const subscription = { dispose: vi.fn() };
    const commandSubscription = { dispose: vi.fn() };
    register.mockReturnValue(subscription as unknown as vscode.Disposable);
    registerCommand.mockReturnValue(
      commandSubscription as unknown as vscode.Disposable,
    );
    const context = { subscriptions: [] as unknown[] };
    const reportCompletionOutcome = vi.fn();

    registerInlineCompletion(
      context as unknown as vscode.ExtensionContext,
      {
        requestInlineCompletion: vi.fn(),
        reportCompletionOutcome,
      } as never,
    );

    expect(register).toHaveBeenCalledWith(
      { pattern: "**" },
      expect.any(WaveInlineCompletionProvider),
    );
    expect(context.subscriptions).toContain(subscription);
    expect(context.subscriptions).toContain(commandSubscription);

    // The accept hook is a command: VS Code runs it when the user takes the
    // suggestion, and it is the only acceptance signal we get.
    const [command, handler] = registerCommand.mock.calls[0] as [
      string,
      () => void,
    ];
    expect(command).toBe(ACCEPT_COMPLETION_COMMAND);
    handler();
    expect(reportCompletionOutcome).toHaveBeenCalledWith("accepted");
  });

  it("registers the chord that accepts a suggestion the editor cannot draw", () => {
    const register = vi.mocked(
      vscode.languages.registerInlineCompletionItemProvider,
    );
    const registerCommand = vi.mocked(vscode.commands.registerCommand);
    register.mockReturnValue({
      dispose: vi.fn(),
    } as unknown as vscode.Disposable);
    registerCommand.mockReturnValue({
      dispose: vi.fn(),
    } as unknown as vscode.Disposable);

    registerInlineCompletion(
      { subscriptions: [] as unknown[] } as unknown as vscode.ExtensionContext,
      {
        requestInlineCompletion: vi.fn(),
        reportCompletionOutcome: vi.fn(),
      } as never,
    );

    const commands = registerCommand.mock.calls.map(([command]) => command);
    expect(commands).toContain(NEXT_EDIT_APPLY_COMMAND);
    expect(commands).toContain("wave.nextEdit.jump");
    expect(commands).toContain(ACCEPT_NEXT_EDIT_COMMAND);
  });
});
