import { describe, it, expect, beforeAll, vi, afterAll } from "vitest";
import { highlightToAnsi } from "../../src/utils/highlightUtils.js";
import { logger } from "../../src/utils/logger.js";
import chalk from "chalk";

// highlight.js is mocked with the shape we actually consume: the token tree
// behind "_emitter.rootNode", not the rendered HTML string.
vi.mock("highlight.js/lib/core", () => ({
  default: {
    highlight: vi
      .fn()
      .mockImplementation(
        (code: string, { language }: { language: string }) => {
          if (language === "ts" && code.includes("const")) {
            return {
              _emitter: {
                rootNode: {
                  children: [
                    { scope: "keyword", children: ["const"] },
                    " x = ",
                    { scope: "number", children: ["1"] },
                    ";",
                  ],
                },
              },
            };
          }
          if (language === "ts" && code.includes("tiered")) {
            return {
              _emitter: {
                rootNode: {
                  children: [{ scope: "title.function", children: ["tiered"] }],
                },
              },
            };
          }
          if (language === "ts" && code.includes("brokenchild")) {
            // A node shaped like highlight.js 10.x ({ kind, value }) instead of
            // 11.x ({ scope, children }) — text we cannot render.
            return {
              _emitter: {
                rootNode: { children: [{ kind: "keyword", value: "x" }] },
              },
            };
          }
          if (language === "ts" && code.includes("broken")) {
            return {};
          }
          return { _emitter: { rootNode: { children: [code] } } };
        },
      ),
    highlightAuto: vi.fn().mockImplementation((code: string) => {
      if (code.includes("function")) {
        return {
          _emitter: {
            rootNode: {
              children: [
                { scope: "keyword", children: ["function"] },
                " hello() { console.log(",
                { scope: "string", children: ['"world"'] },
                "); }",
              ],
            },
          },
        };
      }
      return { _emitter: { rootNode: { children: [code] } } };
    }),
    registerLanguage: vi.fn(),
    getLanguage: vi.fn((language: string) => language === "ts"),
  },
}));

describe("highlightToAnsi", () => {
  let originalChalkLevel: typeof chalk.level;
  let originalForceColor: string | undefined;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let loggerErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    originalChalkLevel = chalk.level;
    originalForceColor = process.env.FORCE_COLOR;
    process.env.FORCE_COLOR = "1";
    chalk.level = 1;
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    loggerErrorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
  });

  afterAll(() => {
    chalk.level = originalChalkLevel;
    process.env.FORCE_COLOR = originalForceColor;
    vi.restoreAllMocks();
  });

  it("should highlight typescript code", () => {
    const code = "const x = 1;";
    const highlighted = highlightToAnsi(code, "ts");

    // "const" should be blue (keyword scope)
    expect(highlighted).toContain(chalk.blue("const"));
    // "1" should be magenta (number scope)
    expect(highlighted).toContain(chalk.magenta("1"));
  });

  it("should highlight javascript code automatically", () => {
    const code = 'function hello() { console.log("world"); }';
    const highlighted = highlightToAnsi(code);

    // "function" should be blue (keyword scope)
    expect(highlighted).toContain(chalk.blue("function"));
    // '"world"' should be green (string scope)
    expect(highlighted).toContain(chalk.green('"world"'));
  }, 2000);

  it("should fall back to the first scope segment for tiered scopes", () => {
    const highlighted = highlightToAnsi("tiered", "ts");

    // title.function has no entry of its own; "title" does.
    expect(highlighted).toBe(chalk.yellow("tiered"));
  });

  it("should handle unknown languages gracefully", () => {
    const code = "some random text";
    const highlighted = highlightToAnsi(code, "nonexistent");
    expect(highlighted).toBe(code);
  });

  it("should not log console errors for unregistered languages", () => {
    const code = "Get-Process wave";
    const highlighted = highlightToAnsi(code, "powershell");
    expect(highlighted).toBe(code);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("should handle errors gracefully", () => {
    // This might be hard to trigger with highlight.js but we can try
    const highlighted = highlightToAnsi(null as unknown as string, "ts");
    expect(highlighted).toBe("");
  });

  it("should degrade to plain text and log once when the token tree shape changes", () => {
    // An unknown node shape loses the text it holds if rendered, so the whole
    // block falls back to the source instead of leaking a partial line.
    const childBroken = "brokenchild";
    expect(highlightToAnsi(childBroken, "ts")).toBe(childBroken);

    // Same for a missing token tree at the root.
    const rootBroken = "broken tree";
    expect(highlightToAnsi(rootBroken, "ts")).toBe(rootBroken);

    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
    expect(loggerErrorSpy.mock.calls[0][0]).toContain(
      "token tree shape mismatch",
    );

    // The guard is sticky: a shape mismatch logs once, not once per block.
    expect(highlightToAnsi(rootBroken, "ts")).toBe(rootBroken);
    expect(loggerErrorSpy).toHaveBeenCalledTimes(1);
  });
});
