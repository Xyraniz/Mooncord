# Mooncord agent notes

## Repository boundaries

Mooncord contains two separate clients that must remain independent:

- `src/`, `Vencord/`, and `static/` are the existing Electron/Vencord client.
- `native/` is Mooncord Native, a standalone Rust client with its own Cargo
  project, UI assets, authentication, storage, REST provider, and Gateway
  handling.

Do not move, delete, or import Electron/Vencord runtime code into `native/`.
Do not make the Native client load Discord Web. Its HTML/CSS/JS is bundled as
local UI only; Discord communication is implemented in Rust. Changes to one
client should not silently alter the other.

## Native development

Run these commands from the repository root:

```powershell
pnpm native:check
pnpm native:test
pnpm native:build
pnpm native:run
```

The Windows release binary is generated at
`native/target/release/mooncord-native.exe`. Equivalent Cargo commands can be
run with `--manifest-path native/Cargo.toml`.

The Native UI is local HTML/CSS/JS rendered in the native window. The Rust
`DiscordProvider` abstraction keeps the UI independent from the official and
demo providers. Private conversations are sorted by Discord's
`last_message_id`; live message events and sent messages update that order.
Message attachments are modeled in `native/src/models/message.rs` and image
attachments are rendered by the local UI.

## Demo mode and diagnostics

Use demo mode when testing layout, scrolling, message grouping, attachments,
failed sends, or chat switching without touching a real account:

```powershell
$env:MOONCORD_NATIVE_DEMO = "1"
pnpm native:run
```

For additional Rust diagnostics, set:

```powershell
$env:MOONCORD_NATIVE_LOG = "mooncord_native=debug"
```

Logs should contain only lifecycle state, HTTP status codes, counts, and
connection information. Never log passwords, tokens, attachment URLs when
they could contain secrets, or message contents.

## Windows UI debugging

For visible application testing, use the `codex-computer-run` / Computer Use
skill. Enumerate the exact `mooncord-native` window, verify its handle before
input, then use screenshots, coordinate clicks, keyboard input, and scrolling
to reproduce the issue. Always account for the window's screen-space bounds
when translating screenshot coordinates. Close the exact window handle after
testing and verify that no `mooncord-native` process remains.

Prefer the demo provider for repeatable UI checks. Use a real Discord session
only when the user explicitly authorizes the specific inspection. Do not send
messages, log out, or expose credentials unless that action is explicitly in
scope. Never ask the user to share a Discord password.

## Validation before committing

At minimum, run:

```powershell
cargo fmt --manifest-path native/Cargo.toml -- --check
cargo clippy --manifest-path native/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path native/Cargo.toml
cargo build --release --manifest-path native/Cargo.toml
pnpm testTypes
pnpm test:unit
pnpm build
```

Also check `git diff --check` and confirm that unrelated files under
`src/`, `Vencord/`, and `static/` were not changed.
