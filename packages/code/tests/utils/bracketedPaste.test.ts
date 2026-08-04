import { describe, it, expect } from "vitest";
import { createBracketedPasteDetector } from "../../src/utils/bracketedPaste.js";

const ESC = "\u001b";

describe("createBracketedPasteDetector", () => {
  describe("single-chunk paste (whole paste in one stdin chunk)", () => {
    it("detects a paste with a trailing \\r (the tmux copy bug)", () => {
      const detector = createBracketedPasteDetector();
      // ink strips ONE leading ESC, so the callback sees `[200~...\x1b[201~`.
      const result = detector.process(
        `[200~Watch PR checks until completion\r${ESC}[201~`,
      );
      expect(result).toEqual({
        kind: "paste",
        text: "Watch PR checks until completion\r",
      });
    });

    it("detects the raw (un-stripped) marker form", () => {
      const detector = createBracketedPasteDetector();
      const result = detector.process(
        `${ESC}[200~Watch PR checks until completion\r${ESC}[201~`,
      );
      expect(result).toEqual({
        kind: "paste",
        text: "Watch PR checks until completion\r",
      });
    });

    it("detects a multi-line paste", () => {
      const detector = createBracketedPasteDetector();
      const result = detector.process(`[200~line1\rline2${ESC}[201~`);
      expect(result).toEqual({ kind: "paste", text: "line1\rline2" });
    });

    it("detects an empty paste", () => {
      const detector = createBracketedPasteDetector();
      const result = detector.process(`[200~${ESC}[201~`);
      expect(result).toEqual({ kind: "paste", text: "" });
    });

    it("keeps content after a nested-looking start marker inside the paste", () => {
      const detector = createBracketedPasteDetector();
      const result = detector.process(`[200~a[200~b${ESC}[201~`);
      expect(result).toEqual({ kind: "paste", text: "a[200~b" });
    });

    it("reports content before the start marker as leadingInput", () => {
      const detector = createBracketedPasteDetector();
      const result = detector.process(`abc[200~pasted${ESC}[201~`);
      expect(result).toEqual({
        kind: "paste",
        text: "pasted",
        leadingInput: "abc",
      });
    });
  });

  describe("split-chunk paste (markers and content across stdin chunks)", () => {
    it("holds chunks while in paste and never yields input for the \\r chunk", () => {
      const detector = createBracketedPasteDetector();
      expect(detector.process(`[200~`)).toEqual({ kind: "consume" });
      expect(detector.process("Watch PR checks until completion")).toEqual({
        kind: "consume",
      });
      // The lone \r mid-paste must NOT be surfaced as input (no submit).
      expect(detector.process("\r")).toEqual({ kind: "consume" });
      expect(detector.process(`${ESC}[201~`)).toEqual({
        kind: "paste",
        text: "Watch PR checks until completion\r",
      });
    });

    it("handles an end marker split across two chunks", () => {
      const detector = createBracketedPasteDetector();
      expect(detector.process(`[200~text\r`)).toEqual({ kind: "consume" });
      expect(detector.process(`${ESC}[201`)).toEqual({ kind: "consume" });
      expect(detector.process(`~`)).toEqual({
        kind: "paste",
        text: "text\r",
      });
    });

    it("handles a start marker split across two chunks", () => {
      const detector = createBracketedPasteDetector();
      // `[200` is a deferred partial, so the chunk yields no input.
      expect(detector.process(`[200`)).toEqual({ kind: "input", input: "" });
      expect(detector.process(`~pasted${ESC}[201~`)).toEqual({
        kind: "paste",
        text: "pasted",
      });
    });

    it("flushes a deferred partial unchanged when no marker completes", () => {
      const detector = createBracketedPasteDetector();
      expect(detector.process(`[200`)).toEqual({ kind: "input", input: "" });
      expect(detector.process("xyz")).toEqual({
        kind: "input",
        input: "[200xyz",
      });
    });

    it("handles a partial start marker at the end of a longer chunk", () => {
      const detector = createBracketedPasteDetector();
      // "abc[200" -> "abc" is input, "[200" is deferred.
      expect(detector.process("abc[200")).toEqual({
        kind: "input",
        input: "abc",
      });
      expect(detector.process(`~pasted${ESC}[201~`)).toEqual({
        kind: "paste",
        text: "pasted",
      });
    });
  });

  describe("orphan end marker (start marker missed)", () => {
    it("treats text before the orphan end marker as paste, not input", () => {
      const detector = createBracketedPasteDetector();
      const result = detector.process(
        `Watch PR checks until completion\r${ESC}[201~`,
      );
      expect(result).toEqual({
        kind: "paste",
        text: "Watch PR checks until completion\r",
      });
    });
  });

  describe("normal input passthrough", () => {
    it("passes through typed text", () => {
      const detector = createBracketedPasteDetector();
      expect(detector.process("hello")).toEqual({
        kind: "input",
        input: "hello",
      });
    });

    it("passes through a lone \\r (genuine Enter is a separate key event)", () => {
      const detector = createBracketedPasteDetector();
      expect(detector.process("\r")).toEqual({ kind: "input", input: "\r" });
    });

    it("passes through an empty chunk (arrow keys etc.)", () => {
      const detector = createBracketedPasteDetector();
      expect(detector.process("")).toEqual({ kind: "input", input: "" });
    });

    it("passes through text ending in a bracket that is not a marker partial", () => {
      const detector = createBracketedPasteDetector();
      expect(detector.process("[200a")).toEqual({
        kind: "input",
        input: "[200a",
      });
    });

    it("passes through mixed content without markers", () => {
      const detector = createBracketedPasteDetector();
      expect(detector.process("a\rb\nc")).toEqual({
        kind: "input",
        input: "a\rb\nc",
      });
    });
  });

  describe("reset", () => {
    it("abandons an in-flight paste", () => {
      const detector = createBracketedPasteDetector();
      expect(detector.process(`[200~half`)).toEqual({ kind: "consume" });
      detector.reset();
      expect(detector.process(`[200~done${ESC}[201~`)).toEqual({
        kind: "paste",
        text: "done",
      });
    });
  });
});
