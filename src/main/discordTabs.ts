/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { randomUUID } from "crypto";
import { BrowserWindow, WebContents, WebContentsView } from "electron";
import { join } from "path";
import { IpcEvents } from "shared/IpcEvents";
import type { MooncordTabInfo, MooncordTabsState } from "shared/mooncordTabs";

import { BrowserUserAgent } from "./constants";
import { AppEvents } from "./events";
import { Settings, State } from "./settings";
import { updateSplashMessage } from "./splash";
import { handle } from "./utils/ipcWrappers";
import { makeWebContentsLinksOpenExternally } from "./utils/makeLinksOpenExternally";

const MAX_TABS = 8;
const TOOLBAR_HEIGHT = 54;
const HOME_PATH = "/channels/@me";
const DISCORD_SCHEME_PROTOCOLS = new Set(["discord:", "discordapp:", "discord-canary:", "discord-ptb:"]);
const HIDE_DISCORD_WINDOW_CHROME = `
    [data-window-chrome="true"],
    [class*="systemBar_"] {
        display: none !important;
    }
`;

interface DiscordTab extends MooncordTabInfo {
    view: WebContentsView;
    loaded: boolean;
    loading: boolean;
    retryTimer?: ReturnType<typeof setTimeout>;
}

let shellWindow: BrowserWindow | undefined;
let tabs: DiscordTab[] = [];
let activeId = "";
let didEmitAppLoaded = false;

function discordOrigin() {
    const branch = Settings.store.discordBranch;
    const subdomain = branch === "canary" || branch === "ptb" ? `${branch}.` : "";
    return `https://${subdomain}discord.com`;
}

function safePath(path: unknown): string {
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return HOME_PATH;
    try {
        const url = new URL(path, discordOrigin());
        return url.origin === discordOrigin() ? `${url.pathname}${url.search}${url.hash}` : HOME_PATH;
    } catch {
        return HOME_PATH;
    }
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
        tabs: tabs.map(({ id, path, title }) => ({ id, path, title })),
        activeId
    };
}

function persistState() {
    State.store.mooncordTabs = publicState().tabs;
    State.store.activeMooncordTabId = activeId;
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
    for (const tab of tabs) {
        tab.view.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width, height: Math.max(0, height - TOOLBAR_HEIGHT) });
    }
}

function activeTab() {
    return tabs.find(tab => tab.id === activeId);
}

function sendToTab(tab: DiscordTab, channel: IpcEvents, ...args: unknown[]) {
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.send(channel, ...args);
}

function emitAppLoaded() {
    if (didEmitAppLoaded) return;
    didEmitAppLoaded = true;
    updateSplashMessage("");
    AppEvents.emit("appLoaded");
}

