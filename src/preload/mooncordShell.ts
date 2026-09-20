/*
 * Mooncord Client UI layer.
 *
 * Discord remains the authenticated, real-time application underneath this
 * shell. The shell only owns navigation metadata and presentation; it never
 * reads or exports Discord credentials, cookies, or tokens.
 */

import { VesktopNative } from "./VesktopNative";

const SHELL_ID = "mooncord-shell";
const TABS_KEY = "mooncord.shell.tabs.v1";
const MAX_TABS = 8;
const HOME_PATH = "/channels/@me";

type MooncordTab = {
    id: string;
    path: string;
    title: string;
};

const shellCss = `
:root {
    --mooncord-shell-height: 54px;
    --mooncord-bg: rgba(8, 10, 14, .97);
    --mooncord-bg-elevated: rgba(18, 21, 27, .99);
    --mooncord-border: rgba(255, 255, 255, .09);
    --mooncord-text: #f2f5ff;
    --mooncord-muted: #9ca5b2;
    --mooncord-accent: #c9ced7;
    --mooncord-accent-strong: #f2f4f7;

    /* Neutral dark Discord palette, matching the supplied monochrome mark. */
    --background-primary: #0b0d10 !important;
    --background-secondary: #111419 !important;
    --background-secondary-alt: #0e1115 !important;
    --background-tertiary: #080a0d !important;
    --background-floating: #15191f !important;
    --background-accent: #262c34 !important;
    --channeltextarea-background: #15191f !important;
    --modal-background: #111419 !important;
    --input-background: #0d1014 !important;
    --background-modifier-hover: rgba(255, 255, 255, .07) !important;
    --background-modifier-active: rgba(255, 255, 255, .11) !important;
    --background-modifier-selected: rgba(255, 255, 255, .13) !important;
    --background-modifier-accent: rgba(255, 255, 255, .12) !important;
    --brand-experiment: #dce1e8 !important;
    --brand-experiment-560: #363c45 !important;
    --brand-500: #dce1e8 !important;
}

#${SHELL_ID} {
    align-items: center;
    background: linear-gradient(105deg, rgba(11, 14, 23, .98), rgba(28, 25, 55, .96) 48%, rgba(19, 24, 39, .98));
    border-bottom: 1px solid var(--mooncord-border);
    box-shadow: 0 8px 26px rgba(0, 0, 0, .28);
    box-sizing: border-box;
    color: var(--mooncord-text);
    display: flex;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    gap: 8px;
    height: var(--mooncord-shell-height);
    left: 0;
    padding: 0 10px;
    position: fixed;
    right: 0;
    top: 0;
    user-select: none;
    z-index: 2147483646;
    -webkit-app-region: drag;
}

#${SHELL_ID} *, #${SHELL_ID} button { box-sizing: border-box; }
#${SHELL_ID} button, #${SHELL_ID} .mooncord-tab { -webkit-app-region: no-drag; }

#${SHELL_ID} .mooncord-brand {
    align-items: center;
    display: flex;
    flex: 0 0 auto;
    gap: 8px;
    min-width: 154px;
}

#${SHELL_ID} .mooncord-mark {
    align-items: center;
    background: linear-gradient(145deg, #303640, #111419);
    border: 1px solid rgba(255, 255, 255, .16);
    border-radius: 12px;
    box-shadow: 0 0 22px rgba(0, 0, 0, .5), inset 0 1px 0 rgba(255, 255, 255, .12);
    color: white;
    display: inline-flex;
    font-size: 16px;
    font-weight: 800;
    height: 30px;
    justify-content: center;
    width: 30px;
}
#${SHELL_ID} .mooncord-mark img { height: 22px; object-fit: contain; width: 22px; }

#${SHELL_ID} .mooncord-brand-copy { display: flex; flex-direction: column; line-height: 1.05; }
#${SHELL_ID} .mooncord-brand-name { font-size: 13px; font-weight: 750; letter-spacing: .2px; }
#${SHELL_ID} .mooncord-brand-status { align-items: center; color: #9eacc7; display: flex; font-size: 10px; gap: 4px; margin-top: 3px; }
#${SHELL_ID} .mooncord-status-dot { background: #dce1e8; border-radius: 50%; box-shadow: 0 0 8px rgba(220, 225, 232, .45); height: 6px; width: 6px; }

#${SHELL_ID} .mooncord-nav { display: flex; flex: 0 0 auto; gap: 3px; }
#${SHELL_ID} .mooncord-icon-button,
#${SHELL_ID} .mooncord-window-button,
#${SHELL_ID} .mooncord-tool-button {
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: 8px;
    color: var(--mooncord-muted);
    cursor: pointer;
    display: inline-flex;
    font-size: 16px;
    height: 32px;
    justify-content: center;
    transition: background .15s ease, color .15s ease, transform .15s ease;
    width: 32px;
}
#${SHELL_ID} .mooncord-icon-button:hover,
#${SHELL_ID} .mooncord-window-button:hover,
#${SHELL_ID} .mooncord-tool-button:hover { background: rgba(255, 255, 255, .1); color: white; transform: translateY(-1px); }
#${SHELL_ID} .mooncord-icon-button:active,
#${SHELL_ID} .mooncord-window-button:active,
#${SHELL_ID} .mooncord-tool-button:active { transform: translateY(0); }

#${SHELL_ID} .mooncord-tabs { align-items: center; display: flex; flex: 1 1 auto; gap: 5px; min-width: 0; overflow: hidden; }
#${SHELL_ID} .mooncord-tab {
    align-items: center;
    background: rgba(255, 255, 255, .045);
    border: 1px solid transparent;
    border-radius: 9px;
    color: var(--mooncord-muted);
    cursor: pointer;
    display: flex;
    flex: 0 1 210px;
    gap: 8px;
    height: 34px;
    min-width: 100px;
    overflow: hidden;
    padding: 0 7px 0 11px;
    transition: background .15s ease, border .15s ease, color .15s ease;
}
#${SHELL_ID} .mooncord-tab:hover { background: rgba(255, 255, 255, .09); color: white; }
#${SHELL_ID} .mooncord-tab.active { background: linear-gradient(135deg, rgba(255, 255, 255, .16), rgba(255, 255, 255, .07)); border-color: rgba(255, 255, 255, .22); color: white; }
#${SHELL_ID} .mooncord-tab-icon { color: var(--mooncord-accent-strong); flex: 0 0 auto; font-size: 13px; }
#${SHELL_ID} .mooncord-tab-label { flex: 1 1 auto; font-size: 12px; overflow: hidden; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
#${SHELL_ID} .mooncord-tab-close { align-items: center; border-radius: 5px; color: #919ab0; display: inline-flex; flex: 0 0 auto; font-size: 14px; height: 22px; justify-content: center; opacity: .7; width: 22px; }
#${SHELL_ID} .mooncord-tab-close:hover { background: rgba(255, 255, 255, .13); color: white; opacity: 1; }
#${SHELL_ID} .mooncord-add { flex: 0 0 auto; margin-left: 2px; }

#${SHELL_ID} .mooncord-tools { align-items: center; display: flex; flex: 0 0 auto; gap: 3px; margin-left: 5px; }
#${SHELL_ID} .mooncord-tools-menu {
    background: var(--mooncord-bg-elevated);
    border: 1px solid var(--mooncord-border);
    border-radius: 11px;
    box-shadow: 0 15px 38px rgba(0, 0, 0, .48);
    display: none;
    min-width: 190px;
    padding: 6px;
    position: absolute;
    right: 96px;
    top: 47px;
    -webkit-app-region: no-drag;
}
#${SHELL_ID} .mooncord-tools-menu.open { display: block; }
#${SHELL_ID} .mooncord-menu-item { background: transparent; border: 0; border-radius: 7px; color: #d6dcf0; cursor: pointer; display: block; font: inherit; font-size: 12px; padding: 9px 10px; text-align: left; width: 100%; }
#${SHELL_ID} .mooncord-menu-item:hover { background: rgba(255, 255, 255, .1); color: white; }

#${SHELL_ID} .mooncord-window-controls { display: flex; flex: 0 0 auto; gap: 2px; margin-left: 2px; }
#${SHELL_ID} .mooncord-window-button { border-radius: 6px; font-size: 13px; height: 28px; width: 30px; }
#${SHELL_ID} .mooncord-window-button.close:hover { background: #d9536f; }

/*
 * Mooncord owns the window chrome. Discord also renders a second in-page
 * chrome row (back/forward, inbox, help, and its own window buttons); keeping
 * it would duplicate controls and consume 32px of the viewport.
 */
body:has(#${SHELL_ID}) [data-window-chrome="true"],
body:has(#${SHELL_ID}) [class*="systemBar_"] {
    display: none !important;
}

body:has(#${SHELL_ID}) #app-mount {
    height: calc(100vh - var(--mooncord-shell-height)) !important;
    margin-top: var(--mooncord-shell-height) !important;
}
`;

