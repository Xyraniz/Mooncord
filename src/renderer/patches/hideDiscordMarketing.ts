/*
 * Mooncord, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Discord occasionally adds its desktop-download prompt from the renderer
 * after the initial React tree has mounted. Keep the fallback deliberately
 * narrow: remove only known download targets, never generic banners or
 * containers that could hold messages, calls, or settings.
 */

const MARKETING_SELECTORS = [
    "#app-download-button",
    '[data-testid="app-download-button"]',
    'a[href="https://discord.com/download"]',
    'a[href^="https://discord.com/download?"]'
].join(",");

const STYLE_ID = "mooncord-hide-discord-marketing";

function installMarketingCss() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `${MARKETING_SELECTORS} { display: none !important; }`;
    (document.head || document.documentElement).appendChild(style);
}

function inspectNode(node: Node) {
    if (!(node instanceof Element)) return;
    if (node.matches(MARKETING_SELECTORS)) node.remove();
    for (const element of node.querySelectorAll(MARKETING_SELECTORS)) element.remove();
}

if (document.readyState === "loading") {
    document.addEventListener(
        "DOMContentLoaded",
        () => {
            installMarketingCss();
            inspectNode(document.body);
        },
        { once: true }
    );
} else {
    installMarketingCss();
    inspectNode(document.body);
}

function observeDiscordDom() {
    const root = document.documentElement;
    if (!root) return;

    new MutationObserver(records => {
        for (const record of records) {
            for (const node of record.addedNodes) inspectNode(node);
        }
    }).observe(root, {
        childList: true,
        subtree: true
    });
}

if (document.documentElement) observeDiscordDom();
else document.addEventListener("DOMContentLoaded", observeDiscordDom, { once: true });
