use thiserror::Error;

#[derive(Debug, Error, Clone, Eq, PartialEq)]
pub enum DiscordError {
    #[error("authentication failed: {0}")]
    Authentication(String),
    #[error("authentication is required")]
    AuthenticationRequired,
    #[error("permission denied: {0}")]
    PermissionDenied(String),
    #[error("request was rate limited; retry after {retry_after_ms} ms")]
    RateLimited { retry_after_ms: u64 },
    #[error("network error: {0}")]
    Network(String),
    #[error("protocol error: {0}")]
    Protocol(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("secure storage error: {0}")]
    Storage(String),
    #[error("operation cancelled")]
    Cancelled,
    #[error("request failed with HTTP status {status}: {message}")]
    Http { status: u16, message: String },
    #[error("operation failed: {0}")]
    Other(String),
}

impl DiscordError {
    pub fn is_permission_error(&self) -> bool {
        matches!(
            self,
            Self::PermissionDenied(_) | Self::Http { status: 403, .. }
        )
    }

    pub fn is_auth_error(&self) -> bool {
        matches!(
            self,
            Self::Authentication(_) | Self::AuthenticationRequired | Self::Http { status: 401, .. }
        )
    }
}

#[cfg(test)]
mod tests {
    use super::DiscordError;

    #[test]
    fn permission_errors_are_classified_explicitly() {
        let error = DiscordError::PermissionDenied("DM access is unavailable".to_owned());
        assert!(error.is_permission_error());
        assert!(!error.is_auth_error());
        assert!(error.to_string().contains("permission denied"));
    }
}
