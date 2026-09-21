use std::fmt;

use crate::models::User;

#[derive(Clone)]
pub struct LoginCredentials {
    pub email: String,
    pub password: String,
}

impl LoginCredentials {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.email.trim().is_empty() {
            return Err("Escribe tu correo o teléfono de Discord.");
        }
        if self.password.is_empty() {
            return Err("Escribe tu contraseña.");
        }
        Ok(())
    }
}

impl fmt::Debug for LoginCredentials {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("LoginCredentials")
            .field("email", &self.email)
            .field("password", &"[REDACTED]")
            .finish()
    }
}

#[derive(Clone)]
pub struct AuthSession {
    pub user: User,
    pub(crate) token: String,
}

impl AuthSession {
    pub(crate) fn new(user: User, token: String) -> Self {
        Self { user, token }
    }

    pub(crate) fn token(&self) -> &str {
        &self.token
    }
}

impl fmt::Debug for AuthSession {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AuthSession")
            .field("user", &self.user)
            .field("token", &"[REDACTED]")
            .finish()
    }
}
