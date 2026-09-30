import { describe, it, expect } from "vitest";
import {
  STRUCTURAL_NON_DEFERRABLE,
  isDeferredTool,
} from "../../src/exec/deferral.js";

const none = new Set<string>();

describe("isDeferredTool", () => {
  it("declares a tool that says nothing", () => {
    // The default is the point: deferring a tool costs a search round-trip the
    // first time it is used, so silence has to mean "declare me".
    expect(isDeferredTool({ name: "Read" }, none)).toBe(false);
  });

  it("defers a tool that claimed defer", () => {
    expect(isDeferredTool({ name: "WebFetch", defer: true }, none)).toBe(true);
  });

  it("defers every MCP tool, claimed or not", () => {
    expect(isDeferredTool({ name: "mcp__srv__run", isMcp: true }, none)).toBe(
      true,
    );
    expect(
      isDeferredTool(
        { name: "mcp__srv__run", isMcp: true, defer: false },
        none,
      ),
    ).toBe(true);
  });

  it("lets alwaysLoad win over a defer claim", () => {
    expect(
      isDeferredTool({ name: "WebFetch", defer: true, alwaysLoad: true }, none),
    ).toBe(false);
  });

  it("lets alwaysLoad win over the unconditional MCP rule", () => {
    // The escape hatch is first in the order for exactly this case: a server that
    // knows a tool is used every turn has no other way to say so.
    expect(
      isDeferredTool(
        { name: "mcp__srv__ping", isMcp: true, alwaysLoad: true },
        none,
      ),
    ).toBe(false);
  });

  it("lets the non-deferrable list win over a defer claim", () => {
    expect(
      isDeferredTool({ name: "WebFetch", defer: true }, new Set(["WebFetch"])),
    ).toBe(false);
  });

  it("lets the non-deferrable list win over MCP", () => {
    expect(
      isDeferredTool(
        { name: "mcp__srv__run", isMcp: true },
        new Set(["mcp__srv__run"]),
      ),
    ).toBe(false);
  });

  it("keeps Exec out of the pool whatever the configuration says", () => {
    // The structural floor is not a replacement for the configurable list: an
    // operator editing a list cannot accidentally let the sandbox call its own
    // carrier, which would be a script spawning a script.
    expect(STRUCTURAL_NON_DEFERRABLE).toContain("Exec");
    expect(
      isDeferredTool(
        { name: "Exec", defer: true, isMcp: true },
        new Set(STRUCTURAL_NON_DEFERRABLE),
      ),
    ).toBe(false);
  });
});
