/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
    app,
    BrowserWindow,
    BrowserWindowConstructorOptions,
    Menu,
    MenuItemConstructorOptions,
    nativeTheme,
    Rectangle,
    screen,
    session
} from "electron";
import { join } from "path";
import { IpcCommands } from "shared/IpcEvents";
import { isTruthy } from "shared/utils/guards";
import { once } from "shared/utils/once";
import type { SettingsStore } from "shared/utils/SettingsStore";

import { createAboutWindow } from "./about";
import { initArRPC } from "./arrpc";
import { CommandLine } from "./cli";
import { DEFAULT_HEIGHT, DEFAULT_WIDTH, MIN_HEIGHT, MIN_WIDTH } from "./constants";
import { initializeDiscordTabs, toggleActiveDiscordDevTools } from "./discordTabs";
import { AppEvents } from "./events";
import { sendRendererCommand } from "./ipcCommands";
import { darwinURL } from "./main";
import { Settings, State, VencordSettings } from "./settings";
import { createSplashWindow } from "./splash";
import { destroyTray, initTray } from "./tray";
import { clearData } from "./utils/clearData";
import { makeLinksOpenExternally } from "./utils/makeLinksOpenExternally";
import { applyDeckKeyboardFix, askToApplySteamLayout, isDeckGameMode } from "./utils/steamOS";
import { ensureVencordFiles, restoreBundledVencordFiles } from "./utils/vencordLoader";
import { VENCORD_FILES_DIR } from "./vencordFilesDir";

let isQuitting = false;

applyDeckKeyboardFix();

app.on("before-quit", () => {
    isQuitting = true;
});

export let mainWin: BrowserWindow;

function makeSettingsListenerHelpers<O extends object>(o: SettingsStore<O>) {
    const listeners = new Map<(data: any) => void, PropertyKey>();

    const addListener: typeof o.addChangeListener = (path, cb) => {
        listeners.set(cb, path);
        o.addChangeListener(path, cb);
    };
    const removeAllListeners = () => {
        for (const [listener, path] of listeners) {
            o.removeChangeListener(path as any, listener);
        }

        listeners.clear();
    };

    return [addListener, removeAllListeners] as const;
}

const [addSettingsListener, removeSettingsListeners] = makeSettingsListenerHelpers(Settings);
const [addVencordSettingsListener, removeVencordSettingsListeners] = makeSettingsListenerHelpers(VencordSettings);

type MenuItemList = Array<MenuItemConstructorOptions | false>;

function initMenuBar(win: BrowserWindow) {
    const isWindows = process.platform === "win32";
    const isDarwin = process.platform === "darwin";
    const wantCtrlQ = !isWindows || VencordSettings.store.winCtrlQ;

    const subMenu = [
        {
            label: "About Mooncord",
            click: createAboutWindow
        },
        {
            label: "Restaurar plugins locales de Vencord",
            async click() {
                await restoreBundledVencordFiles();
                app.relaunch();
                app.quit();
            },
            toolTip: "Vesktop will automatically restart after this operation"
        },
        {
            label: "Restablecer Mooncord",
            async click() {
                await clearData(win);
            },
            toolTip: "Vesktop will automatically restart after this operation"
        },
        {
            label: "Relaunch",
            accelerator: "CmdOrCtrl+Shift+R",
            click() {
                app.relaunch();
                app.quit();
            }
        },
        ...(!isDarwin
            ? []
            : ([
                  {
                      type: "separator"
                  },
                  {
                      label: "Settings",
                      accelerator: "CmdOrCtrl+,",
                      async click() {
                          await sendRendererCommand(IpcCommands.NAVIGATE_SETTINGS).catch(error => {
                              console.warn("Could not open Discord settings from the menu:", error);
                          });
                      }
                  },
                  {
                      type: "separator"
                  },
                  {
                      role: "hide"
                  },
                  {
                      role: "hideOthers"
                  },
                  {
                      role: "unhide"
                  },
                  {
                      type: "separator"
                  }
              ] satisfies MenuItemList)),
        {
            label: "Quit",
            accelerator: wantCtrlQ ? "CmdOrCtrl+Q" : void 0,
            visible: !isWindows,
            role: "quit",
            click() {
                app.quit();
            }
        },
        isWindows && {
            label: "Quit",
            accelerator: "Alt+F4",
            role: "quit",
            click() {
                app.quit();
            }
        },
        // See https://github.com/electron/electron/issues/14742 and https://github.com/electron/electron/issues/5256
        {
            label: "Zoom in (hidden, hack for Qwertz and others)",
            accelerator: "CmdOrCtrl+=",
            role: "zoomIn",
            visible: false
        },
        // numpad zooms
        {
            label: "Zoom in (hidden)",
            accelerator: "CmdOrCtrl+numadd",
            role: "zoomIn",
            visible: false
        },
        {
            label: "Zoom out (hidden)",
            accelerator: "CmdOrCtrl+numsub",
            role: "zoomOut",
            visible: false
        },
        {
            label: "Reset Zoom (hidden)",
            accelerator: "CmdOrCtrl+num0",
            role: "resetZoom",
            visible: false
        }
    ] satisfies MenuItemList;

    const menuItems = [
        {
            label: "Vesktop",
            role: "appMenu",
            submenu: subMenu.filter(isTruthy)
        },
        { role: "fileMenu" },
        { role: "editMenu" },
        { role: "viewMenu" },
        isDarwin && { role: "windowMenu" }
    ] satisfies MenuItemList;

    const menu = Menu.buildFromTemplate(menuItems.filter(isTruthy));

    Menu.setApplicationMenu(menu);
}

