/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

if (process.platform === "linux") import("./venmic");

import { execFile } from "child_process";
import {
    app,
    BrowserWindow,
    clipboard,
    dialog,
    IpcMainInvokeEvent,
    nativeImage,
    RelaunchOptions,
    session,
    shell
} from "electron";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, watch } from "fs";
import { readFile, stat } from "fs/promises";
import { release } from "os";
import { join } from "path";

import { IpcEvents } from "../shared/IpcEvents";
import { setBadgeCount } from "./appBadge";
import { autoStart } from "./autoStart";
import { VENCORD_SETTINGS_DIR } from "./constants";
import {
    broadcastToDiscordTabs,
    getActiveDiscordWebContents,
    getDiscordTabForWebContents,
    toggleActiveDiscordDevTools
} from "./discordTabs";
import { enableHardwareAcceleration } from "./main";
import { mainWin } from "./mainWindow";
import { Settings, State } from "./settings";
import { handle, handleSync } from "./utils/ipcWrappers";
import { PopoutWindows } from "./utils/popout";
import { isDeckGameMode, showGamePage } from "./utils/steamOS";
import { isValidVencordInstall } from "./utils/vencordLoader";
import { VENCORD_FILES_DIR } from "./vencordFilesDir";

const rendererScriptCache = new Map<string, string>();
let rendererCssCache: Promise<string> | undefined;

function readRendererScript(filePath: string) {
    if (IS_DEV) return readFileSync(filePath, "utf-8");

    const cached = rendererScriptCache.get(filePath);
    if (cached !== undefined) return cached;

    const script = readFileSync(filePath, "utf-8");
    rendererScriptCache.set(filePath, script);
    return script;
}

handleSync(IpcEvents.GET_VENCORD_PRELOAD_SCRIPT, () =>
    readRendererScript(join(VENCORD_FILES_DIR, "vencordDesktopPreload.js"))
);
handleSync(IpcEvents.GET_VENCORD_RENDERER_SCRIPT, () =>
    readRendererScript(join(VENCORD_FILES_DIR, "vencordDesktopRenderer.js"))
);

const VESKTOP_RENDERER_JS_PATH = join(__dirname, "renderer.js");
const VESKTOP_RENDERER_CSS_PATH = join(__dirname, "renderer.css");
handleSync(IpcEvents.GET_VESKTOP_RENDERER_SCRIPT, () => readRendererScript(VESKTOP_RENDERER_JS_PATH));
handle(IpcEvents.GET_VESKTOP_RENDERER_CSS, () => {
    if (IS_DEV) return readFile(VESKTOP_RENDERER_CSS_PATH, "utf-8");
    if (!rendererCssCache) {
        rendererCssCache = readFile(VESKTOP_RENDERER_CSS_PATH, "utf-8").catch(error => {
            rendererCssCache = undefined;
            throw error;
        });
    }
    return rendererCssCache;
});

if (IS_DEV) {
    watch(VESKTOP_RENDERER_CSS_PATH, { persistent: false }, async () => {
        broadcastToDiscordTabs(
            IpcEvents.VESKTOP_RENDERER_CSS_UPDATE,
            await readFile(VESKTOP_RENDERER_CSS_PATH, "utf-8")
        );
    });
}

handleSync(IpcEvents.GET_SETTINGS, () => Settings.plain);
handleSync(IpcEvents.GET_VERSION, () => app.getVersion());
handleSync(IpcEvents.GET_ENABLE_HARDWARE_ACCELERATION, () => enableHardwareAcceleration);

handleSync(
    IpcEvents.SUPPORTS_WINDOWS_TRANSPARENCY,
    () => process.platform === "win32" && Number(release().split(".").pop()) >= 22621
);

handleSync(IpcEvents.AUTOSTART_ENABLED, () => autoStart.isEnabled());
handle(IpcEvents.ENABLE_AUTOSTART, autoStart.enable);
handle(IpcEvents.DISABLE_AUTOSTART, autoStart.disable);

handle(IpcEvents.SET_SETTINGS, (_, settings: typeof Settings.store, path?: string) => {
    Settings.setData(settings, path);
});

handle(IpcEvents.IMPORT_VENCORD_SETTINGS, () => {
    const sourceDirectory = join(app.getPath("userData"), "..", "Vencord", "settings");

    try {
        const files = readdirSync(sourceDirectory, { withFileTypes: true }).filter(entry => entry.isFile());
        if (!files.length) return "empty";

        mkdirSync(VENCORD_SETTINGS_DIR, { recursive: true });
        for (const file of files) {
            copyFileSync(join(sourceDirectory, file.name), join(VENCORD_SETTINGS_DIR, file.name));
        }

        return "ok";
    } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") return "not-found";

        console.error("Failed to import existing Vencord settings:", error);
        return "failed";
    }
});

