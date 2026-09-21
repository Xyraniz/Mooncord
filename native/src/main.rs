#![allow(dead_code)]

mod app;
mod auth;
mod discord;
mod models;
mod storage;
mod ui;

use std::sync::Arc;

use auth::{KeyringSecretStore, SecretStore};
use discord::{DemoProvider, DiscordProvider, OfficialDiscordProvider};

fn main() {
    let log_filter = std::env::var("MOONCORD_NATIVE_LOG").unwrap_or_else(|_| "warn".to_owned());
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::new(log_filter))
        .with_target(false)
        .init();

    let runtime = Arc::new(tokio::runtime::Runtime::new().expect("Tokio runtime must start"));
    let provider: Arc<dyn DiscordProvider> =
        if std::env::var("MOONCORD_NATIVE_DEMO").as_deref() == Ok("1") {
            Arc::new(DemoProvider::new())
        } else {
            let secrets: Arc<dyn SecretStore> = Arc::new(KeyringSecretStore::default());
            Arc::new(OfficialDiscordProvider::new(secrets))
        };
    let app = app::NativeApp::new(runtime, provider);
    if let Err(error) = app.run() {
        eprintln!("Mooncord Native could not start: {error}");
    }
}
