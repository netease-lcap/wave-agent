import React from "react";
import { render } from "ink-testing-library";
import { TextInput } from "../src/components/TextInput.js";
import { describe, it, expect, vi } from "vitest";

describe("TextInput Logic", () => {
  // Helper to test logic without full ink-testing-library stdin complexity
  it("should handle basic typing", async () => {
    let currentValue = "";
    const onChange = vi.fn((val) => {
      currentValue = val;
    });

    const { stdin, rerender } = render(
      <TextInput value={currentValue} onChange={onChange} isFocused={true} />,
    );

    stdin.write("a");
    rerender(
      <TextInput value={currentValue} onChange={onChange} isFocused={true} />,
    );
    stdin.write("b");
    rerender(
      <TextInput value={currentValue} onChange={onChange} isFocused={true} />,
    );

    expect(currentValue).toBe("ab");
  });

  it("should handle backspace at the end", async () => {
    let currentValue = "abc";
    const onChange = vi.fn((val) => {
      currentValue = val;
    });

    const { stdin, rerender } = render(
      <TextInput value={currentValue} onChange={onChange} isFocused={true} />,
    );

    // Initial cursor is at the end (length 3)
    stdin.write("\x08"); // Backspace (Ctrl+H / \x08 is often used in tests for backspace)
    rerender(
      <TextInput value={currentValue} onChange={onChange} isFocused={true} />,
    );

    if (currentValue === "abc") {
      stdin.write("\x7f"); // Try \x7f if \x08 didn't work
      rerender(
        <TextInput value={currentValue} onChange={onChange} isFocused={true} />,
      );
    }

    expect(currentValue).toBe("ab");
  });

  it("should handle cursor movement and middle insertion", async () => {
    let currentValue = "ac";
    const onChange = vi.fn((val) => {
      currentValue = val;
    });

    const { stdin, rerender } = render(
      <TextInput value={currentValue} onChange={onChange} isFocused={true} />,
    );

    // Move left once (cursor between 'a' and 'c')
    stdin.write("\u001b[D");
    rerender(
      <TextInput value={currentValue} onChange={onChange} isFocused={true} />,
    );

    stdin.write("b");
    rerender(
      <TextInput value={currentValue} onChange={onChange} isFocused={true} />,
    );

    expect(currentValue).toBe("abc");
  });

  it("should handle backspace in the middle", async () => {
    let currentValue = "abc";
    const onChange = vi.fn((val) => {
      currentValue = val;
    });

    const { stdin, rerender } = render(
      <TextInput value={currentValue} onChange={onChange} isFocused={true} />,
    );

    // Move left once (cursor at 'c')
    stdin.write("\u001b[D");
    rerender(
      <TextInput value={currentValue} onChange={onChange} isFocused={true} />,
    );

    // Backspace (should delete 'b')
    stdin.write("\x08");
    rerender(
      <TextInput value={currentValue} onChange={onChange} isFocused={true} />,
    );
    if (currentValue === "abc") {
      stdin.write("\x7f");
      rerender(
        <TextInput value={currentValue} onChange={onChange} isFocused={true} />,
      );
    }

    expect(currentValue).toBe("ac");
  });

  it("should handle delete key", async () => {
    let currentValue = "abc";
    const onChange = vi.fn((val) => {
      currentValue = val;
    });

    const { stdin, rerender } = render(
      <TextInput value={currentValue} onChange={onChange} isFocused={true} />,
    );

    // Move left twice (cursor at 'b')
    stdin.write("\u001b[D");
    stdin.write("\u001b[D");
    rerender(
      <TextInput value={currentValue} onChange={onChange} isFocused={true} />,
    );

    // Delete (should delete 'b')
    stdin.write("\u001b[3~");
    rerender(
      <TextInput value={currentValue} onChange={onChange} isFocused={true} />,
    );

    expect(currentValue).toBe("ac");
  });
});
