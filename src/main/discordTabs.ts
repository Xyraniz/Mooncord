/*
 * Mooncord, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { randomUUID } from "crypto";
import { BrowserWindow, WebContents, WebContentsView } from "electron";
import { join } from "path";
import { IpcEvents } from "shared/IpcEvents";
import {
    canLoadMooncordTab,
    getFallbackActiveMooncordTabId,
    getMooncordTabBounds,
    getMooncordTabRetryDelay,
    MAX_MOONCORD_TABS,
    type MooncordTabInfo,
    type MooncordTabRecord,
    type MooncordTabsState,
    moveMooncordTab,
    normalizeCustomMooncordTabTitle,
    restoreMooncordTabs,
    sanitizeDiscordPath
} from "shared/mooncordTabs";

import { BrowserUserAgent } from "./constants";
import { attachMooncordDebugConsoleMessages, mooncordDebug } from "./debug";
import { AppEvents } from "./events";
import { Settings, State } from "./settings";
import { updateSplashMessage } from "./splash";
import { handle } from "./utils/ipcWrappers";
import { makeWebContentsLinksOpenExternally } from "./utils/makeLinksOpenExternally";

const HOME_PATH = "/channels/@me";
const DISCORD_SCHEME_PROTOCOLS = new Set(["discord:", "discordapp:", "discord-canary:", "discord-ptb:"]);
const HIDE_DISCORD_WINDOW_CHROME = `
    [data-window-chrome="true"],
    [class*="systemBar_"] {
        display: none !important;
    }
`;

interface DiscordTab extends MooncordTabRecord {
    view?: WebContentsView;
    loadStatus: MooncordTabInfo["loadStatus"];
    loadGeneration: number;
    retryAttempt: number;
    retryTimer?: ReturnType<typeof setTimeout>;
    crashRecoveryAttempted: boolean;
    lastInteractionAt: number;
    activity: {
        callActive: boolean;
        mediaActive: boolean;
        uploadActive: boolean;
    };
}

let shellWindow: BrowserWindow | undefined;
let tabs: DiscordTab[] = [];
let activeId = "";
let didEmitAppLoaded = false;
let persistedTabsSignature = JSON.stringify(State.store.mooncordTabs ?? []);
let persistedActiveId = State.store.activeMooncordTabId;
let hibernationTimer: ReturnType<typeof setInterval> | undefined;

function discordOrigin() {
    const branch = Settings.store.discordBranch;
    const subdomain = branch === "canary" || branch === "ptb" ? `${branch}.` : "";
    return `https://${subdomain}discord.com`;
}

function safePath(path: unknown): string {
    return sanitizeDiscordPath(path, discordOrigin(), HOME_PATH);
}

function pathTitle(path: string, index: number) {
    if (path.includes("/settings")) return "Ajustes";
    if (path.startsWith("/channels/@me/") || path.startsWith("/channels/@me?")) return `Chat ${index}`;
    if (path.startsWith("/channels/")) return "Canal de Discord";
    return "Inicio";
}

function cleanTitle(title: string, tab: DiscordTab) {
    const cleaned = title.replace(/\s*(?:[|–-]\s*)?Discord(?:\s+App)?$/i, "").trim();
    return cleaned && !/^discord(?: web)?$/i.test(cleaned) ? cleaned : pathTitle(tab.path, tabs.indexOf(tab) + 1);
}

function publicState(): MooncordTabsState {
    return {
        tabs: tabs.map(({ id, path, title, customTitle, loadStatus }) => ({
            id,
            path,
            title,
            ...(customTitle ? { customTitle } : {}),
            loadStatus
        })),
        activeId
    };
}

function persistState() {
    const storedTabs = tabs.map(({ id, path, title, customTitle }) => ({
        id,
        path,
        title,
        ...(customTitle ? { customTitle } : {})
    }));
    const nextTabsSignature = JSON.stringify(storedTabs);
    if (nextTabsSignature !== persistedTabsSignature) {
        State.store.mooncordTabs = storedTabs;
        persistedTabsSignature = nextTabsSignature;
    }
    if (activeId !== persistedActiveId) {
        State.store.activeMooncordTabId = activeId;
        persistedActiveId = activeId;
    }
}

function broadcastState() {
    if (shellWindow && !shellWindow.isDestroyed()) {
        shellWindow.webContents.send(IpcEvents.MOONCORD_TABS_UPDATED, publicState());
    }
    persistState();
}

function updateBounds() {
    if (!shellWindow || shellWindow.isDestroyed()) return;
    const [width, height] = shellWindow.getContentSize();
    const bounds = getMooncordTabBounds(width, height);
    activeTab()?.view?.setBounds(bounds);
}

function activeTab() {
    return tabs.find(tab => tab.id === activeId);
}

function sendToTab(tab: DiscordTab, channel: IpcEvents, ...args: unknown[]) {
    if (tab.view && !tab.view.webContents.isDestroyed()) tab.view.webContents.send(channel, ...args);
}

function emitAppLoaded() {
    if (didEmitAppLoaded) return;
    didEmitAppLoaded = true;
    updateSplashMessage("");
    AppEvents.emit("appLoaded");
}

function loadTab(tab: DiscordTab, automaticRetry = false) {
    if (!tab.view || !canLoadMooncordTab(tab.loadStatus) || tab.view.webContents.isDestroyed()) return;
    const { view } = tab;
    if (!automaticRetry) tab.retryAttempt = 0;
    if (tab.retryTimer) clearTimeout(tab.retryTimer);
    tab.retryTimer = undefined;
    const loadGeneration = ++tab.loadGeneration;
    tab.loadStatus = "loading";
    const url = `${discordOrigin()}${safePath(tab.path)}`;
    updateSplashMessage("Conectando con Discord...");

    view.webContents
        .loadURL(url)
        .then(() => {
            if (tab.loadGeneration !== loadGeneration || tab.loadStatus === "crashed") return;
            tab.loadStatus = "loaded";
            tab.retryAttempt = 0;
            tab.crashRecoveryAttempted = false;
            tab.lastInteractionAt = Date.now();
            applyTabScheduling(tab);
            emitAppLoaded();
            broadcastState();
        })
        .catch(error => {
            if (view.webContents.isDestroyed()) return;
            if (tab.loadGeneration !== loadGeneration || tab.loadStatus === "crashed") return;
            tab.loadStatus = "idle";
            broadcastState();
            const description = error?.code || error?.message || "Error de conexión";
            console.error(`Failed to load Discord tab ${tab.id}:`, error);
            updateSplashMessage(`No se pudo cargar Discord: ${description}`);
            tab.retryAttempt++;
            const retryDelay = getMooncordTabRetryDelay(tab.retryAttempt);
            if (retryDelay === null) {
                console.warn("Stopped automatic Discord tab retries after " + tab.retryAttempt + " attempts:", tab.id);
                return;
            }
            if (tab.retryTimer) clearTimeout(tab.retryTimer);
            tab.retryTimer = setTimeout(() => {
                tab.retryTimer = undefined;
                loadTab(tab, true);
            }, retryDelay);
        });
}

function updateTabFromNavigation(tab: DiscordTab, url: string) {
    try {
        const parsed = new URL(url);
        if (parsed.origin !== discordOrigin()) return;
        const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
        if (path === tab.path) return;
        tab.path = path;
        tab.title = pathTitle(path, tabs.indexOf(tab) + 1);
        broadcastState();
    } catch {
        // Ignore navigation URLs that are not Discord web pages.
    }
}

function touchTab(tab: DiscordTab) {
    tab.lastInteractionAt = Date.now();
}

function isTabBusy(tab: DiscordTab) {
    return tab.activity.callActive || tab.activity.mediaActive || tab.activity.uploadActive;
}

function applyTabScheduling(tab: DiscordTab) {
    if (!tab.view || tab.view.webContents.isDestroyed()) return;
    const shouldThrottle = tab.id !== activeId && !isTabBusy(tab);
    tab.view.webContents.setBackgroundThrottling(shouldThrottle);
}

function canHibernate(tab: DiscordTab) {
    const timeout = Math.max(1, Settings.store.tabHibernateAfterMinutes || 15) * 60_000;
    return (
        Settings.store.enableTabHibernation &&
        tab.id !== activeId &&
        tab.loadStatus === "loaded" &&
        !isTabBusy(tab) &&
        Date.now() - tab.lastInteractionAt >= timeout
    );
}

function suspendTab(tab: DiscordTab) {
    if (!canHibernate(tab) || !tab.view) return;
    if (shellWindow && !shellWindow.isDestroyed()) shellWindow.contentView.removeChildView(tab.view);
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    tab.view = undefined;
    tab.loadStatus = "suspended";
    tab.loadGeneration++;
    tab.retryAttempt = 0;
    tab.crashRecoveryAttempted = false;
    broadcastState();
    mooncordDebug("tabs", "Suspended inactive tab %s", tab.id);
}

function checkTabHibernation() {
    for (const tab of tabs) suspendTab(tab);
}

function createDiscordTab(window: BrowserWindow, info: MooncordTabRecord): DiscordTab {
    const view = new WebContentsView({
        webPreferences: {
            nodeIntegration: false,
            sandbox: true,
            contextIsolation: true,
            devTools: true,
            preload: join(__dirname, "preload.js"),
            spellcheck: true,
            // Hidden tabs keep their in-memory state while Chromium throttles background work.
            backgroundThrottling: true
        }
    });
    const tab: DiscordTab = {
        ...info,
        path: safePath(info.path),
        view,
        loadStatus: "idle",
        loadGeneration: 0,
        retryAttempt: 0,
        crashRecoveryAttempted: false,
        lastInteractionAt: Date.now(),
        activity: {
            callActive: false,
            mediaActive: false,
            uploadActive: false
        }
    };
    window.contentView.addChildView(view);
    view.setVisible(false);
    view.webContents.setUserAgent(BrowserUserAgent);
    attachMooncordDebugConsoleMessages(view.webContents, `tab:${tab.id}`);
    makeWebContentsLinksOpenExternally(view.webContents);

    view.webContents.on("dom-ready", () => {
        void view.webContents.insertCSS(HIDE_DISCORD_WINDOW_CHROME).catch(error => {
            console.error("Failed to hide Discord's duplicate window controls:", error);
        });
    });

    view.webContents.on("did-navigate", (_event, url, responseCode) => {
        updateTabFromNavigation(tab, url);
        let pathname = "";
        try {
            pathname = new URL(url).pathname;
        } catch {
            return;
        }
        if (responseCode >= 300 && pathname !== "/app") {
            const wasLoading = tab.loadStatus === "loading";
            tab.loadStatus = "idle";
            tab.path = HOME_PATH;
            console.warn(`Discord tab returned HTTP ${responseCode}; navigating to the home screen.`);
            if (!wasLoading) loadTab(tab);
        }
    });
    view.webContents.on("did-navigate-in-page", (_event, url) => updateTabFromNavigation(tab, url));
    view.webContents.on("page-title-updated", (event, title) => {
        event.preventDefault();
        const nextTitle = cleanTitle(title, tab);
        if (tab.title === nextTitle) return;
        tab.title = nextTitle;
        broadcastState();
    });
    view.webContents.on("before-input-event", (event, input) => {
        if (input.type === "keyDown" && input.key === "F12") {
            event.preventDefault();
            view.webContents.toggleDevTools();
        }
    });
    view.webContents.on("will-navigate", (event, url) => {
        try {
            const protocol = new URL(url).protocol.toLowerCase();
            if (DISCORD_SCHEME_PROTOCOLS.has(protocol)) {
                event.preventDefault();
                console.info("Blocked Discord native-app hand-off:", protocol);
            }
        } catch {
            event.preventDefault();
        }
    });
    view.webContents.on("context-menu", (_event, data) => {
        sendToTab(tab, IpcEvents.SPELLCHECK_RESULT, data.misspelledWord, data.dictionarySuggestions);
    });
    view.webContents.on("devtools-opened", () => sendToTab(tab, IpcEvents.DEVTOOLS_OPENED));
    view.webContents.on("devtools-closed", () => sendToTab(tab, IpcEvents.DEVTOOLS_CLOSED));
    view.webContents.on("render-process-gone", (_event, details) => {
        tab.loadGeneration++;
        tab.retryAttempt = 0;
        if (tab.retryTimer) clearTimeout(tab.retryTimer);
        tab.retryTimer = undefined;
        tab.loadStatus = "crashed";
        console.error("Discord tab renderer exited:", details);
        broadcastState();
        if (!tab.crashRecoveryAttempted) {
            tab.crashRecoveryAttempted = true;
            tab.retryTimer = setTimeout(() => {
                tab.retryTimer = undefined;
                if (tab.view && !tab.view.webContents.isDestroyed()) loadTab(tab, true);
            }, 1_500);
        }
    });
    view.webContents.on("unresponsive", () => {
        tab.loadStatus = "unresponsive";
        broadcastState();
        console.warn("Discord tab renderer is unresponsive:", tab.id);
    });
    view.webContents.on("responsive", () => {
        if (tab.loadStatus === "unresponsive") tab.loadStatus = "loaded";
        touchTab(tab);
        broadcastState();
        console.info("Discord tab renderer recovered:", tab.id);
    });
    const untypedEvents = view.webContents as unknown as {
        on(eventName: string, listener: (...args: any[]) => void): void;
    };
    const refreshMediaActivity = () => {
        if (view.webContents.isDestroyed()) return;
        void view.webContents
            .executeJavaScript(
                `Array.from(document.querySelectorAll("audio,video")).some(element => !element.paused && !element.ended)`
            )
            .then(mediaActive => handleDiscordTabActivity(tab.id, { mediaActive: Boolean(mediaActive) }))
            .catch(() => undefined);
    };
    untypedEvents.on("audio-state-changed", (_event, audible) => {
        handleDiscordTabActivity(tab.id, { callActive: Boolean(audible), mediaActive: Boolean(audible) });
    });
    view.webContents.on("media-started-playing", () => handleDiscordTabActivity(tab.id, { mediaActive: true }));
    view.webContents.on("media-paused", refreshMediaActivity);
    untypedEvents.on("media-removed", refreshMediaActivity);
    view.webContents.on("destroyed", () => {
        if (tab.retryTimer) clearTimeout(tab.retryTimer);
    });
    return tab;
}

function resumeTab(tab: DiscordTab) {
    if (tab.view || !shellWindow || shellWindow.isDestroyed()) return tab;
    const index = tabs.indexOf(tab);
    if (index < 0) return tab;
    const resumed = createDiscordTab(shellWindow, {
        id: tab.id,
        path: tab.path,
        title: tab.title,
        ...(tab.customTitle ? { customTitle: tab.customTitle } : {})
    });
    resumed.lastInteractionAt = Date.now();
    tabs[index] = resumed;
    mooncordDebug("tabs", "Resumed suspended tab %s", tab.id);
    return resumed;
}

function setActive(id: string) {
    let next = tabs.find(tab => tab.id === id);
    if (!next) return publicState();
    if (next.loadStatus === "suspended") next = resumeTab(next);
    touchTab(next);
    activeId = next.id;

    for (const tab of tabs) {
        tab.view?.setVisible(tab === next);
        applyTabScheduling(tab);
    }
    loadTab(next);
    updateBounds();
    broadcastState();
    return publicState();
}

function disposeTab(tab: DiscordTab) {
    if (tab.retryTimer) clearTimeout(tab.retryTimer);
    if (shellWindow && !shellWindow.isDestroyed()) {
        if (tab.view) shellWindow.contentView.removeChildView(tab.view);
    }
    if (tab.view && !tab.view.webContents.isDestroyed()) tab.view.webContents.close();
}

function createTab() {
    if (!shellWindow || shellWindow.isDestroyed() || tabs.length >= MAX_MOONCORD_TABS) return publicState();
    const tab = createDiscordTab(shellWindow, { id: randomUUID(), path: HOME_PATH, title: "Inicio" });
    tabs.push(tab);
    return setActive(tab.id);
}

function closeTab(id: string) {
    if (tabs.length <= 1) return publicState();
    const index = tabs.findIndex(tab => tab.id === id);
    if (index < 0) return publicState();
    const [removed] = tabs.splice(index, 1);
    const wasActive = removed.id === activeId;
    disposeTab(removed);
    if (wasActive) activeId = getFallbackActiveMooncordTabId(tabs, index);
    return setActive(activeId);
}

function renameTab(id: string, title: unknown) {
    const tab = tabs.find(item => item.id === id);
    if (!tab) return publicState();

    const customTitle = normalizeCustomMooncordTabTitle(title);
    if (tab.customTitle === customTitle) return publicState();
    if (customTitle) tab.customTitle = customTitle;
    else delete tab.customTitle;

    broadcastState();
    return publicState();
}

function reorderTab(id: string, targetId: string, after: boolean) {
    if (!tabs.some(tab => tab.id === id) || !tabs.some(tab => tab.id === targetId)) return publicState();
    tabs = moveMooncordTab(tabs, id, targetId, after);
    broadcastState();
    return publicState();
}

export function reloadDiscordTab(id: string) {
    let tab = tabs.find(item => item.id === id);
    if (!tab) return publicState();
    const wasSuspended = tab.loadStatus === "suspended";
    if (wasSuspended) tab = resumeTab(tab);
    if (!tab.view || tab.view.webContents.isDestroyed()) return publicState();
    tab.crashRecoveryAttempted = false;
    tab.retryAttempt = 0;
    tab.loadStatus = "idle";
    if (wasSuspended) loadTab(tab);
    else tab.view.webContents.reload();
    broadcastState();
    return publicState();
}

function reloadActiveTab() {
    const tab = activeTab();
    if (!tab || !tab.view || tab.view.webContents.isDestroyed()) return;

    if (tab.loadStatus === "crashed" || tab.loadStatus === "idle") {
        if (tab.loadStatus === "crashed") tab.loadStatus = "idle";
        loadTab(tab);
        broadcastState();
        return;
    }

    reloadDiscordTab(tab.id);
}

export function openDiscordTabDevTools(id: string) {
    const tab = tabs.find(item => item.id === id);
    if (!tab?.view || tab.view.webContents.isDestroyed()) return;
    tab.view.webContents.openDevTools({ mode: "detach" });
}

export function handleDiscordTabActivity(id: string, activity: unknown) {
    const tab = tabs.find(item => item.id === id);
    if (!tab || typeof activity !== "object" || activity === null) return;
    const data = activity as Record<string, unknown>;
    if (data.interaction === true) touchTab(tab);
    for (const key of ["callActive", "mediaActive", "uploadActive"] as const) {
        if (typeof data[key] === "boolean") tab.activity[key] = data[key];
    }
    applyTabScheduling(tab);
    broadcastState();
}

function resetTabs() {
    const current = activeTab();
    for (const tab of [...tabs]) {
        if (tab !== current) disposeTab(tab);
    }
    tabs = current ? [current] : [];
    activeId = current?.id ?? "";
    if (current) return setActive(current.id);
    return createTab();
}

export function getDiscordTabState() {
    return publicState();
}

export function getActiveDiscordWebContents(): WebContents | undefined {
    const contents = activeTab()?.view?.webContents;
    return contents && !contents.isDestroyed() ? contents : undefined;
}

export function getDiscordTabForWebContents(contents: WebContents) {
    return tabs.find(tab => tab.view?.webContents.id === contents.id);
}

export function broadcastToDiscordTabs(channel: IpcEvents, ...args: unknown[]) {
    for (const tab of tabs) sendToTab(tab, channel, ...args);
}

export function toggleActiveDiscordDevTools() {
    getActiveDiscordWebContents()?.toggleDevTools();
}

export function openDiscordSettings() {
    const contents = getActiveDiscordWebContents();
    if (!contents) return;
    void contents.executeJavaScript(`(() => {
        const openSettings = () => {
            const button = [...document.querySelectorAll('button')].find(element => /settings|ajustes/i.test(element.getAttribute('aria-label') || element.textContent || ''));
            button?.click();
        };
        if (!location.pathname.startsWith('/channels/@me')) location.assign('/channels/@me');
        setTimeout(openSettings, 800);
    })()`);
}

export function initializeDiscordTabs(window: BrowserWindow, uri?: string) {
    shellWindow = window;
    tabs = [];
    const stored = State.store.mooncordTabs ?? [];
    const initialPath = (() => {
        if (!uri) return undefined;
        try {
            return safePath(new URL(uri).pathname + new URL(uri).search + new URL(uri).hash);
        } catch {
            return HOME_PATH;
        }
    })();
    const restored = restoreMooncordTabs({
        storedTabs: Array.isArray(stored) ? stored : [],
        storedActiveId: State.store.activeMooncordTabId,
        initialPath,
        homePath: HOME_PATH,
        maxTabs: MAX_MOONCORD_TABS,
        createId: randomUUID,
        safePath,
        pathTitle
    });
    for (const info of restored.tabs) {
        const tabInfo = { ...info, loadStatus: "idle" as const };
        tabs.push(createDiscordTab(window, tabInfo));
    }
    activeId = restored.activeId;

    handle(IpcEvents.GET_MOONCORD_TABS, () => publicState());
    handle(IpcEvents.SELECT_MOONCORD_TAB, (_event, id: string) => setActive(id));
    handle(IpcEvents.CREATE_MOONCORD_TAB, () => createTab());
    handle(IpcEvents.CLOSE_MOONCORD_TAB, (_event, id: string) => closeTab(id));
    handle(IpcEvents.RENAME_MOONCORD_TAB, (_event, id: string, title: string) => renameTab(id, title));
    handle(IpcEvents.REORDER_MOONCORD_TAB, (_event, id: string, targetId: string, after: boolean) =>
        reorderTab(id, targetId, after)
    );
    handle(IpcEvents.RESET_MOONCORD_TABS, () => resetTabs());
    handle(IpcEvents.OPEN_DISCORD_SETTINGS, () => openDiscordSettings());
    handle(IpcEvents.DISCORD_BACK, () => {
        const contents = getActiveDiscordWebContents();
        if (contents?.canGoBack()) contents.goBack();
    });
    handle(IpcEvents.DISCORD_FORWARD, () => {
        const contents = getActiveDiscordWebContents();
        if (contents?.canGoForward()) contents.goForward();
    });
    handle(IpcEvents.DISCORD_RELOAD, () => reloadActiveTab());

    window.on("resize", updateBounds);
    window.on("closed", () => {
        if (hibernationTimer) clearInterval(hibernationTimer);
        hibernationTimer = undefined;
        for (const tab of tabs) {
            if (tab.retryTimer) clearTimeout(tab.retryTimer);
        }
        tabs = [];
        activeId = "";
        shellWindow = undefined;
    });

    if (hibernationTimer) clearInterval(hibernationTimer);
    hibernationTimer = setInterval(checkTabHibernation, 30_000);
    Settings.addChangeListener("enableTabHibernation", () => checkTabHibernation());
    Settings.addChangeListener("tabHibernateAfterMinutes", () => checkTabHibernation());
    setActive(activeId);
    void window.loadURL("mooncord://static/views/mooncord-shell.html").catch(error => {
        console.error("Failed to load Mooncord tab bar:", error);
    });
}
