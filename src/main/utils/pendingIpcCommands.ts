/*
 * Mooncord, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

interface PendingCommand {
    webContentsId: number;
    resolve(data: unknown): void;
    reject(reason: unknown): void;
    timeout: ReturnType<typeof setTimeout>;
}

export class PendingIpcCommands {
    private readonly commands = new Map<string, PendingCommand>();

    register<T>(nonce: string, webContentsId: number, timeoutMs: number): Promise<T> {
        if (this.commands.has(nonce)) return Promise.reject(new Error(`Duplicate IPC command nonce: ${nonce}`));

        return new Promise<T>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.reject(nonce, new Error(`IPC command timed out: ${nonce}`));
            }, timeoutMs);
            this.commands.set(nonce, {
                webContentsId,
                resolve: data => resolve(data as T),
                reject,
                timeout
            });
        });
    }

    resolve(nonce: string, senderId: number, ok: boolean, data: unknown): boolean {
        const command = this.commands.get(nonce);
        if (!command || command.webContentsId !== senderId) return false;

        clearTimeout(command.timeout);
        this.commands.delete(nonce);
        if (ok) command.resolve(data);
        else command.reject(data);
        return true;
    }

    reject(nonce: string, reason: unknown): boolean {
        const command = this.commands.get(nonce);
        if (!command) return false;

        clearTimeout(command.timeout);
        this.commands.delete(nonce);
        command.reject(reason);
        return true;
    }

    rejectForWebContents(webContentsId: number, reason: unknown): number {
        let rejected = 0;
        for (const [nonce, command] of this.commands) {
            if (command.webContentsId === webContentsId && this.reject(nonce, reason)) rejected++;
        }
        return rejected;
    }

    hasPendingForWebContents(webContentsId: number): boolean {
        for (const command of this.commands.values()) {
            if (command.webContentsId === webContentsId) return true;
        }
        return false;
    }
}
