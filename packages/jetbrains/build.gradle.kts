import org.jetbrains.intellij.platform.gradle.TestFrameworkType

plugins {
    id("org.jetbrains.intellij.platform")
    kotlin("jvm")
    kotlin("plugin.serialization")
}

group = providers.gradleProperty("pluginGroup").get()
version = providers.gradleProperty("pluginVersion").get()

// Real-IDE integration tests (Starter + Driver). Separate source set on purpose:
// these launch a full IDE, need a screen (macOS Accessibility permission for
// java.awt.Robot) and take minutes — never part of `pnpm jb:test`.
sourceSets {
    create("integrationTest") {
        compileClasspath += sourceSets.main.get().output
        runtimeClasspath += sourceSets.main.get().output
    }
}

val integrationTestImplementation by configurations.getting {
    extendsFrom(configurations.testImplementation.get())
}

dependencies {
    intellijPlatform {
        // 终端插件：@terminal 读的是 Shell 终端 widget 的文本缓冲
        // （IdeContextReader，spec ui/ide-context-mentions.md）。Terminal 在所有
        // JetBrains IDE 里都随平台分发，因此是硬依赖。
        bundledPlugin("org.jetbrains.plugins.terminal")

        // Starter (IDE lifecycle) + Driver (UI/JMX interaction) for the
        // integrationTest source set; see docs link in the task below.
        testFramework(
            TestFrameworkType.Starter,
            configurationName = "integrationTestImplementation",
        )

        // Real platform test fixture (BasePlatformTestCase). It loads the plugin's
        // extension declarations under the IDE's own classloader — precisely what
        // the JVM-only tests cannot see. See
        // WaveInlineCompletionProviderRegistrationTest.
        testFramework(TestFrameworkType.Platform)

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
    // kotlinx-coroutines is provided by the IDE at runtime (the platform bundles
    // it in lib/util-8.jar) and must NOT be packaged into the plugin. Bundling it
    // puts two copies on the classpath, and PluginClassLoader is child-first: the
    // platform's `flow { }` creates a SafeCollector from its own jar, while the
    // FlowCollector our lambda was compiled against comes from the plugin jar — so
    // handing a suggestion to the platform died with
    //   ClassCastException: SafeCollector cannot be cast to FlowCollector
    // in WaveInlineCompletionProvider.getSuggestion, and ghost text never rendered
    // (kotlinx-serialization is duplicated the same way but stays harmless: no
    // serialization object crosses the plugin → platform call boundary).
    // compileOnly keeps it on the compile classpath only, so the single platform
    // copy wins at runtime. Only stable coroutines API is used here.
    compileOnly("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    // Markdown → HTML for the plan-preview column of the chat editor tab (PlanPreviewBuilder).
    // GFM extensions (tables/strikethrough/task lists) match the webview's marked.js feature set.
    implementation("com.vladsch.flexmark:flexmark:0.64.8")
    implementation("com.vladsch.flexmark:flexmark-ext-tables:0.64.8")
    implementation("com.vladsch.flexmark:flexmark-ext-gfm-strikethrough:0.64.8")
    implementation("com.vladsch.flexmark:flexmark-ext-gfm-tasklist:0.64.8")
    testImplementation(kotlin("test"))
    testImplementation(platform("org.junit:junit-bom:5.10.2"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    // Platform fixtures (BasePlatformTestCase) are JUnit 3 tests — they extend
    // junit.framework.TestCase, so junit:junit is a compile-time need, and the
    // vintage engine is what lets `useJUnitPlatform()` run them next to the
    // Jupiter ones.
    testImplementation("junit:junit:4.13.2")
    testRuntimeOnly("org.junit.vintage:junit-vintage-engine")

    // Required by Starter itself (DI + coroutines), see the Integration Tests tutorial.
    integrationTestImplementation("org.kodein.di:kodein-di-jvm:7.20.2")
    integrationTestImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-core-jvm:1.10.1")
}

kotlin {
    jvmToolchain(17)
}

tasks.test {
    useJUnitPlatform()
}

// Real-IDE integration test (`pnpm jb:test:ui`): launches IntelliJ with the
// built plugin installed, so completion can be exercised against the actual
// editor, extension point registry and plugin classloader.
//
// Requirements: a screen and — on macOS — Accessibility permission for the IDE
// (System Settings → Privacy & Security → Accessibility), because the Driver
// types through java.awt.Robot. Slow (IDE start ≈ 1 min), never part of jb:test.
val integrationTest by intellijPlatformTesting.testIdeUi.registering {
    task {
        dependsOn(tasks.named("prepareSandbox"))
        val integrationTestSourceSet = sourceSets.getByName("integrationTest")
        testClassesDirs = integrationTestSourceSet.output.classesDirs
        classpath = integrationTestSourceSet.runtimeClasspath
        useJUnitPlatform()
        // Resolved at configuration time: the configuration cache cannot
        // serialize a reference to the prepareSandbox task inside doFirst.
        systemProperty(
            "path.to.build.plugin",
            layout.projectDirectory
                .dir(
                    ".intellijPlatform/sandbox/wave-jetbrains/" +
                        "IC-${providers.gradleProperty("platformVersion").get()}" +
                        "/plugins/wave-jetbrains",
                )
                .asFile.absolutePath,
        )
    }
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
    pluginVerification {
        // Same engine the Marketplace runs on upload, with its default failure levels — so it
        // fails the build on internal / override-only platform API usage.
        //
        // Verify against `current()` (the IDE we compile against, IC 2024.2) only: it is already
        // resolved above, so this adds no IDE download, whereas the default `recommended()` pulls
        // four builds (IC 242 + 243 + 251 + 252). What that misses: API that only *becomes*
        // internal/deprecated in newer builds — `FileEditorManagerImpl.FORBID_PREVIEW_TAB` was
        // internal in 2024.2 but only deprecated once 2024.3 moved it to FileEditorManagerKeys.
        //
        // Accepted warning on the 263.x EAP verifier (2026-09): 3× deprecated
        // `FileEditorManager.openFile(VirtualFile, boolean)`, whose ReplaceWith is
        // `requestOpenFile`. Do NOT migrate while sinceBuild = 242: `requestOpenFile` returned
        // `void` up to 2026.2 and only in 2026.3 became `CompletableFuture<FileEditorComposite>`
        // (IJPL-207648), so the descriptor a 2024.2-compiled plugin emits
        // — `openFile(VirtualFile)void` — does not exist on exactly the IDEs that carry the
        // deprecation: NoSuchMethodError at runtime. The deprecated overload keeps its signature
        // in 2026.3 (still present in master, unchanged), so it is the compatible choice until the
        // baseline moves and the replacement is no longer `@ApiStatus.Experimental`.
        ides {
            current()
        }
    }
}

// Copy webview assets (chat.js/chat.css + settings.js/settings.css) from packages/webview/dist
// into resources. Also copy the full VS Code theme variable set (theme-base-dark.css +
// theme-base-light.css) from the webview theme dir — JetBrains JCEF is a bare browser and does
// NOT inject --vscode-* CSS variables the way VS Code's webview does, so we ship a complete theme
// (dark + light bases) as the styling base.
val copyWebviewAssets by tasks.registering(Copy::class) {
    val webviewDir = rootProject.projectDir.parentFile.resolve("webview")
    from(webviewDir.resolve("dist")) {
        include("chat.js", "chat.css", "settings.js", "settings.css")
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
