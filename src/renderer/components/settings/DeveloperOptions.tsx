/*
 * Mooncord, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button, Heading, Paragraph, TextButton } from "@vencord/types/components";
import { Margins, useForceUpdater } from "@vencord/types/utils";
import { Modal, openModal, Toasts } from "@vencord/types/webpack/common";
import { Settings } from "shared/settings";

import { cl, SettingsComponent } from "./Settings";

export const DeveloperOptionsButton: SettingsComponent = ({ settings }) => {
    return <Button onClick={() => openDeveloperOptionsModal(settings)}>Open Developer Settings</Button>;
};

function openDeveloperOptionsModal(settings: Settings) {
    openModal(props => (
        <Modal {...props} size="lg" title="Mooncord Developer Options">
            <Heading tag="h4">Vencord Location</Heading>
            <VencordLocationPicker settings={settings} />

            <Heading tag="h4" className={Margins.top16}>
                Debugging
            </Heading>
            <div className={cl("button-grid")}>
                <Button onClick={() => MooncordNative.debug.launchGpu()}>Open chrome://gpu</Button>
                <Button onClick={() => MooncordNative.debug.launchWebrtcInternals()}>
                    Open chrome://webrtc-internals
                </Button>
            </div>
        </Modal>
    ));
}

const VencordLocationPicker: SettingsComponent = ({ settings }) => {
    const forceUpdate = useForceUpdater();
    const usingCustomVencordDir = MooncordNative.fileManager.isUsingCustomVencordDir();

    return (
        <>
            <Paragraph>
                Vencord files are loaded from{" "}
                {usingCustomVencordDir ? (
                    <TextButton
                        variant="link"
                        onClick={e => {
                            e.preventDefault();
                            MooncordNative.fileManager.showCustomVencordDir();
                        }}
                    >
                        a custom location
                    </TextButton>
                ) : (
                    "the default location"
                )}
            </Paragraph>
            <div className={cl("button-grid")}>
                <Button
                    onClick={async () => {
                        const choice = await MooncordNative.fileManager.selectVencordDir();
                        switch (choice) {
                            case "cancelled":
                                break;
                            case "ok":
                                Toasts.show({
                                    message: "Vencord install changed. Fully restart Mooncord to apply.",
                                    id: Toasts.genId(),
                                    type: Toasts.Type.SUCCESS
                                });
                                break;
                            case "invalid":
                                Toasts.show({
                                    message:
                                        "You did not choose a valid Vencord install. Make sure you're selecting the dist dir!",
                                    id: Toasts.genId(),
                                    type: Toasts.Type.FAILURE
                                });
                                break;
                        }
                        forceUpdate();
                    }}
                >
                    Change
                </Button>
                <Button
                    variant="dangerPrimary"
                    onClick={async () => {
                        await MooncordNative.fileManager.selectVencordDir(null);
                        forceUpdate();
                    }}
                >
                    Reset
                </Button>
            </div>
        </>
    );
};
