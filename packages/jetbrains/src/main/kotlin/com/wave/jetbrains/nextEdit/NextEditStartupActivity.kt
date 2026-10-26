package com.wave.jetbrains.nextEdit

import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity

/**
 * 项目打开时就实例化 [WaveNextEditService]。
 *
 * 项目级服务是懒加载的：没人取它，它就不存在，[WaveNextEditService] 里的文档监听也就
 * 从来没注册过——结果就是「编辑轨迹永远是空的，建议永远不出来」。启动活动是它被取到的
 * 最小触发点，效果等价于 VS Code 那边「行内补全提供者始终在册」。
 */
class NextEditStartupActivity : ProjectActivity {
    override suspend fun execute(project: Project) {
        WaveNextEditService.getInstance(project)
    }
}
