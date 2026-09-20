/*
 * venmic is an optional native dependency used only for Linux audio capture.
 * The package is intentionally not installed on Windows, but the shared
 * TypeScript sources still reference its public types.
 */

declare module "@vencord/venmic" {
    export type Node = Record<string, string | undefined>;

    export type LinkData = {
        mute?: boolean;
        include: Node[];
        exclude: Node[];
        only_speakers?: boolean;
        ignore_devices?: boolean;
        only_default_speakers?: boolean;
        workaround?: Node[];
    };

    export class PatchBay {
        static hasPipeWire(): boolean;
        list(filters?: string[]): Node[];
        link(data: LinkData): void;
        unmute(): void;
        unlink(): void;
    }
}
