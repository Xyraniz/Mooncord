/*
 * Mooncord, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * Discord sometimes offers to hand a link to the installed official client.
 * Mooncord is already the desktop client, so that hand-off is both redundant
 * and confusing. Keep this guard narrow: only Discord's native-app schemes
 * are blocked, while normal web, mail, media, and Mooncord URLs continue to
 * behave normally.
 */

const DISCORD_APP_PROTOCOLS = new Set(["discord:", "discordapp:", "discord-canary:", "discord-ptb:"]);
const HANDOFF_GUARD_KEY = "__mooncordDiscordAppHandoffGuard";

function isDiscordAppUrl(value: unknown): boolean {
    if (typeof value !== "string" && !(value instanceof URL)) return false;

    try {
        return DISCORD_APP_PROTOCOLS.has(new URL(String(value), window.location.href).protocol.toLowerCase());
    } catch {
        return false;
    }
}

function logBlockedHandoff(source: string) {
    console.info(`[Mooncord] Blocked Discord native-app hand-off (${source})`);
}

function getTargetUrl(target: EventTarget | null): string | undefined {
    if (!(target instanceof Element)) return undefined;

    const link = target.closest("a[href], [data-href], [data-url]");
    if (!link) return undefined;

    return link.getAttribute("href") ?? link.getAttribute("data-href") ?? link.getAttribute("data-url") ?? undefined;
}

function blockNativeAppClicks() {
    const blockClick = (event: Event) => {
        if (!isDiscordAppUrl(getTargetUrl(event.target))) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        logBlockedHandoff(event.type);
    };

    document.addEventListener("click", blockClick, true);
    document.addEventListener("auxclick", blockClick, true);
}

function blockNativeAppJavaScript() {
    const pageWindow = window as Window & { [HANDOFF_GUARD_KEY]?: boolean };
    if (pageWindow[HANDOFF_GUARD_KEY]) return;
    pageWindow[HANDOFF_GUARD_KEY] = true;

    const originalOpen = window.open;
    window.open = function (url?: string | URL, target?: string, features?: string) {
        if (isDiscordAppUrl(url)) {
            logBlockedHandoff("window.open");
            return null;
        }

        return originalOpen.call(window, url, target, features);
    };

    const anchorPrototype = HTMLAnchorElement.prototype;
    const originalAnchorClick = anchorPrototype.click;
    anchorPrototype.click = function () {
        if (isDiscordAppUrl(this.href)) {
            logBlockedHandoff("anchor.click");
            return;
        }

        return originalAnchorClick.call(this);
    };
}

function isDiscordAppHandoffDialog(element: Element): boolean {
    if (element.getAttribute("role") !== "dialog" && element.getAttribute("aria-modal") !== "true") return false;

    const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
    const mentionsDiscordApp =
        /(aplicaci[oó]n de discord detectada|discord app detected|open discord app|abrir aplicaci[oó]n)/i.test(text);
    const offersBrowserContinuation = /(continuar en el navegador|continue in browser)/i.test(text);

    return mentionsDiscordApp && offersBrowserContinuation;
}

function removeDiscordAppHandoffDialog(node: Node) {
    if (!(node instanceof Element)) return;

    const candidates = [node, ...node.querySelectorAll('[role="dialog"], [aria-modal="true"]')];
    for (const candidate of candidates) {
        if (!isDiscordAppHandoffDialog(candidate)) continue;
        candidate.remove();
        logBlockedHandoff("dialog");
    }
}

function installDiscordAppHandoffGuard() {
    blockNativeAppClicks();
    blockNativeAppJavaScript();

    const inspectDocument = () => {
        if (document.body) removeDiscordAppHandoffDialog(document.body);
    };

    const observeDocument = () => {
        if (!document.documentElement) return;

        inspectDocument();
        new MutationObserver(records => {
            for (const record of records) {
                for (const node of record.addedNodes) removeDiscordAppHandoffDialog(node);
            }
        }).observe(document.documentElement, { childList: true, subtree: true });
    };

    if (document.readyState === "loading")
        document.addEventListener("DOMContentLoaded", observeDocument, { once: true });
    else observeDocument();
}

installDiscordAppHandoffGuard();
