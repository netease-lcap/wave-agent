import { describe, expect, it } from "vitest";
import {
  ALIAS_HIJACK_CMDLETS,
  ARG_GATED_CMDLETS,
  BLOCK_PERSIST,
  DANGEROUS_CMDLET_GROUPS,
  DANGEROUS_CMDLET_NAMES,
  DANGEROUS_SCRIPT_BLOCK_CMDLETS,
  FILEPATH_EXECUTION_CMDLETS,
  MODULE_LOADING_CMDLETS,
  NETWORK_CMDLETS,
  NO_PREFIX_SUGGEST,
  SHELLS_AND_SPAWNERS,
  WMI_CIM_CMDLETS,
  dangerousCmdletGroup,
} from "../../../src/utils/powershellStructure/dangerousCmdlets.js";

describe("dangerous cmdlet groups", () => {
  it("should carry CC's eight groups", () => {
    expect(Object.keys(DANGEROUS_CMDLET_GROUPS)).toEqual([
      "filepathExecution",
      "scriptBlock",
      "moduleLoading",
      "shellsAndSpawners",
      "network",
      "aliasHijack",
      "wmiCim",
      "argGated",
    ]);
  });

  it("should list names in lowercase", () => {
    for (const names of Object.values(DANGEROUS_CMDLET_GROUPS)) {
      for (const name of names) {
        expect(name).toBe(name.toLowerCase());
      }
    }
  });

  it("should keep the group contents needed by the permission engine", () => {
    expect(FILEPATH_EXECUTION_CMDLETS).toContain("invoke-command");
    expect(DANGEROUS_SCRIPT_BLOCK_CMDLETS).toContain("invoke-expression");
    expect(MODULE_LOADING_CMDLETS).toContain("import-module");
    expect(SHELLS_AND_SPAWNERS).toContain("start-process");
    expect(NETWORK_CMDLETS).toContain("invoke-webrequest");
    expect(ALIAS_HIJACK_CMDLETS).toContain("set-alias");
    expect(WMI_CIM_CMDLETS).toContain("invoke-wmimethod");
    expect(ARG_GATED_CMDLETS).toContain("where-object");
  });

  it("should include every group's names in the flat set", () => {
    for (const names of Object.values(DANGEROUS_CMDLET_GROUPS)) {
      for (const name of names) {
        expect(DANGEROUS_CMDLET_NAMES.has(name)).toBe(true);
      }
    }
  });
});

describe("dangerousCmdletGroup", () => {
  it("should name the hazard class of a cmdlet", () => {
    expect(dangerousCmdletGroup("Invoke-Expression")).toBe("scriptBlock");
    expect(dangerousCmdletGroup("Import-Module")).toBe("moduleLoading");
    expect(dangerousCmdletGroup("Start-Process")).toBe("shellsAndSpawners");
    expect(dangerousCmdletGroup("Invoke-WebRequest")).toBe("network");
    expect(dangerousCmdletGroup("Set-Alias")).toBe("aliasHijack");
    expect(dangerousCmdletGroup("Invoke-WmiMethod")).toBe("wmiCim");
    expect(dangerousCmdletGroup("Where-Object")).toBe("argGated");
  });

  it("should resolve aliases first", () => {
    expect(dangerousCmdletGroup("iex")).toBe("scriptBlock");
    expect(dangerousCmdletGroup("iwr")).toBe("network");
    expect(dangerousCmdletGroup("start")).toBe("shellsAndSpawners");
    expect(dangerousCmdletGroup("sal")).toBe("aliasHijack");
  });

  it("should accept a module-qualified name", () => {
    expect(
      dangerousCmdletGroup("Microsoft.PowerShell.Utility\\Invoke-Expression"),
    ).toBe("scriptBlock");
  });

  it("should answer undefined for cmdlets nothing complains about", () => {
    expect(dangerousCmdletGroup("Get-ChildItem")).toBeUndefined();
    expect(dangerousCmdletGroup("ls")).toBeUndefined();
    expect(dangerousCmdletGroup("git")).toBeUndefined();
  });
});

