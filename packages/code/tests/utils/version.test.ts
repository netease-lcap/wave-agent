import { describe, it, expect } from "vitest";
import { isUpdateAvailable } from "../../src/utils/version.js";

describe("isUpdateAvailable", () => {
  it("should return true if latest version is greater than current version", () => {
    expect(isUpdateAvailable("0.11.5", "0.11.6")).toBe(true);
    expect(isUpdateAvailable("0.11.5", "0.12.0")).toBe(true);
    expect(isUpdateAvailable("0.11.5", "1.0.0")).toBe(true);
  });

  it("should return false if latest version is equal to current version", () => {
    expect(isUpdateAvailable("0.11.6", "0.11.6")).toBe(false);
  });

  it("should return false if latest version is less than current version", () => {
    expect(isUpdateAvailable("0.11.7", "0.11.6")).toBe(false);
  });
});
