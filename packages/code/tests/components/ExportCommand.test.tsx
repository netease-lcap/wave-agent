import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, cleanup } from "../helpers/inkHarness.js";
import { ExportCommand } from "../../src/components/ExportCommand.js";

const DEFAULT_FILENAME = "2026-01-02-030405-first-prompt.txt";

const makeProps = () => ({
  defaultFilename: DEFAULT_FILENAME,
  stats: { messages: 3, injectedMessages: 0, toolCalls: 2, images: 1 },
  onCopy: vi.fn(async () => {}),
  onSave: vi.fn(async () => {}),
  onCancel: vi.fn(),
});

describe("ExportCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders Claude Code's two options verbatim and the stats summary", async () => {
    const props = makeProps();
    const { lastFrame, settle } = render(<ExportCommand {...props} />);
    await settle();

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Export Conversation");
    expect(frame).toContain("Select export method:");
    expect(frame).toContain("Copy to clipboard");
    expect(frame).toContain("Copy the conversation to your system clipboard");
    expect(frame).toContain("Save to file");
    expect(frame).toContain(
      "Save the conversation to a file in the current directory",
    );
    // Stats line: images only appear when there are any.
    expect(frame).toContain("3 messages · 2 tool calls · 1 images");
  });

  it("drops the tool-call and image parts of the summary when they are zero", async () => {
    const props = {
      ...makeProps(),
      stats: { messages: 1, injectedMessages: 0, toolCalls: 0, images: 0 },
    };
    const { lastFrame, settle } = render(<ExportCommand {...props} />);
    await settle();

    expect(lastFrame()).toContain("1 messages");
    expect(lastFrame()).not.toContain("tool calls");
    expect(lastFrame()).not.toContain("images");
  });

  it("copies to the clipboard on Enter over the first option", async () => {
    const props = makeProps();
    const { stdin, settle } = render(<ExportCommand {...props} />);
    await settle();

    stdin.write("\r");
    await settle();

    expect(props.onCopy).toHaveBeenCalledTimes(1);
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it("moves to the filename prompt when Save to file is chosen", async () => {
    const props = makeProps();
    const { stdin, lastFrame, settle } = render(<ExportCommand {...props} />);
    await settle();

    stdin.write("\u001B[B"); // Down arrow
    await settle();
    stdin.write("\r");
    await settle();

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Enter filename:");
    // The default name is prefilled, cursor at its end (same as CC's TextInput).
    expect(frame).toContain(DEFAULT_FILENAME);
    expect(props.onCopy).not.toHaveBeenCalled();
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it("appends typed characters to the default name and saves on Enter", async () => {
    const props = makeProps();
    const { stdin, settle } = render(<ExportCommand {...props} />);
    await settle();

    stdin.write("\u001B[B");
    await settle();
    stdin.write("\r");
    await settle();

    stdin.write("x");
    await settle();
    stdin.write("\r");
    await settle();

    expect(props.onSave).toHaveBeenCalledWith(`${DEFAULT_FILENAME}x`);
  });

  it("goes back to the option list on Esc in the filename step", async () => {
    const props = makeProps();
    const { stdin, lastFrame, settle } = render(<ExportCommand {...props} />);
    await settle();

    stdin.write("\u001B[B");
    await settle();
    stdin.write("\r");
    await settle();
    stdin.write("\u001B"); // Esc
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Select export method:");
    });

    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it("cancels the whole dialog on Esc in the option list", async () => {
    const props = makeProps();
    const { stdin, settle } = render(<ExportCommand {...props} />);
    await settle();

    stdin.write("\u001B");
    // A lone Esc is resolved by ink's escape-sequence parser, i.e. on a timer.
    await vi.waitFor(() => {
      expect(props.onCancel).toHaveBeenCalledTimes(1);
    });
  });

  it("does not save an empty filename", async () => {
    const props = makeProps();
    const { stdin, settle } = render(<ExportCommand {...props} />);
    await settle();

    stdin.write("\u001B[B");
    await settle();
    stdin.write("\r");
    await settle();

    // Backspace over every character of the prefilled name.
    for (let i = 0; i < DEFAULT_FILENAME.length; i++) {
      stdin.write("\u007F");
    }
    await settle();
    stdin.write("\r");
    await settle();

    expect(props.onSave).not.toHaveBeenCalled();
  });
});
