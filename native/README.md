# Mooncord Native

Mooncord Native is a second client in the Mooncord repository. It is a native
Rust application for private Discord conversations, separate from the existing
Electron/Vencord application.

## Separation from the Electron client

The current client is still the code in `src/`, `Vencord/`, `static/`, and the
existing root `package.json` scripts. Nothing from that runtime is imported by
Rust, and nothing in the Electron client was moved into this directory.

Mooncord Native uses stable Rust with `tao` for the native window and `wry` to
render HTML/CSS/JS that is compiled into the executable from `assets/ui/`.
This is only a local presentation layer: it contains no Discord Web page,
iframe, remote script, remote stylesheet, or navigation to Discord. The
`with_navigation_handler` and new-window handler reject every navigation except
the local initial document. On Windows, wry uses the operating system's
WebView2 runtime as a renderer; that is not Electron and it is never pointed at
Discord Web. REST and Gateway networking code remains in Rust behind the
`DiscordProvider` trait, so the UI is not coupled to the official or demo
implementation.

## Current scope

The initial version contains:

- direct Discord email/phone and password authentication based on the flow used
  by [Discordo](https://github.com/ayn2op/discordo), using Discord's `/auth/login`
  endpoint;
- secure token storage through the operating-system credential store via the
  `keyring` crate; passwords are never stored;
- current-user loading, private conversation loading, message history, sending,
  logout, and token deletion;
- an authorized-session Gateway architecture with bounded reconnect backoff,
  connection state, event deduplication, stable message ordering, edits,
  deletes, and clean cancellation on logout/exit;
- add-friend UI and a small, non-secret diagnostics export;
- a dark local HTML UI with a native navigation rail, DM list, chat panel,
  composer, connection/synchronization status, legal notice, and profile
  panel.

Servers, server channels, roles, moderation, voice, video, streaming,
activities, attachment uploads, GIFs, stickers, embeds, reactions, threads,
and complex Markdown are deliberately outside this version. Received image
attachments are rendered inline; other received files are shown as basic file
cards without upload or download workflows.

## Authentication and Discord policy

This is an unofficial client. The login implementation makes a real request
with the credentials entered by the user and never pretends that a permission
error means “no messages”. Discord can require MFA, CAPTCHA, rate limits, or
other interactive checks; those responses are surfaced as explicit errors
instead of bypassed or simulated. A token is kept only in the OS credential
store and is removed by logout.

Discord's policies can change, and using an unofficial client or automating a
user account may violate Discord's Terms of Service. Client modifications may
result in account restrictions or termination. Review Discord's current
policies before using this software; you are responsible for your account.

The Gateway is started only after a successful authenticated session and is
cancelled on logout or application exit. It is not used to create a second
account or to hide access failures. If Discord does not authorize the session,
the client reports the failure.

## Build on Windows

Install stable Rust and run from the repository root:

```powershell
cargo fmt --manifest-path native/Cargo.toml --all -- --check
cargo clippy --manifest-path native/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path native/Cargo.toml
cargo build --release --manifest-path native/Cargo.toml
```

The release binary is:

```text
native/target/release/mooncord-native.exe
```

On Windows, the executable expects the Microsoft WebView2 Runtime to be
available because it renders the bundled local document through the system
renderer. This runtime is not Discord Web, does not provide the Discord site,
and Mooncord Native does not navigate it to any Discord URL.

The equivalent root scripts are:

```powershell
pnpm native:check
pnpm native:test
pnpm native:build
pnpm native:run
```

For a safe local UI preview without contacting Discord, set the demo flag:

```powershell
$env:MOONCORD_NATIVE_DEMO = "1"
pnpm native:run
```

The demo provider is an explicit test/development provider. It is not used by
the normal application path and never stores a token.

## Local data

Preferences, the last selected conversation, and window-related preferences
are stored under the platform configuration directory in
`mooncord-native/settings.json`. The initial implementation keeps only a
bounded in-memory message cache. Logout deletes the secure token; the profile
panel also exposes cache deletion and a diagnostics export. Diagnostics contain
only version, platform, state, and counts—never credentials, tokens, message
content, or password text.

## Project layout

```text
native/
├── Cargo.toml
├── Cargo.lock
├── README.md
├── assets/
└── src/
    ├── main.rs
    ├── app/          # UI-facing state and asynchronous actions
    ├── auth/         # login session and secure credential storage
    ├── discord/      # provider trait, REST provider, demo, Gateway, errors
    ├── models/       # users, conversations, messages, friend requests
    ├── storage/      # bounded cache and non-secret settings
    └── ui/           # local HTML bridge, IPC actions, and serialized view state

The HTML UI is not a second web client. JavaScript sends small typed IPC
actions to Rust; Rust performs authentication, REST requests, Gateway event
handling, caching, ordering, deduplication, and secure storage, then sends a
sanitized view state back to the local document.
```
