/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface MooncordTabInfo {
    id: string;
    path: string;
    title: string;
}

export interface MooncordTabsState {
    tabs: MooncordTabInfo[];
    activeId: string;
}
