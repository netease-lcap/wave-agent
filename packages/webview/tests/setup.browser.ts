import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";
import { createCodeEditor } from "../src/components/fileEditor/createCodeEditor";
import { createReadOnlyCodeView } from "../src/components/fileEditor/createReadOnlyCodeView";

/**
 * Browser-mode setup: everything the real Chromium environment still needs —
 * and nothing else.
 *
 * The jsdom setup this replaces carried five polyfills (`scrollIntoView`,
 * `Element.scrollTo`, `offsetHeight`/`offsetWidth`, `DataTransfer`,
 * `innerText`) because jsdom does no layout and implements none of them. In a
 * real browser all five are native, so re-stubbing them here would hide the
 * very behaviour the suite is supposed to exercise.
 */
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "warn").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});
vi.spyOn(console, "info").mockImplementation(() => {});
vi.spyOn(console, "debug").mockImplementation(() => {});

// Heavy renderers stay mocked: mermaid needs fonts/layout to lay out a diagram
// and dompurify's sanitizer is exercised by its own dedicated specs. Both mocks
// live here (not in a shared test helper) because in browser mode a `vi.mock`
// registered from an imported helper lands after the module graph is built.
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi
      .fn()
      .mockResolvedValue({ svg: "<svg></svg>", bindFunctions: vi.fn() }),
  },
}));

vi.mock("dompurify", () => ({
  default: { sanitize: vi.fn((html: string) => html) },
}));

// A few specs still write `globalThis.global` (node spelling). There is no
// `global` in a browser; alias it so those assertions keep working.
(globalThis as unknown as Record<string, unknown>).global = globalThis;

// The file panel reaches CodeMirror through a lazily injected desktop-only chunk
// (`./editor.js`), which this dev server never builds. Wiring the chunk's own
// source into the global stands in for that <script> tag: the specs drive the
// same editor the desktop host ships, without a bundling step. Loading is still
// asynchronous (one promise hop), so specs that touch the code surface await it.
window.WaveEditor = { createCodeEditor, createReadOnlyCodeView };
