/**
 * Plan preview webview entry (VS Code `claudePlanPreview` equivalent).
 *
 * A tiny standalone bundle rendered inside the plan-preview WebviewPanel that the VS Code
 * extension opens adjacent to the chat panel when ExitPlanMode asks for confirmation. The
 * extension host posts `{ command: "planPreview", content }` over the webview message channel;
 * this script renders the markdown plan into the `.markdown-body` container (sanitized, same
 * marked/DOMPurify stack the chat bundle uses). The panel HTML links `chat.css` for the
 * markdown-body + VS Code theme variable styles.
 */
import { marked } from "marked";
import DOMPurify from "dompurify";

function renderPlan(content: string) {
  const html = DOMPurify.sanitize(marked.parse(String(content)) as string);
  const container = document.getElementById("plan-preview");
  if (container) {
    container.innerHTML = html;
  }
}

window.addEventListener("message", (event) => {
  const msg = event.data as { command?: string; content?: unknown } | undefined;
  if (
    msg &&
    typeof msg === "object" &&
    msg.command === "planPreview" &&
    typeof msg.content === "string"
  ) {
    renderPlan(msg.content);
  }
});

renderPlan("等待计划生成…");
