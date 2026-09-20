/*
 * Mooncord, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { app, protocol } from "electron";

import { handleMooncordStaticProtocol } from "./mooncordStatic";
import { handleMooncordAssetsProtocol } from "./userAssets";

app.whenReady().then(() => {
    protocol.handle("mooncord", async req => {
        const url = new URL(req.url);

        switch (url.hostname) {
            case "assets":
                return handleMooncordAssetsProtocol(url.pathname, req);
            case "static":
                return handleMooncordStaticProtocol(url.pathname, req);
            default:
                return new Response(null, { status: 404 });
        }
    });
});

protocol.registerSchemesAsPrivileged([
    {
        scheme: "mooncord",
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
            stream: true
        }
    }
]);
