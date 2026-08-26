package com.wave.jetbrains.bridge

import org.junit.jupiter.api.Assertions.assertDoesNotThrow
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Tests for [PlanPreviewBuilder], which renders ExitPlanMode plan markdown into the standalone
 * HTML document shown in the chat tab's plan-preview column. GFM extensions (tables,
 * strikethrough, task lists) match the webview's marked.js feature set so the preview looks
 * identical to the in-dialog preview it replaces.
 */
class PlanPreviewBuilderTest {

    @Test
    fun `renders headings and paragraphs as markdown-body html`() {
        val html = PlanPreviewBuilder.buildHtml("# 重构方案\n\n正文段落")
        assertTrue(html.contains("markdown-body"), "expected markdown-body container")
        assertTrue(html.contains("<h1>重构方案</h1>"), "expected rendered h1, got: $html")
        assertTrue(html.contains("<p>正文段落</p>"), "expected rendered paragraph")
    }

    @Test
    fun `renders gfm tables`() {
        val md = "| A | B |\n|---|---|\n| 1 | 2 |"
        val html = PlanPreviewBuilder.buildHtml(md)
        assertTrue(html.contains("<table>"), "expected a <table>, got: $html")
        assertTrue(html.contains("<td>1</td>"), "expected table cell")
    }

    @Test
    fun `renders task lists`() {
        val html = PlanPreviewBuilder.buildHtml("- [ ] 待办\n- [x] 完成")
        assertTrue(html.contains("task-list"), "expected task-list markup, got: $html")
    }

    @Test
    fun `renders strikethrough`() {
        val html = PlanPreviewBuilder.buildHtml("~~删除~~")
        assertTrue(html.contains("<s>删除</s>") || html.contains("<del>删除</del>"),
            "expected strikethrough markup, got: $html")
    }

    @Test
    fun `escapes html in code blocks so no script injection`() {
        val md = "```html\n<script>alert(1)</script>\n```"
        val html = PlanPreviewBuilder.buildHtml(md)
        assertTrue(html.contains("&lt;script&gt;"), "expected escaped script tag")
    }

    @Test
    fun `never throws on hostile input`() {
        // NUL bytes / binary junk are not valid markdown; the builder must not throw into the
        // permission flow (it degrades via the internal catch-all, or renders what it can).
        assertDoesNotThrow { PlanPreviewBuilder.buildHtml("bad \u0000 input \u0001\u0002\u0003") }
    }

    @Test
    fun `output is a self-contained document with webview theme css`() {
        val html = PlanPreviewBuilder.buildHtml("# 方案")
        assertTrue(html.startsWith("<!DOCTYPE html>"))
        assertTrue(html.contains("wave-theme-base"), "expected theme css inlined")
        assertTrue(html.contains("wave-laf-overrides"), "expected LaF overrides inlined")
        assertTrue(html.contains("markdown-body"), "expected markdown styles inlined")
    }
}
