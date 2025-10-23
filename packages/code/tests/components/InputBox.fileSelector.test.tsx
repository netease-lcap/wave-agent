import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { render } from "ink-testing-library";
import { InputBox } from "../../src/components/InputBox.js";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Delay function
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("InputBox File Selector", () => {
  let tempDir: string;
  let originalCwd: string;

  beforeAll(async () => {
    // Save original working directory
    originalCwd = process.cwd();

    // Create temporary directory
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-selector-test-"));

    // Switch directly to temporary directory
    process.chdir(tempDir);

    // Create test file structure
    const testFiles = [
      "src/index.ts",
      "src/components/App.tsx",
      "src/cli.tsx",
      "package.json",
    ];

    // Create directory structure and files
    for (const filePath of testFiles) {
      const fullPath = path.join(tempDir, filePath);
      const dir = path.dirname(fullPath);

      // Ensure directory exists
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Write file content
      fs.writeFileSync(fullPath, `// Test file: ${filePath}`);
    }
  });

  afterAll(() => {
    // Restore original working directory
    process.chdir(originalCwd);

    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should trigger file selector when @ is typed", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Input @ symbol
    stdin.write("@");
    await delay(100); // Increase delay to wait for debounced search completion

    // Verify file selector appears
    expect(lastFrame()).toContain("Select File");
    expect(lastFrame()).toContain("src/index.ts");
    expect(lastFrame()).toContain("src/cli.tsx");
    // Verify at least some files are displayed
    expect(lastFrame()).toMatch(/File \d+ of \d+/);
  });

  it("should filter files when typing after @", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // First input @ to trigger file selector
    stdin.write("@");
    await delay(100); // Wait for debounced search completion

    // Verify file selector is already displayed
    expect(lastFrame()).toContain("Select File");

    // Then input filter condition (search for files containing "src")
    stdin.write("src");
    await delay(100); // Wait for debounced search completion

    // Verify file selector displays filtered results
    const output = lastFrame();
    expect(output).toContain('filtering: "src"');
    expect(output).toContain("src/index.ts");
    // package.json should be filtered out
    expect(output).not.toContain("package.json");
  });

  it("should filter files with more specific query", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // First input @ to trigger file selector
    stdin.write("@");
    await delay(100); // Wait for initial search completion

    // Then input more specific filter condition
    stdin.write("tsx");
    await delay(100); // Wait for debounced search completion

    // Verify only matching files are displayed
    expect(lastFrame()).toContain("Select File");
    expect(lastFrame()).toContain('filtering: "tsx"');
    expect(lastFrame()).toContain("src/cli.tsx");
    // Other files should be filtered out
    expect(lastFrame()).not.toContain("src/index.ts");
    expect(lastFrame()).not.toContain("package.json");
  });

  it("should show no files message when no matches found", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // First input @ to trigger file selector
    stdin.write("@");
    await delay(100); // Wait for initial search completion

    // Then input non-existent file filter condition
    stdin.write("nonexistent");
    await delay(100); // Wait for debounced search completion

    // Verify no matching files message is displayed
    expect(lastFrame()).toContain('No files found for "nonexistent"');
    expect(lastFrame()).toContain("Press Escape to cancel");
  });

  it("should close file selector when escape is pressed", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Input @ to trigger file selector
    stdin.write("@");
    await delay(100); // Wait for debounced search completion
    expect(lastFrame()).toContain("Select File");

    // Press Escape key
    stdin.write("\u001B"); // ESC key
    await delay(50);

    // Verify file selector disappears
    expect(lastFrame()).not.toContain("Select File");
    expect(lastFrame()).toContain("@");
  });

  it("should close file selector when @ is deleted", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // First input @ to trigger file selector
    stdin.write("@");
    await delay(100); // Wait for debounced search completion

    // Verify file selector appears
    expect(lastFrame()).toContain("Select File");

    // Delete @ character
    stdin.write("\u007F"); // Backspace
    await delay(50);

    // Verify file selector disappears
    expect(lastFrame()).not.toContain("Select File");
  });

  it("should select file and replace @ query when Enter is pressed", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // First input @ to trigger file selector
    stdin.write("@");
    await delay(100); // Wait for initial search completion

    // Then input filter condition
    stdin.write("tsx");
    await delay(100); // Wait for debounced search completion

    // Verify file selector displays
    expect(lastFrame()).toContain("Select File");
    expect(lastFrame()).toContain("src/cli.tsx");

    // Press Enter to select first file
    stdin.write("\r"); // Enter key
    await delay(50);

    // Verify file selector disappears, text is replaced
    expect(lastFrame()).not.toContain("Select File");
    expect(lastFrame()).toContain("src/cli.tsx");
  });

  it("should navigate files with arrow keys in file selector", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Input @ to trigger file selector
    stdin.write("@");
    await delay(100); // Wait for debounced search completion

    // Verify first item is selected (directories are shown first, so it should be src directory)
    expect(lastFrame()).toContain("▶ 📁 src");

    // Press down arrow key to move selection
    stdin.write("\u001B[B"); // Down arrow
    await delay(50);

    // Verify selection moves to second item (should be first file)
    expect(lastFrame()).toContain("▶ 📄 src/index.ts");
    expect(lastFrame()).not.toContain("▶ 📁 src");

    // Press up arrow key
    stdin.write("\u001B[A"); // Up arrow
    await delay(50);

    // Verify selection returns to first item (directory)
    expect(lastFrame()).toContain("▶ 📁 src");
    expect(lastFrame()).not.toContain("▶ 📄 src/index.ts");
  });

  it("should handle complex input with @ in the middle", async () => {
    const { stdin, lastFrame } = render(<InputBox />);

    // Input some text, then insert @ in the middle
    stdin.write("Check this file ");
    await delay(50);

    // First input @ to trigger file selector
    stdin.write("@");
    await delay(100); // Wait for initial search completion

    // Then input filter condition
    stdin.write("tsx");
    await delay(100); // Wait for debounced search completion

    // Verify file selector displays
    expect(lastFrame()).toContain("Select File");
    expect(lastFrame()).toContain('filtering: "tsx"');

    // Select file
    stdin.write("\r"); // Enter
    await delay(50);

    // Verify complete text
    expect(lastFrame()).toContain("Check this file src/cli.tsx");
    expect(lastFrame()).not.toContain("Select File");
  });
});
