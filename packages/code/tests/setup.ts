import { vi } from "vitest";

vi.mock("highlight.js", () => ({
  default: {
    highlight: vi.fn().mockImplementation((code, { language }) => {
      if (language === "ts" && code.includes("const")) {
        return {
          value:
            '<span class="hljs-keyword">const</span> x = <span class="hljs-number">1</span>;',
        };
      }
      return { value: code };
    }),
    highlightAuto: vi.fn().mockImplementation((code) => {
      if (code.includes("function")) {
        return {
          value:
            '<span class="hljs-keyword">function</span> hello() { console.log(<span class="hljs-string">"world"</span>); }',
        };
      }
      return { value: code };
    }),
    registerLanguage: vi.fn(),
    getLanguage: vi.fn(),
  },
}));
