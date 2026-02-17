import { describe, it, expect } from "vitest";
import { generateRandomName } from "../../src/utils/nameGenerator.js";

describe("nameGenerator", () => {
  it("should generate a random name without seed", () => {
    const name = generateRandomName();
    expect(name).toMatch(/^[a-z]+-[a-z]+$/);
  });

  it("should generate the same name for the same seed", () => {
    const seed = "test-seed";
    const name1 = generateRandomName(seed);
    const name2 = generateRandomName(seed);
    expect(name1).toBe(name2);
  });

  it("should generate different names for different seeds", () => {
    const name1 = generateRandomName("seed-1");
    const name2 = generateRandomName("seed-2");
    expect(name1).not.toBe(name2);
  });

  it("should generate a name even with empty seed", () => {
    const name = generateRandomName("");
    expect(name).toMatch(/^[a-z]+-[a-z]+$/);
  });
});
