/*
 * Mooncord, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const native = window.MooncordNative;
if (native) {
    let activeMedia = 0;
    let activeCalls = 0;
    let activeUploads = 0;
    let reportTimer: ReturnType<typeof setTimeout> | undefined;

    const report = (patch: Record<string, boolean>) => {
        if (reportTimer) clearTimeout(reportTimer);
        reportTimer = setTimeout(() => {
            reportTimer = undefined;
            native.tabActivity.report({
                mediaActive: activeMedia > 0,
                callActive: activeCalls > 0,
                uploadActive: activeUploads > 0,
                ...patch
            });
        }, 100);
    };

    const { mediaDevices } = navigator;
    if (mediaDevices) {
        for (const method of ["getUserMedia", "getDisplayMedia"] as const) {
            const original = mediaDevices[method]?.bind(mediaDevices);
            if (!original) continue;
            mediaDevices[method] = (async (...args: Parameters<MediaDevices[typeof method]>) => {
                const stream = await original(...args);
                activeCalls++;
                activeMedia += stream.getTracks().length || 1;
                report({});
                for (const track of stream.getTracks()) {
                    track.addEventListener(
                        "ended",
                        () => {
                            activeMedia = Math.max(0, activeMedia - 1);
                            activeCalls = Math.max(0, activeCalls - 1);
                            report({});
                        },
                        { once: true }
                    );
                }
                return stream;
            }) as MediaDevices[typeof method];
        }
    }

    document.addEventListener(
        "play",
        event => {
            if (event.target instanceof HTMLMediaElement) {
                activeMedia++;
                report({ mediaActive: true });
            }
        },
        true
    );
    for (const eventName of ["pause", "ended"] as const) {
        document.addEventListener(
            eventName,
            event => {
                if (event.target instanceof HTMLMediaElement) {
                    activeMedia = Math.max(0, activeMedia - 1);
                    report({});
                }
            },
            true
        );
    }

    const markUpload = () => {
        activeUploads++;
        report({ uploadActive: true });
        window.setTimeout(() => {
            activeUploads = Math.max(0, activeUploads - 1);
            report({});
        }, 60_000);
    };
    document.addEventListener(
        "change",
        event => {
            if (event.target instanceof HTMLInputElement && event.target.type === "file") markUpload();
        },
        true
    );
    document.addEventListener(
        "drop",
        event => {
            if (event.dataTransfer?.files.length) markUpload();
        },
        true
    );
}