function loadTab(tab: DiscordTab) {
    if (tab.loaded || tab.loading || tab.view.webContents.isDestroyed()) return;
    tab.loading = true;
    const url = `${discordOrigin()}${safePath(tab.path)}`;
    updateSplashMessage("Conectando con Discord...");

    tab.view.webContents
        .loadURL(url)
        .then(() => {
            tab.loading = false;
            tab.loaded = true;
            emitAppLoaded();
        })
        .catch(error => {
            tab.loading = false;
            if (tab.view.webContents.isDestroyed()) return;
            const description = error?.code || error?.message || "Error de conexión";
            console.error(`Failed to load Discord tab ${tab.id}:`, error);
            updateSplashMessage(`No se pudo cargar Discord: ${description}`);
            tab.retryTimer = setTimeout(() => loadTab(tab), 1000);
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

function createDiscordTab(window: BrowserWindow, info: MooncordTabInfo): DiscordTab {
    const view = new WebContentsView({
        webPreferences: {
            nodeIntegration: false,
            sandbox: true,
            contextIsolation: true,
            devTools: true,
            preload: join(__dirname, "preload.js"),
            spellcheck: true,
            // Keep Discord's renderer alive when its tab is hidden.
            backgroundThrottling: false
        }
    });
    const tab: DiscordTab = { ...info, path: safePath(info.path), view, loaded: false, loading: false };
    window.contentView.addChildView(view);
    view.setVisible(false);
    view.webContents.setUserAgent(BrowserUserAgent);
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
            tab.loaded = false;
            tab.path = HOME_PATH;
            console.warn(`Discord tab returned HTTP ${responseCode}; navigating to the home screen.`);
            loadTab(tab);
        }
    });
    view.webContents.on("did-navigate-in-page", (_event, url) => updateTabFromNavigation(tab, url));
    view.webContents.on("page-title-updated", (event, title) => {
        event.preventDefault();
        tab.title = cleanTitle(title, tab);
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
    view.webContents.on("render-process-gone", (_event, details) =>
        console.error("Discord tab renderer exited:", details)
    );
    view.webContents.on("destroyed", () => {
        if (tab.retryTimer) clearTimeout(tab.retryTimer);
    });
    return tab;
}

function setActive(id: string) {
    const next = tabs.find(tab => tab.id === id);
    if (!next) return publicState();

    for (const tab of tabs) tab.view.setVisible(tab === next);
    activeId = next.id;
    loadTab(next);
    updateBounds();
    broadcastState();
    return publicState();
}

function disposeTab(tab: DiscordTab) {
    if (tab.retryTimer) clearTimeout(tab.retryTimer);
    if (shellWindow && !shellWindow.isDestroyed()) {
        shellWindow.contentView.removeChildView(tab.view);
    }
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
}

function createTab() {
    if (!shellWindow || shellWindow.isDestroyed() || tabs.length >= MAX_TABS) return publicState();
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
    if (wasActive) activeId = tabs[Math.max(0, index - 1)]?.id ?? tabs[0].id;
    return setActive(activeId);
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
    const contents = activeTab()?.view.webContents;
    return contents && !contents.isDestroyed() ? contents : undefined;
}

export function getDiscordTabForWebContents(contents: WebContents) {
    return tabs.find(tab => tab.view.webContents.id === contents.id);
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
    const storedTabs = stored.slice(0, MAX_TABS).map((tab, index) => ({
        id: typeof tab.id === "string" && tab.id ? tab.id : randomUUID(),
        path: safePath(tab.path),
        title: typeof tab.title === "string" && tab.title ? tab.title : pathTitle(safePath(tab.path), index + 1)
    }));

    if (initialPath) {
        const existing = storedTabs.find(tab => tab.path === initialPath);
        if (existing) State.store.activeMooncordTabId = existing.id;
        else {
            const deepLinkTab = { id: randomUUID(), path: initialPath, title: pathTitle(initialPath, 1) };
            storedTabs.unshift(deepLinkTab);
            State.store.activeMooncordTabId = deepLinkTab.id;
        }
    }
    if (!storedTabs.length) storedTabs.push({ id: randomUUID(), path: HOME_PATH, title: "Inicio" });

    const uniqueTabs = storedTabs.slice(0, MAX_TABS);
    const ids = new Set<string>();
    for (const info of uniqueTabs) {
        if (ids.has(info.id)) info.id = randomUUID();
        ids.add(info.id);
        tabs.push(createDiscordTab(window, info));
    }
    activeId = tabs.some(tab => tab.id === State.store.activeMooncordTabId)
        ? State.store.activeMooncordTabId!
        : tabs[0].id;

    handle(IpcEvents.GET_MOONCORD_TABS, () => publicState());
    handle(IpcEvents.SELECT_MOONCORD_TAB, (_event, id: string) => setActive(id));
    handle(IpcEvents.CREATE_MOONCORD_TAB, () => createTab());
    handle(IpcEvents.CLOSE_MOONCORD_TAB, (_event, id: string) => closeTab(id));
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
    handle(IpcEvents.DISCORD_RELOAD, () => getActiveDiscordWebContents()?.reload());

    window.on("resize", updateBounds);
    window.on("closed", () => {
        for (const tab of tabs) {
            if (tab.retryTimer) clearTimeout(tab.retryTimer);
        }
        tabs = [];
        activeId = "";
        shellWindow = undefined;
    });

    setActive(activeId);
    void window.loadURL("vesktop://static/views/mooncord-shell.html").catch(error => {
        console.error("Failed to load Mooncord tab bar:", error);
    });
}
