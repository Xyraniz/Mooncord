use std::{future::Future, sync::Arc};

use futures_util::StreamExt;
use tokio::{runtime::Runtime, sync::mpsc};

use crate::{
    auth::{AuthSession, LoginCredentials},
    discord::{DiscordError, DiscordEvent, DiscordProvider},
    models::{Conversation, Message},
};

pub enum ActionResult {
    Restored(Result<Option<AuthSession>, DiscordError>),
    Authenticated(Result<AuthSession, DiscordError>),
    Conversations(Result<Vec<Conversation>, DiscordError>),
    Messages {
        conversation_id: String,
        result: Result<Vec<Message>, DiscordError>,
    },
    Sent {
        conversation_id: String,
        result: Result<Message, DiscordError>,
    },
    LoggedOut(Result<(), DiscordError>),
    FriendAdded(Result<(), DiscordError>),
    Event(Result<DiscordEvent, DiscordError>),
}

pub struct ActionController {
    runtime: Arc<Runtime>,
    provider: Arc<dyn DiscordProvider>,
    sender: mpsc::UnboundedSender<ActionResult>,
    receiver: mpsc::UnboundedReceiver<ActionResult>,
    event_loop_started: bool,
}

impl ActionController {
    pub fn new(runtime: Arc<Runtime>, provider: Arc<dyn DiscordProvider>) -> Self {
        let (sender, receiver) = mpsc::unbounded_channel();
        Self {
            runtime,
            provider,
            sender,
            receiver,
            event_loop_started: false,
        }
    }

    pub fn restore(&self) {
        let provider = Arc::clone(&self.provider);
        self.spawn(async move { ActionResult::Restored(provider.restore_session().await) });
    }

    pub fn authenticate(&self, credentials: LoginCredentials) {
        let provider = Arc::clone(&self.provider);
        self.spawn(
            async move { ActionResult::Authenticated(provider.authenticate(credentials).await) },
        );
    }

    pub fn load_conversations(&self) {
        let provider = Arc::clone(&self.provider);
        self.spawn(async move { ActionResult::Conversations(provider.list_conversations().await) });
    }

    pub fn load_messages(&self, conversation_id: String, before: Option<String>) {
        let provider = Arc::clone(&self.provider);
        let result_id = conversation_id.clone();
        self.spawn(async move {
            ActionResult::Messages {
                conversation_id: result_id,
                result: provider
                    .list_messages(&conversation_id, before.as_deref(), 100)
                    .await,
            }
        });
    }

    pub fn send_message(&self, conversation_id: String, content: String) {
        let provider = Arc::clone(&self.provider);
        let result_id = conversation_id.clone();
        self.spawn(async move {
            ActionResult::Sent {
                conversation_id: result_id,
                result: provider.send_message(&conversation_id, &content).await,
            }
        });
    }

    pub fn logout(&self) {
        let provider = Arc::clone(&self.provider);
        self.spawn(async move { ActionResult::LoggedOut(provider.logout().await) });
    }

    pub fn add_friend(&self, identifier: String) {
        let provider = Arc::clone(&self.provider);
        self.spawn(
            async move { ActionResult::FriendAdded(provider.add_friend(&identifier).await) },
        );
    }

    pub fn start_event_loop(&mut self) {
        if self.event_loop_started {
            return;
        }
        self.event_loop_started = true;
        let provider = Arc::clone(&self.provider);
        let sender = self.sender.clone();
        self.runtime.spawn(async move {
            let mut stream = match provider.subscribe_events().await {
                Ok(stream) => stream,
                Err(error) => {
                    let _ = sender.send(ActionResult::Event(Err(error)));
                    return;
                }
            };
            while let Some(event) = stream.next().await {
                let ended = matches!(event, Ok(DiscordEvent::SessionEnded));
                if sender.send(ActionResult::Event(event)).is_err() || ended {
                    break;
                }
            }
        });
    }

    pub fn poll(&mut self) -> Vec<ActionResult> {
        let mut results = Vec::new();
        while let Ok(result) = self.receiver.try_recv() {
            results.push(result);
        }
        results
    }

    pub fn mark_event_loop_stopped(&mut self) {
        self.event_loop_started = false;
    }

    pub fn provider(&self) -> Arc<dyn DiscordProvider> {
        Arc::clone(&self.provider)
    }

    fn spawn<F>(&self, future: F)
    where
        F: Future<Output = ActionResult> + Send + 'static,
    {
        let sender = self.sender.clone();
        self.runtime.spawn(async move {
            let _ = sender.send(future.await);
        });
    }
}
