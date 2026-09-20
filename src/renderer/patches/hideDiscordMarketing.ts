/*
 * Discord occasionally adds its desktop-download prompt from the renderer
 * after the initial React tree has mounted. Keep the fallback deliberately
 * narrow: remove only known download targets, never generic banners or
 * containers that could hold messages, calls, or settings.
 */

const MARKETING_SELECTORS = [
    "#app-download-button",
    "[data-testid=\"app-download-button\"]",
    "a[href=\"https://discord.com/download\"]",
    "a[href^=\"https://discord.com/download?\"]"
].join(",");

let removalScheduled = false;

function removeDiscordDownloadPrompts() {
    removalScheduled = false;

    for (const element of document.querySelectorAll<HTMLElement>(MARKETING_SELECTORS)) {
        const banner = element.closest<HTMLElement>('[role="banner"]');
        (banner || element).remove();
    }
}

function scheduleRemoval() {
    if (removalScheduled) return;
    removalScheduled = true;
    requestAnimationFrame(removeDiscordDownloadPrompts);
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleRemoval, { once: true });
} else {
    scheduleRemoval();
}

function observeDiscordDom() {
    const root = document.documentElement;
    if (!root) return;

    new MutationObserver(scheduleRemoval).observe(root, {
        childList: true,
        subtree: true
    });
}

if (document.documentElement) observeDiscordDom();
else document.addEventListener("DOMContentLoaded", observeDiscordDom, { once: true });
