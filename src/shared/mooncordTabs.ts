/*
 * Mooncord, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export const MAX_MOONCORD_TABS = 8;
export const MAX_AUTOMATIC_MOONCORD_TAB_RETRIES = 5;
export const MOONCORD_TOOLBAR_HEIGHT = 54;
export const MOONCORD_TAB_TITLE_MAX_LENGTH = 48;

export function getMooncordTabRetryDelay(retryAttempt: number): number | null {
    if (!Number.isInteger(retryAttempt) || retryAttempt < 1 || retryAttempt > MAX_AUTOMATIC_MOONCORD_TAB_RETRIES)
        return null;

    return Math.min(1000 * 2 ** (retryAttempt - 1), 16_000);
}

export interface MooncordTabRecord {
    id: string;
    path: string;
    title: string;
    customTitle?: string;
}

export type MooncordTabLoadStatus = "idle" | "loading" | "loaded" | "crashed" | "unresponsive" | "suspended";

export interface MooncordTabInfo extends MooncordTabRecord {
    loadStatus: MooncordTabLoadStatus;
}

export interface MooncordTabsState {
    tabs: MooncordTabInfo[];
    activeId: string;
}

export function canLoadMooncordTab(status: MooncordTabLoadStatus) {
    return status === "idle" || status === "crashed" || status === "unresponsive" || status === "suspended";
}

export interface RestoreMooncordTabsOptions {
    storedTabs: readonly unknown[];
    storedActiveId?: string;
    initialPath?: string;
    homePath: string;
    maxTabs?: number;
    createId(): string;
    safePath(path: unknown): string;
    pathTitle(path: string, index: number): string;
}

export function sanitizeDiscordPath(path: unknown, origin: string, homePath: string): string {
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return homePath;
    try {
        const url = new URL(path, origin);
        return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : homePath;
    } catch {
        return homePath;
    }
}

export function normalizeCustomMooncordTabTitle(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const title = value.trim().slice(0, MOONCORD_TAB_TITLE_MAX_LENGTH).trim();
    return title || undefined;
}

function normalizeStoredTabs(
    storedTabs: readonly unknown[],
    maxTabs: number,
    createId: () => string,
    safePath: (path: unknown) => string,
    pathTitle: (path: string, index: number) => string
): MooncordTabRecord[] {
    const ids = new Set<string>();
    const normalized: MooncordTabRecord[] = [];

    for (const [index, entry] of storedTabs.slice(0, maxTabs).entries()) {
        const tab = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
        const path = safePath(tab.path);
        let id = typeof tab.id === "string" && tab.id ? tab.id : createId();
        while (ids.has(id)) id = createId();
        ids.add(id);

        const title = typeof tab.title === "string" && tab.title ? tab.title : pathTitle(path, index + 1);
        const customTitle = normalizeCustomMooncordTabTitle(tab.customTitle);
        normalized.push({ id, path, title, ...(customTitle ? { customTitle } : {}) });
    }

    return normalized;
}

export function restoreMooncordTabs({
    storedTabs,
    storedActiveId,
    initialPath,
    homePath,
    maxTabs = MAX_MOONCORD_TABS,
    createId,
    safePath,
    pathTitle
}: RestoreMooncordTabsOptions): { tabs: MooncordTabRecord[]; activeId: string } {
    let tabs = normalizeStoredTabs(storedTabs, maxTabs, createId, safePath, pathTitle);
    let activeId = tabs.some(tab => tab.id === storedActiveId) ? storedActiveId! : (tabs[0]?.id ?? "");

    if (initialPath) {
        const path = safePath(initialPath);
        const existing = tabs.find(tab => tab.path === path);
        if (existing) activeId = existing.id;
        else {
            let id = createId();
            while (tabs.some(tab => tab.id === id)) id = createId();
            tabs.unshift({ id, path, title: pathTitle(path, 1) });
            activeId = id;
        }
    }

    if (!tabs.length) tabs.push({ id: createId(), path: homePath, title: "Inicio" });
    tabs = tabs.slice(0, maxTabs);
    if (!tabs.some(tab => tab.id === activeId)) activeId = tabs[0].id;

    return { tabs, activeId };
}

export function getFallbackActiveMooncordTabId(tabs: readonly Pick<MooncordTabRecord, "id">[], removedIndex: number) {
    return tabs[Math.max(0, removedIndex - 1)]?.id ?? tabs[0]?.id ?? "";
}

export function moveMooncordTab<T extends Pick<MooncordTabRecord, "id">>(
    tabs: readonly T[],
    sourceId: string,
    targetId: string,
    after = false
): T[] {
    if (sourceId === targetId) return [...tabs];

    const sourceIndex = tabs.findIndex(tab => tab.id === sourceId);
    const targetIndex = tabs.findIndex(tab => tab.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return [...tabs];

    const reordered = [...tabs];
    const [source] = reordered.splice(sourceIndex, 1);
    const adjustedTargetIndex = reordered.findIndex(tab => tab.id === targetId);
    reordered.splice(adjustedTargetIndex + (after ? 1 : 0), 0, source);
    return reordered;
}

export function getMooncordTabBounds(width: number, height: number) {
    return {
        x: 0,
        y: MOONCORD_TOOLBAR_HEIGHT,
        width,
        height: Math.max(0, height - MOONCORD_TOOLBAR_HEIGHT)
    };
}
