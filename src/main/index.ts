/*
 * Mooncord, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app } from "electron";

import { CommandLine } from "./cli";
import { restoreBundledVencordFiles } from "./utils/vencordLoader";

if (CommandLine.values.repair) {
    console.log("Restoring bundled Vencord files...");
    restoreBundledVencordFiles().then(() => app.quit());
} else {
    require("./main");
}
