import { describe, it, expect, beforeEach } from "vitest";
import {
  recordArtifact,
  getArtifactByFilePath,
  getRecordedVersion,
  recordVersion,
  clearArtifactSession,
} from "../../src/services/artifactSession.js";

describe("artifactSession", () => {
  beforeEach(() => {
    clearArtifactSession("session-a");
    clearArtifactSession("session-b");
  });

  it("should record a publish by file path and slug version", () => {
    recordArtifact("session-a", "docs/guide.md", {
      url: "https://server.test/code/artifact/abc",
      slug: "abc",
      version: "v1",
    });

    expect(getArtifactByFilePath("session-a", "docs/guide.md")).toEqual({
      url: "https://server.test/code/artifact/abc",
      slug: "abc",
      version: "v1",
    });
    expect(getRecordedVersion("session-a", "abc")).toBe("v1");
  });

  it("should keep sessions isolated", () => {
    recordArtifact("session-a", "doc.md", {
      url: "https://server.test/code/artifact/abc",
      slug: "abc",
      version: "v1",
    });

    expect(getArtifactByFilePath("session-b", "doc.md")).toBeUndefined();
    expect(getRecordedVersion("session-b", "abc")).toBeUndefined();
  });

  it("should overwrite the record on republish", () => {
    recordArtifact("session-a", "doc.md", {
      url: "https://server.test/code/artifact/abc",
      slug: "abc",
      version: "v1",
    });
    recordArtifact("session-a", "doc.md", {
      url: "https://server.test/code/artifact/abc",
      slug: "abc",
      version: "v2",
    });

    expect(getArtifactByFilePath("session-a", "doc.md")?.version).toBe("v2");
    expect(getRecordedVersion("session-a", "abc")).toBe("v2");
  });

  it("should track versions observed outside publishes (conflicts / reads)", () => {
    recordVersion("session-a", "abc", "v5");
    expect(getRecordedVersion("session-a", "abc")).toBe("v5");
  });

  it("should clear all state for a session", () => {
    recordArtifact("session-a", "doc.md", {
      url: "https://server.test/code/artifact/abc",
      slug: "abc",
      version: "v1",
    });
    clearArtifactSession("session-a");

    expect(getArtifactByFilePath("session-a", "doc.md")).toBeUndefined();
    expect(getRecordedVersion("session-a", "abc")).toBeUndefined();
  });
});
