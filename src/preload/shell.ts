/*
 * Mooncord, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { contextBridge, ipcRenderer } from "electron/renderer";
import { IpcEvents } from "shared/IpcEvents";
import type { MooncordTabsState } from "shared/mooncordTabs";

import { installMooncordShell, type MooncordShellNativeApi } from "./mooncordShell";

const mooncordShellNative: MooncordShellNativeApi = {
    getState: () => ipcRenderer.invoke(IpcEvents.GET_MOONCORD_TABS) as Promise<MooncordTabsState>,
    onStateChanged(callback: (state: MooncordTabsState) => void) {
        const listener = (_event: Electron.IpcRendererEvent, state: MooncordTabsState) => callback(state);
        ipcRenderer.on(IpcEvents.MOONCORD_TABS_UPDATED, listener);
        return () => ipcRenderer.removeListener(IpcEvents.MOONCORD_TABS_UPDATED, listener);
    },
    selectTab: (id: string) => ipcRenderer.invoke(IpcEvents.SELECT_MOONCORD_TAB, id),
    createTab: () => ipcRenderer.invoke(IpcEvents.CREATE_MOONCORD_TAB),
    closeTab: (id: string) => ipcRenderer.invoke(IpcEvents.CLOSE_MOONCORD_TAB, id),
    renameTab: (id: string, title: string) => ipcRenderer.invoke(IpcEvents.RENAME_MOONCORD_TAB, id, title),
    reorderTab: (id: string, targetId: string, after: boolean) =>
        ipcRenderer.invoke(IpcEvents.REORDER_MOONCORD_TAB, id, targetId, after),
    resetTabs: () => ipcRenderer.invoke(IpcEvents.RESET_MOONCORD_TABS),
    openDiscordSettings: () => ipcRenderer.invoke(IpcEvents.OPEN_DISCORD_SETTINGS),
    goBack: () => ipcRenderer.invoke(IpcEvents.DISCORD_BACK),
    goForward: () => ipcRenderer.invoke(IpcEvents.DISCORD_FORWARD),
    reload: () => ipcRenderer.invoke(IpcEvents.DISCORD_RELOAD),
    reloadTab: (id: string) => ipcRenderer.invoke(IpcEvents.RELOAD_MOONCORD_TAB, id),
    openTabDevTools: (id: string) => ipcRenderer.invoke(IpcEvents.OPEN_MOONCORD_TAB_DEVTOOLS, id),
    waitForTab: (id: string) => ipcRenderer.invoke(IpcEvents.WAIT_FOR_MOONCORD_TAB, id),
    minimize: () => ipcRenderer.invoke(IpcEvents.MINIMIZE),
    maximize: () => ipcRenderer.invoke(IpcEvents.MAXIMIZE),
    closeWindow: () => ipcRenderer.invoke(IpcEvents.CLOSE),
    toggleDevTools: () => ipcRenderer.invoke(IpcEvents.TOGGLE_DEVTOOLS)
};

contextBridge.exposeInMainWorld("MooncordShellNative", mooncordShellNative);

installMooncordShell(mooncordShellNative);
