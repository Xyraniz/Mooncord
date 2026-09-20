/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { localStorage } from "./utils";

function isDiscordNativeProtocol(value: string | URL) {
    try {
        const protocol = new URL(String(value), location.href).protocol.toLowerCase();
        return ["discord:", "discordapp:", "discord-canary:", "discord-ptb:"].includes(protocol);
    } catch {
        return false;
    }
}

// Discord web may offer to hand a page to the installed official client by
// emitting a custom protocol. Mooncord is already the client, so block only
// those protocols and keep normal HTTPS links and popouts untouched.
const nativeWindowOpen = window.open.bind(window);
window.open = ((url?: string | URL, target?: string, features?: string) => {
    if (url != null && isDiscordNativeProtocol(url)) return null;
    return nativeWindowOpen(url, target, features);
}) as typeof window.open;

document.addEventListener(
    "click",
    event => {
        const element = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>("a[href]");
        if (element && isDiscordNativeProtocol(element.href)) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    },
    true
);

// Make clicking Notifications focus the window
const originalSetOnClick = Object.getOwnPropertyDescriptor(Notification.prototype, "onclick")!.set!;
Object.defineProperty(Notification.prototype, "onclick", {
    set(onClick) {
        originalSetOnClick.call(this, function (this: unknown) {
            onClick.apply(this, arguments);
            VesktopNative.win.focus();
        });
    },
    configurable: true
});

// Hide "Download Discord Desktop now!!!!" banner
localStorage.setItem("hideNag", "true");