handle(IpcEvents.RELAUNCH, async () => {
    const options: RelaunchOptions = {
        args: process.argv.slice(1).concat(["--relaunch"])
    };
    if (isDeckGameMode) {
        // We can't properly relaunch when running under gamescope, but we can at least navigate to our page in Steam.
        await showGamePage();
    } else if (app.isPackaged && process.env.APPIMAGE) {
        execFile(process.env.APPIMAGE, options.args);
    } else {
        app.relaunch(options);
    }
    app.exit();
});

handleSync(IpcEvents.IS_USING_CUSTOM_VENCORD_DIR, () => !!State.store.vencordDir);
handle(IpcEvents.SHOW_CUSTOM_VENCORD_DIR, async () => {
    const { vencordDir } = State.store;
    if (!vencordDir) return;

    const stats = await stat(vencordDir);
    if (!stats.isDirectory()) return;

    shell.openPath(vencordDir);
});

function getWindow(e: IpcMainInvokeEvent, key?: string) {
    return key ? PopoutWindows.get(key)! : (BrowserWindow.fromWebContents(e.sender) ?? mainWin);
}

handle(IpcEvents.FOCUS, () => {
    mainWin.show();
    mainWin.setSkipTaskbar(false);
});

handle(IpcEvents.CLOSE, (e, key?: string) => {
    getWindow(e, key).close();
});

handle(IpcEvents.MINIMIZE, (e, key?: string) => {
    getWindow(e, key).minimize();
});

handle(IpcEvents.MAXIMIZE, (e, key?: string) => {
    const win = getWindow(e, key);
    if (win.isMaximized()) {
        win.unmaximize();
    } else {
        win.maximize();
    }
});

handleSync(IpcEvents.SPELLCHECK_GET_AVAILABLE_LANGUAGES, e => {
    e.returnValue = session.defaultSession.availableSpellCheckerLanguages;
});

handle(IpcEvents.SPELLCHECK_REPLACE_MISSPELLING, (e, word: string) => {
    e.sender.replaceMisspelling(word);
});

handle(IpcEvents.SPELLCHECK_ADD_TO_DICTIONARY, (e, word: string) => {
    e.sender.session.addWordToSpellCheckerDictionary(word);
});

handle(IpcEvents.SELECT_VENCORD_DIR, async (_e, value?: null) => {
    if (value === null) {
        delete State.store.vencordDir;
        return "ok";
    }

    const res = await dialog.showOpenDialog(mainWin!, {
        properties: ["openDirectory"]
    });
    if (!res.filePaths.length) return "cancelled";

    const dir = res.filePaths[0];
    if (!(await isValidVencordInstall(dir))) return "invalid";

    State.store.vencordDir = dir;

    return "ok";
});

handle(IpcEvents.SET_BADGE_COUNT, (_, count: number) => setBadgeCount(count));

handle(IpcEvents.FLASH_FRAME, (_, flag: boolean) => {
    if (!mainWin || mainWin.isDestroyed() || (flag && mainWin.isFocused())) return;
    mainWin.flashFrame(flag);
});

handle(IpcEvents.CLIPBOARD_COPY_IMAGE, async (_, buf: ArrayBuffer, src: string) => {
    clipboard.write({
        html: `<img src="${src.replaceAll('"', '\\"')}">`,
        image: nativeImage.createFromBuffer(Buffer.from(buf))
    });
});

function openDebugPage(page: string) {
    const win = new BrowserWindow({
        autoHideMenuBar: true
    });

    win.loadURL(page);
}

handle(IpcEvents.DEBUG_LAUNCH_GPU, () => openDebugPage("chrome://gpu"));
handle(IpcEvents.DEBUG_LAUNCH_WEBRTC_INTERNALS, () => openDebugPage("chrome://webrtc-internals"));

handle(IpcEvents.TOGGLE_DEVTOOLS, e => {
    const tab = getDiscordTabForWebContents(e.sender);
    if (tab) tab.view.webContents.toggleDevTools();
    else if (e.sender === mainWin?.webContents) toggleActiveDiscordDevTools();
    else getActiveDiscordWebContents()?.toggleDevTools();
});
