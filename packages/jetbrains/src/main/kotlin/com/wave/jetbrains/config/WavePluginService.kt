package com.wave.jetbrains.config

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage

/**
 * 插件本地状态（落 `wave.xml`）。只保留扩展本地键；用户偏好
 * （AI 回复语言 / 上下文长度 / 自动记忆开关与频率）落点唯一为用户级
 * `~/.wave/settings.json`（见 spec core/agent-config.md「IDE 插件配置入口」
 * 场景 6）——**不得**回读本存储当作第二真源。
 */
data class ConfigurationData(
    var model: String = "",
    var fastModel: String = "",
    var serverUrl: String = "",
)

@State(name = "WavePlugin", storages = [Storage("wave.xml")])
@Service(Service.Level.APP)
class WavePluginService : PersistentStateComponent<ConfigurationData> {
    private var state = ConfigurationData()

    override fun getState(): ConfigurationData = state

    override fun loadState(state: ConfigurationData) {
        this.state = state
    }

    fun loadConfiguration(): ConfigurationData = state.copy()

    fun saveConfiguration(data: ConfigurationData) {
        state = data.copy()
    }

    companion object {
        fun getInstance(): WavePluginService =
            ApplicationManager.getApplication().getService(WavePluginService::class.java)
    }
}
