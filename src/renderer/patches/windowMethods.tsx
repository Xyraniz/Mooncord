/*
 * Mooncord, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addPatch } from "./shared";

addPatch({
    patches: [
        {
            find: ",setSystemTrayApplications",
            replacement: [
                {
                    match: /\i\.window\.(close|minimize|maximize)/g,
                    replace: `MooncordNative.win.$1`
                },
                {
                    match: /(focus(\(\i\)){).{0,150}?\.focus\(\i,\i\)/,
                    replace: "$1MooncordNative.win.focus$2"
                },
                {
                    match: /,getEnableHardwareAcceleration/,
                    replace: "$&:MooncordNative.app.getEnableHardwareAcceleration,_oldGetEnableHardwareAcceleration"
                }
            ]
        }
    ]
});
