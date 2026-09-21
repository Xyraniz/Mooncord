/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { makeRange, OptionType } from "@utils/types";
import type { Channel } from "@vencord/discord-types";
import { findStoreLazy } from "@webpack";
import { GuildChannelStore, Menu, React, RestAPI, UserStore } from "@webpack/common";

const VoiceStateStore = findStoreLazy("VoiceStateStore");

async function runSequential<T>(promises: Promise<T>[]): Promise<T[]> {
    const results: T[] = [];

    for (let i = 0; i < promises.length; i++) {
        const result = await promises[i];
        results.push(result);

        if (i % settings.store.waitAfter === 0) {
            await new Promise(resolve => setTimeout(resolve, settings.store.waitSeconds * 1000));
        }
    }

    return results;
}

function sendPatch(channel: Channel, body: Record<string, any>, bypass = false) {
    const usersVoice = VoiceStateStore.getVoiceStatesForChannel(channel.id);
    const myId = UserStore.getCurrentUser().id;

    const promises: Promise<any>[] = [];
    Object.keys(usersVoice).forEach(key => {
        const userVoice = usersVoice[key];

        if (bypass || userVoice.userId !== myId) {
            promises.push(RestAPI.patch({
                url: `/guilds/${channel.guild_id}/members/${userVoice.userId}`,
                body
            }));
        }
    });

    runSequential(promises).catch(error => {
        console.error("VoiceChatUtilities failed to run", error);
    });
}

interface VoiceChannelContextProps {
    channel: Channel;
}

const VoiceChannelContext: NavContextMenuPatchCallback = (children, { channel }: VoiceChannelContextProps) => {
    if (!channel || (channel.type !== 2 && channel.type !== 13)) return;

    const userCount = Object.keys(VoiceStateStore.getVoiceStatesForChannel(channel.id)).length;
    if (userCount === 0) return;

    const guildChannels: { VOCAL: { channel: Channel; comparator: number; }[]; } = GuildChannelStore.getChannels(channel.guild_id);
    const voiceChannels = guildChannels.VOCAL
        .map(({ channel }) => channel)
        .filter(({ id }) => id !== channel.id);

    children.splice(
        -1,
        0,
        <Menu.MenuItem
            label="Voice Tools"
            key="voice-tools"
            id="voice-tools"
        >
            <Menu.MenuItem
                key="voice-tools-disconnect-all"
                id="voice-tools-disconnect-all"
                label="Disconnect all"
                action={() => sendPatch(channel, { channel_id: null })}
            />

            <Menu.MenuItem
                key="voice-tools-mute-all"
                id="voice-tools-mute-all"
                label="Mute all"
                action={() => sendPatch(channel, { mute: true })}
            />

            <Menu.MenuItem
                key="voice-tools-unmute-all"
                id="voice-tools-unmute-all"
                label="Unmute all"
                action={() => sendPatch(channel, { mute: false })}
            />

            <Menu.MenuItem
                key="voice-tools-deafen-all"
                id="voice-tools-deafen-all"
                label="Deafen all"
                action={() => sendPatch(channel, { deaf: true })}
            />

            <Menu.MenuItem
                key="voice-tools-undeafen-all"
                id="voice-tools-undeafen-all"
                label="Undeafen all"
                action={() => sendPatch(channel, { deaf: false })}
            />

            <Menu.MenuItem
                label="Move all"
                key="voice-tools-move-all"
                id="voice-tools-move-all"
            >
                {voiceChannels.map(voiceChannel => (
                    <Menu.MenuItem
                        key={voiceChannel.id}
                        id={voiceChannel.id}
                        label={voiceChannel.name}
                        action={() => sendPatch(channel, { channel_id: voiceChannel.id }, true)}
                    />
                ))}
            </Menu.MenuItem>
        </Menu.MenuItem>
    );
};

const settings = definePluginSettings({
    waitAfter: {
        type: OptionType.SLIDER,
        description: "Amount of API actions to perform before waiting (to avoid rate limits)",
        default: 5,
        markers: makeRange(1, 20),
    },
    waitSeconds: {
        type: OptionType.SLIDER,
        description: "Time to wait between each action (in seconds)",
        default: 2,
        markers: makeRange(1, 10, .5),
    }
});

export default definePlugin({
    name: "VoiceChatUtilities",
    description: "This plugin allows you to perform multiple actions on an entire channel (move, mute, disconnect, etc.) (originally by dutake)",
    authors: [Devs.D3SOX],
    settings,
    contextMenus: {
        "channel-context": VoiceChannelContext
    }
});
