package com.wave.jetbrains.ide

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.testFramework.PlatformTestUtil
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.concurrent.TimeUnit

/**
 * `IdeContextReader` 在真实平台 API 上的行为（spec `ui/ide-context-mentions.md`）。
 *
 * 为什么这些用例必须跑在平台 fixture 里、而不能写成纯 JVM 单测：被读的两样东西都
 * 只存在于真实 IDE 进程内——一个是 daemon 写进 `DocumentMarkupModel` 的
 * highlighter（`impl` 包，没有公开诊断 API），另一个是终端插件的
 * `ShellTerminalWidget` 文本缓冲。纯 JVM 测试里这两个来源都不存在，断言只能靠
 * mock，而 mock 只能证明「我以为 API 是这样」。
 *
 * 边界：这是**真 IDE 进程**（平台 fixture 起了完整的 IntelliJ Application），但
 * 不是**真 IDE 界面**——没有 Starter/Driver、没有用户打字。界面级链路
 * （@ 下拉 → 发送 → 气泡里的标签）由共享 webview 的单测与浏览器 e2e 覆盖。
 *
 * **终端读取不在本文件覆盖**：平台 fixture 的 `ToolWindowManager` 是
 * `ToolWindowHeadlessManagerImpl`（无头桩），根本不存在 Terminal 工具窗口，因此
 * 「取选中终端 widget」这一步在 fixture 里没有对象可读。因此这里只断言「没有终端
 * 时降级为不可用 + 原因」；真实终端缓冲的读取要真界面（Starter + Driver），本文件
 * 不覆盖——这一条仍是真机未验证项。
 */
class IdeContextReaderTest : BasePlatformTestCase() {

    fun testReadsErrorsOfTheActiveFile() {
        myFixture.configureByText(
            "Broken.java",
            """
            public class Broken {
                void f() {
                    int x = ;
                }
            }
            """.trimIndent(),
        )
        // 让 daemon 把 highlighter 写进 markup model：读取端的唯一数据来源。
        val highlighted = myFixture.doHighlighting()
        assertTrue("the fixture produced no highlights at all", highlighted.isNotEmpty())

        val result = read(listOf("problems")).single().jsonObject

        assertTrue(
            "reader did not report the file as readable: ${result["reason"]}",
            result["ok"]?.jsonPrimitive?.boolean == true,
        )
        val problems = result["problems"]!! as JsonArray
        assertTrue("expected at least one error for the open file, got $problems", problems.isNotEmpty())

        val first = problems[0].jsonObject
        assertTrue("line must be 1-based, got ${first["line"]}", first["line"]!!.jsonPrimitive.int >= 1)
        assertTrue("column must be 1-based, got ${first["column"]}", first["column"]!!.jsonPrimitive.int >= 1)
        assertEquals("error", first["severity"]!!.jsonPrimitive.content)
        assertTrue(
            "the diagnostic message must come from the platform, got '${first["message"]}'",
            first["message"]!!.jsonPrimitive.content.isNotBlank(),
        )
        // 工作区相对路径（fixture 项目根 = 项目 baseDir），用于消息里说明「哪个文件」。
        assertEquals("Broken.java", result["filePath"]?.jsonPrimitive?.content)
    }

    fun testReportsUnavailableWhenThereIsNoTerminal() {
        val toolWindow = ToolWindowManager.getInstance(project).getToolWindow("Terminal")
        // 没有终端内容被选中时，读取端必须回「不可用 + 原因」，不能抛。
        if (toolWindow != null) {
            toolWindow.contentManager.removeAllContents(true)
        }

        val result = read(listOf("terminal")).single().jsonObject

        assertFalse(result["ok"]!!.jsonPrimitive.boolean)
        assertTrue(
            "an unavailable read must explain itself, got ${result["reason"]}",
            !result["reason"]?.jsonPrimitive?.content.isNullOrBlank(),
        )
    }

    /**
     * 读取端是 suspend 的，而平台 fixture 的测试方法跑在 EDT 上——`withContext(EDT)`
     * 需要 EDT 事件队列继续被处理，所以把整次读取丢到线程池，让 EDT 空出来。
     */
    private fun read(providers: List<String>): JsonArray {
        val future = ApplicationManager.getApplication()
            .executeOnPooledThread<JsonArray> {
                runBlocking { IdeContextReader(project).read(providers) }
            }
        // 测试线程就是 EDT：阻塞等待会让 `Dispatchers.EDT` 永远排不上，所以边等边
        // 把 EDT 事件队列跑空。
        val deadline = System.currentTimeMillis() + 30_000
        while (!future.isDone && System.currentTimeMillis() < deadline) {
            PlatformTestUtil.dispatchAllEventsInIdeEventQueue()
            Thread.sleep(10)
        }
        return future.get(1, TimeUnit.SECONDS)
    }
}
