import { describe, it, expect } from "vitest";
import {
  CORE_POOL_TOOLS,
  STRUCTURAL_NON_DEFERRABLE,
  isCorePoolTool,
  isDeferredTool,
  toolTier,
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

  it("keeps the REPL out of the pool whatever the configuration says", () => {
    // The structural floor is not a replacement for the configurable list: an
    // operator editing a list cannot accidentally let the sandbox call its own
    // carrier, which would be a script spawning a script.
    expect(STRUCTURAL_NON_DEFERRABLE).toContain("REPL");
    expect(STRUCTURAL_NON_DEFERRABLE).toContain("Eval");
    for (const name of ["REPL", "Eval"]) {
      expect(
        isDeferredTool(
          { name, defer: true, isMcp: true },
          new Set(STRUCTURAL_NON_DEFERRABLE),
        ),
      ).toBe(false);
      // ... and the same holds with the core-tool switch on.
      expect(
        isDeferredTool({ name }, new Set(STRUCTURAL_NON_DEFERRABLE), true),
      ).toBe(false);
    }
  });
});

describe("core-tool pooling", () => {
  it("lists exactly the seven tier-1 tools", () => {
    expect([...CORE_POOL_TOOLS].sort()).toEqual([
      "Bash",
      "Edit",
      "Glob",
      "Grep",
      "PowerShell",
      "Read",
      "Write",
    ]);
  });

  it("declares core tools flat while the switch is off", () => {
    for (const name of CORE_POOL_TOOLS) {
      expect(isDeferredTool({ name }, none)).toBe(false);
      expect(isDeferredTool({ name }, none, false)).toBe(false);
    }
  });

  it("defers core tools once the switch is on", () => {
    for (const name of CORE_POOL_TOOLS) {
      expect(isDeferredTool({ name }, none, true)).toBe(true);
    }
  });

  it("leaves every other tool's judgment alone when the switch is on", () => {
    expect(isDeferredTool({ name: "WebFetch" }, none, true)).toBe(false);
    expect(
      isDeferredTool({ name: "mcp__srv__run", isMcp: true }, none, true),
    ).toBe(true);
  });

  it("still lets alwaysLoad take a core tool out of the pool", () => {
    // The escape hatch sits ahead of the bulk switch: a per-tool decision has to
    // be able to beat it, or a session could not keep one hot tool flat.
    expect(isDeferredTool({ name: "Read", alwaysLoad: true }, none, true)).toBe(
      false,
    );
  });

  it("lets the configurable non-deferrable list pull a core tool back out", () => {
    // The order is the contract: `alwaysLoad` → non-deferrable → core pool.
    // Both escape hatches sit *above* the switch, so an operator can always get
    // one tool back to a flat declaration without turning the whole feature off.
    expect(isDeferredTool({ name: "Read" }, new Set(["Read"]), true)).toBe(
      false,
    );
    // A deferred tool outside the core set is still pulled out by the list.
    expect(
      isDeferredTool(
        { name: "WebFetch", defer: true },
        new Set(["WebFetch"]),
        true,
      ),
    ).toBe(false);
  });

  it("reports the tier the announcement splits on", () => {
    expect(toolTier("Read", true)).toBe("core");
    expect(toolTier("Read", false)).toBe("named");
    // A tool outside the core set is name-only even when the switch is on.
    expect(toolTier("WebFetch", true)).toBe("named");
    expect(isCorePoolTool("Read", true)).toBe(true);
    expect(isCorePoolTool("Read", false)).toBe(false);
    expect(isCorePoolTool("WebFetch", true)).toBe(false);
  });
});
