/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button, Paragraph } from "@vencord/types/components";
import { Toasts } from "@vencord/types/webpack/common";

import type { SettingsComponent } from "./Settings";

export const ImportVencordSettings: SettingsComponent = () => (
    <>
        <Paragraph>Import settings from an existing Vencord installation. Mooncord restarts to apply them.</Paragraph>
        <Button
            onClick={async () => {
                try {
                    const result = await VesktopNative.settings.importVencordSettings();
                    if (result === "ok") {
                        Toasts.show({
                            message: "Vencord settings imported. Mooncord will restart now.",
                            id: Toasts.genId(),
                            type: Toasts.Type.SUCCESS
                        });
                        window.setTimeout(() => void VesktopNative.app.relaunch(), 900);
                        return;
                    }

                    const message =
                        result === "not-found"
                            ? "No existing Vencord settings folder was found."
                            : result === "empty"
                              ? "The existing Vencord settings folder is empty."
                              : "Could not import Vencord settings. Check the Mooncord logs for details.";
                    Toasts.show({ message, id: Toasts.genId(), type: Toasts.Type.FAILURE });
                } catch (error) {
                    console.error("Failed to import Vencord settings:", error);
                    Toasts.show({
                        message: "Could not import Vencord settings. Check the Mooncord logs for details.",
                        id: Toasts.genId(),
                        type: Toasts.Type.FAILURE
                    });
                }
            }}
        >
            Import Vencord Settings and Restart
        </Button>
    </>
);