function initWindowBoundsListeners(win: BrowserWindow) {
    const saveState = () => {
        State.store.maximized = win.isMaximized();
        State.store.minimized = win.isMinimized();
    };

    win.on("maximize", saveState);
    win.on("minimize", saveState);
    win.on("unmaximize", saveState);
    win.on("restore", saveState);

    const saveBounds = () => {
        if (win.isMaximized()) return;

        State.store.windowBounds = win.getBounds();
    };

    win.on("resize", saveBounds);
    win.on("move", saveBounds);
}

function initSettingsListeners(win: BrowserWindow) {
    addSettingsListener("tray", enable => {
        if (enable) initTray(win, q => (isQuitting = q));
        else destroyTray();
    });

    addSettingsListener("disableMinSize", disable => {
        if (disable) {
            // 0 no work
            win.setMinimumSize(1, 1);
        } else {
            win.setMinimumSize(MIN_WIDTH, MIN_HEIGHT);

            const { width, height } = win.getBounds();
            win.setBounds({
                width: Math.max(width, MIN_WIDTH),
                height: Math.max(height, MIN_HEIGHT)
            });
        }
    });

    addVencordSettingsListener("macosTranslucency", enabled => {
        if (enabled) {
            win.setVibrancy("sidebar");
            win.setBackgroundColor("#ffffff00");
        } else {
            win.setVibrancy(null);
            win.setBackgroundColor("#ffffff");
        }
    });

    addSettingsListener("enableMenu", enabled => {
        win.setAutoHideMenuBar(enabled ?? false);
    });

    addSettingsListener("spellCheckLanguages", languages => initSpellCheckLanguages(languages));
}

async function initSpellCheckLanguages(languages?: string[]) {
    if (!languages) {
        try {
            languages = await sendRendererCommand(IpcCommands.GET_LANGUAGES);
        } catch (error) {
            console.warn("Could not load Discord's spell-check languages:", error);
            return;
        }
    }
    if (!languages) return;

    const ses = session.defaultSession;

    const available = ses.availableSpellCheckerLanguages;
    const applicable = languages.filter(l => available.includes(l)).slice(0, 5);
    if (applicable.length) ses.setSpellCheckerLanguages(applicable);
}

function initStaticTitle(win: BrowserWindow) {
    const listener = (e: { preventDefault: Function }) => e.preventDefault();

    if (Settings.store.staticTitle) win.on("page-title-updated", listener);

    addSettingsListener("staticTitle", enabled => {
        if (enabled) {
            win.setTitle("Vesktop");
            win.on("page-title-updated", listener);
        } else {
            win.off("page-title-updated", listener);
        }
    });
}

function getWindowBoundsOptions(): BrowserWindowConstructorOptions {
    // We want the default window behaviour to apply in game mode since it expects everything to be fullscreen and maximized.
    if (isDeckGameMode) return {};

    const { x, y, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT } = State.store.windowBounds ?? {};

    const options = { width, height } as BrowserWindowConstructorOptions;

    if (x != null && y != null) {
        function isInBounds(rect: Rectangle, display: Rectangle) {
            return !(
                rect.x + rect.width < display.x ||
                rect.x > display.x + display.width ||
                rect.y + rect.height < display.y ||
                rect.y > display.y + display.height
            );
        }

        const inBounds = screen.getAllDisplays().some(d => isInBounds({ x, y, width, height }, d.bounds));
        if (inBounds) {
            options.x = x;
            options.y = y;
        }
    }

    if (!Settings.store.disableMinSize) {
        options.minWidth = MIN_WIDTH;
        options.minHeight = MIN_HEIGHT;
    }

    return options;
}

