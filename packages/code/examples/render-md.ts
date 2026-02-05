import React from "react";
import { render } from "ink";
import { Markdown } from "../src/components/Markdown.js";
import fs from "fs";
import path from "path";

function run() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(
      "Usage: pnpm exec tsx examples/render-md.ts <path-to-md-file>",
    );
    process.exit(1);
  }

  const absolutePath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolutePath)) {
    console.error(`File not found: ${absolutePath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(absolutePath, "utf-8");

  const element = React.createElement(Markdown, null, content);
  const { unmount } = render(element);

  setTimeout(() => {
    unmount();
    process.exit(0);
  }, 100);
}

run();
