package com.wave.jetbrains.nextEdit

/**
 * 建议渲染成「替换 `startLine..<endLineExclusive` 这几行」+ 用来替换的文本。
 * 行号一律 1-based；`startLine == endLineExclusive` 表示纯插入。
 */
data class NextEditReplacement(
    val startLine: Int,
    val endLineExclusive: Int,
    val newText: String,
    /** 要删的行（用于浮层展示）。 */
    val removedLines: List<String>,
    /** 要加的行（用于浮层展示）。 */
    val addedLines: List<String>,
) {
    /** 纯删除：浮层没有绿行可展示，但仍然值得提示（spec 故事 1 场景 4）。 */
    val isPureDeletion: Boolean get() = addedLines.isEmpty() && removedLines.isNotEmpty()
}

/**
 * 把模型给的「整段重写」收成最小改动。
 *
 * 做法与 VS Code 端 `nextEditService.ts` 的 `toRender` 同一个算法：在整行上求最长公共前缀
 * / 后缀，剩下的才是真正变化的行。两端判据必须一致（spec 边界：渲染方式两端各自实现，
 * 但可观察行为要一致），差别只在表达方式——VS Code 的行内补全只能插灰字，纯删除得借一行
 * 存活行来画；JetBrains 这里自己画浮层并且直接做区间替换，所以纯删除就是一个空文本的替换。
 *
 * `null` 表示「没有可展示的东西」：行号越出拿到的片段、或前后完全一样。
 *
 * 纯函数：不碰 Document，测试直接喂字符串。
 *
 * @param excerptStartLine 片段首行的绝对行号（1-based）
 * @param excerptLines 片段的所有行（不含换行符）
 * @param suggestionStartLine 模型给的首行（绝对行号，1-based）
 * @param suggestionEndLine 模型给的末行（绝对行号，含）
 * @param suggestionText 模型给的替换文本，空表示删掉这些行
 */
fun buildNextEditReplacement(
    excerptStartLine: Int,
    excerptLines: List<String>,
    suggestionStartLine: Int,
    suggestionEndLine: Int,
    suggestionText: String,
): NextEditReplacement? {
    if (suggestionStartLine < excerptStartLine) return null
    if (suggestionEndLine < suggestionStartLine) return null
    val firstIndex = suggestionStartLine - excerptStartLine
    val lastIndexExclusive = suggestionEndLine - excerptStartLine + 1
    if (lastIndexExclusive > excerptLines.size) return null

    val original = excerptLines.subList(firstIndex, lastIndexExclusive).toList()
    // 空文本是「删掉这几行」，不是「插一个空行」。
    val next = if (suggestionText.isBlank()) emptyList() else splitLines(suggestionText)

    var prefix = 0
    while (prefix < original.size && prefix < next.size && original[prefix] == next[prefix]) {
        prefix += 1
    }
    var suffix = 0
    while (
        suffix < original.size - prefix &&
        suffix < next.size - prefix &&
        original[original.size - 1 - suffix] == next[next.size - 1 - suffix]
    ) {
        suffix += 1
    }

    val removed = original.subList(prefix, original.size - suffix)
    val added = next.subList(prefix, next.size - suffix)
    if (removed.isEmpty() && added.isEmpty()) return null

    val startLine = suggestionStartLine + prefix
    val endLineExclusive = startLine + removed.size
    return NextEditReplacement(
        startLine = startLine,
        endLineExclusive = endLineExclusive,
        newText = added.joinToString("\n"),
        removedLines = removed.toList(),
        addedLines = added.toList(),
    )
}

private fun splitLines(text: String): List<String> {
    val lines = text.split("\n")
    // 结尾换行符产生的空串不是一行。
    return if (lines.size > 1 && lines.last().isEmpty()) lines.dropLast(1) else lines
}
