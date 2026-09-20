/*
 * Mooncord, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { type Settings as TVencordSettings } from "@vencord/types/Vencord";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { mkdir, rename, unlink, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { DefaultMooncordSettings } from "shared/defaultSettings";
import type { Settings as TSettings, State as TState } from "shared/settings";
import { SettingsStore } from "shared/utils/SettingsStore";

import { DATA_DIR, VENCORD_SETTINGS_FILE } from "./constants";
import { mergeDefaults } from "./utils/mergeDefaults";

const SETTINGS_FILE = join(DATA_DIR, "settings.json");
const STATE_FILE = join(DATA_DIR, "state.json");

function loadSettings<T extends object = any>(file: string, name: string, defaults?: T) {
    let settings = {} as T;
    try {
        const content = readFileSync(file, "utf8");
        try {
            settings = JSON.parse(content);
        } catch (err) {
            console.error(`Failed to parse ${name}.json:`, err);
        }
    } catch {}

    if (defaults) {
        mergeDefaults(settings, defaults);
    }

    const store = new SettingsStore(settings);
    let writeTimer: ReturnType<typeof setTimeout> | undefined;
    let writeChain = Promise.resolve();
    let lastSerialized = JSON.stringify(settings, null, 4);

    const writeAtomically = (data: string) => {
        writeChain = writeChain
            .catch(() => undefined)
            .then(async () => {
                if (data === lastSerialized) return;
                await mkdir(dirname(file), { recursive: true });
                const temporaryFile = `${file}.${process.pid}.${randomUUID()}.tmp`;
                try {
                    await writeFile(temporaryFile, data, "utf8");
                    await rename(temporaryFile, file);
                    lastSerialized = data;
                } finally {
                    // rename removes the temporary file on success. A failed
                    // rename should not leave a growing collection of stale files.
                    try {
                        await unlink(temporaryFile);
                    } catch {}
                }
            });
        return writeChain;
    };

    const scheduleWrite = (data: T) => {
        if (writeTimer) clearTimeout(writeTimer);
        writeTimer = setTimeout(() => {
            writeTimer = undefined;
            const serialized = JSON.stringify(data, null, 4);
            if (serialized !== lastSerialized)
                void writeAtomically(serialized).catch(error => {
                    console.error(`Failed to save ${name}.json:`, error);
                });
        }, 200);
    };

    store.addGlobalChangeListener(o => {
        scheduleWrite(o);
    });

    return Object.assign(store, {
        flush: async () => {
            if (writeTimer) {
                clearTimeout(writeTimer);
                writeTimer = undefined;
            }
            const serialized = JSON.stringify(store.plain, null, 4);
            if (serialized !== lastSerialized) await writeAtomically(serialized);
            await writeChain;
        }
    });
}

export const Settings = loadSettings<TSettings>(SETTINGS_FILE, "Mooncord settings", DefaultMooncordSettings);
export const VencordSettings = loadSettings<TVencordSettings>(VENCORD_SETTINGS_FILE, "Vencord settings");
export const State = loadSettings<TState>(STATE_FILE, "Mooncord state");

export async function flushSettings() {
    await Promise.all([Settings.flush(), VencordSettings.flush(), State.flush()]);
}
