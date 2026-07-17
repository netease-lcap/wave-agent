plugins {
    id("org.jetbrains.intellij.platform")
    kotlin("jvm")
    kotlin("plugin.serialization")
}

group = providers.gradleProperty("pluginGroup").get()
version = providers.gradleProperty("pluginVersion").get()

dependencies {
    intellijPlatform {
        create(providers.gradleProperty("platformType"), providers.gradleProperty("platformVersion"))
    }
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-jdk8:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
}

kotlin {
    jvmToolchain(17)
}

intellijPlatform {
    pluginConfiguration {
        name = providers.gradleProperty("pluginName")
        version = providers.gradleProperty("pluginVersion")
        ideaVersion {
            sinceBuild = provider { "242" }
            untilBuild = provider { null }
        }
    }
}

// Copy webview assets (chat.js/chat.css) from packages/webview/dist into resources.
// Also copy the full VS Code theme variable set (vscode-styles.css) from the webview e2e
// utils — JetBrains JCEF is a bare browser and does NOT inject --vscode-* CSS variables
// the way VS Code's webview does, so we ship a complete theme as the styling base.
val copyWebviewAssets by tasks.registering(Copy::class) {
    val webviewDir = rootProject.projectDir.parentFile.resolve("webview")
    from(webviewDir.resolve("dist")) {
        include("chat.js", "chat.css")
    }
    from(webviewDir.resolve("e2e/utils")) {
        include("vscode-styles.css")
        rename { "theme-base.css" }
    }
    into(layout.projectDirectory.dir("src/main/resources/webview"))
}

tasks.named("processResources") {
    mustRunAfter(copyWebviewAssets)
}

tasks.named("classes") {
    dependsOn(copyWebviewAssets)
}
