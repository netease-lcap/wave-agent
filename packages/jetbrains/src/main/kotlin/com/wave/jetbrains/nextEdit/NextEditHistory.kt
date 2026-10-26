package com.wave.jetbrains.nextEdit

import com.intellij.openapi.editor.Document
import com.intellij.openapi.editor.event.DocumentEvent

/**
 * 用户编辑轨迹：只保留「用户输入产生」的编辑，每条是一对前后文本。
 *
 * 判据（spec ui/next-edit-suggestion.md 故事 3）：整篇文档被换掉的一次变更**不是**用户
 * 编辑——切分支、外部格式化、被别的程序改写、重新打开文件都长这样，把它记进轨迹会让
 * 建议对着别人的改动猜；因此这种变更清空该文件的轨迹而不是追加一条。
 *
 * 与 VS Code 端的 `nextEditHistory.ts` 同一套语义（保留条数、时间窗），只是这里拿不到
 * 「影子副本」，被删文本直接取自 `DocumentEvent.oldFragment`。
 */
class NextEditHistory(
    private val maxEntries: Int = 5,
    private val ttlMs: Long = 30_000,
) {
    private data class Entry(val oldText: String, val newText: String, val at: Long)

    private val byDocument = mutableMapOf<Document, ArrayDeque<Entry>>()

    /** 在 `beforeDocumentChange` 里调用：此时 [DocumentEvent.oldFragment] 才是被删的文本。 */
    fun record(event: DocumentEvent) {
        val document = event.document
        val removed = event.oldFragment.toString()
        val added = event.newFragment.toString()
        if (removed.isEmpty() && added.isEmpty()) return

        // 整篇被替换：不是用户编辑，轨迹从头开始。
        if (removed.length >= document.textLength || added.length >= document.textLength) {
            byDocument.remove(document)
            return
        }

        val queue = byDocument.getOrPut(document) { ArrayDeque() }
        queue.addLast(Entry(removed, added, System.currentTimeMillis()))
        while (queue.size > maxEntries) queue.removeFirst()
    }

    /** 最近若干条仍在时间窗内的编辑，最旧的在前。 */
    fun recent(document: Document): List<Pair<String, String>> {
        val queue = byDocument[document] ?: return emptyList()
        val deadline = System.currentTimeMillis() - ttlMs
        val fresh = queue.filter { it.at >= deadline }
        while (queue.isNotEmpty() && queue.first().at < deadline) queue.removeFirst()
        return fresh.map { it.oldText to it.newText }
    }

    fun lastEditAt(document: Document): Long? =
        byDocument[document]?.lastOrNull()?.at

    fun forget(document: Document) {
        byDocument.remove(document)
    }
}
