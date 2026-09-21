/*
 * Mooncord, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { spawn } from "child_process";
import { app, type WebContents } from "electron";
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { format } from "util";

import { DATA_DIR } from "./constants";

// Keep normal builds from opening a detached PowerShell/CMD debug console.
export const MOONCORD_DEBUG_BUILD = false;

const DEBUG_LOG_FILE = join(DATA_DIR, "logs", "mooncord-debug.log");
const DEBUG_CONSOLE_LOCK_FILE = join(DATA_DIR, "logs", "mooncord-debug-console.lock");
let initialized = false;
let originalConsole: Record<string, (...args: unknown[]) => void> | undefined;

function isProcessAlive(pid: number) {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function claimDebugConsoleLock() {
    const lock = () => {
        const fileDescriptor = openSync(DEBUG_CONSOLE_LOCK_FILE, "wx");
        try {
            writeFileSync(fileDescriptor, JSON.stringify({ ownerPid: process.pid }));
        } finally {
            closeSync(fileDescriptor);
        }
        return true;
    };

    try {
        lock();
        // Closing the descriptor releases the OS handle but intentionally
        // leaves the marker while the detached console remains visible.
        return { claimed: true };
    } catch {
        try {
            const current = JSON.parse(readFileSync(DEBUG_CONSOLE_LOCK_FILE, "utf8")) as {
                ownerPid?: number;
                consolePid?: number;
            };
            if (
                (current.ownerPid && isProcessAlive(current.ownerPid)) ||
                (current.consolePid && isProcessAlive(current.consolePid))
            ) {
                return { claimed: false };
            }
        } catch {
            // A malformed or unreadable marker is safe to replace.
        }

        try {
            unlinkSync(DEBUG_CONSOLE_LOCK_FILE);
        } catch {
            return { claimed: false };
        }

        try {
            lock();
            return { claimed: true };
        } catch {
            return { claimed: false };
        }
    }
}

function writeLog(scope: string, message: string) {
    try {
        appendFileSync(DEBUG_LOG_FILE, `[${new Date().toISOString()}] [${scope}] ${message}\n`, "utf8");
    } catch {}
}

export function mooncordDebug(scope: string, ...args: unknown[]) {
    if (!MOONCORD_DEBUG_BUILD) return;
    writeLog(scope, format(...args));
}

export function initializeMooncordDebugConsole() {
    if (initialized || !MOONCORD_DEBUG_BUILD || !app.isPackaged || process.platform !== "win32") return;
    initialized = true;
    mkdirSync(dirname(DEBUG_LOG_FILE), { recursive: true });
    writeFileSync(
        DEBUG_LOG_FILE,
        `[${new Date().toISOString()}] [startup] Mooncord debug build\n` +
            `version=${app.getVersion()} electron=${process.versions.electron} chrome=${process.versions.chrome}\n`,
        "utf8"
    );

    originalConsole = {
        log: console.log.bind(console),
        info: console.info.bind(console),
        warn: console.warn.bind(console),
        error: console.error.bind(console),
        debug: console.debug.bind(console)
    };
    for (const method of Object.keys(originalConsole)) {
        const original = originalConsole[method];
        (console as unknown as Record<string, (...args: unknown[]) => void>)[method] = (...args) => {
            original(...args);
            writeLog(method, format(...args));
        };
    }

    const shell = process.env.ComSpec || "cmd.exe";
    const consoleScript = join(dirname(DEBUG_LOG_FILE), "mooncord-debug-console.cmd");
    const escapedLogPath = DEBUG_LOG_FILE.replaceAll("'", "''");
    writeFileSync(
        consoleScript,
        `@echo off\r\ntitle Mooncord Debug Console\r\necho Mooncord debug build ${app.getVersion()}\r\necho Streaming ${DEBUG_LOG_FILE}\r\npowershell -NoProfile -Command "Get-Content -LiteralPath '${escapedLogPath}' -Wait"\r\n`,
        "utf8"
    );

    const lock = claimDebugConsoleLock();
    if (!lock.claimed) {
        mooncordDebug("startup", "Debug console already exists; reusing the current console.");
        return;
    }

    const consoleWindow = spawn(shell, ["/d", "/k", consoleScript], {
        detached: true,
        stdio: "ignore",
        windowsHide: false
    });
    consoleWindow.unref();
    try {
        writeFileSync(
            DEBUG_CONSOLE_LOCK_FILE,
            JSON.stringify({ ownerPid: process.pid, consolePid: consoleWindow.pid }),
            "utf8"
        );
    } catch {}
    mooncordDebug("startup", "Debug console opened at %s", DEBUG_LOG_FILE);
}

export function attachMooncordDebugConsoleMessages(contents: WebContents, scope: string) {
    if (!MOONCORD_DEBUG_BUILD) return;
    const onConsoleMessage = contents.on.bind(contents) as unknown as (
        eventName: string,
        listener: (event: unknown) => void
    ) => WebContents;
    onConsoleMessage("console-message", event => {
        const data = event as { level?: number; message?: string; line?: number; sourceId?: string };
        mooncordDebug(
            `${scope}:console`,
            "level=%s line=%s source=%s %s",
            data.level ?? "?",
            data.line ?? "?",
            data.sourceId ?? "?",
            data.message ?? ""
        );
    });
}

export { DEBUG_LOG_FILE };
