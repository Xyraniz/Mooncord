/*
 * Mooncord, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { randomUUID } from "crypto";
import { ipcMain } from "electron";
import { IpcEvents } from "shared/IpcEvents";

import { getActiveDiscordWebContents } from "./discordTabs";
import { mainWin } from "./mainWindow";
import { PendingIpcCommands } from "./utils/pendingIpcCommands";

const COMMAND_TIMEOUT_MS = 30_000;
const pendingCommands = new PendingIpcCommands();
const contentsWatchers = new Map<
    number,
    { contents: Electron.WebContents; onRenderProcessGone: () => void; onDestroyed: () => void }
>();

export interface IpcMessage {
    nonce: string;
    message: string;
    data?: any;
}

export interface IpcResponse {
    nonce: string;
    ok: boolean;
    data?: any;
}

function cleanupContentsWatcher(webContentsId: number) {
    if (pendingCommands.hasPendingForWebContents(webContentsId)) return;
    const watcher = contentsWatchers.get(webContentsId);
    if (!watcher) return;

    watcher.contents.removeListener("render-process-gone", watcher.onRenderProcessGone);
    watcher.contents.removeListener("destroyed", watcher.onDestroyed);
    contentsWatchers.delete(webContentsId);
}

function watchContents(contents: Electron.WebContents) {
    if (contentsWatchers.has(contents.id)) return;

    const rejectPending = (reason: Error) => {
        pendingCommands.rejectForWebContents(contents.id, reason);
        cleanupContentsWatcher(contents.id);
    };
    const onRenderProcessGone = () => rejectPending(new Error("Discord tab renderer exited before replying"));
    const onDestroyed = () => rejectPending(new Error("Discord tab was closed before replying"));

    contentsWatchers.set(contents.id, { contents, onRenderProcessGone, onDestroyed });
    contents.on("render-process-gone", onRenderProcessGone);
    contents.on("destroyed", onDestroyed);
}

/**
 * Sends a message to the renderer process and waits for a response.
 * `data` must be serializable as it will be sent over IPC.
 *
 * You must add a handler for the message in the renderer process.
 */
export function sendRendererCommand<T = any>(message: string, data?: any) {
    const contents = getActiveDiscordWebContents();
    if (!contents || contents.isDestroyed() || mainWin.isDestroyed()) {
        console.warn("Active Discord tab is unavailable, cannot send IPC command:", message);
        return Promise.reject(new Error("Main window is destroyed"));
    }

    const nonce = randomUUID();

    const promise = pendingCommands.register<T>(nonce, contents.id, COMMAND_TIMEOUT_MS);
    watchContents(contents);
    void promise.then(
        () => cleanupContentsWatcher(contents.id),
        () => cleanupContentsWatcher(contents.id)
    );

    try {
        if (contents.isDestroyed()) throw new Error("Discord tab was closed before sending the command");
        contents.send(IpcEvents.IPC_COMMAND, { nonce, message, data });
    } catch (error) {
        pendingCommands.reject(nonce, error);
    }

    return promise;
}

ipcMain.on(IpcEvents.IPC_COMMAND, (event, response: IpcResponse) => {
    if (!response || typeof response.nonce !== "string" || typeof response.ok !== "boolean") {
        console.warn("Ignoring malformed renderer IPC response");
        return;
    }

    const resolved = pendingCommands.resolve(response.nonce, event.sender.id, response.ok, response.data);
    if (!resolved) {
        console.warn("Ignoring unknown, expired, or mismatched renderer IPC response:", response.nonce);
    }
});
