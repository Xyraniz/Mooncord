use std::{fs, io, path::PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct AppSettings {
    #[serde(default = "default_accent")]
    pub accent: [u8; 3],
    #[serde(default)]
    pub last_conversation_id: Option<String>,
    #[serde(default = "default_window_size")]
    pub window_size: [f32; 2],
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            accent: default_accent(),
            last_conversation_id: None,
            window_size: default_window_size(),
        }
    }
}

fn default_accent() -> [u8; 3] {
    [139, 156, 255]
}

fn default_window_size() -> [f32; 2] {
    [1320.0, 820.0]
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct Diagnostics {
    pub app_version: String,
    pub os: String,
    pub authenticated: bool,
    pub connection: String,
    pub conversation_count: usize,
    pub cached_message_count: usize,
}

impl Diagnostics {
    pub fn to_safe_text(&self) -> String {
        format!(
            "Mooncord Native diagnostics\napp_version={}\nos={}\nauthenticated={}\nconnection={}\nconversation_count={}\ncached_message_count={}\n",
            self.app_version,
            self.os,
            self.authenticated,
            self.connection,
            self.conversation_count,
            self.cached_message_count
        )
    }
}

#[derive(Clone, Debug)]
pub struct SettingsStore {
    path: PathBuf,
}

impl Default for SettingsStore {
    fn default() -> Self {
        Self::new(default_settings_path())
    }
}

impl SettingsStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn path(&self) -> &PathBuf {
        &self.path
    }

    pub fn load(&self) -> io::Result<AppSettings> {
        if !self.path.exists() {
            return Ok(AppSettings::default());
        }
        let contents = fs::read_to_string(&self.path)?;
        serde_json::from_str(&contents)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
    }

    pub fn save(&self, settings: &AppSettings) -> io::Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let contents = serde_json::to_string_pretty(settings)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
        fs::write(&self.path, contents)
    }

    pub fn clear_local_cache(&self) -> io::Result<()> {
        let cache_path = self
            .path
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .join("cache.json");
        match fs::remove_file(cache_path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error),
        }
    }

    pub fn export_diagnostics(&self, diagnostics: &Diagnostics) -> io::Result<PathBuf> {
        let destination = self
            .path
            .parent()
            .unwrap_or_else(|| std::path::Path::new("."))
            .join("mooncord-native-diagnostics.txt");
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&destination, diagnostics.to_safe_text())?;
        Ok(destination)
    }
}

fn default_settings_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("mooncord-native")
        .join("settings.json")
}

#[cfg(test)]
mod tests {
    use super::SettingsStore;
    #[test]
    fn missing_configuration_uses_defaults() {
        let path = std::env::temp_dir().join(format!(
            "mooncord-native-missing-{}-settings.json",
            std::process::id()
        ));
        let settings = SettingsStore::new(path);
        let loaded = settings.load().expect("missing config is not an error");
        assert_eq!(loaded.window_size, [1320.0, 820.0]);
    }
}
