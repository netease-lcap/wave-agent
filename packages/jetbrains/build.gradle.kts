plugins {
    id("org.jetbrains.intellij.platform")
    kotlin("jvm")
    kotlin("plugin.serialization")
}

group = providers.gradleProperty("pluginGroup").get()
version = providers.gradleProperty("pluginVersion").get()

dependencies {
    intellijPlatform {
        // Local-IDE override for development: pass -PlocalIdePath=<dir> to use a
        // locally installed/unpacked IDE instead of downloading the platform
        // distribution (useful when JetBrains repos are unreachable). CI and
        // normal builds omit the property and download via create(...).
        val localIdePath = providers.gradleProperty("localIdePath")
        if (localIdePath.isPresent && localIdePath.get().isNotBlank()) {
            local(localIdePath)
        } else {
            create(providers.gradleProperty("platformType"), providers.gradleProperty("platformVersion"))
        }
    }
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-jdk8:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    // Markdown → HTML for the plan-preview column of the chat editor tab (PlanPreviewBuilder).
    // GFM extensions (tables/strikethrough/task lists) match the webview's marked.js feature set.
    implementation("com.vladsch.flexmark:flexmark:0.64.8")
    implementation("com.vladsch.flexmark:flexmark-ext-tables:0.64.8")
    implementation("com.vladsch.flexmark:flexmark-ext-gfm-strikethrough:0.64.8")
    implementation("com.vladsch.flexmark:flexmark-ext-gfm-tasklist:0.64.8")
    // tar.gz extraction for the on-demand ripgrep download (see BinaryResolver)
    implementation("org.apache.commons:commons-compress:1.27.1")
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
    publishing {
        // Supplied as -PintellijPublishToken (GitHub Actions secret); orNull so
        // local builds without the property still configure fine.
        token = providers.gradleProperty("intellijPublishToken").orNull
    }
}

// Copy webview assets (chat.js/chat.css) from packages/webview/dist into resources.
// Also copy the full VS Code theme variable set (theme-base-dark.css + theme-base-light.css)
// from the webview theme dir — JetBrains JCEF is a bare browser and does NOT inject
// --vscode-* CSS variables the way VS Code's webview does, so we ship a complete theme
// (dark + light bases) as the styling base.
val copyWebviewAssets by tasks.registering(Copy::class) {
    val webviewDir = rootProject.projectDir.parentFile.resolve("webview")
    from(webviewDir.resolve("dist")) {
        include("chat.js", "chat.css")
    }
    from(webviewDir.resolve("theme")) {
        include("theme-base-dark.css")
        rename { "theme-base.css" }
    }
    from(webviewDir.resolve("theme")) {
        include("theme-base-light.css")
    }
    into(layout.projectDirectory.dir("src/main/resources/webview"))
}

tasks.named("processResources") {
    mustRunAfter(copyWebviewAssets)
    mustRunAfter(bundleCli)
}

tasks.named("classes") {
    dependsOn(copyWebviewAssets)
    dependsOn(bundleCli)
}

// Copy the wave CLI 三件套 (bin/wave-code.js + package.json + dist/bundle/wave.mjs)
// from packages/code into resources so the plugin can run bundled CLI sessions
// with the customer's system Node.js — no npm-global wave-code needed.
val bundleCli by tasks.registering(Exec::class) {
    commandLine("node", "scripts/bundleCli.mjs")
    workingDir(layout.projectDirectory)
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
    jvmArgs(
        "-Didea.suppressed.plugins.id=org.jetbrains.plugins.gradle,com.intellij.gradle",
        // Skip the first-run Terms of Service dialog so headless CI runs can reach the
        // welcome/project screen without manual consent (sandbox-only convenience).
        "-Djb.consents.confirmation.enabled=false",
    )
}
