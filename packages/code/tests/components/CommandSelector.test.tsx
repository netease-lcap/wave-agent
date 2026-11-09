import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "../helpers/inkHarness.js";
import { CommandSelector } from "../../src/components/CommandSelector.js";
import type { SlashCommand } from "wave-agent-sdk";

/**
 * A skill description as it really arrives: `Skill: ${frontmatter description}`,
 * hard line breaks included (`/claude-api`'s `TRIGGER when:` block is the
 * canonical example). Ink wraps such text by default, so before the fix this
 * single entry occupied six rows and the whole menu grew and shrank as the
 * selection moved.
 */
const WRAPPED_SKILL_DESCRIPTION = `Skill: Analyze a codebase and produce a structured report.

TRIGGER when: the user asks for an architecture overview, wants to know how a feature is wired end to end, or asks "where is X handled". Do NOT trigger for single-file reads.`;

const commands: SlashCommand[] = [
  {
    id: "zz-alpha",
    name: "zz-alpha",
    description:
      "Revert conversation and file changes to a previous checkpoint",
    handler: () => {},
  },
  {
    id: "zz-beta",
    name: "zz-beta",
    description: WRAPPED_SKILL_DESCRIPTION,
    handler: () => {},
  },
  {
    id: "zz-gamma",
    name: "zz-gamma",
    description: "",
    handler: () => {},
  },
];

const mount = async () => {
  const harness = render(
    <CommandSelector
      searchQuery="zz-"
      onSelect={() => {}}
      onCancel={() => {}}
      commands={commands}
    />,
  );
  await harness.settle();
  return harness;
};

/** The frame as rows, so a test can talk about heights instead of raw text. */
const rowsOf = (frame: string) => frame.split("\n");

describe("CommandSelector", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps the menu height fixed while the selection moves across descriptions of any length", async () => {
    const { lastFrame, stdin, settle } = await mount();

    const heights = [rowsOf(lastFrame() ?? "").length];
    for (let i = 0; i < 2; i++) {
      stdin.write("\u001B[B"); // ArrowDown
      await settle();
      heights.push(rowsOf(lastFrame() ?? "").length);
    }

    // Short description → six-line skill description → no description at all.
    expect(new Set(heights).size).toBe(1);
  });

  it("flattens a multi-line description into one truncated row", async () => {
    const { lastFrame, stdin, settle } = await mount();
    stdin.write("\u001B[B"); // ArrowDown → zz-beta
    await settle();

    const rows = rowsOf(lastFrame() ?? "");
    const descriptionRow = rows.find((row) => row.includes("Skill: Analyze"));

    expect(descriptionRow).toBeDefined();
    // Flattened: the paragraph break is gone, and the text that used to sit on
    // the following lines now lives on this same row.
    expect(descriptionRow).toContain("TRIGGER when:");
    expect(descriptionRow).not.toContain("\r");
    // Wider than the 100-column harness, so the tail is cut — one row, not six.
    expect(descriptionRow?.endsWith("…")).toBe(true);
    expect(rows.some((row) => row.includes("single-file reads"))).toBe(false);
  });

  it("still spends a row on the description slot when the command has none", async () => {
    const { lastFrame, stdin, settle } = await mount();
    const heightWithShortDescription = rowsOf(lastFrame() ?? "").length;

    stdin.write("\u001B[B\u001B[B"); // ArrowDown ×2 → zz-gamma (no description)
    await settle();

    const rows = rowsOf(lastFrame() ?? "");
    expect(rows.some((row) => row.includes("zz-gamma"))).toBe(true);
    expect(rows.length).toBe(heightWithShortDescription);
  });
});
