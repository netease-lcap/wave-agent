package com.wave.jetbrains.bridge

import com.intellij.openapi.diagnostic.logger
import com.intellij.ui.JBColor
import java.awt.Color
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import javax.swing.UIManager

/**
 * Extracts the shared webview bundle (chat.js / chat.css / vscode-shim.js + index.html) from
 * the plugin jar resources to a temp directory.
 *
 * JCEF cannot read from inside a jar directly, and `loadHTML` uses a non-file origin that
 * blocks `file://` sub-resources via same-origin policy. So we extract everything to a real
 * temp dir and load `index.html` via `loadURL("file://...")`, giving the page a `file://`
 * origin that can freely load sibling assets.
 *
 * VS Code injects `--vscode-*` CSS variables into the webview body; JetBrains/JCEF does not,
 * so we read the current IntelliJ LaF colors and inject them as `:root` variables to keep
 * the shared webview styled consistently with the host theme.
 */
object WebviewContentBuilder {
    private val LOG = logger<WebviewContentBuilder>()

    private const val RESOURCE_DIR = "/webview"
    private val ASSETS = listOf("chat.js", "chat.css", "vscode-shim.js", "theme-base.css")

    /** Extracted temp dir + the file:// URL of index.html to load. */
    data class ExtractedAssets(val dir: File, val indexUrl: String)

    fun extractAssets(): ExtractedAssets {
        val dir = Files.createTempDirectory("wave-webview").toFile()
        dir.deleteOnExit()
        val paths = mutableMapOf<String, File>()
        for (name in ASSETS) {
            val stream = javaClass.getResourceAsStream("$RESOURCE_DIR/$name")
            if (stream == null) {
                LOG.warn("Webview asset not found in plugin resources: $name")
                continue
            }
            val target = File(dir, name)
            stream.use { Files.copy(it, target.toPath(), StandardCopyOption.REPLACE_EXISTING) }
            paths[name] = target
        }

        val chatJs = paths["chat.js"]?.name ?: "chat.js"
        val chatCss = paths["chat.css"]?.name ?: "chat.css"
        val shimJs = paths["vscode-shim.js"]?.name ?: "vscode-shim.js"
        val themeBase = paths["theme-base.css"]?.readText() ?: ""
        val lafOverrides = buildLafOverrides()

        val html = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Wave AI Chat</title>
    <style>
        $themeBase
        :root {
$lafOverrides
        }
        html, body { margin: 0; padding: 0; height: 100%; width: 100%; overflow: hidden; }
        #root { height: 100%; width: 100%; }
    </style>
    <link rel="stylesheet" href="$chatCss">
</head>
<body>
    <div id="root"></div>
    <script src="$shimJs"></script>
    <script src="$chatJs"></script>
</body>
</html>"""

        val indexFile = File(dir, "index.html")
        indexFile.writeText(html, Charsets.UTF_8)
        LOG.info("Wave webview extracted to ${dir.path}, index=${indexFile.path}")
        return ExtractedAssets(dir, indexFile.toURI().toString())
    }

    /**
     * Generate `--vscode-*` overrides from the current IntelliJ LaF so the webview blends with
     * the host theme. Only the key surface colors are overridden; the remaining 80+ variables
     * come from the bundled theme-base.css (a full VS Code dark theme). Placed AFTER theme-base
     * in the <style> so these win via cascade order.
     */
    private fun buildLafOverrides(): String {
        val bg = laf("Panel.background", JBColor.PanelBackground, Color(0x1e1e1e))
        val fg = laf("Label.foreground", JBColor.foreground(), Color(0xd4d4d4))
        val inputBg = laf("TextField.background", bg.brighter(), Color(0x2a2a2a))
        val inputFg = laf("TextField.foreground", fg, fg)
        val inputBorder = laf("TextField.borderColor", JBColor.border(), Color(0x3c3c3c))
        val buttonBg = laf("Button.background", JBColor(0x0e639c, 0x0e639c), Color(0x0e639c))
        val buttonFg = laf("Button.foreground", Color.WHITE, Color.WHITE)
        val border = laf("Border.color", JBColor.border(), Color(0x3c3c3c))
        val font = lafFont("Label.font")

        val vars = linkedMapOf(
            "--vscode-editor-background" to bg,
            "--vscode-editor-foreground" to fg,
            "--vscode-foreground" to fg,
            "--vscode-panel-background" to bg,
            "--vscode-panel-border" to border,
            "--vscode-panel-title-foreground" to fg,
            "--vscode-input-background" to inputBg,
            "--vscode-input-foreground" to inputFg,
            "--vscode-input-border" to inputBorder,
            "--vscode-dropdown-background" to inputBg,
            "--vscode-dropdown-foreground" to inputFg,
            "--vscode-dropdown-border" to inputBorder,
            "--vscode-button-background" to buttonBg,
            "--vscode-button-foreground" to buttonFg,
            "--vscode-icon-foreground" to fg,
        )
        return buildString {
            for ((key, color) in vars) {
                append("            ").append(key).append(": ").append(cssColor(color)).append(";\n")
            }
            if (font != null) {
                append("            --vscode-font-family: ").append(font).append(";\n")
                append("            --vscode-editor-font-family: ").append(font).append(";\n")
            }
        }.trimEnd()
    }

    /** Read a LaF color by key with fallbacks; null-safe. */
    private fun laf(key: String, fallback: Color, fallback2: Color): Color {
        return try {
            UIManager.getColor(key) ?: fallback
        } catch (_: Exception) {
            fallback
        }?.let { if (it is JBColor) it else it } ?: fallback2
    }

    /** Best-effort font family name from the LaF. */
    private fun lafFont(key: String): String? {
        return try {
            (UIManager.getFont(key) ?: UIManager.getFont("Label.font"))?.family
        } catch (_: Exception) {
            null
        }
    }

    private fun cssColor(c: Color): String {
        val a = c.alpha / 255.0
        return if (a >= 1.0) {
            "rgb(${c.red}, ${c.green}, ${c.blue})"
        } else {
            "rgba(${c.red}, ${c.green}, ${c.blue}, ${"%.2f".format(a)})"
        }
    }
}
