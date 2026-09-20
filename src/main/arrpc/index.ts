/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2023 Vendicated and Vencord contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { SESSION_DATA_DIR } from "main/constants";
import { join, resolve } from "path";
import { IpcCommands } from "shared/IpcEvents";
import { MessageChannel, MessagePort, Worker } from "worker_threads";

import { sendRendererCommand } from "../ipcCommands";
import { Settings } from "../settings";
import { ArRpcEvent, ArRpcHostEvent } from "./types";

let worker: Worker | undefined;
let hostPort: MessagePort | undefined;

const inviteCodeRegex = /^(\w|-)+$/;

export async function initArRPC() {
    if (worker || !Settings.store.arRPC) return;

    process.env.ARRPC_DETECTABLE_CACHE_PATH = join(SESSION_DATA_DIR, "arrpc-detectable-db.json");

    try {
        const { port1, port2: workerPort } = new MessageChannel();
        const port = port1;
        hostPort = port;

        worker = new Worker(resolve(__dirname, "./arRpcWorker.js"), {
            workerData: {
                workerPort
            },
            transferList: [workerPort]
        });

        port.on("message", async ({ type, nonce, data }: ArRpcEvent) => {
            switch (type) {
                case "activity": {
                    void sendRendererCommand(IpcCommands.RPC_ACTIVITY, data).catch(error => {
                        console.warn("Could not forward Rich Presence to the active Discord tab:", error);
                    });
                    break;
                }

                case "invite": {
                    const invite = String(data);

                    const response: ArRpcHostEvent = {
                        type: "ack-invite",
                        nonce,
                        data: false
                    };

                    if (!inviteCodeRegex.test(invite)) {
                        return port.postMessage(response);
                    }

                    response.data = await sendRendererCommand(IpcCommands.RPC_INVITE, invite).catch(() => false);

                    port.postMessage(response);
                    break;
                }

                case "link": {
                    const response: ArRpcHostEvent = {
                        type: "ack-link",
                        nonce: nonce,
                        data: false
                    };

                    response.data = await sendRendererCommand(IpcCommands.RPC_DEEP_LINK, data).catch(() => false);

                    port.postMessage(response);
                    break;
                }
            }
        });
    } catch (e) {
        console.error("Failed to start arRPC server", e);
        stopArRPC();
    }
}

export function stopArRPC() {
    hostPort?.close();
    hostPort = undefined;
    void worker?.terminate();
    worker = undefined;
}

Settings.addChangeListener("arRPC", enabled => {
    if (enabled) void initArRPC();
    else stopArRPC();
});
