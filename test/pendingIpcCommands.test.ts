import assert from "node:assert/strict";
import test from "node:test";

import { PendingIpcCommands } from "../src/main/utils/pendingIpcCommands";

test("pending commands accept only a response from the requesting WebContents", async () => {
    const pending = new PendingIpcCommands();
    const response = pending.register<string>("nonce-1", 10, 1_000);

    assert.equal(pending.resolve("nonce-1", 11, true, "wrong tab"), false);
    assert.equal(pending.resolve("nonce-1", 10, true, "ok"), true);
    assert.equal(await response, "ok");
});

test("pending commands reject when their WebContents exits", async () => {
    const pending = new PendingIpcCommands();
    const first = pending.register("nonce-1", 10, 1_000);
    const second = pending.register("nonce-2", 10, 1_000);
    const other = pending.register("nonce-3", 11, 1_000);

    assert.equal(pending.rejectForWebContents(10, new Error("renderer exited")), 2);
    await assert.rejects(first, /renderer exited/);
    await assert.rejects(second, /renderer exited/);
    assert.equal(pending.hasPendingForWebContents(10), false);
    assert.equal(pending.resolve("nonce-3", 11, true, "ok"), true);
    await other;
});

test("pending commands time out and ignore late replies", async () => {
    const pending = new PendingIpcCommands();
    const response = pending.register("nonce-timeout", 15, 10);

    await assert.rejects(response, /timed out/);
    assert.equal(pending.resolve("nonce-timeout", 15, true, "late"), false);
});
