/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { contextBridge, ipcRenderer, webFrame } from "electron/renderer";

import { IpcEvents } from "../shared/IpcEvents";
import { VesktopNative } from "./VesktopNative";

contextBridge.exposeInMainWorld("VesktopNative", VesktopNative);

const MOONCORD_PAGE_PASSKEY_GUARD = `(() => {
    const credentials = navigator.credentials;
    const denied = () => Promise.reject(new DOMException("Passkeys are disabled in Mooncord", "NotAllowedError"));
    const isPublicKeyRequest = options => Boolean(options && options.publicKey);

    if (credentials && !credentials.__mooncordPasskeyGuard) {
        for (const key of ["get", "create"]) {
            const original = credentials[key];
            if (typeof original !== "function") continue;

            const wrapped = function(options) {
                return isPublicKeyRequest(options) ? denied() : original.call(this, options);
            };

            try {
                Object.defineProperty(credentials, key, { configurable: true, value: wrapped });
            } catch {
                // Keep Discord working if Chromium exposes the API as read-only.
            }
        }

        try {
            Object.defineProperty(credentials, "__mooncordPasskeyGuard", { value: true });
        } catch {
            // This marker is only used to avoid wrapping the same page twice.
        }
    }

    const publicKeyCredential = globalThis.PublicKeyCredential;
    if (publicKeyCredential) {
        for (const key of ["isUserVerifyingPlatformAuthenticatorAvailable", "isConditionalMediationAvailable"]) {
            try {
                Object.defineProperty(publicKeyCredential, key, { configurable: true, value: async () => false });
            } catch {
                // Keep loading if Chromium marks a static method read-only.
            }
        }
    }
})();`;

// Discord's login page can automatically start a WebAuthn passkey request.
// In a desktop client this produces a native Windows Security dialog on every
// launch, even when the user wants to use QR or password login. Block only
// public-key credential operations inside Mooncord; Windows Hello itself and
// all non-passkey credential APIs remain untouched.
function disableAutomaticPasskeys() {
    const credentials = navigator.credentials as
        | (CredentialsContainer & {
              __mooncordPasskeyGuard?: boolean;
          })
        | null;
    if (!credentials || credentials.__mooncordPasskeyGuard) return;

    const prototype = Object.getPrototypeOf(credentials) as CredentialsContainer;
    const originalGet = prototype.get.bind(credentials);
    const originalCreate = prototype.create.bind(credentials);
    const isPublicKeyRequest = (options: CredentialRequestOptions | CredentialCreationOptions | undefined) =>
        Boolean(options && "publicKey" in options && options.publicKey);
    const denied = () => Promise.reject(new DOMException("Passkeys are disabled in Mooncord", "NotAllowedError"));

    Object.defineProperty(prototype, "get", {
        configurable: true,
        value(options: CredentialRequestOptions) {
            return isPublicKeyRequest(options) ? denied() : originalGet(options);
        }
    });
    Object.defineProperty(prototype, "create", {
        configurable: true,
        value(options?: CredentialCreationOptions) {
            return isPublicKeyRequest(options) ? denied() : originalCreate(options);
        }
    });
    Object.defineProperty(credentials, "__mooncordPasskeyGuard", { value: true });

    const publicKeyCredential = globalThis.PublicKeyCredential as typeof PublicKeyCredential | undefined;
    if (publicKeyCredential) {
        publicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async () => false;
        publicKeyCredential.isConditionalMediationAvailable = async () => false;
    }
}

disableAutomaticPasskeys();

// The regular preload runs in Electron's isolated world. Inject the same
// narrow guard into world 0 so Discord itself sees the disabled passkey APIs.
void webFrame
    .executeJavaScriptInIsolatedWorld(0, [{ code: MOONCORD_PAGE_PASSKEY_GUARD }])
    .catch(error => console.warn("Unable to install the Mooncord page passkey guard:", error));

// While sandboxed, Electron "polyfills" these APIs as local variables.
// We have to pass them as arguments as they are not global
Function(
    "require",
    "Buffer",
    "process",
    "clearImmediate",
    "setImmediate",
    ipcRenderer.sendSync(IpcEvents.GET_VENCORD_PRELOAD_SCRIPT)
)(require, Buffer, process, clearImmediate, setImmediate);

webFrame.executeJavaScript(ipcRenderer.sendSync(IpcEvents.GET_VENCORD_RENDERER_SCRIPT));
webFrame.executeJavaScript(ipcRenderer.sendSync(IpcEvents.GET_VESKTOP_RENDERER_SCRIPT));
