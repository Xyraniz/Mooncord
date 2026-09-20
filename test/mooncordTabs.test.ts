import assert from "node:assert/strict";
import test from "node:test";

import {
    canLoadMooncordTab,
    getFallbackActiveMooncordTabId,
    getMooncordTabBounds,
    MAX_MOONCORD_TABS,
    moveMooncordTab,
    MOONCORD_TAB_TITLE_MAX_LENGTH,
    normalizeCustomMooncordTabTitle,
    restoreMooncordTabs,
    sanitizeDiscordPath
} from "../src/shared/mooncordTabs";

const HOME_PATH = "/channels/@me";
const ORIGIN = "https://discord.com";

function pathTitle(path: string, index: number) {
    if (path.startsWith("/channels/@me/")) return `Chat ${index}`;
    if (path.startsWith("/channels/")) return "Canal de Discord";
    return "Inicio";
}

function idFactory(prefix = "tab") {
    let next = 0;
    return () => `${prefix}-${++next}`;
}

test("restores legacy tabs, validates paths and selects the stored active tab", () => {
    const createId = idFactory();
    const restored = restoreMooncordTabs({
        storedTabs: [
            { id: "first", path: "/channels/123/456", title: "General" },
            { id: "second", path: "https://outside.example", title: "Other" }
        ],
        storedActiveId: "second",
        homePath: HOME_PATH,
        createId,
        safePath: path => sanitizeDiscordPath(path, ORIGIN, HOME_PATH),
        pathTitle
    });

    assert.equal(restored.activeId, "second");
    assert.equal(restored.tabs[1].path, HOME_PATH);
    assert.equal(restored.tabs[0].title, "General");
});

test("deep links select an existing matching tab or add one without exceeding the limit", () => {
    const storedTabs = Array.from({ length: MAX_MOONCORD_TABS }, (_, index) => ({
        id: `tab-${index}`,
        path: `/channels/${index}/general`,
        title: `Tab ${index}`
    }));

    const existing = restoreMooncordTabs({
        storedTabs,
        initialPath: "/channels/4/general",
        homePath: HOME_PATH,
        createId: idFactory("deep-link"),
        safePath: path => sanitizeDiscordPath(path, ORIGIN, HOME_PATH),
        pathTitle
    });
    assert.equal(existing.activeId, "tab-4");
    assert.equal(existing.tabs.length, MAX_MOONCORD_TABS);

    const added = restoreMooncordTabs({
        storedTabs,
        initialPath: "/channels/999/general",
        homePath: HOME_PATH,
        createId: idFactory("deep-link"),
        safePath: path => sanitizeDiscordPath(path, ORIGIN, HOME_PATH),
        pathTitle
    });
    assert.equal(added.activeId, "deep-link-1");
    assert.equal(added.tabs.length, MAX_MOONCORD_TABS);
    assert.equal(added.tabs[0].path, "/channels/999/general");
    assert.equal(added.tabs.some(tab => tab.id === "tab-7"), false);
});

test("restoration caps tab count, repairs duplicate IDs and keeps custom names optional", () => {
    const restored = restoreMooncordTabs({
        storedTabs: [
            { id: "duplicate", path: HOME_PATH, title: "Home", customTitle: "   Team   " },
            { id: "duplicate", path: "/channels/1/2", title: "General", customTitle: " " },
            ...Array.from({ length: MAX_MOONCORD_TABS }, (_, index) => ({
                id: `extra-${index}`,
                path: HOME_PATH,
                title: "Extra"
            }))
        ],
        homePath: HOME_PATH,
        maxTabs: 3,
        createId: idFactory(),
        safePath: path => sanitizeDiscordPath(path, ORIGIN, HOME_PATH),
        pathTitle
    });

    assert.equal(restored.tabs.length, 3);
    assert.equal(new Set(restored.tabs.map(tab => tab.id)).size, 3);
    assert.equal(restored.tabs[0].customTitle, "Team");
    assert.equal(restored.tabs[1].customTitle, undefined);
});

test("path validation keeps Discord routes and rejects external, relative and protocol-relative paths", () => {
    assert.equal(sanitizeDiscordPath("/channels/123/456?q=1#message", ORIGIN, HOME_PATH), "/channels/123/456?q=1#message");
    assert.equal(sanitizeDiscordPath("https://evil.example/path", ORIGIN, HOME_PATH), HOME_PATH);
    assert.equal(sanitizeDiscordPath("//evil.example/path", ORIGIN, HOME_PATH), HOME_PATH);
    assert.equal(sanitizeDiscordPath("channels/123", ORIGIN, HOME_PATH), HOME_PATH);
});

test("closing an active tab chooses the previous tab, or the first remaining tab", () => {
    const tabs = [{ id: "first" }, { id: "second" }, { id: "third" }];
    assert.equal(getFallbackActiveMooncordTabId([tabs[0], tabs[2]], 1), "first");
    assert.equal(getFallbackActiveMooncordTabId([tabs[1], tabs[2]], 0), "second");
    assert.equal(getFallbackActiveMooncordTabId([], 0), "");
});

test("a crashed tab is eligible for an explicit reload without reloading ready tabs", () => {
    assert.equal(canLoadMooncordTab("crashed"), true);
    assert.equal(canLoadMooncordTab("idle"), true);
    assert.equal(canLoadMooncordTab("loading"), false);
    assert.equal(canLoadMooncordTab("loaded"), false);
});

test("reordering moves the same tab records and leaves unrelated order intact", () => {
    const tabs = [{ id: "first" }, { id: "second" }, { id: "third" }];
    const reordered = moveMooncordTab(tabs, "third", "first");

    assert.deepEqual(reordered.map(tab => tab.id), ["third", "first", "second"]);
    assert.equal(reordered[0], tabs[2]);
    assert.equal(reordered[1], tabs[0]);
    assert.deepEqual(moveMooncordTab(tabs, "first", "third", true).map(tab => tab.id), ["second", "third", "first"]);
});

test("tab bounds keep the content below the shared toolbar height", () => {
    assert.deepEqual(getMooncordTabBounds(940, 500), { x: 0, y: 54, width: 940, height: 446 });
    assert.equal(getMooncordTabBounds(800, 40).height, 0);
});

test("custom tab names are trimmed and bounded", () => {
    assert.equal(normalizeCustomMooncordTabTitle("  Team chat  "), "Team chat");
    assert.equal(normalizeCustomMooncordTabTitle("  "), undefined);
    assert.equal(normalizeCustomMooncordTabTitle("x".repeat(100))?.length, MOONCORD_TAB_TITLE_MAX_LENGTH);
});
