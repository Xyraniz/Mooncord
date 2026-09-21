use std::{
    error::Error,
    sync::Arc,
    time::{Duration, Instant},
};

use tao::{
    event::{Event, StartCause, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder},
    window::WindowBuilder,
};
use tokio::runtime::Runtime;
use wry::{NewWindowResponse, WebViewBuilder};

use crate::{
    auth::LoginCredentials,
    models::Message,
    storage::SettingsStore,
    ui::{self, UiIntent},
};

use super::{
    actions::{ActionController, ActionResult},
    state::{AuthState, NativeState, SendState, SyncState},
};

pub struct NativeApp {
    pub state: NativeState,
    pub actions: ActionController,
    runtime: Arc<Runtime>,
}

impl NativeApp {
    pub fn new(runtime: Arc<Runtime>, provider: Arc<dyn crate::discord::DiscordProvider>) -> Self {
        let settings_store = SettingsStore::default();
        let mut actions = ActionController::new(Arc::clone(&runtime), provider);
        actions.start_event_loop();
        actions.restore();
        let mut state = NativeState::new(settings_store);
        state.event_loop_running = true;
        Self {
            state,
            actions,
            runtime,
        }
    }

    pub fn run(mut self) -> Result<(), Box<dyn Error>> {
        let event_loop = EventLoopBuilder::<UiIntent>::with_user_event().build();
        let proxy = event_loop.create_proxy();
        let window = WindowBuilder::new()
            .with_title("Mooncord Native")
            .with_inner_size(tao::dpi::LogicalSize::new(1320.0, 820.0))
            .with_min_inner_size(tao::dpi::LogicalSize::new(900.0, 600.0))
            .build(&event_loop)?;
        let webview = WebViewBuilder::new()
            .with_html(ui::document())
            .with_ipc_handler(move |request| ui::connect_ipc(proxy.clone(), request.body()))
            .with_navigation_handler(|url| url == "about:blank" || url.starts_with("data:"))
            .with_new_window_req_handler(|_, _| NewWindowResponse::Deny)
            .with_general_autofill_enabled(false)
            .with_clipboard(true)
            .build(&window)?;

        ui::render_state(&webview, &self.state)?;
        event_loop.run(move |event, _, control_flow| {
            *control_flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(100));
            match event {
                Event::NewEvents(StartCause::Init)
                | Event::NewEvents(StartCause::ResumeTimeReached { .. }) => {
                    self.refresh(&webview, false);
                }
                Event::UserEvent(intent) => {
                    self.apply_intent(intent);
                    self.refresh(&webview, true);
                }
                Event::WindowEvent {
                    event: WindowEvent::CloseRequested,
                    ..
                } => {
                    self.shutdown();
                    *control_flow = ControlFlow::Exit;
                }
                _ => {}
            }
        });
    }

    pub fn apply_intent(&mut self, intent: UiIntent) {
        match intent {
            UiIntent::Login { email, password } => {
                self.state.login_email = email;
                let credentials = LoginCredentials {
                    email: self.state.login_email.trim().to_owned(),
                    password,
                };
                if let Err(error) = credentials.validate() {
                    self.state.login_error = Some(error.to_owned());
                    return;
                }
                self.state.login_error = None;
                self.state.auth = AuthState::Authenticating;
                self.actions.authenticate(credentials);
            }
            UiIntent::Logout => {
                self.state.notice = Some("Cerrando sesión y borrando el token seguro…".to_owned());
                self.actions.logout();
            }
            UiIntent::SelectConversation(id) => {
                self.state.select_conversation(id.clone());
                self.state.message_cache.clear();
                self.state.loading_more = false;
                self.state.send_state = SendState::Idle;
                self.state.pending_message_id = None;
                self.state.failed_content = None;
                self.actions.load_messages(id, None);
            }
            UiIntent::LoadMore(conversation_id, before) => {
                if !self.state.loading_more {
                    self.state.loading_more = true;
                    self.actions.load_messages(conversation_id, before);
                }
            }
            UiIntent::SendMessage {
                conversation_id,
                content,
            } => self.begin_send(conversation_id, content),
            UiIntent::RetryMessage(content) => {
                if let Some(conversation_id) = self.state.selected_conversation_id.clone() {
                    self.begin_send(conversation_id, content);
                }
            }
            UiIntent::AddFriend(identifier) => {
                self.state.add_friend_identifier = identifier.trim().to_owned();
                if self.state.add_friend_identifier.is_empty() {
                    self.state.add_friend_error =
                        Some("Escribe un nombre de usuario o identificador.".to_owned());
                } else {
                    self.state.add_friend_error = None;
                    self.actions
                        .add_friend(self.state.add_friend_identifier.clone());
                }
            }
            UiIntent::ClearCache => self.state.clear_local_cache(),
            UiIntent::ExportDiagnostics => match self
                .state
                .settings_store
                .export_diagnostics(&self.state.diagnostics())
            {
                Ok(path) => {
                    self.state.notice =
                        Some(format!("Diagnóstico exportado en {}.", path.display()))
                }
                Err(error) => {
                    self.state.notice = Some(format!("No se pudo exportar el diagnóstico: {error}"))
                }
            },
        }
    }

    fn begin_send(&mut self, conversation_id: String, content: String) {
        let content = content.trim().to_owned();
        if content.is_empty() || matches!(self.state.send_state, SendState::Sending) {
            return;
        }
        let Some(AuthState::Authenticated(user)) = Some(&self.state.auth) else {
            return;
        };
        let pending = Message::pending(&conversation_id, user.clone(), &content);
        self.state.pending_message_id = Some(pending.id.clone());
        self.state.message_cache.upsert(pending);
        self.state.failed_content = None;
        self.state.send_state = SendState::Sending;
        self.state.composer.clear();
        self.actions.send_message(conversation_id, content);
    }

    fn refresh(&mut self, webview: &wry::WebView, force: bool) {
        let changed = self.process_results();
        if (force || changed)
            && let Err(error) = ui::render_state(webview, &self.state)
        {
            tracing::warn!("could not update native UI: {error}");
        }
    }

    fn process_results(&mut self) -> bool {
        let mut changed = false;
        for result in self.actions.poll() {
            changed = true;
            match result {
                ActionResult::Restored(Ok(Some(session))) => {
                    self.state.auth = AuthState::Authenticated(session.user);
                    self.state.login_error = None;
                    self.state.event_loop_running = true;
                    self.actions.start_event_loop();
                    self.state.sync = SyncState::Loading;
                    self.actions.load_conversations();
                }
                ActionResult::Restored(Ok(None)) => {
                    self.state.auth = AuthState::Unauthenticated;
                    self.state.connection = crate::discord::ConnectionStatus::Disconnected {
                        reason: "No autenticado".to_owned(),
                    };
                }
                ActionResult::Restored(Err(error)) => {
                    self.state.auth = AuthState::Unauthenticated;
                    self.state.login_error =
                        Some(format!("No se pudo restaurar la sesión: {error}"));
                }
                ActionResult::Authenticated(Ok(session)) => {
                    self.state.auth = AuthState::Authenticated(session.user);
                    self.state.login_password.clear();
                    self.state.login_error = None;
                    self.state.event_loop_running = true;
                    self.actions.start_event_loop();
                    self.state.sync = SyncState::Loading;
                    self.actions.load_conversations();
                }
                ActionResult::Authenticated(Err(error)) => {
                    self.state.auth = AuthState::Unauthenticated;
                    self.state.login_password.clear();
                    self.state.login_error = Some(error.to_string());
                }
                ActionResult::Conversations(Ok(conversations)) => {
                    self.state.set_conversations(conversations);
                    self.state.sync = SyncState::Ready;
                    if let Some(id) = self.state.selected_conversation_id.clone() {
                        self.actions.load_messages(id, None);
                    }
                }
                ActionResult::Conversations(Err(error)) => {
                    self.state.sync = SyncState::Error(error.to_string());
                    self.state.notice =
                        Some(format!("No se pudieron cargar las conversaciones: {error}"));
                }
                ActionResult::Messages {
                    conversation_id,
                    result: Ok(messages),
                } => {
                    if self.state.selected_conversation_id.as_deref()
                        != Some(conversation_id.as_str())
                    {
                        continue;
                    }
                    self.state
                        .message_cache
                        .merge_page(&conversation_id, messages);
                    self.state.loading_more = false;
                    self.state.sync = SyncState::Ready;
                }
                ActionResult::Messages {
                    conversation_id,
                    result: Err(error),
                } => {
                    if self.state.selected_conversation_id.as_deref()
                        != Some(conversation_id.as_str())
                    {
                        continue;
                    }
                    self.state.loading_more = false;
                    self.state.sync = SyncState::Error(error.to_string());
                    self.state.notice =
                        Some(format!("No se pudieron cargar los mensajes: {error}"));
                }
                ActionResult::Sent {
                    conversation_id,
                    result: Ok(message),
                } => {
                    if self.state.selected_conversation_id.as_deref()
                        != Some(conversation_id.as_str())
                    {
                        continue;
                    }
                    if let Some(pending_id) = self.state.pending_message_id.take() {
                        self.state
                            .message_cache
                            .remove(&conversation_id, &pending_id);
                    }
                    let message_id = message.id.clone();
                    self.state.message_cache.upsert(message);
                    self.state.touch_conversation(&conversation_id, &message_id);
                    self.state.send_state = SendState::Idle;
                }
                ActionResult::Sent {
                    conversation_id,
                    result: Err(error),
                } => {
                    if self.state.selected_conversation_id.as_deref()
                        != Some(conversation_id.as_str())
                    {
                        continue;
                    }
                    if let Some(pending_id) = self.state.pending_message_id.take() {
                        let failed = self
                            .state
                            .message_cache
                            .messages(&conversation_id)
                            .into_iter()
                            .find(|message| message.id == pending_id);
                        if let Some(mut failed) = failed {
                            self.state.failed_content = Some(failed.content.clone());
                            failed.pending = false;
                            failed.failed = true;
                            self.state.message_cache.upsert(failed);
                        }
                    }
                    self.state.send_state = SendState::Failed(error.to_string());
                }
                ActionResult::LoggedOut(Ok(())) => {
                    self.state.auth = AuthState::Unauthenticated;
                    self.state.conversations.clear();
                    self.state.selected_conversation_id = None;
                    self.state.message_cache.clear();
                    self.state.composer.clear();
                    self.state.send_state = SendState::Idle;
                    self.state.event_loop_running = false;
                    self.state.notice =
                        Some("Sesión cerrada. El token seguro fue borrado.".to_owned());
                    self.actions.mark_event_loop_stopped();
                }
                ActionResult::LoggedOut(Err(error)) => {
                    self.state.notice = Some(format!(
                        "No se pudo cerrar la sesión completamente: {error}"
                    ));
                }
                ActionResult::FriendAdded(Ok(())) => {
                    self.state.show_add_friend = false;
                    self.state.add_friend_identifier.clear();
                    self.state.add_friend_error = None;
                    self.state.notice = Some("Solicitud de amistad enviada.".to_owned());
                }
                ActionResult::FriendAdded(Err(error)) => {
                    self.state.add_friend_error = Some(error.to_string());
                }
                ActionResult::Event(Ok(event)) => {
                    let ended = matches!(event, crate::discord::DiscordEvent::SessionEnded);
                    self.state.apply_event(event);
                    if ended {
                        self.actions.mark_event_loop_stopped();
                    }
                }
                ActionResult::Event(Err(error)) => {
                    self.state.notice = Some(format!("El canal de eventos tuvo un error: {error}"));
                }
            }
        }
        changed
    }

    fn shutdown(&mut self) {
        let provider = self.actions.provider();
        let _ = self.runtime.block_on(provider.shutdown());
        let _ = self.state.settings_store.save(&self.state.settings);
    }
}
