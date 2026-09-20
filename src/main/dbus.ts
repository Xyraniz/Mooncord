/*
 * Mooncord, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app } from "electron";
import { join } from "path";
import { STATIC_DIR } from "shared/paths";

let libMooncord: typeof import("libvesktop") | null = null;

function loadLibMooncord() {
    try {
        if (!libMooncord) {
            libMooncord = require(join(STATIC_DIR, `dist/libvesktop-${process.arch}.node`));
        }
    } catch (e) {
        console.error("Failed to load libvesktop:", e);
    }

    return libMooncord;
}

export function getAccentColor() {
    return loadLibMooncord()?.getAccentColor() ?? null;
}

export function updateUnityLauncherCount(count: number) {
    const libMooncord = loadLibMooncord();
    if (!libMooncord) {
        return app.setBadgeCount(count);
    }

    return libMooncord.updateUnityLauncherCount(count);
}

export function requestBackground(autoStart: boolean, commandLine: string[]) {
    return loadLibMooncord()?.requestBackground(autoStart, commandLine) ?? false;
}
