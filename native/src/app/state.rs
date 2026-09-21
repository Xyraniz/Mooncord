use crate::{
    discord::{ConnectionStatus, DiscordEvent},
    models::{Conversation, Message, User, sort_conversations},
    storage::{AppSettings, MessageCache, SettingsStore},
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AuthState {
    Loading,
    Unauthenticated,
    Authenticating,
    Authenticated(User),
}

impl AuthState {
    pub fn is_authenticated(&self) -> bool {
        matches!(self, Self::Authenticated(_))
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SyncState {
    Idle,
    Loading,
    Ready,
    Error(String),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SendState {
    Idle,
    Sending,
    Failed(String),
}

pub struct NativeState {
    pub auth: AuthState,
    pub connection: ConnectionStatus,
    pub sync: SyncState,
    pub conversations: Vec<Conversation>,
    pub selected_conversation_id: Option<String>,
    pub message_cache: MessageCache,
    pub login_email: String,
    pub login_password: String,
    pub login_error: Option<String>,
    pub dm_search: String,
    pub composer: String,
    pub send_state: SendState,
    pub pending_message_id: Option<String>,
    pub failed_content: Option<String>,
    pub add_friend_identifier: String,
    pub add_friend_error: Option<String>,
    pub show_add_friend: bool,
    pub show_diagnostics: bool,
    pub notice: Option<String>,
    pub settings: AppSettings,
    pub settings_store: SettingsStore,
    pub loading_more: bool,
    pub event_loop_running: bool,
}

impl NativeState {
    pub fn new(settings_store: SettingsStore) -> Self {
        let settings = settings_store.load().unwrap_or_default();
        Self {
            auth: AuthState::Loading,
            connection: ConnectionStatus::Disconnected {
                reason: "Not authenticated".to_owned(),
            },
            sync: SyncState::Idle,
            conversations: Vec::new(),
            selected_conversation_id: settings.last_conversation_id.clone(),
            message_cache: MessageCache::default(),
            login_email: String::new(),
            login_password: String::new(),
            login_error: None,
            dm_search: String::new(),
            composer: String::new(),
            send_state: SendState::Idle,
            pending_message_id: None,
            failed_content: None,
            add_friend_identifier: String::new(),
            add_friend_error: None,
            show_add_friend: false,
            show_diagnostics: false,
            notice: None,
            settings,
            settings_store,
            loading_more: false,
            event_loop_running: false,
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.auth.is_authenticated()
            && self
                .conversations
                .iter()
                .any(|conversation| conversation.id.is_empty())
        {
            return Err("authenticated state contains a conversation without an id".to_owned());
        }
        if let Some(selected) = self.selected_conversation_id.as_deref()
            && !selected.is_empty()
            && !self.conversations.is_empty()
            && !self
                .conversations
                .iter()
                .any(|conversation| conversation.id == selected)
        {
            return Err("selected conversation is not in the conversation list".to_owned());
        }
        Ok(())
    }

    pub fn set_conversations(&mut self, mut conversations: Vec<Conversation>) {
        conversations.retain(|conversation| !conversation.id.is_empty() && conversation.kind != 0);
        if self.selected_conversation_id.is_none() {
            self.selected_conversation_id = conversations
                .first()
                .map(|conversation| conversation.id.clone());
        }
        if let Some(selected) = self.selected_conversation_id.as_deref()
            && !conversations
                .iter()
                .any(|conversation| conversation.id == selected)
        {
            self.selected_conversation_id = conversations
                .first()
                .map(|conversation| conversation.id.clone());
        }
        self.conversations = conversations;
        self.persist_settings();
    }

    pub fn selected_conversation(&self) -> Option<&Conversation> {
        self.selected_conversation_id.as_deref().and_then(|id| {
            self.conversations
                .iter()
                .find(|conversation| conversation.id == id)
        })
    }

    pub fn select_conversation(&mut self, id: String) {
        if self
            .conversations
            .iter()
            .any(|conversation| conversation.id == id)
        {
            self.selected_conversation_id = Some(id);
            self.sync = SyncState::Loading;
            self.persist_settings();
        }
    }

    pub fn selected_messages(&self) -> Vec<Message> {
        self.selected_conversation_id
            .as_deref()
            .map(|id| self.message_cache.messages(id))
            .unwrap_or_default()
    }

    pub fn touch_conversation(&mut self, conversation_id: &str, message_id: &str) {
        if let Some(conversation) = self
            .conversations
            .iter_mut()
            .find(|conversation| conversation.id == conversation_id)
        {
            conversation.last_message_id = Some(message_id.to_owned());
            sort_conversations(&mut self.conversations);
        }
    }

    pub fn apply_event(&mut self, event: DiscordEvent) {
        match event {
            DiscordEvent::Connection(status) => self.connection = status,
            DiscordEvent::Ready { user } => self.auth = AuthState::Authenticated(user),
            DiscordEvent::MessageCreate(message) => {
                let conversation_id = message.channel_id.clone();
                let message_id = message.id.clone();
                self.message_cache.upsert(message);
                self.touch_conversation(&conversation_id, &message_id);
            }
            DiscordEvent::MessageUpdate(message) => {
                self.message_cache.edit(message);
            }
            DiscordEvent::MessageDelete {
                channel_id,
                message_id,
            } => {
                self.message_cache.remove(&channel_id, &message_id);
            }
            DiscordEvent::SessionEnded => {
                self.event_loop_running = false;
                self.connection = ConnectionStatus::Disconnected {
                    reason: "Signed out".to_owned(),
                };
            }
        }
    }

    pub fn clear_local_cache(&mut self) {
        self.message_cache.clear();
        let _ = self.settings_store.clear_local_cache();
        self.notice = Some("Caché local borrada.".to_owned());
    }

    pub fn diagnostics(&self) -> crate::storage::Diagnostics {
        crate::storage::Diagnostics {
            app_version: env!("CARGO_PKG_VERSION").to_owned(),
            os: std::env::consts::OS.to_owned(),
            authenticated: self.auth.is_authenticated(),
            connection: format!("{:?}", self.connection),
            conversation_count: self.conversations.len(),
            cached_message_count: self.message_cache.len(),
        }
    }

    fn persist_settings(&mut self) {
        self.settings.last_conversation_id = self.selected_conversation_id.clone();
        let _ = self.settings_store.save(&self.settings);
    }
}

#[cfg(test)]
mod tests {
    use super::{AuthState, NativeState};
    use crate::{
        models::{Conversation, User},
        storage::SettingsStore,
    };

    #[test]
    fn unauthenticated_state_is_valid() {
        let state = NativeState::new(SettingsStore::new(
            std::env::temp_dir().join("mooncord-state-test.json"),
        ));
        assert!(!state.auth.is_authenticated());
        assert!(state.validate().is_ok());
    }

    #[test]
    fn authenticated_state_rejects_unknown_selected_conversation() {
        let mut state = NativeState::new(SettingsStore::new(
            std::env::temp_dir().join("mooncord-state-test-2.json"),
        ));
        state.auth = AuthState::Authenticated(User::default());
        state.conversations = vec![Conversation {
            id: "known".to_owned(),
            kind: 1,
            ..Conversation::default()
        }];
        state.selected_conversation_id = Some("missing".to_owned());
        assert!(state.validate().is_err());
    }

    #[test]
    fn new_messages_move_their_conversation_to_the_top() {
        let mut state = NativeState::new(SettingsStore::new(
            std::env::temp_dir().join("mooncord-state-test-3.json"),
        ));
        state.conversations = vec![
            Conversation {
                id: "first".to_owned(),
                kind: 1,
                last_message_id: Some("175928847299117063".to_owned()),
                ..Conversation::default()
            },
            Conversation {
                id: "second".to_owned(),
                kind: 1,
                last_message_id: Some("175928847299117064".to_owned()),
                ..Conversation::default()
            },
        ];
        state.touch_conversation("first", "175928847299117065");

        assert_eq!(
            state
                .conversations
                .first()
                .map(|conversation| conversation.id.as_str()),
            Some("first")
        );
    }
}