function buildBrowserWindowOptions(): BrowserWindowConstructorOptions {
    const {
        staticTitle,
        transparencyOption,
        enableMenu,
        enableShadow,
        enableRoundedCorners,
        nativeTitleBar,
        splashTheming,
        splashBackground
    } = Settings.store;

    const { transparent, macosVibrancyStyle } = VencordSettings.store;

    const frameless = !nativeTitleBar;
    const backgroundColor = splashTheming ? splashBackground : nativeTheme.shouldUseDarkColors ? "#313338" : "#ffffff";

    const options: BrowserWindowConstructorOptions = {
        show: !Settings.store.enableSplashScreen && !CommandLine.values["start-minimized"],
        backgroundColor,
        webPreferences: {
            nodeIntegration: false,
            sandbox: true,
            contextIsolation: true,
            devTools: true,
            preload: join(__dirname, "shellPreload.js"),
            spellcheck: true,
            // disable renderer backgrounding to prevent the app from unloading when in the background
            backgroundThrottling: false
        },
        frame: !frameless,
        autoHideMenuBar: enableMenu,
        hasShadow: enableShadow,
        roundedCorners: enableRoundedCorners,
        ...getWindowBoundsOptions()
    };

    if (transparent) {
        options.transparent = true;
        options.backgroundColor = "#00000000";
    }

    if (transparencyOption && transparencyOption !== "none") {
        options.backgroundColor = "#00000000";
        options.backgroundMaterial = transparencyOption;

        if (frameless) {
            options.transparent = true;
        }
    }

    if (staticTitle) {
        options.title = "Vesktop";
    }

    if (process.platform === "darwin") {
        options.titleBarStyle = "hidden";
        options.trafficLightPosition = { x: 10, y: 10 };

        if (macosVibrancyStyle) {
            options.vibrancy = macosVibrancyStyle;
            options.backgroundColor = "#00000000";
        }
    }

    return options;
}

function createMainWindow() {
    // Clear up previous settings listeners
    removeSettingsListeners();
    removeVencordSettingsListeners();

    const win = (mainWin = new BrowserWindow(buildBrowserWindowOptions()));

    // The shell renderer does not need to render continuously while the window is hidden.
    const syncBackgroundThrottling = () => {
        if (!win.isDestroyed()) win.webContents.setBackgroundThrottling(!win.isVisible() || win.isMinimized());
    };
    win.on("hide", () => win.webContents.setBackgroundThrottling(true));
    win.on("minimize", () => win.webContents.setBackgroundThrottling(true));
    win.on("show", () => win.webContents.setBackgroundThrottling(false));
    win.on("restore", () => win.webContents.setBackgroundThrottling(false));
    syncBackgroundThrottling();

    win.setMenuBarVisibility(false);
    if (process.platform === "darwin" && Settings.store.nativeTitleBar) win.setWindowButtonVisibility(false);

    win.on("close", e => {
        const useTray = !isDeckGameMode && Settings.store.minimizeToTray && Settings.store.tray;
        if (isQuitting || (process.platform !== "darwin" && !useTray)) return;

        e.preventDefault();

        if (process.platform === "darwin") app.hide();
        else win.hide();

        return false;
    });

    win.on("focus", () => {
        win.flashFrame(false);
    });

    initWindowBoundsListeners(win);
    if (!isDeckGameMode && (Settings.store.tray ?? true) && process.platform !== "darwin")
        initTray(win, q => (isQuitting = q));

    initMenuBar(win);
    makeLinksOpenExternally(win);
    initSettingsListeners(win);
    initStaticTitle(win);

    win.webContents.on("before-input-event", (event, input) => {
        if (input.type === "keyDown" && input.key === "F12") {
            event.preventDefault();
            toggleActiveDiscordDevTools();
        }
    });

    return win;
}

const runVencordMain = once(() => require(join(VENCORD_FILES_DIR, "vencordDesktopMain.js")));

export async function createWindows() {
    const startMinimized = CommandLine.values["start-minimized"];

    let splash: BrowserWindow | undefined;
    if (Settings.store.enableSplashScreen) {
        splash = createSplashWindow(startMinimized);

        // SteamOS letterboxes and scales it terribly, so just full screen it
        if (isDeckGameMode) splash.setFullScreen(true);
    }

    await ensureVencordFiles();
    runVencordMain();

    mainWin = createMainWindow();

    AppEvents.on("appLoaded", () => {
        splash?.destroy();
        void initSpellCheckLanguages(Settings.store.spellCheckLanguages);

        if (!startMinimized) {
            if (splash) mainWin!.show();
            if (State.store.maximized && !isDeckGameMode) mainWin!.maximize();
        }

        if (isDeckGameMode) {
            // always use entire display
            mainWin!.setFullScreen(true);

            askToApplySteamLayout(mainWin);
        }

        mainWin.once("show", () => {
            if (State.store.maximized && !mainWin!.isMaximized() && !isDeckGameMode) {
                mainWin!.maximize();
            }
        });
    });

    const deepLink = darwinURL || process.argv.find(arg => arg.startsWith("discord://"));
    initializeDiscordTabs(mainWin, deepLink);
    initArRPC();
}
