use std::{collections::HashMap, sync::Mutex};

use thiserror::Error;

const SERVICE_NAME: &str = "mooncord-native";
const ACCOUNT_NAME: &str = "discord-session-token";

#[derive(Debug, Error)]
pub enum SecretStoreError {
    #[error("secure storage is unavailable: {0}")]
    Backend(String),
}

pub trait SecretStore: Send + Sync {
    fn load_token(&self) -> Result<Option<String>, SecretStoreError>;
    fn save_token(&self, token: &str) -> Result<(), SecretStoreError>;
    fn delete_token(&self) -> Result<(), SecretStoreError>;
}

#[derive(Clone, Debug)]
pub struct KeyringSecretStore {
    service: String,
    account: String,
}

impl Default for KeyringSecretStore {
    fn default() -> Self {
        Self {
            service: SERVICE_NAME.to_owned(),
            account: ACCOUNT_NAME.to_owned(),
        }
    }
}

impl KeyringSecretStore {
    pub fn new(service: impl Into<String>, account: impl Into<String>) -> Self {
        Self {
            service: service.into(),
            account: account.into(),
        }
    }

    fn entry(&self) -> Result<keyring::Entry, SecretStoreError> {
        keyring::Entry::new(&self.service, &self.account)
            .map_err(|error| SecretStoreError::Backend(error.to_string()))
    }
}

impl SecretStore for KeyringSecretStore {
    fn load_token(&self) -> Result<Option<String>, SecretStoreError> {
        match self.entry()?.get_password() {
            Ok(token) => Ok(Some(token)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(SecretStoreError::Backend(error.to_string())),
        }
    }

    fn save_token(&self, token: &str) -> Result<(), SecretStoreError> {
        self.entry()?
            .set_password(token)
            .map_err(|error| SecretStoreError::Backend(error.to_string()))
    }

    fn delete_token(&self) -> Result<(), SecretStoreError> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(SecretStoreError::Backend(error.to_string())),
        }
    }
}

#[derive(Default)]
pub struct MemorySecretStore {
    values: Mutex<HashMap<String, String>>,
}

impl MemorySecretStore {
    pub fn new() -> Self {
        Self::default()
    }
}

impl SecretStore for MemorySecretStore {
    fn load_token(&self) -> Result<Option<String>, SecretStoreError> {
        Ok(self
            .values
            .lock()
            .expect("memory secret store mutex is not poisoned")
            .get(ACCOUNT_NAME)
            .cloned())
    }

    fn save_token(&self, token: &str) -> Result<(), SecretStoreError> {
        self.values
            .lock()
            .expect("memory secret store mutex is not poisoned")
            .insert(ACCOUNT_NAME.to_owned(), token.to_owned());
        Ok(())
    }

    fn delete_token(&self) -> Result<(), SecretStoreError> {
        self.values
            .lock()
            .expect("memory secret store mutex is not poisoned")
            .remove(ACCOUNT_NAME);
        Ok(())
    }
}

pub fn redact_secret(secret: &str) -> String {
    if secret.is_empty() {
        return "[empty]".to_owned();
    }
    "[REDACTED]".to_owned()
}

#[cfg(test)]
mod tests {
    use super::{MemorySecretStore, SecretStore, redact_secret};

    #[test]
    fn memory_store_round_trips_without_plaintext_logs() {
        let store = MemorySecretStore::new();
        store
            .save_token("super-secret-token")
            .expect("save succeeds");
        assert_eq!(
            store.load_token().expect("load succeeds"),
            Some("super-secret-token".to_owned())
        );
        assert_eq!(redact_secret("super-secret-token"), "[REDACTED]");
        assert!(!redact_secret("super-secret-token").contains("super-secret-token"));
        store.delete_token().expect("delete succeeds");
        assert_eq!(store.load_token().expect("load succeeds"), None);
    }
}
