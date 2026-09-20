/*
 * Mooncord, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, BrowserWindow } from "electron";

import { loadView } from "./mooncordStatic";
import { makeLinksOpenExternally } from "./utils/makeLinksOpenExternally";

export async function createAboutWindow() {
    const height = 750;
    const width = height * (4 / 3);

    const about = new BrowserWindow({
        center: true,
        autoHideMenuBar: true,
        height,
        width
    });

    makeLinksOpenExternally(about);

    const data = new URLSearchParams({
        APP_VERSION: app.getVersion()
    });

    loadView(about, "about.html", data);

    return about;
}
