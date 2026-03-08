import { describe, it, expect, beforeAll, vi, afterAll } from "vitest";
import { highlightToAnsi } from "../../src/utils/highlightUtils.js";
import chalk from "chalk";

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

describe("highlightToAnsi", () => {
  let originalChalkLevel: typeof chalk.level;
  let originalForceColor: string | undefined;

  beforeAll(() => {
    originalChalkLevel = chalk.level;
    originalForceColor = process.env.FORCE_COLOR;
    process.env.FORCE_COLOR = "1";
    chalk.level = 1;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterAll(() => {
    chalk.level = originalChalkLevel;
    process.env.FORCE_COLOR = originalForceColor;
    vi.restoreAllMocks();
  });

  it("should highlight typescript code", () => {
    const code = "const x = 1;";
    const highlighted = highlightToAnsi(code, "ts");

    // 'const' should be blue (hljs-keyword)
    expect(highlighted).toContain(chalk.blue("const"));
    // '1' should be magenta (hljs-number)
    expect(highlighted).toContain(chalk.magenta("1"));
  });

  it("should highlight javascript code automatically", () => {
    const code = 'function hello() { console.log("world"); }';
    const highlighted = highlightToAnsi(code);

    // 'function' should be blue (hljs-keyword)
    expect(highlighted).toContain(chalk.blue("function"));
    // '"world"' should be green (hljs-string)
    expect(highlighted).toContain(chalk.green('"world"'));
  }, 2000); // Increase timeout for auto-detection if needed, but it should be faster now with fewer tests running it

  it("should handle unknown languages gracefully", () => {
    const code = "some random text";
    const highlighted = highlightToAnsi(code, "nonexistent");
    expect(highlighted).toBe(code);
  });

  it("should handle errors gracefully", () => {
    // This might be hard to trigger with highlight.js but we can try
    const highlighted = highlightToAnsi(null as unknown as string, "ts");
    expect(highlighted).toBe("");
  });
});
