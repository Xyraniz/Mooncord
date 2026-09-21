use std::sync::Arc;

use chrono::Utc;
use futures_util::StreamExt;
use tokio::sync::{RwLock, broadcast};
use tokio_stream::wrappers::BroadcastStream;

use crate::{
    auth::{AuthSession, LoginCredentials},
    models::{Attachment, Conversation, Message, User},
};

use super::{
    DiscordError,
    provider::{ConnectionStatus, DiscordEvent, DiscordProvider, EventStream},
};

#[derive(Clone)]
pub struct DemoProvider {
    user: User,
    conversations: Arc<Vec<Conversation>>,
    messages: Arc<Vec<Message>>,
    authenticated: Arc<RwLock<bool>>,
    events: broadcast::Sender<DiscordEvent>,
}

impl Default for DemoProvider {
    fn default() -> Self {
        let user = demo_user("demo-user", "moonwalker", "Moonwalker", "0001");
        let luna = demo_user("demo-luna", "luna", "Luna", "0420");
        let noa = demo_user("demo-noa", "noa", "Noa", "1337");
        let kai = demo_user("demo-kai", "kai", "Kai", "2468");
        let mira = demo_user("demo-mira", "mira", "Mira", "9999");

        let luna_conversation = Conversation {
            id: "demo-conversation".to_owned(),
            kind: 1,
            name: None,
            recipients: vec![luna.clone()],
            last_message_id: Some("demo-message-2".to_owned()),
        };
        let noa_conversation = Conversation {
            id: "demo-noa".to_owned(),
            kind: 1,
            name: None,
            recipients: vec![noa.clone()],
            last_message_id: Some("demo-noa-message-4".to_owned()),
        };
        let group_conversation = Conversation {
            id: "demo-group".to_owned(),
            kind: 3,
            name: Some("Luna, Noa y Kai".to_owned()),
            recipients: vec![luna.clone(), noa.clone(), kai.clone()],
            last_message_id: Some("demo-group-message-48".to_owned()),
        };
        let empty_conversation = Conversation {
            id: "demo-empty".to_owned(),
            kind: 1,
            name: None,
            recipients: vec![mira],
            last_message_id: None,
        };

        let now = Utc::now();
        let mut messages = vec![
            Message {
                id: "demo-message-1".to_owned(),
                channel_id: luna_conversation.id.clone(),
                author: luna.clone(),
                content:
                    "Bienvenido a Mooncord Native. Este proveedor demo no hace solicitudes de red."
                        .to_owned(),
                timestamp: (now - chrono::Duration::minutes(5)).to_rfc3339(),
                ..Message::default()
            },
            Message {
                id: "demo-message-2".to_owned(),
                channel_id: luna_conversation.id.clone(),
                author: user.clone(),
                content: "La UI está preparada para DMs, eventos y reconexión.".to_owned(),
                attachments: vec![Attachment {
                    id: "demo-attachment-1".to_owned(),
                    filename: "mooncord-demo.png".to_owned(),
                    size: 2_048,
                    url: "https://cdn.discordapp.com/embed/avatars/0.png".to_owned(),
                    proxy_url: Some("https://media.discordapp.net/embed/avatars/0.png".to_owned()),
                    width: Some(128),
                    height: Some(128),
                    content_type: Some("image/png".to_owned()),
                    ephemeral: false,
                }],
                timestamp: now.to_rfc3339(),
                ..Message::default()
            },
        ];

        for (index, (author, content)) in [
            (
                noa.clone(),
                "Este DM secundario sirve para probar cambios rápidos de conversación.",
            ),
            (
                user.clone(),
                "La selección debe conservar el compositor y el foco.",
            ),
            (
                noa.clone(),
                "También puedes probar la búsqueda de conversaciones.",
            ),
            (
                user.clone(),
                "Los mensajes fallidos usan [demo-send-error].",
            ),
        ]
        .into_iter()
        .enumerate()
        {
            messages.push(Message {
                id: format!("demo-noa-message-{}", index + 1),
                channel_id: noa_conversation.id.clone(),
                author,
                content: content.to_owned(),
                timestamp: (now - chrono::Duration::minutes((4 - index) as i64)).to_rfc3339(),
                ..Message::default()
            });
        }

        let group_authors = [user.clone(), luna, noa, kai];
        for index in 0..49 {
            let author = group_authors[index % group_authors.len()].clone();
            let days_ago = (48 - index) / 16;
            let minutes_ago = (48 - index) % 16;
            messages.push(Message {
                id: format!("demo-group-message-{}", index),
                channel_id: group_conversation.id.clone(),
                author,
                content: format!(
                    "Mensaje de prueba {:02} del grupo. Cambia de chat y vuelve para comprobar que el historial sigue estable.",
                    index + 1
                ),
                timestamp: (now
                    - chrono::Duration::days(days_ago as i64)
                    - chrono::Duration::minutes(minutes_ago as i64))
                .to_rfc3339(),
                ..Message::default()
            });
        }

        let (events, _) = broadcast::channel(64);
        Self {
            user,
            conversations: Arc::new(vec![
                luna_conversation,
                group_conversation,
                noa_conversation,
                empty_conversation,
            ]),
            messages: Arc::new(messages),
            authenticated: Arc::new(RwLock::new(false)),
            events,
        }
    }
}

fn demo_user(id: &str, username: &str, global_name: &str, discriminator: &str) -> User {
    User {
        id: id.to_owned(),
        username: username.to_owned(),
        global_name: Some(global_name.to_owned()),
        discriminator: Some(discriminator.to_owned()),
        avatar: None,
        bot: false,
    }
}

