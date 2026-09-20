/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { contextBridge, ipcRenderer } from "electron/renderer";
import { IpcEvents } from "shared/IpcEvents";
import type { MooncordTabsState } from "shared/mooncordTabs";

import { installMooncordShell } from "./mooncordShell";

contextBridge.exposeInMainWorld("MooncordShellNative", {
    getState: () => ipcRenderer.invoke(IpcEvents.GET_MOONCORD_TABS) as Promise<MooncordTabsState>,
    onStateChanged(callback: (state: MooncordTabsState) => void) {
        const listener = (_event: Electron.IpcRendererEvent, state: MooncordTabsState) => callback(state);
        ipcRenderer.on(IpcEvents.MOONCORD_TABS_UPDATED, listener);
        return () => ipcRenderer.removeListener(IpcEvents.MOONCORD_TABS_UPDATED, listener);
    },
    selectTab: (id: string) => ipcRenderer.invoke(IpcEvents.SELECT_MOONCORD_TAB, id),
    createTab: () => ipcRenderer.invoke(IpcEvents.CREATE_MOONCORD_TAB),
    closeTab: (id: string) => ipcRenderer.invoke(IpcEvents.CLOSE_MOONCORD_TAB, id),
    resetTabs: () => ipcRenderer.invoke(IpcEvents.RESET_MOONCORD_TABS),
    openDiscordSettings: () => ipcRenderer.invoke(IpcEvents.OPEN_DISCORD_SETTINGS),
    goBack: () => ipcRenderer.invoke(IpcEvents.DISCORD_BACK),
    goForward: () => ipcRenderer.invoke(IpcEvents.DISCORD_FORWARD),
    reload: () => ipcRenderer.invoke(IpcEvents.DISCORD_RELOAD),
    minimize: () => ipcRenderer.invoke(IpcEvents.MINIMIZE),
    maximize: () => ipcRenderer.invoke(IpcEvents.MAXIMIZE),
    closeWindow: () => ipcRenderer.invoke(IpcEvents.CLOSE),
    toggleDevTools: () => ipcRenderer.invoke(IpcEvents.TOGGLE_DEVTOOLS)
});

installMooncordShell();