describe("NO_PREFIX_SUGGEST", () => {
  it("should cover every dangerous group", () => {
    for (const name of DANGEROUS_CMDLET_NAMES) {
      expect(NO_PREFIX_SUGGEST.has(name)).toBe(true);
    }
  });

  it("should expand aliases, not just canonical names", () => {
    expect(NO_PREFIX_SUGGEST.has("iex")).toBe(true);
    expect(NO_PREFIX_SUGGEST.has("iwr")).toBe(true);
    expect(NO_PREFIX_SUGGEST.has("rm")).toBe(true);
    expect(NO_PREFIX_SUGGEST.has("del")).toBe(true);
    expect(NO_PREFIX_SUGGEST.has("md")).toBe(true);
    expect(NO_PREFIX_SUGGEST.has("%")).toBe(true);
    expect(NO_PREFIX_SUGGEST.has("?")).toBe(true);
  });

  it("should refuse the destructive write/delete cmdlets", () => {
    // A `PowerShell(Remove-Item*)` rule is a permanent yes for deleting
    // anything; wave's bash side refuses the same rule for `rm`.
    expect(NO_PREFIX_SUGGEST.has("remove-item")).toBe(true);
    expect(NO_PREFIX_SUGGEST.has("set-content")).toBe(true);
    expect(NO_PREFIX_SUGGEST.has("add-content")).toBe(true);
    expect(NO_PREFIX_SUGGEST.has("out-file")).toBe(true);
  });

  it("should refuse ForEach-Object, whose member-name form hides a method call", () => {
    expect(NO_PREFIX_SUGGEST.has("foreach-object")).toBe(true);
  });

  it("should still allow suggesting read-only cmdlets", () => {
    expect(NO_PREFIX_SUGGEST.has("get-childitem")).toBe(false);
    expect(NO_PREFIX_SUGGEST.has("get-content")).toBe(false);
    expect(NO_PREFIX_SUGGEST.has("select-string")).toBe(false);
  });

  it("should contain every name BLOCK_PERSIST refuses", () => {
    // The subset invariant: what may not be persisted at all may also never get
    // a wildcard suggestion.
    for (const name of BLOCK_PERSIST) {
      expect(NO_PREFIX_SUGGEST.has(name)).toBe(true);
    }
  });
});

describe("BLOCK_PERSIST", () => {
  it("should cover the destructive write/delete cmdlets, aliases included", () => {
    expect(BLOCK_PERSIST.has("remove-item")).toBe(true);
    expect(BLOCK_PERSIST.has("rm")).toBe(true);
    expect(BLOCK_PERSIST.has("del")).toBe(true);
    expect(BLOCK_PERSIST.has("set-content")).toBe(true);
    expect(BLOCK_PERSIST.has("move-item")).toBe(true);
    expect(BLOCK_PERSIST.has("out-file")).toBe(true);
  });

  it("should leave the downgrade-only cmdlets persistable", () => {
    // Arbitrary code in general, but a rule for the exact command text pins the
    // code, the target and the scriptblock that were read — CC offers "don't
    // ask again" for these too.
    expect(BLOCK_PERSIST.has("invoke-expression")).toBe(false);
    expect(BLOCK_PERSIST.has("iex")).toBe(false);
    expect(BLOCK_PERSIST.has("start-process")).toBe(false);
    expect(BLOCK_PERSIST.has("invoke-webrequest")).toBe(false);
    expect(BLOCK_PERSIST.has("foreach-object")).toBe(false);
    expect(BLOCK_PERSIST.has("select-object")).toBe(false);
    expect(BLOCK_PERSIST.has("set-alias")).toBe(false);
  });

  it("should not cover the read-only cmdlets", () => {
    expect(BLOCK_PERSIST.has("get-childitem")).toBe(false);
    expect(BLOCK_PERSIST.has("get-content")).toBe(false);
  });
});
