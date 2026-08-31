package com.wave.jetbrains.config

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage

data class ConfigurationData(
    var apiKey: String = "",
    var headers: String = "",
    var baseURL: String = "",
    var model: String = "",
    var fastModel: String = "",
    var language: String = "Chinese",
    var serverUrl: String = "",
    /** Per-model input context window in K tokens (e.g. 200 = 200K), 16–1000 */
    var contextLength: Int? = null,
    /** Whether auto-memory extraction is enabled */
    var autoMemoryEnabled: Boolean? = null,
    /** Auto-memory extraction turn frequency, 1–100 */
    var autoMemoryFrequency: Int? = null,
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
