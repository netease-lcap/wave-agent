import { describe, it, expect } from "vitest";
import type { Message } from "@/types/messaging.js";
import type { SkillMetadata } from "@/types/skills.js";
import {
  DEFAULT_SKILL_LISTING_CHAR_BUDGET,
  SKILL_LISTING_MARKER_PREFIX,
  buildSkillListingAnnouncement,
  collectSkillListingState,
  formatSkillsWithinBudget,
} from "@/utils/skillListing.js";

function skill(
  name: string,
  description: string,
  type: SkillMetadata["type"] = "project",
): SkillMetadata {
  return {
    name,
    description,
    type,
    skillPath: `/skills/${name}`,
  };
}

/** A meta message carrying `content`, i.e. what the announcement writes. */
function metaMessage(content: string, id = "m"): Message {
  return {
    id,
    role: "user",
    timestamp: "2026-10-01T00:00:00.000Z",
    isMeta: true,
    blocks: [{ type: "text", content }],
  };
}

function plainMessage(content: string, id = "m"): Message {
  return {
    id,
    role: "assistant",
    timestamp: "2026-10-01T00:00:00.000Z",
    blocks: [{ type: "text", content }],
  };
}

describe("formatSkillsWithinBudget", () => {
  it("renders one sorted line per skill under a header", () => {
    const { body, omitted } = formatSkillsWithinBudget([
      skill("zebra", "does stripes"),
      skill("alpha", "does letters"),
    ]);

    expect(body).toBe(
      [
        "Skills available for use with the Skill tool (name: when to use it):",
        "- alpha: does letters",
        "- zebra: does stripes",
      ].join("\n"),
    );
    expect(omitted).toBe(0);
  });

  it("squashes a multi-line description onto the skill's line", () => {
    const { body } = formatSkillsWithinBudget([
      skill("alpha", "line one\n\n  line   two"),
    ]);

    expect(body).toContain("- alpha: line one line two");
    expect(body.split("\n")).toHaveLength(2);
  });

  it("omits the separator when a skill has no description", () => {
    const { body } = formatSkillsWithinBudget([skill("alpha", "")]);

    expect(body.split("\n")).toEqual([
      "Skills available for use with the Skill tool (name: when to use it):",
      "- alpha",
    ]);
  });

  it("produces the same body for the same set in a different order", () => {
    const forward = formatSkillsWithinBudget([
      skill("alpha", "a"),
      skill("beta", "b"),
    ]).body;
    const reverse = formatSkillsWithinBudget([
      skill("beta", "b"),
      skill("alpha", "a"),
    ]).body;

    // The body *is* the hash source, so discovery order must not reach it —
    // otherwise two sessions with the same skills would disagree every turn.
    expect(forward).toBe(reverse);
  });

  it("keeps full descriptions while they fit", () => {
    const long = "x".repeat(200);
    const { body } = formatSkillsWithinBudget(
      [skill("alpha", long), skill("zulu", long, "builtin")],
      10_000,
    );

    expect(body).toContain(`- alpha: ${long}`);
    expect(body).toContain(`- zulu: ${long}`);
  });

  it("shortens non-builtin descriptions first, leaving builtin ones intact", () => {
    const long = "x".repeat(200);
    const skills = [skill("alpha", long), skill("zulu", long, "builtin")];
    const fullBody = formatSkillsWithinBudget(skills, 10_000).body;
    // One character short of the full rendering: the first level cannot fit, the
    // compact one can (400 description chars collapse to 280).
    const { body, omitted } = formatSkillsWithinBudget(
      skills,
      fullBody.length - 1,
    );

    // A builtin is what the model is expected to recognise unaided, so it keeps
    // its description for as long as anything keeps one.
    expect(body).toContain(`- zulu: ${long}`);
    expect(body).not.toContain(`- alpha: ${long}`);
    expect(body).toContain(`- alpha: ${"x".repeat(79)}…`);
    expect(omitted).toBe(0);
  });

  it("drops every description before it drops a name", () => {
    const long = "x".repeat(200);
    const skills = [skill("alpha", long), skill("zulu", long, "builtin")];
    const compactBody = formatSkillsWithinBudget(
      skills,
      formatSkillsWithinBudget(skills, 10_000).body.length - 1,
    ).body;
    const { body } = formatSkillsWithinBudget(skills, compactBody.length - 1);

    // A skill whose name the model never sees cannot be invoked at all; a missing
    // description only makes selection worse.
    expect(body.split("\n").slice(1)).toEqual(["- alpha", "- zulu"]);
  });

  it("truncates the tail and counts it when even the names do not fit", () => {
    const skills = [
      skill("alpha", "a"),
      skill("bravo", "b"),
      skill("zulu", "z"),
    ];
    // An empty list renders the header alone, which is the exact amount of room
    // the header takes out of the budget.
    const header = formatSkillsWithinBudget([]).body;
    const { body, omitted } = formatSkillsWithinBudget(
      skills,
      // Room for the header plus exactly one name line.
      header.length + "- alpha".length + 2,
    );

    expect(body.split("\n")).toEqual([
      header,
      "- alpha",
      "- (2 more skills not listed)",
    ]);
    expect(omitted).toBe(2);
  });

  it("handles a budget with no room for a single name", () => {
    const { body, omitted } = formatSkillsWithinBudget(
      [skill("alpha", "a"), skill("bravo", "b")],
      1,
    );

    expect(omitted).toBe(2);
    expect(body).not.toContain("- alpha");
    expect(body).toContain("- (2 more skills not listed)");
  });

  it("treats the default budget as a usable list", () => {
    const { body, omitted } = formatSkillsWithinBudget([skill("alpha", "a")]);

    expect(body).toContain("- alpha: a");
    expect(omitted).toBe(0);
    expect(DEFAULT_SKILL_LISTING_CHAR_BUDGET).toBeGreaterThan(body.length);
  });
});

