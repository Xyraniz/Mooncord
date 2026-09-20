/*
 * Mooncord, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

declare global {
    export var MooncordNative: typeof import("preload/MooncordNative").MooncordNative;
    export var VesktopNative: typeof import("preload/MooncordNative").MooncordNative;
    export var Mooncord: typeof import("renderer/index");
    export var MooncordPatchGlobals: any;
    export var VesktopPatchGlobals: any;

    export var IS_DEV: boolean;
}

export {};