function getPath() {
    const path = `${location.pathname}${location.search}${location.hash}`;
    return path.startsWith("/") ? path : HOME_PATH;
}

function makeId() {
    return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readTabs(): MooncordTab[] {
    try {
        const parsed = JSON.parse(localStorage.getItem(TABS_KEY) || "[]");
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((tab): tab is MooncordTab => Boolean(tab && typeof tab.path === "string"))
            .slice(0, MAX_TABS)
            .map(tab => ({ id: tab.id || makeId(), path: tab.path, title: tab.title || "Discord" }));
    } catch {
        return [];
    }
}

function saveTabs(tabs: MooncordTab[]) {
    try {
        localStorage.setItem(TABS_KEY, JSON.stringify(tabs.slice(0, MAX_TABS)));
    } catch {
        // A blocked storage area should not prevent Discord from working.
    }
}

function labelForPath(path: string) {
    if (path === HOME_PATH || path.startsWith(`${HOME_PATH}?`)) return "Inicio";
    if (path.startsWith("/channels/")) return "Canal de Discord";
    if (path.includes("/settings")) return "Ajustes";
    return "Discord";
}

function createButton(className: string, text: string, ariaLabel: string) {
    const button = document.createElement("button");
    button.className = className;
    button.type = "button";
    button.textContent = text;
    button.setAttribute("aria-label", ariaLabel);
    button.title = ariaLabel;
    return button;
}

export function installMooncordShell() {
    const install = () => {
        if (!document.body || document.getElementById(SHELL_ID)) return;

        const style = document.createElement("style");
        style.id = `${SHELL_ID}-style`;
        style.textContent = shellCss;
        document.head.appendChild(style);

        let tabs = readTabs();
        const currentPath = getPath();
        let activeId = tabs.find(tab => tab.path === currentPath)?.id || tabs[0]?.id || makeId();
        if (!tabs.length) tabs = [{ id: activeId, path: currentPath, title: labelForPath(currentPath) }];
        else if (!tabs.some(tab => tab.id === activeId)) tabs.unshift({ id: activeId, path: currentPath, title: labelForPath(currentPath) });
        saveTabs(tabs);

        const shell = document.createElement("div");
        shell.id = SHELL_ID;
        shell.innerHTML = `
            <div class="mooncord-brand">
                <span class="mooncord-mark"><img src="vesktop://static/discord.png" alt="" /></span>
                <span class="mooncord-brand-copy">
                    <span class="mooncord-brand-name">Mooncord</span>
                    <span class="mooncord-brand-status"><span class="mooncord-status-dot"></span><span data-status-label>Discord web</span></span>
                </span>
            </div>
            <div class="mooncord-nav">
                <button class="mooncord-icon-button" data-action="back" type="button" aria-label="Atrás" title="Atrás">‹</button>
                <button class="mooncord-icon-button" data-action="forward" type="button" aria-label="Adelante" title="Adelante">›</button>
                <button class="mooncord-icon-button" data-action="reload" type="button" aria-label="Recargar Discord" title="Recargar Discord">↻</button>
            </div>
            <div class="mooncord-tabs" role="tablist" aria-label="Pestañas de Mooncord"></div>
            <button class="mooncord-icon-button mooncord-add" data-action="new-tab" type="button" aria-label="Nueva pestaña" title="Nueva pestaña">+</button>
            <div class="mooncord-tools">
                <button class="mooncord-tool-button" data-action="tools" type="button" aria-label="Herramientas" title="Herramientas">☷</button>
                <div class="mooncord-tools-menu" role="menu">
                    <button class="mooncord-menu-item" data-action="devtools" type="button">Abrir DevTools (F12)</button>
                    <button class="mooncord-menu-item" data-action="reset-tabs" type="button">Restablecer pestañas</button>
                    <button class="mooncord-menu-item" data-action="discord-settings" type="button">Abrir ajustes de Discord</button>
                </div>
            </div>
            <div class="mooncord-window-controls">
                <button class="mooncord-window-button" data-action="minimize" type="button" aria-label="Minimizar">−</button>
                <button class="mooncord-window-button" data-action="maximize" type="button" aria-label="Maximizar">□</button>
                <button class="mooncord-window-button close" data-action="close" type="button" aria-label="Cerrar">×</button>
            </div>
        `;
        document.body.appendChild(shell);

        const tabsContainer = shell.querySelector<HTMLDivElement>(".mooncord-tabs")!;
        const toolsMenu = shell.querySelector<HTMLDivElement>(".mooncord-tools-menu")!;
        const statusLabel = shell.querySelector<HTMLSpanElement>("[data-status-label]")!;
        let lastRenderedSignature = "";

        const navigate = (path: string) => {
            const nextPath = path.startsWith("/") ? path : HOME_PATH;
            if (getPath() === nextPath) {
                window.dispatchEvent(new PopStateEvent("popstate"));
                return;
            }
            location.assign(nextPath);
        };

        const renderTabs = () => {
            const signature = `${activeId}|${tabs.map(tab => `${tab.id}:${tab.path}:${tab.title}`).join("\u0001")}`;
            if (signature === lastRenderedSignature) return;
            lastRenderedSignature = signature;
            tabsContainer.replaceChildren();
            for (const tab of tabs) {
                const tabElement = document.createElement("div");
                tabElement.className = `mooncord-tab${tab.id === activeId ? " active" : ""}`;
                tabElement.setAttribute("role", "tab");
                tabElement.setAttribute("aria-selected", String(tab.id === activeId));
                tabElement.title = tab.path;

                const icon = document.createElement("span");
                icon.className = "mooncord-tab-icon";
                icon.textContent = tab.id === activeId ? "●" : "○";

                const label = document.createElement("span");
                label.className = "mooncord-tab-label";
                label.textContent = tab.title;

                const close = document.createElement("span");
                close.className = "mooncord-tab-close";
                close.textContent = "×";
                close.setAttribute("aria-label", `Cerrar ${tab.title}`);

                tabElement.append(icon, label, close);
                tabElement.addEventListener("click", event => {
                    if ((event.target as HTMLElement).closest(".mooncord-tab-close")) return;
                    activeId = tab.id;
                    renderTabs();
                    navigate(tab.path);
                });
                close.addEventListener("click", event => {
                    event.stopPropagation();
                    if (tabs.length === 1) return;
                    const removedIndex = tabs.findIndex(item => item.id === tab.id);
                    tabs = tabs.filter(item => item.id !== tab.id);
                    if (tab.id === activeId) {
                        const fallback = tabs[Math.max(0, removedIndex - 1)] || tabs[0];
                        activeId = fallback.id;
                        navigate(fallback.path);
                    }
                    saveTabs(tabs);
                    renderTabs();
                });
                tabsContainer.appendChild(tabElement);
            }
            saveTabs(tabs);
        };

        const syncRoute = () => {
            const path = getPath();
            const signedIn = !path.startsWith("/login") && !path.startsWith("/register");
            statusLabel.textContent = signedIn ? "Discord conectado" : "Listo para iniciar sesión";
            const current = tabs.find(tab => tab.id === activeId);
            if (current) {
                current.path = path;
                current.title = document.title && !document.title.includes("Discord") ? document.title : labelForPath(path);
            }
            renderTabs();
        };

        // Discord is a single-page app and changes routes with the History API
        // without emitting popstate. Listen to those real changes instead of
        // polling every 1.2 seconds and rebuilding the tab DOM unnecessarily.
        const routeChanged = () => window.dispatchEvent(new Event("mooncord-route-change"));
        for (const method of ["pushState", "replaceState"] as const) {
            const original = history[method] as (...args: any[]) => unknown;
            Object.defineProperty(history, method, {
                configurable: true,
                value: function (this: History, ...args: any[]) {
                    const result = original.apply(this, args);
                    routeChanged();
                    return result;
                }
            });
        }

        shell.addEventListener("click", event => {
            const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
            const action = target?.dataset.action;
            if (!action) return;
            if (action === "back") history.back();
            if (action === "forward") history.forward();
            if (action === "reload") location.reload();
            if (action === "new-tab") {
                if (tabs.length >= MAX_TABS) return;
                const tab = { id: makeId(), path: HOME_PATH, title: "Inicio" };
                tabs.push(tab);
                activeId = tab.id;
                renderTabs();
                navigate(tab.path);
            }
            if (action === "tools") toolsMenu.classList.toggle("open");
            if (action === "devtools") {
                toolsMenu.classList.remove("open");
                VesktopNative.win.toggleDevTools();
            }
            if (action === "reset-tabs") {
                toolsMenu.classList.remove("open");
                tabs = [{ id: makeId(), path: getPath(), title: labelForPath(getPath()) }];
                activeId = tabs[0].id;
                renderTabs();
            }
            if (action === "discord-settings") {
                toolsMenu.classList.remove("open");
                navigate("/channels/@me");
                setTimeout(() => {
                    const settingsButton = [...document.querySelectorAll<HTMLElement>("button")].find(button =>
                        /ajustes|settings/i.test(button.getAttribute("aria-label") || button.textContent || "")
                    );
                    settingsButton?.click();
                }, 800);
            }
            if (action === "minimize") VesktopNative.win.minimize();
            if (action === "maximize") VesktopNative.win.maximize();
            if (action === "close") VesktopNative.win.close();
        });

        document.addEventListener("click", event => {
            if (!shell.contains(event.target as Node)) toolsMenu.classList.remove("open");
        });
        window.addEventListener("popstate", syncRoute);
        window.addEventListener("hashchange", syncRoute);
        window.addEventListener("mooncord-route-change", syncRoute);
        new MutationObserver(syncRoute).observe(document.querySelector("title") || document.head, { childList: true, subtree: true });

        renderTabs();
        syncRoute();
    };

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
    else install();
}
