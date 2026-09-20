/*
 * Mooncord, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}
