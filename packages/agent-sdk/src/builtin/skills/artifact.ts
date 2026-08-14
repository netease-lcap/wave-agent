import { ARTIFACT_TOOL_NAME } from "../../constants/tools.js";

export const artifactSkill: Record<string, string> = {
  "skills/artifact/SKILL.md": `---
name: artifact
description: Publish a local HTML or Markdown file as a shareable web page
disable-model-invocation: true
---

# Artifact: Publish a File as a Shareable Web Page

Publish a local \`.html\` or \`.md\` file as a default-private, shareable web page.

- If a file path was provided ($ARGUMENTS / $1), use it directly as the \`file_path\`.
- Otherwise, infer which file to publish from the conversation context; if it is not clear, ask the user which file to publish.

Call the \`${ARTIFACT_TOOL_NAME}\` tool with the resolved \`file_path\` (and \`favicon\` if relevant), then report the resulting URL to the user.
`,
};
