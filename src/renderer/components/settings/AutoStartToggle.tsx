/*
 * Mooncord, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { useState } from "@vencord/types/webpack/common";

import { MooncordSettingsSwitch } from "./MooncordSettingsSwitch";
import { SettingsComponent } from "./Settings";

export const AutoStartToggle: SettingsComponent = ({ settings }) => {
    const [autoStartEnabled, setAutoStartEnabled] = useState(MooncordNative.autostart.isEnabled());

    return (
        <>
            <MooncordSettingsSwitch
                title="Start With System"
                description="Automatically start Mooncord on computer start-up"
                value={autoStartEnabled}
                onChange={async v => {
                    await MooncordNative.autostart[v ? "enable" : "disable"]();
                    setAutoStartEnabled(v);
                }}
            />

            <MooncordSettingsSwitch
                title="Auto Start Minimized"
                description={"Start Mooncord minimized when starting with system"}
                value={settings.autoStartMinimized}
                onChange={v => (settings.autoStartMinimized = v)}
                disabled={!autoStartEnabled}
            />
        </>
    );
};
