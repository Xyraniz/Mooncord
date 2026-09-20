/*
 * Mooncord, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { setBadge } from "renderer/appBadge";

import { MooncordSettingsSwitch } from "./MooncordSettingsSwitch";
import { SettingsComponent } from "./Settings";

export const NotificationBadgeToggle: SettingsComponent = ({ settings }) => {
    return (
        <MooncordSettingsSwitch
            title="Notification Badge"
            description="Show mention badge on the app icon"
            value={settings.appBadge}
            onChange={v => {
                settings.appBadge = v;
                if (v) setBadge();
                else MooncordNative.app.setBadgeCount(0);
            }}
        />
    );
};
