/*
 * Mooncord, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button, Card, HeadingTertiary, Paragraph } from "@vencord/types/components";
import { useAwaiter } from "@vencord/types/utils";

import { cl } from "./Settings";

export function OutdatedMooncordWarning() {
    const [isOutdated] = useAwaiter(MooncordNative.app.isOutdated);

    if (!isOutdated) return null;

    return (
        <Card variant="warning" className={cl("updater-card")}>
            <HeadingTertiary>Your Mooncord is outdated!</HeadingTertiary>
            <Paragraph>Staying up to date is important for security and stability.</Paragraph>

            <Button onClick={() => MooncordNative.app.openUpdater()} variant="secondary">
                Open Updater
            </Button>
        </Card>
    );
}
