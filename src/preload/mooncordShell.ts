/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { MooncordTabsState } from "shared/mooncordTabs";

const SHELL_ID = "mooncord-shell";

declare global {
    interface Window {
        MooncordShellNative: {
            getState(): Promise<MooncordTabsState>;
            onStateChanged(callback: (state: MooncordTabsState) => void): () => void;
            selectTab(id: string): Promise<MooncordTabsState>;
            createTab(): Promise<MooncordTabsState>;
            closeTab(id: string): Promise<MooncordTabsState>;
            resetTabs(): Promise<MooncordTabsState>;
            openDiscordSettings(): Promise<void>;
            goBack(): Promise<void>;
            goForward(): Promise<void>;
            reload(): Promise<void>;
            minimize(): Promise<void>;
            maximize(): Promise<void>;
            closeWindow(): Promise<void>;
            toggleDevTools(): Promise<void>;
        };
    }
}

const shellCss = `
:root { color-scheme: dark; font-family: Inter, "Segoe UI", sans-serif; }
* { box-sizing: border-box; }
html, body { background: #191b20; color: #f1f3f8; height: 100%; margin: 0; overflow: hidden; }
#${SHELL_ID} {
    align-items: center;
    background: linear-gradient(110deg, #222630, #191b20 60%, #20232a);
    border-bottom: 1px solid rgba(255,255,255,.09);
    display: flex;
    gap: 10px;
    height: 54px;
    left: 0;
    padding: 0 8px 0 12px;
    position: fixed;
    right: 0;
    top: 0;
    user-select: none;
    z-index: 100;
    -webkit-app-region: drag;
}
#${SHELL_ID} button, #${SHELL_ID} .mooncord-tab { -webkit-app-region: no-drag; pointer-events: auto; }
#${SHELL_ID} .mooncord-brand { align-items: center; display: flex; flex: 0 0 auto; gap: 8px; min-width: 130px; }
#${SHELL_ID} .mooncord-mark { align-items: center; background: #111419; border: 1px solid #50545c; border-radius: 10px; display: inline-flex; height: 30px; justify-content: center; width: 30px; }
#${SHELL_ID} .mooncord-mark img { height: 22px; object-fit: contain; width: 22px; }
#${SHELL_ID} .mooncord-brand-copy { display: flex; flex-direction: column; line-height: 1.05; }
#${SHELL_ID} .mooncord-brand-name { font-size: 13px; font-weight: 750; letter-spacing: .2px; }
#${SHELL_ID} .mooncord-brand-status { align-items: center; color: #aab1bf; display: flex; font-size: 10px; gap: 5px; margin-top: 4px; }
#${SHELL_ID} .mooncord-status-dot { background: #45cf91; border-radius: 50%; height: 6px; width: 6px; }
#${SHELL_ID} .mooncord-nav, #${SHELL_ID} .mooncord-window-controls { align-items: center; display: flex; flex: 0 0 auto; gap: 2px; }
#${SHELL_ID} .mooncord-tabs { align-items: center; display: flex; flex: 1 1 auto; gap: 5px; min-width: 0; overflow: hidden; }
#${SHELL_ID} button { align-items: center; background: transparent; border: 0; border-radius: 7px; color: #b7bfce; cursor: pointer; display: inline-flex; font: inherit; justify-content: center; }
#${SHELL_ID} button:hover { background: rgba(255,255,255,.1); color: white; }
#${SHELL_ID} .mooncord-icon-button { font-size: 17px; height: 32px; width: 30px; }
#${SHELL_ID} .mooncord-tab { align-items: center; background: rgba(255,255,255,.045); border: 1px solid transparent; border-radius: 9px; color: #bdc4d1; cursor: pointer; display: flex; flex: 0 1 210px; gap: 8px; height: 34px; min-width: 90px; overflow: hidden; padding: 0 6px 0 10px; }
#${SHELL_ID} .mooncord-tab:hover { background: rgba(255,255,255,.09); color: white; }
#${SHELL_ID} .mooncord-tab.active { background: rgba(255,255,255,.14); border-color: rgba(255,255,255,.2); color: white; }
#${SHELL_ID} .mooncord-tab-icon { color: #e7e9ee; flex: 0 0 auto; font-size: 11px; }
#${SHELL_ID} .mooncord-tab-label { flex: 1 1 auto; font-size: 12px; overflow: hidden; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
#${SHELL_ID} .mooncord-tab-close { border-radius: 5px; flex: 0 0 auto; font-size: 15px; height: 22px; opacity: .75; width: 22px; }
#${SHELL_ID} .mooncord-tab-close:hover { background: rgba(255,255,255,.13); opacity: 1; }
#${SHELL_ID} .mooncord-add { flex: 0 0 auto; font-size: 20px; height: 32px; margin-left: 1px; width: 30px; }
#${SHELL_ID} .mooncord-tools { position: relative; }
#${SHELL_ID} .mooncord-tools-menu { background: #292c33; border: 1px solid #434751; border-radius: 9px; box-shadow: 0 12px 30px rgba(0,0,0,.45); display: none; min-width: 200px; padding: 5px; position: absolute; right: 0; top: 38px; }
#${SHELL_ID} .mooncord-tools-menu.open { display: block; }
#${SHELL_ID} .mooncord-menu-item { border-radius: 6px; display: block; font-size: 12px; padding: 9px 10px; text-align: left; width: 100%; }
#${SHELL_ID} .mooncord-window-button { font-size: 14px; height: 28px; width: 30px; }
#${SHELL_ID} .mooncord-window-button.close:hover { background: #d9536f; }
`;