describe("collectSkillListingState", () => {
  it("returns null when no listing was ever announced", () => {
    expect(collectSkillListingState([])).toBeNull();
    expect(
      collectSkillListingState([plainMessage("no marker here")]),
    ).toBeNull();
  });

  it("reads the marker the announcement wrote", () => {
    const text = buildSkillListingAnnouncement(null, [skill("alpha", "a")]);

    const state = collectSkillListingState([metaMessage(text as string)]);

    expect(state?.hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it("takes the newest marker, scanning from the tail", () => {
    const first = buildSkillListingAnnouncement(null, [skill("alpha", "a")]);
    const second = buildSkillListingAnnouncement(null, [skill("beta", "b")]);

    const state = collectSkillListingState([
      metaMessage(first as string, "m1"),
      metaMessage(second as string, "m2"),
    ]);

    const newest = collectSkillListingState([metaMessage(second as string)]);
    expect(state?.hash).toBe(newest?.hash);
  });

  it("ignores a marker quoted in ordinary conversation", () => {
    const quoted = plainMessage(
      `A listing starts with ${SKILL_LISTING_MARKER_PREFIX}{"h":"deadbeefcafe"} -->`,
    );

    // Prose *about* a marker is not a statement about the skill set; counting it
    // would suppress the real listing.
    expect(collectSkillListingState([quoted])).toBeNull();
  });

  it("skips a marker that cannot be parsed", () => {
    expect(
      collectSkillListingState([
        metaMessage(`${SKILL_LISTING_MARKER_PREFIX}not json -->\n- alpha: a`),
      ]),
    ).toBeNull();
    expect(
      collectSkillListingState([
        metaMessage(`${SKILL_LISTING_MARKER_PREFIX}{"h":42} -->\n- alpha: a`),
      ]),
    ).toBeNull();
  });
});

describe("buildSkillListingAnnouncement", () => {
  it("stays silent when there is nothing to list and nothing was ever listed", () => {
    // Most sessions listing no skills must not be told about a list they never saw.
    expect(buildSkillListingAnnouncement(null, [])).toBeNull();
  });

  it("announces the full list when nothing was announced yet", () => {
    const text = buildSkillListingAnnouncement(null, [
      skill("alpha", "does letters"),
    ]);

    expect(text).toContain(SKILL_LISTING_MARKER_PREFIX);
    expect(text).toContain("- alpha: does letters");
  });

  it("goes quiet once the same set is on record", () => {
    const skills = [skill("alpha", "a"), skill("beta", "b")];
    const first = buildSkillListingAnnouncement(null, skills);
    const state = collectSkillListingState([metaMessage(first as string)]);

    expect(buildSkillListingAnnouncement(state, skills)).toBeNull();
  });

  it("re-announces when the set changes", () => {
    const first = buildSkillListingAnnouncement(null, [skill("alpha", "a")]);
    const state = collectSkillListingState([metaMessage(first as string)]);

    const next = buildSkillListingAnnouncement(state, [
      skill("alpha", "a"),
      skill("beta", "b"),
    ]);

    expect(next).toContain("- beta: b");
  });

  it("re-announces when a description changes, not only the names", () => {
    const first = buildSkillListingAnnouncement(null, [skill("alpha", "old")]);
    const state = collectSkillListingState([metaMessage(first as string)]);

    // The listing is what the model selects from, so a reworded "when to use it"
    // is a change it needs to see.
    expect(
      buildSkillListingAnnouncement(state, [skill("alpha", "new")]),
    ).toContain("- alpha: new");
  });

  it("corrects an earlier list once it becomes empty", () => {
    const first = buildSkillListingAnnouncement(null, [skill("alpha", "a")]);
    const state = collectSkillListingState([metaMessage(first as string)]);

    const correction = buildSkillListingAnnouncement(state, []);

    expect(correction).toContain("No skills are currently available");
    expect(correction).toContain("no longer current");
  });

  it("says the list is empty only once", () => {
    const first = buildSkillListingAnnouncement(null, [skill("alpha", "a")]);
    const afterFirst = collectSkillListingState([metaMessage(first as string)]);
    const correction = buildSkillListingAnnouncement(afterFirst, []);
    const afterCorrection = collectSkillListingState([
      metaMessage(first as string, "m1"),
      metaMessage(correction as string, "m2"),
    ]);

    expect(buildSkillListingAnnouncement(afterCorrection, [])).toBeNull();
  });

  it("re-announces the full list after the correction", () => {
    const first = buildSkillListingAnnouncement(null, [skill("alpha", "a")]);
    const correction = buildSkillListingAnnouncement(
      collectSkillListingState([metaMessage(first as string)]),
      [],
    );
    const state = collectSkillListingState([metaMessage(correction as string)]);

    // Not compared by content: the empty note is not a list, so there is nothing
    // to hash against and comparing would leave the session mute for good.
    expect(
      buildSkillListingAnnouncement(state, [skill("alpha", "a")]),
    ).toContain("- alpha: a");
  });

  it("announces the full list again when the history lost the marker", () => {
    const skills = [skill("alpha", "a")];
    const first = buildSkillListingAnnouncement(null, skills);
    expect(
      buildSkillListingAnnouncement(
        collectSkillListingState([metaMessage(first as string)]),
        skills,
      ),
    ).toBeNull();

    // Compaction or a rewind: nothing left to compare against. A duplicate beats
    // a loss — the model would otherwise act on a list that no longer exists.
    expect(buildSkillListingAnnouncement(null, skills)).toContain("- alpha: a");
  });

  it("honours the budget it is given", () => {
    const long = "y".repeat(500);
    const text = buildSkillListingAnnouncement(
      null,
      [skill("alpha", long), skill("bravo", long), skill("zulu", long)],
      80,
    );

    expect(text).toContain("skills not listed");
    expect(text?.length).toBeLessThan(400);
  });
});
