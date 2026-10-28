import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "./inkHarness.js";

afterEach(cleanup);

describe("inkHarness", () => {
  /**
   * ink's `getWindowSize()` only trusts the stream when **both** `columns` and
   * `rows` are present; otherwise it resolves the real terminal through the
   * `terminal-size` package, which does it with synchronous `execFileSync`
   * spawns (`tput`, `resize`, `/dev/tty`). ink asks once per layout pass, so a
   * stream declaring only `columns` pays a child-process spawn on every
   * rendered frame — cheap on Linux, but ~10x+ on the Windows runner, where it
   * ate `vi.waitFor`'s 1s budget and made the suite flake (2026-10-27).
   *
   * Both dimensions must therefore stay declared, and stay independent of the
   * machine running the suite (a real terminal answers with *its* height).
   */
  it("declares both terminal dimensions", () => {
    const { stdout } = render(<></>);

    expect(stdout.columns).toBe(100);
    expect(stdout.rows).toBe(24);
  });
});