function createButton(className: string, text: string, ariaLabel: string, action: string) {
    const button = document.createElement("button");
    button.className = className;
    button.type = "button";
    button.textContent = text;
    button.dataset.action = action;
    button.setAttribute("aria-label", ariaLabel);
    button.title = ariaLabel;
    return button;
}

export function installMooncordShell() {
    const install = async () => {
        if (!document.body || document.getElementById(SHELL_ID)) return;
        const style = document.createElement("style");
        style.textContent = shellCss;
        document.head.appendChild(style);

        const shell = document.createElement("div");
        shell.id = SHELL_ID;
        const brand = document.createElement("div");
        brand.className = "mooncord-brand";
        brand.innerHTML = `<span class="mooncord-mark"><img src="vesktop://static/discord.png" alt="" /></span><span class="mooncord-brand-copy"><span class="mooncord-brand-name">Mooncord</span><span class="mooncord-brand-status"><span class="mooncord-status-dot"></span>Discord</span></span>`;
        const nav = document.createElement("div");
        nav.className = "mooncord-nav";
        nav.append(
            createButton("mooncord-icon-button", "‹", "Atrás", "back"),
            createButton("mooncord-icon-button", "›", "Adelante", "forward"),
            createButton("mooncord-icon-button", "↻", "Recargar pestaña", "reload")
        );
        const tabsContainer = document.createElement("div");
        tabsContainer.className = "mooncord-tabs";
        tabsContainer.setAttribute("role", "tablist");
        tabsContainer.setAttribute("aria-label", "Pestañas de Mooncord");
        const tools = document.createElement("div");
        tools.className = "mooncord-tools";
        const toolsButton = createButton("mooncord-icon-button", "☷", "Herramientas", "tools");
        const menu = document.createElement("div");
        menu.className = "mooncord-tools-menu";
        menu.append(
            createButton("mooncord-menu-item", "Abrir DevTools (F12)", "Abrir DevTools", "devtools"),
            createButton("mooncord-menu-item", "Restablecer pestañas", "Restablecer pestañas", "reset-tabs"),
            createButton(
                "mooncord-menu-item",
                "Abrir ajustes de Discord",
                "Abrir ajustes de Discord",
                "discord-settings"
            )
        );
        tools.append(toolsButton, menu);
        const windowControls = document.createElement("div");
        windowControls.className = "mooncord-window-controls";
        windowControls.append(
            createButton("mooncord-window-button", "−", "Minimizar", "minimize"),
            createButton("mooncord-window-button", "□", "Maximizar", "maximize"),
            createButton("mooncord-window-button close", "×", "Cerrar", "close")
        );
        const addTabButton = createButton("mooncord-add", "+", "Nueva pestaña", "new-tab");
        shell.append(brand, nav, tabsContainer, addTabButton, tools, windowControls);
        document.body.append(shell);

        const native = window.MooncordShellNative;
        let currentState: MooncordTabsState = { tabs: [], activeId: "" };
        let lastSignature = "";
        addTabButton.addEventListener("click", event => {
            event.stopPropagation();
            if (currentState.tabs.length >= 8) {
                addTabButton.title = "Ya tienes el máximo de 8 pestañas. Cierra una para agregar otra.";
                return;
            }

            addTabButton.disabled = true;
            void native
                .createTab()
                .then(renderTabs)
                .catch(error => {
                    console.error("No se pudo crear la pestaña de Mooncord:", error);
                    addTabButton.title = "No se pudo crear la pestaña. Abre DevTools para ver el error.";
                })
                .finally(() => {
                    addTabButton.disabled = currentState.tabs.length >= 8;
                });
        });

        const renderTabs = (state: MooncordTabsState) => {
            currentState = state;
            addTabButton.disabled = state.tabs.length >= 8;
            addTabButton.title = addTabButton.disabled
                ? "Ya tienes el máximo de 8 pestañas. Cierra una para agregar otra."
                : "Nueva pestaña";
            const signature = `${state.activeId}|${state.tabs.map(tab => `${tab.id}:${tab.path}:${tab.title}`).join("\u0001")}`;
            if (signature === lastSignature) return;
            lastSignature = signature;
            tabsContainer.replaceChildren();
            for (const tab of state.tabs) {
                const tabElement = document.createElement("div");
                tabElement.className = `mooncord-tab${tab.id === state.activeId ? " active" : ""}`;
                tabElement.setAttribute("role", "tab");
                tabElement.setAttribute("aria-selected", String(tab.id === state.activeId));
                tabElement.title = tab.path;
                const icon = document.createElement("span");
                icon.className = "mooncord-tab-icon";
                icon.textContent = tab.id === state.activeId ? "●" : "○";
                const label = document.createElement("span");
                label.className = "mooncord-tab-label";
                label.textContent = tab.title;
                const close = createButton("mooncord-tab-close", "×", `Cerrar ${tab.title}`, "close-tab");
                close.addEventListener("click", event => {
                    event.stopPropagation();
                    void native.closeTab(tab.id);
                });
                tabElement.append(icon, label, close);
                tabElement.addEventListener("click", () => void native.selectTab(tab.id));
                tabsContainer.appendChild(tabElement);
            }
        };

        shell.addEventListener("click", event => {
            const action = (event.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action;
            if (!action) return;
            if (action === "back") void native.goBack();
            if (action === "forward") void native.goForward();
            if (action === "reload") void native.reload();
            if (action === "tools") menu.classList.toggle("open");
            if (action === "devtools") {
                menu.classList.remove("open");
                void native.toggleDevTools();
            }
            if (action === "reset-tabs") {
                menu.classList.remove("open");
                void native.resetTabs();
            }
            if (action === "discord-settings") {
                menu.classList.remove("open");
                void native.openDiscordSettings();
            }
            if (action === "minimize") void native.minimize();
            if (action === "maximize") void native.maximize();
            if (action === "close") void native.closeWindow();
        });
        document.addEventListener("click", event => {
            if (!tools.contains(event.target as Node)) menu.classList.remove("open");
        });
        window.addEventListener("keydown", event => {
            if (event.ctrlKey && event.key === "Tab" && currentState.tabs.length > 1) {
                event.preventDefault();
                const index = currentState.tabs.findIndex(tab => tab.id === currentState.activeId);
                const next = currentState.tabs[(index + 1) % currentState.tabs.length];
                if (next) void native.selectTab(next.id);
            }
        });

        native.onStateChanged(renderTabs);
        renderTabs(await native.getState());
    };

    if (document.readyState === "loading")
        document.addEventListener("DOMContentLoaded", () => void install(), { once: true });
    else void install();
}
