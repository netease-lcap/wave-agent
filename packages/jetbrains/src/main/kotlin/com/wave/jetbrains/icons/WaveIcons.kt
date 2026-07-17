package com.wave.jetbrains.icons

import com.intellij.openapi.util.IconLoader
import javax.swing.Icon

/**
 * Wave plugin icons. Loaded via [IconLoader] so the SVG's `currentColor` is themed
 * automatically (light/dark) by the platform. Referenced from plugin.xml as
 * `com.wave.jetbrains.icons.WaveIcons.Wave` (tool window icons only accept a
 * `pkg.Class.field` constant, not a raw resource path).
 */
object WaveIcons {
    @JvmField
    val Wave: Icon = IconLoader.getIcon("/icons/waveToolWindow.svg", WaveIcons::class.java)
}
