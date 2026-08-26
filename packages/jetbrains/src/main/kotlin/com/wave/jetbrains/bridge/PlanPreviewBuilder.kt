package com.wave.jetbrains.bridge

import com.intellij.openapi.diagnostic.logger
import com.vladsch.flexmark.html.HtmlRenderer
import com.vladsch.flexmark.parser.Parser
import com.vladsch.flexmark.ext.gfm.strikethrough.StrikethroughExtension
import com.vladsch.flexmark.ext.tables.TablesExtension
import com.vladsch.flexmark.ext.gfm.tasklist.TaskListExtension
import com.vladsch.flexmark.util.data.MutableDataSet

/**
 * Builds the self-contained HTML document shown in the plan-preview column of a Wave chat
 * editor tab (the JetBrains counterpart of CC's `claudePlanPreview`).
 *
 * The plan markdown is rendered with flexmark (GFM tables/strikethrough/task lists to match the
 * webview's marked.js feature set), then wrapped in a document that reuses the webview's
 * `chat.css` + theme CSS so the preview looks identical to the in-dialog preview it replaces.
 * Everything is inlined — the JBCefBrowser loads it via `loadHTML`, which uses a non-file
 * origin that blocks `file://` sub-resources (see WebviewContentBuilder docs).
 */
object PlanPreviewBuilder {
    private val LOG = logger<PlanPreviewBuilder>()

    private val options: MutableDataSet by lazy {
        MutableDataSet().apply {
            set(Parser.EXTENSIONS, listOf(
                TablesExtension.create(),
                StrikethroughExtension.create(),
                TaskListExtension.create(),
            ))
        }
    }

    private val parser: Parser by lazy { Parser.builder(options).build() }

    private val renderer: HtmlRenderer by lazy { HtmlRenderer.builder(options).build() }

    /** Renders [markdown] to a full, standalone HTML document ready for `loadHTML`. */
    fun buildHtml(markdown: String): String {
        val body = try {
            renderer.render(parser.parse(markdown))
        } catch (e: Exception) {
            LOG.warn("markdown render failed, falling back to pre-formatted text: ${e.message}")
            "<pre>${escapeHtml(markdown)}</pre>"
        }
        val themeBase = WebviewContentBuilder.themeBaseText()
        val lafOverrides = WebviewContentBuilder.buildLafOverrides()
        val chatCss = WebviewContentBuilder.chatCssText()
        return """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Wave 计划预览</title>
    <style id="${WebviewContentBuilder.THEME_BASE_STYLE_ID}">
        $themeBase
    </style>
    <style id="${WebviewContentBuilder.LAF_STYLE_ID}">
        :root {
$lafOverrides
        }
    </style>
    <style>
        $chatCss
    </style>
    <style>
        html, body { margin: 0; padding: 0; }
        .plan-doc { padding: 16px 20px; overflow: auto; height: 100vh; box-sizing: border-box; }
    </style>
</head>
<body>
    <div class="plan-doc">
        <div class="markdown-body">$body</div>
    </div>
</body>
</html>"""
    }

    private fun escapeHtml(s: String): String = s
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
}
