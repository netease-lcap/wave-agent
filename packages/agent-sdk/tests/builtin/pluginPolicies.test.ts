import { describe, expect, it } from "vitest";
import {
  BUILTIN_PLUGIN_POLICIES,
  isBuiltinPluginEnabled,
} from "../../src/builtin/pluginPolicies.js";

describe("isBuiltinPluginEnabled", () => {
  it("defaults to off when no entry and no policy", () => {
    expect(isBuiltinPluginEnabled("sdd", {})).toBe(false);
  });

  it("loads a plugin whose policy declares defaultEnabled", () => {
    expect(isBuiltinPluginEnabled("demo", {}, { defaultEnabled: true })).toBe(
      true,
    );
  });

  it("keeps an explicit policy of false off", () => {
    expect(isBuiltinPluginEnabled("demo", {}, { defaultEnabled: false })).toBe(
      false,
    );
  });

  it("lets an explicit true entry override a default-off policy", () => {
    expect(
      isBuiltinPluginEnabled(
        "demo",
        { "demo@builtin": true },
        {
          defaultEnabled: false,
        },
      ),
    ).toBe(true);
  });

  it("lets an explicit false entry override a default-on policy", () => {
    expect(
      isBuiltinPluginEnabled(
        "demo",
        { "demo@builtin": false },
        {
          defaultEnabled: true,
        },
      ),
    ).toBe(false);
  });

  it("keys on <name>@builtin, not the plain plugin name", () => {
    expect(
      isBuiltinPluginEnabled("demo", { demo: true }, { defaultEnabled: false }),
    ).toBe(false);
  });

  it("declares sdd off by default", () => {
    // Design intent: the sdd SessionStart hook would otherwise inject guidance
    // into every repository. Enablement is a per-project decision.
    expect(BUILTIN_PLUGIN_POLICIES.sdd?.defaultEnabled).toBe(false);
    expect(isBuiltinPluginEnabled("sdd", {})).toBe(false);
    expect(isBuiltinPluginEnabled("sdd", { "sdd@builtin": true })).toBe(true);
  });
});