impl DemoProvider {
    pub fn new() -> Self {
        Self::default()
    }

    async fn require_authentication(&self) -> Result<(), DiscordError> {
        if *self.authenticated.read().await {
            Ok(())
        } else {
            Err(DiscordError::AuthenticationRequired)
        }
    }
}

#[async_trait::async_trait]
impl DiscordProvider for DemoProvider {
    async fn authenticate(
        &self,
        credentials: LoginCredentials,
    ) -> Result<AuthSession, DiscordError> {
        credentials
            .validate()
            .map_err(|error| DiscordError::InvalidInput(error.to_owned()))?;
        *self.authenticated.write().await = true;
        let _ = self
            .events
            .send(DiscordEvent::Connection(ConnectionStatus::Connected));
        let _ = self.events.send(DiscordEvent::Ready {
            user: self.user.clone(),
        });
        Ok(AuthSession::new(
            self.user.clone(),
            "demo-session".to_owned(),
        ))
    }

    async fn restore_session(&self) -> Result<Option<AuthSession>, DiscordError> {
        Ok(None)
    }

    async fn logout(&self) -> Result<(), DiscordError> {
        *self.authenticated.write().await = false;
        let _ = self.events.send(DiscordEvent::SessionEnded);
        Ok(())
    }

    async fn current_user(&self) -> Result<User, DiscordError> {
        self.require_authentication().await?;
        Ok(self.user.clone())
    }

    async fn list_conversations(&self) -> Result<Vec<Conversation>, DiscordError> {
        self.require_authentication().await?;
        Ok((*self.conversations).clone())
    }

    async fn list_messages(
        &self,
        conversation_id: &str,
        _before: Option<&str>,
        _limit: u32,
    ) -> Result<Vec<Message>, DiscordError> {
        self.require_authentication().await?;
        Ok(self
            .messages
            .iter()
            .filter(|message| message.channel_id == conversation_id)
            .cloned()
            .collect())
    }

    async fn send_message(
        &self,
        conversation_id: &str,
        content: &str,
    ) -> Result<Message, DiscordError> {
        self.require_authentication().await?;
        if content.contains("[demo-send-error]") {
            return Err(DiscordError::Network("demo send failure".to_owned()));
        }
        if content.trim().is_empty() {
            return Err(DiscordError::InvalidInput(
                "message content cannot be empty".to_owned(),
            ));
        }
        let message = Message {
            id: format!("demo-outgoing-{}", uuid::Uuid::new_v4()),
            channel_id: conversation_id.to_owned(),
            author: self.user.clone(),
            content: content.to_owned(),
            timestamp: Utc::now().to_rfc3339(),
            ..Message::default()
        };
        let _ = self
            .events
            .send(DiscordEvent::MessageCreate(message.clone()));
        Ok(message)
    }

    async fn subscribe_events(&self) -> Result<EventStream, DiscordError> {
        let stream = BroadcastStream::new(self.events.subscribe()).map(|item| match item {
            Ok(event) => Ok(event),
            Err(error) => Err(DiscordError::Other(format!("event stream lagged: {error}"))),
        });
        Ok(Box::pin(stream))
    }

    async fn add_friend(&self, user_identifier: &str) -> Result<(), DiscordError> {
        self.require_authentication().await?;
        if user_identifier.trim().is_empty() {
            return Err(DiscordError::InvalidInput(
                "friend identifier cannot be empty".to_owned(),
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::DemoProvider;
    use crate::{auth::LoginCredentials, discord::DiscordProvider};

    fn credentials() -> LoginCredentials {
        LoginCredentials {
            email: "demo@example.com".to_owned(),
            password: "not-logged".to_owned(),
        }
    }

    #[tokio::test]
    async fn demo_provider_authenticates_and_lists_dms() {
        let provider = DemoProvider::new();
        provider
            .authenticate(credentials())
            .await
            .expect("demo login");
        let conversations = provider.list_conversations().await.expect("Dms");
        assert_eq!(conversations.len(), 4);
        assert!(
            conversations
                .iter()
                .any(|conversation| conversation.kind == 3)
        );
        assert!(
            conversations
                .iter()
                .any(|conversation| conversation.id == "demo-empty")
        );
    }

    #[tokio::test]
    async fn demo_provider_exposes_long_group_history() {
        let provider = DemoProvider::new();
        provider
            .authenticate(credentials())
            .await
            .expect("demo login");
        let messages = provider
            .list_messages("demo-group", None, 100)
            .await
            .expect("group messages");
        assert_eq!(messages.len(), 49);
        assert!(
            messages
                .iter()
                .all(|message| message.channel_id == "demo-group")
        );
        let luna_messages = provider
            .list_messages("demo-conversation", None, 100)
            .await
            .expect("luna messages");
        assert_eq!(luna_messages[1].attachments.len(), 1);
    }

    #[tokio::test]
    async fn demo_provider_exposes_failed_send() {
        let provider = DemoProvider::new();
        provider
            .authenticate(credentials())
            .await
            .expect("demo login");
        let error = provider
            .send_message("demo-conversation", "[demo-send-error]")
            .await
            .expect_err("the demo should fail this send");
        assert!(error.to_string().contains("demo send failure"));
    }

    #[tokio::test]
    async fn logout_clears_demo_session() {
        let provider = DemoProvider::new();
        provider
            .authenticate(credentials())
            .await
            .expect("demo login");
        provider.logout().await.expect("logout");
        assert!(provider.current_user().await.is_err());
    }
}
