# Mooncord

<p align="center">
  <img src="static/discord.png" alt="Mooncord" width="96">
</p>

<p align="center"><strong>A focused, dark Discord desktop client with Mooncord's own shell and Vencord integration.</strong></p>

Mooncord loads the official Discord web client inside a desktop application and adds a lightweight native shell around it: custom window controls, tabs, a dark monochrome visual system, DevTools access, and a small set of targeted client-side improvements.

Mooncord is not affiliated with Discord Inc. You still sign in through Discord's normal web interface; Mooncord does not require a Discord token or a separate account system.

## What Mooncord includes

- A custom Mooncord title bar with window controls and lightweight navigation tabs.
- Discord's real-time web client, including messages, servers, calls, notifications, and account settings.
- Vencord integration for optional client plugins. Vencord is an integration layer in Mooncord, not a second Discord client or a replacement for Discord's service.
- A dark, monochrome Mooncord theme and branded splash, tray, and application icons.
- Dynamic background throttling: the foreground window remains responsive, while a hidden or minimized window lets Chromium reduce timer and rendering work.
- Lazy Rich Presence (`arRPC`): the worker stays stopped unless Rich Presence is enabled.
- Targeted removal of known Discord desktop-download promotions without hiding generic Discord layout containers.
- A persistent portable data directory so cookies, settings, and the Discord session survive closing and reopening the portable executable.
- `F12` or the Tools menu to open DevTools when troubleshooting the client.

## Getting Mooncord

The repository currently provides the source tree and the portable Windows build configuration. To create a portable executable yourself, follow the build instructions below. The generated file is written to:

```text
dist-portable/Mooncord Client <version>.exe
```

## Requirements

- Git
- Node.js `>=22`
- pnpm `>=11` (`pnpm@11.9.0` is the repository package manager)
- Windows x64 for the tested portable target

Enable Corepack if pnpm is not installed yet:

```sh
corepack enable
corepack prepare pnpm@11.9.0 --activate
```

## Development

Clone the repository and install dependencies:

```sh
git clone https://github.com/Xyraniz/Mooncord.git
cd Mooncord
pnpm install
```

Run the client from source:

```sh
pnpm start
```

Useful development commands:

```sh
# Build the renderer, preload, and main-process bundles
pnpm build

# Build in development mode
pnpm build:dev

# Run TypeScript validation without emitting files
pnpm testTypes

# Run ESLint
pnpm lint

# Build and launch the development client
pnpm start:dev

# Watch source files and rebuild during development
pnpm start:watch
```

## Creating a Windows portable build

The normal Electron Builder commands are available for platform-specific development builds:

```sh
pnpm package
pnpm package:dir
```

For the validated Mooncord portable x64 executable, use the repository's portable configuration:

```sh
pnpm build
pnpm exec electron-builder --config electron-builder-portable.json --x64
```

The output is created at:

```text
dist-portable/Mooncord Client 1.6.7.exe
```

The version in the filename follows `package.json`, so it may change in future releases.

## Portable data and session persistence

When the portable executable is running, Mooncord stores its persistent data beside the executable:

```text
dist-portable/
├─ Mooncord Client <version>.exe
└─ Data/
```

The `Data` directory contains the application's settings and the browser session data used by Discord. Keep it if you want to remain signed in. Delete it only when you intentionally want to reset Mooncord's local state and sign in again.

`dist-portable/` and `Data/` are ignored by Git so local accounts, cookies, caches, and build artifacts are not committed accidentally.

## Rich Presence and plugins

Rich Presence is disabled by default in Mooncord. It can be enabled from the client settings when needed; enabling it starts the `arRPC` worker on demand, and disabling it stops the worker.

Vencord plugins remain optional. Enable only the plugins you use, since each plugin can add work to Discord's renderer or network-facing features. Mooncord's shell and performance changes are separate from Vencord plugin configuration.

## Troubleshooting

1. Open Mooncord's Tools menu or press `F12` to open DevTools.
2. Check the Console for renderer errors and the Network panel for failed Discord requests.
3. Confirm that the executable can write to the directory containing `Data/`.
4. If the local profile is corrupted, close Mooncord and move `Data/` somewhere safe before launching again. This resets the local profile without deleting it permanently.
5. If Discord changes its web layout or download-promotion selectors, the targeted renderer patch may need to be updated.

Passkey prompts are intentionally disabled inside Mooncord so launching the client does not unexpectedly open the Windows Security passkey dialog. Use another Discord login method if an account requires a passkey.

## Project structure

```text
src/main/       Electron main process, window lifecycle, settings, tray, and arRPC
src/preload/    Native bridge and the Mooncord shell injected around Discord
src/renderer/   Discord/Vencord renderer patches and client fixes
static/         Splash, branding, and static application assets
build/          Application icon and build resources
```

## Credits and licensing

Mooncord builds on the open-source Electron desktop architecture and Vencord integration used by the upstream project this repository originated from. Upstream notices and third-party licenses remain in the repository; see [LICENSE](LICENSE) and the relevant package directories before redistributing a build.

Mooncord itself is distributed under the GNU General Public License v3.0 or later. See [LICENSE](LICENSE) for the complete license text.
