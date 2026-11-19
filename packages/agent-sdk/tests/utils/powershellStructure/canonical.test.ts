import { describe, expect, it } from "vitest";
import {
  COMMON_ALIASES,
  aliasesOf,
  classifyCommandName,
  resolveToCanonical,
  stripModulePrefix,
} from "../../../src/utils/powershellStructure/canonical.js";

describe("resolveToCanonical", () => {
  it("should map aliases to the cmdlet they bind", () => {
    expect(resolveToCanonical("ls")).toBe("Get-ChildItem");
    expect(resolveToCanonical("cat")).toBe("Get-Content");
    expect(resolveToCanonical("cd")).toBe("Set-Location");
    expect(resolveToCanonical("gc")).toBe("Get-Content");
    expect(resolveToCanonical("iex")).toBe("Invoke-Expression");
    expect(resolveToCanonical("iwr")).toBe("Invoke-WebRequest");
  });

  it("should map PowerShell's punctuation aliases", () => {
    expect(resolveToCanonical("%")).toBe("ForEach-Object");
    expect(resolveToCanonical("?")).toBe("Where-Object");
  });

  it("should be case-insensitive, like PowerShell itself", () => {
    expect(resolveToCanonical("LS")).toBe("Get-ChildItem");
    expect(resolveToCanonical("Iex")).toBe("Invoke-Expression");
  });

  it("should strip a module qualifier before resolving the alias", () => {
    expect(
      resolveToCanonical("Microsoft.PowerShell.Management\\Get-ChildItem"),
    ).toBe("Get-ChildItem");
  });

  it("should return an unknown name as written", () => {
    expect(resolveToCanonical("git")).toBe("git");
    expect(resolveToCanonical("npm")).toBe("npm");
    expect(resolveToCanonical("Get-ChildItem")).toBe("Get-ChildItem");
    expect(resolveToCanonical("some-unknown-tool")).toBe("some-unknown-tool");
  });

  it("should not resolve through the map's prototype", () => {
    // A `Map` has no prototype chain to walk, unlike the `Object.create(null)`
    // CC needs for the same reason.
    expect(resolveToCanonical("constructor")).toBe("constructor");
    expect(resolveToCanonical("toString")).toBe("toString");
    expect(resolveToCanonical("__proto__")).toBe("__proto__");
  });

  it("should leave aliases that collide with a native executable unresolved", () => {
    // Measured on Windows PowerShell 5.1.26100: these four are aliases there,
    // while sc.exe / sort.exe / curl.exe / wget.exe exist on PATH, and PS Core
    // 6+ dropped the sc/curl/wget aliases entirely. Resolving them would let a
    // rule fire for the wrong program, so the permission layer must keep
    // seeing an unknown name.
    expect(resolveToCanonical("sc")).toBe("sc");
    expect(resolveToCanonical("sort")).toBe("sort");
    expect(resolveToCanonical("curl")).toBe("curl");
    expect(resolveToCanonical("wget")).toBe("wget");
  });

  it("should leave names that bind to nothing unresolved", () => {
    // `ci` resolves to no command on 5.1; `new` was never an alias (`ni` is).
    expect(resolveToCanonical("ci")).toBe("ci");
    expect(resolveToCanonical("new")).toBe("new");
  });

  it("should resolve single-hop, spelling out md", () => {
    // PowerShell chains md → mkdir → New-Item and mkdir is a function, but the
    // table stores the cmdlet so callers never have to iterate.
    expect(resolveToCanonical("md")).toBe("New-Item");
    expect(resolveToCanonical("mkdir")).toBe("New-Item");
  });
});

describe("COMMON_ALIASES", () => {
  it("should only contain canonical cmdlet names as values", () => {
    for (const [alias, canonical] of COMMON_ALIASES) {
      expect(alias).toBe(alias.toLowerCase());
      expect(classifyCommandName(canonical)).toBe("cmdlet");
    }
  });

  it("should not chain aliases", () => {
    for (const canonical of COMMON_ALIASES.values()) {
      expect(COMMON_ALIASES.has(canonical.toLowerCase())).toBe(false);
    }
  });
});

describe("aliasesOf", () => {
  it("should list every alias of a cmdlet", () => {
    expect(aliasesOf("Get-ChildItem").sort()).toEqual(["dir", "gci", "ls"]);
    expect(aliasesOf("Remove-Item").sort()).toEqual([
      "del",
      "erase",
      "rd",
      "ri",
      "rm",
      "rmdir",
    ]);
  });

  it("should list aliases only for a canonical name, not for an alias", () => {
    expect(aliasesOf("ls")).toEqual([]);
    expect(
      aliasesOf("Microsoft.PowerShell.Management\\Get-Item").sort(),
    ).toEqual(["gi"]);
  });

  it("should return an empty list for a cmdlet with no aliases", () => {
    expect(aliasesOf("Get-Unique")).toEqual([]);
  });
});

describe("re-exported name helpers", () => {
  it("should keep classification consistent with the parser's own use", () => {
    expect(classifyCommandName("Get-ChildItem")).toBe("cmdlet");
    expect(classifyCommandName("C:\\Windows\\System32\\cmd.exe")).toBe(
      "application",
    );
    expect(classifyCommandName("ls")).toBe("unknown");
  });

  it("should strip only real module qualifiers", () => {
    expect(stripModulePrefix("Microsoft.PowerShell.Management\\Get-Item")).toBe(
      "Get-Item",
    );
    expect(stripModulePrefix("C:\\Windows\\System32\\cmd.exe")).toBe(
      "C:\\Windows\\System32\\cmd.exe",
    );
  });
});
