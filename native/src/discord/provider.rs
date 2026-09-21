use std::pin::Pin;

use async_trait::async_trait;
use futures_util::Stream;

use crate::{
    auth::{AuthSession, LoginCredentials},
    models::{Conversation, Message, User},
};

use super::DiscordError;

pub type EventStream = Pin<Box<dyn Stream<Item = Result<DiscordEvent, DiscordError>> + Send>>;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ConnectionStatus {
    Connecting,
    Connected,
    Reconnecting { attempt: u32 },
    Disconnected { reason: String },
}

#[derive(Clone, Debug)]
pub enum DiscordEvent {
    Connection(ConnectionStatus),
    Ready {
        user: User,
    },
    MessageCreate(Message),
    MessageUpdate(Message),
    MessageDelete {
        channel_id: String,
        message_id: String,
    },
    SessionEnded,
}

#[async_trait]
pub trait DiscordProvider: Send + Sync {
    async fn authenticate(
        &self,
        credentials: LoginCredentials,
    ) -> Result<AuthSession, DiscordError>;
    async fn restore_session(&self) -> Result<Option<AuthSession>, DiscordError>;
    async fn logout(&self) -> Result<(), DiscordError>;
    async fn shutdown(&self) -> Result<(), DiscordError> {
        self.logout().await
    }
    async fn current_user(&self) -> Result<User, DiscordError>;
    async fn list_conversations(&self) -> Result<Vec<Conversation>, DiscordError>;
    async fn list_messages(
        &self,
        conversation_id: &str,
        before: Option<&str>,
        limit: u32,
    ) -> Result<Vec<Message>, DiscordError>;
    async fn send_message(
        &self,
        conversation_id: &str,
        content: &str,
    ) -> Result<Message, DiscordError>;
    async fn subscribe_events(&self) -> Result<EventStream, DiscordError>;
    async fn add_friend(&self, user_identifier: &str) -> Result<(), DiscordError>;
}
