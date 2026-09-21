use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct FriendRequest {
    pub user_identifier: String,
}

impl FriendRequest {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.user_identifier.trim().is_empty() {
            Err("Escribe un nombre de usuario o identificador.")
        } else {
            Ok(())
        }
    }
}
