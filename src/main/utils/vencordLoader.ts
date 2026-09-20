/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { access, constants as FsConstants, copyFile, mkdir } from "fs/promises";
import { BUNDLED_VENCORD_FILES_DIR, VENCORD_FILES_DIR } from "main/vencordFilesDir";
import { join } from "path";

export const REQUIRED_VENCORD_FILES = [
    "vencordDesktopMain.js",
    "vencordDesktopPreload.js",
    "vencordDesktopRenderer.js",
    "vencordDesktopRenderer.css"
];

export async function restoreBundledVencordFiles() {
    if (VENCORD_FILES_DIR === BUNDLED_VENCORD_FILES_DIR) return;

    if (!(await isValidVencordInstall(BUNDLED_VENCORD_FILES_DIR))) {
        throw new Error("Bundled Vencord files are missing. Run `pnpm build` to rebuild them from Vencord.");
    }

    await mkdir(VENCORD_FILES_DIR, { recursive: true });
    await Promise.all(
        REQUIRED_VENCORD_FILES.map(file =>
            copyFile(join(BUNDLED_VENCORD_FILES_DIR, file), join(VENCORD_FILES_DIR, file))
        )
    );
}

const existsAsync = (path: string) =>
    access(path, FsConstants.F_OK)
        .then(() => true)
        .catch(() => false);

export async function isValidVencordInstall(dir: string) {
    const results = await Promise.all(REQUIRED_VENCORD_FILES.map(f => existsAsync(join(dir, f))));
    return !results.includes(false);
}

export async function ensureVencordFiles() {
    if (await isValidVencordInstall(VENCORD_FILES_DIR)) return;

    await restoreBundledVencordFiles();

    if (!(await isValidVencordInstall(VENCORD_FILES_DIR))) {
        throw new Error("Vencord files are missing. Run `pnpm build` to build the local Vencord source.");
    }
}
