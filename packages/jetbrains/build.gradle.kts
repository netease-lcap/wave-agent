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
    testImplementation(kotlin("test"))
    testImplementation(platform("org.junit:junit-bom:5.10.2"))
    testImplementation("org.junit.jupiter:junit-jupiter")
}

kotlin {
    jvmToolchain(17)
}

tasks.test {
    useJUnitPlatform()
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

tasks.named<JavaExec>("runIde") {
    // No project path is passed, so the sandbox IDE follows the platform's own
    // recentProjects memory (reopens the last project on startup, else lands on the
    // welcome screen). Note the sandbox lives under .intellijPlatform/sandbox/...; if
    // that config dir is wiped/rebuilt the history is lost and it starts fresh.

    // The bundled Gradle plugin in IC-2024.2 crashes on startup when its JVM support matrix
    // contains a future Java version it can't parse (e.g. "25"): GradleJvmSupportMatrix throws
    // IllegalArgumentException. It is irrelevant to developing this plugin, so suppress it in the
    // sandbox to keep the log clean.
    jvmArgs("-Didea.suppressed.plugins.id=org.jetbrains.plugins.gradle,com.intellij.gradle")
}
