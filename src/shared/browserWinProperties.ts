/*
 * Mooncord, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { BrowserWindowConstructorOptions } from "electron";

export const SplashProps: BrowserWindowConstructorOptions = {
    // Keep the splash opaque so the desktop behind it cannot leak through as
    // a mismatched grey halo around the Mooncord mark.
    transparent: false,
    backgroundColor: "#0b0d10",
    frame: false,
    height: 350,
    width: 300,
    center: true,
    resizable: false,
    maximizable: false,
    alwaysOnTop: true
};
