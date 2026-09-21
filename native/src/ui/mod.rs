use serde::Serialize;
use tao::event_loop::EventLoopProxy;
use wry::WebView;

use crate::{
    app::state::{AuthState, NativeState, SendState, SyncState},
    discord::ConnectionStatus,
};

#[derive(Clone)]
pub enum UiIntent {
    Login {
        email: String,
        password: String,
    },
    Logout,
    SelectConversation(String),
    LoadMore(String, Option<String>),
    SendMessage {
        conversation_id: String,
        content: String,
    },
    RetryMessage(String),
    AddFriend(String),
    ClearCache,
    ExportDiagnostics,
}

#[derive(Clone, Debug, Serialize)]
struct ViewState {
    auth: &'static str,
    user: Option<crate::models::User>,
    conversations: Vec<crate::models::Conversation>,
    selected_conversation_id: Option<String>,
    selected_conversation: Option<crate::models::Conversation>,
    messages: Vec<crate::models::Message>,
    connection: ConnectionView,
    sync: SyncView,
    login_email: String,
    login_error: Option<String>,
    notice: Option<String>,
    send_state: SendView,
    failed_content: Option<String>,
    loading_more: bool,
    show_add_friend: bool,
    add_friend_error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
struct ConnectionView {
    state: &'static str,
    label: &'static str,
    detail: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
struct SyncView {
    state: &'static str,
    error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
struct SendView {
    state: &'static str,
    error: Option<String>,
}

pub fn document() -> String {
    let html = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/assets/ui/index.html"));
    let css = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/assets/ui/styles.css"));
    let javascript = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/assets/ui/app.js"));
    html.replace("/* __MOONCORD_STYLES__ */", css)
        .replace("// __MOONCORD_SCRIPT__", javascript)
}

pub fn parse_ipc_message(body: &str) -> Option<UiIntent> {
    let message = serde_json::from_str::<serde_json::Value>(body).ok()?;
    let kind = message.get("type")?.as_str()?;
    match kind {
        "login" => Some(UiIntent::Login {
            email: message.get("email")?.as_str()?.to_owned(),
            password: message.get("password")?.as_str()?.to_owned(),
        }),
        "logout" => Some(UiIntent::Logout),
        "select_conversation" => Some(UiIntent::SelectConversation(
            message.get("id")?.as_str()?.to_owned(),
        )),
        "load_more" => Some(UiIntent::LoadMore(
            message.get("conversation_id")?.as_str()?.to_owned(),
            message
                .get("before")
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned),
        )),
        "send_message" => Some(UiIntent::SendMessage {
            conversation_id: message.get("conversation_id")?.as_str()?.to_owned(),
            content: message.get("content")?.as_str()?.to_owned(),
        }),
        "retry_message" => Some(UiIntent::RetryMessage(
            message.get("content")?.as_str()?.to_owned(),
        )),
        "add_friend" => Some(UiIntent::AddFriend(
            message.get("identifier")?.as_str()?.to_owned(),
        )),
        "clear_cache" => Some(UiIntent::ClearCache),
        "export_diagnostics" => Some(UiIntent::ExportDiagnostics),
        _ => None,
    }
}

pub fn connect_ipc(proxy: EventLoopProxy<UiIntent>, body: &str) {
    if let Some(intent) = parse_ipc_message(body) {
        let _ = proxy.send_event(intent);
    }
}

pub fn render_state(webview: &WebView, state: &NativeState) -> Result<(), wry::Error> {
    let snapshot = ViewState {
        auth: auth_label(&state.auth),
        user: match &state.auth {
            AuthState::Authenticated(user) => Some(user.clone()),
            _ => None,
        },
        conversations: state.conversations.clone(),
        selected_conversation_id: state.selected_conversation_id.clone(),
        selected_conversation: state.selected_conversation().cloned(),
        messages: state.selected_messages(),
        connection: connection_view(&state.connection),
        sync: sync_view(&state.sync),
        login_email: state.login_email.clone(),
        login_error: state.login_error.clone(),
        notice: state.notice.clone(),
        send_state: send_view(&state.send_state),
        failed_content: state.failed_content.clone(),
        loading_more: state.loading_more,
        show_add_friend: state.show_add_friend,
        add_friend_error: state.add_friend_error.clone(),
    };
    let payload = serde_json::to_string(&snapshot).expect("native UI state is serializable");
    webview.evaluate_script(&format!("window.mooncordReceive({payload});"))
}

fn auth_label(auth: &AuthState) -> &'static str {
    match auth {
        AuthState::Loading => "loading",
        AuthState::Unauthenticated => "unauthenticated",
        AuthState::Authenticating => "authenticating",
        AuthState::Authenticated(_) => "authenticated",
    }
}

fn connection_view(connection: &ConnectionStatus) -> ConnectionView {
    match connection {
        ConnectionStatus::Connected => ConnectionView {
            state: "connected",
            label: "Conectado",
            detail: None,
        },
        ConnectionStatus::Connecting => ConnectionView {
            state: "connecting",
            label: "Conectando",
            detail: None,
        },
        ConnectionStatus::Reconnecting { attempt } => ConnectionView {
            state: "reconnecting",
            label: "Reconectando",
            detail: Some(format!("Intento {attempt}")),
        },
        ConnectionStatus::Disconnected { reason } => ConnectionView {
            state: "disconnected",
            label: "Desconectado",
            detail: Some(reason.clone()),
        },
    }
}

fn sync_view(sync: &SyncState) -> SyncView {
    match sync {
        SyncState::Idle => SyncView {
            state: "idle",
            error: None,
        },
        SyncState::Loading => SyncView {
            state: "loading",
            error: None,
        },
        SyncState::Ready => SyncView {
            state: "ready",
            error: None,
        },
        SyncState::Error(error) => SyncView {
            state: "error",
            error: Some(error.clone()),
        },
    }
}

fn send_view(send: &SendState) -> SendView {
    match send {
        SendState::Idle => SendView {
            state: "idle",
            error: None,
        },
        SendState::Sending => SendView {
            state: "sending",
            error: None,
        },
        SendState::Failed(error) => SendView {
            state: "failed",
            error: Some(error.clone()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{UiIntent, parse_ipc_message};

    #[test]
    fn ipc_login_parses_credentials_without_logging_them() {
        let intent = parse_ipc_message(
            r#"{"type":"login","email":"person@example.com","password":"secret"}"#,
        )
        .expect("login IPC message parses");
        assert!(
            matches!(intent, UiIntent::Login { email, password } if email == "person@example.com" && password == "secret")
        );
    }

    #[test]
    fn unknown_ipc_message_is_ignored() {
        assert!(parse_ipc_message(r#"{"type":"open_external_url"}"#).is_none());
    }
}
