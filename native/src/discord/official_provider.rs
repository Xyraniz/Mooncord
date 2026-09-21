use std::sync::Arc;

use base64::{Engine, engine::general_purpose::STANDARD as BASE64};
use futures_util::StreamExt;
use reqwest::{Client, Response, StatusCode, header};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::{Mutex, RwLock, broadcast, watch};
use tokio_stream::wrappers::BroadcastStream;
use tracing::{debug, warn};

use crate::{
    auth::{AuthSession, LoginCredentials, SecretStore},
    models::{Conversation, Message, User, sort_conversations},
};

use super::{
    DiscordError, gateway,
    provider::{DiscordEvent, DiscordProvider, EventStream},
};

const API_BASE: &str = "https://discord.com/api/v10";
const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0.0.0 Safari/537.36";

pub struct OfficialDiscordProvider {
    client: Client,
    secrets: Arc<dyn SecretStore>,
    token: RwLock<Option<String>>,
    events: broadcast::Sender<DiscordEvent>,
    gateway_cancel: Mutex<Option<watch::Sender<bool>>>,
    gateway_task: Mutex<Option<tokio::task::JoinHandle<()>>>,
}

impl OfficialDiscordProvider {
    pub fn new(secrets: Arc<dyn SecretStore>) -> Self {
        let mut headers = header::HeaderMap::new();
        headers.insert(
            header::USER_AGENT,
            header::HeaderValue::from_static(USER_AGENT),
        );
        headers.insert(header::ACCEPT, header::HeaderValue::from_static("*/*"));
        headers.insert(
            header::ACCEPT_LANGUAGE,
            header::HeaderValue::from_static("en-US,en;q=0.9"),
        );
        headers.insert(
            header::ORIGIN,
            header::HeaderValue::from_static("https://discord.com"),
        );
        headers.insert(
            header::REFERER,
            header::HeaderValue::from_static("https://discord.com/login"),
        );
        headers.insert(
            header::HeaderName::from_static("x-super-properties"),
            header::HeaderValue::from_str(&super_properties())
                .expect("static super properties are valid"),
        );
        headers.insert(
            header::HeaderName::from_static("x-discord-locale"),
            header::HeaderValue::from_static("en-US"),
        );
        headers.insert(
            header::HeaderName::from_static("x-debug-options"),
            header::HeaderValue::from_static("bugReporterEnabled"),
        );

        let client = Client::builder()
            .default_headers(headers)
            .build()
            .expect("official provider HTTP client is valid");
        let (events, _) = broadcast::channel(256);
        Self {
            client,
            secrets,
            token: RwLock::new(None),
            events,
            gateway_cancel: Mutex::new(None),
            gateway_task: Mutex::new(None),
        }
    }

    async fn token(&self) -> Result<String, DiscordError> {
        self.token
            .read()
            .await
            .clone()
            .ok_or(DiscordError::AuthenticationRequired)
    }

    async fn set_token(&self, token: Option<String>) {
        *self.token.write().await = token;
    }

    async fn stop_gateway(&self) {
        if let Some(cancel) = self.gateway_cancel.lock().await.take() {
            let _ = cancel.send(true);
        }
        if let Some(task) = self.gateway_task.lock().await.take() {
            let _ = task.await;
        }
    }

    async fn start_gateway(&self, token: String) {
        self.stop_gateway().await;
        let (cancel, cancel_receiver) = watch::channel(false);
        let events = self.events.clone();
        let task = tokio::spawn(gateway::run(token, events, cancel_receiver));
        *self.gateway_cancel.lock().await = Some(cancel);
        *self.gateway_task.lock().await = Some(task);
    }

    async fn send_authenticated(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Response, DiscordError> {
        let token = self.token().await?;
        let mut request = self.client.request(method, format!("{API_BASE}{path}"));
        request = request.header(header::AUTHORIZATION, token);
        if let Some(body) = body {
            request = request.json(&body);
        }
        request
            .send()
            .await
            .map_err(|error| DiscordError::Network(error.to_string()))
    }

    async fn parse_response<T: for<'de> Deserialize<'de>>(
        response: Response,
    ) -> Result<T, DiscordError> {
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|error| DiscordError::Network(error.to_string()))?;
        if !status.is_success() {
            warn!(status = status.as_u16(), "Discord REST request failed");
            return Err(error_from_response(status, &body));
        }
        serde_json::from_str(&body).map_err(|error| {
            DiscordError::Protocol(format!("Discord returned invalid JSON: {error}"))
        })
    }

    async fn parse_empty(response: Response) -> Result<(), DiscordError> {
        let status = response.status();
        if status.is_success() {
            return Ok(());
        }
        let body = response.text().await.unwrap_or_default();
        Err(error_from_response(status, &body))
    }
}

#[async_trait::async_trait]
impl DiscordProvider for OfficialDiscordProvider {
    async fn authenticate(
        &self,
        credentials: LoginCredentials,
    ) -> Result<AuthSession, DiscordError> {
        credentials
            .validate()
            .map_err(|error| DiscordError::InvalidInput(error.to_owned()))?;

        let response = self
            .client
            .post(format!("{API_BASE}/auth/login"))
            .json(&json!({
                "login": credentials.email,
                "password": credentials.password,
                "undelete": false,
                "login_source": null,
                "gift_code_sku_id": null
            }))
            .send()
            .await
            .map_err(|error| DiscordError::Network(error.to_string()))?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|error| DiscordError::Network(error.to_string()))?;
        if !status.is_success() {
            return Err(authentication_error(status, &body));
        }

        let login: LoginResponse = serde_json::from_str(&body).map_err(|error| {
            DiscordError::Protocol(format!("Discord returned invalid login JSON: {error}"))
        })?;
        let token = login.token.ok_or_else(|| {
            if login.mfa.unwrap_or(false) {
                DiscordError::Authentication(
                    "multi-factor authentication is required by this account".to_owned(),
                )
            } else if login.captcha_key.is_some() || login.captcha_sitekey.is_some() {
                DiscordError::Authentication(
                    "Discord requires an interactive CAPTCHA; direct login cannot continue"
                        .to_owned(),
                )
            } else {
                DiscordError::Authentication(
                    "login response did not include a session token".to_owned(),
                )
            }
        })?;

        self.set_token(Some(token.clone())).await;
        let user = match self.current_user().await {
            Ok(user) => user,
            Err(error) => {
                self.set_token(None).await;
                return Err(error);
            }
        };
        self.secrets
            .save_token(&token)
            .map_err(|error| DiscordError::Storage(error.to_string()))?;
        self.start_gateway(token.clone()).await;
        Ok(AuthSession::new(user, token))
    }

    async fn restore_session(&self) -> Result<Option<AuthSession>, DiscordError> {
        let Some(token) = self
            .secrets
            .load_token()
            .map_err(|error| DiscordError::Storage(error.to_string()))?
        else {
            return Ok(None);
        };

        self.set_token(Some(token.clone())).await;
        let user = match self.current_user().await {
            Ok(user) => user,
            Err(error) => {
                self.set_token(None).await;
                let _ = self.secrets.delete_token();
                if error.is_auth_error() {
                    return Ok(None);
                }
                return Err(error);
            }
        };
        self.start_gateway(token.clone()).await;
        Ok(Some(AuthSession::new(user, token)))
    }

    async fn logout(&self) -> Result<(), DiscordError> {
        let _ = self.events.send(DiscordEvent::SessionEnded);
        self.stop_gateway().await;
        self.set_token(None).await;
        self.secrets
            .delete_token()
            .map_err(|error| DiscordError::Storage(error.to_string()))
    }

    async fn shutdown(&self) -> Result<(), DiscordError> {
        let _ = self.events.send(DiscordEvent::SessionEnded);
        self.stop_gateway().await;
        Ok(())
    }

    async fn current_user(&self) -> Result<User, DiscordError> {
        let response = self
            .send_authenticated(reqwest::Method::GET, "/users/@me", None)
            .await?;
        Self::parse_response(response).await
    }

    async fn list_conversations(&self) -> Result<Vec<Conversation>, DiscordError> {
        let response = self
            .send_authenticated(reqwest::Method::GET, "/users/@me/channels?limit=100", None)
            .await?;
        let mut conversations: Vec<Conversation> = Self::parse_response(response).await?;
        sort_conversations(&mut conversations);
        debug!(count = conversations.len(), "loaded private conversations");
        Ok(conversations)
    }

    async fn list_messages(
        &self,
        conversation_id: &str,
        before: Option<&str>,
        limit: u32,
    ) -> Result<Vec<Message>, DiscordError> {
        if conversation_id.trim().is_empty() {
            return Err(DiscordError::InvalidInput(
                "conversation id cannot be empty".to_owned(),
            ));
        }
        let mut path = format!(
            "/channels/{conversation_id}/messages?limit={}",
            limit.clamp(1, 100)
        );
        if let Some(before) = before {
            path.push_str("&before=");
            path.push_str(before);
        }
        let response = self
            .send_authenticated(reqwest::Method::GET, &path, None)
            .await?;
        let messages: Vec<Message> = Self::parse_response(response).await?;
        debug!(
            conversation_id,
            count = messages.len(),
            "loaded conversation messages"
        );
        Ok(messages)
    }

    async fn send_message(
        &self,
        conversation_id: &str,
        content: &str,
    ) -> Result<Message, DiscordError> {
        if conversation_id.trim().is_empty() || content.trim().is_empty() {
            return Err(DiscordError::InvalidInput(
                "conversation and message content are required".to_owned(),
            ));
        }
        let response = self
            .send_authenticated(
                reqwest::Method::POST,
                &format!("/channels/{conversation_id}/messages"),
                Some(json!({ "content": content })),
            )
            .await?;
        Self::parse_response(response).await
    }

    async fn subscribe_events(&self) -> Result<EventStream, DiscordError> {
        let receiver = self.events.subscribe();
        let stream = BroadcastStream::new(receiver).map(|item| match item {
            Ok(event) => Ok(event),
            Err(error) => Err(DiscordError::Other(format!("event stream lagged: {error}"))),
        });
        Ok(Box::pin(stream))
    }

    async fn add_friend(&self, user_identifier: &str) -> Result<(), DiscordError> {
        if user_identifier.trim().is_empty() {
            return Err(DiscordError::InvalidInput(
                "friend identifier cannot be empty".to_owned(),
            ));
        }
        let response = self
            .send_authenticated(
                reqwest::Method::POST,
                "/users/@me/relationships",
                Some(json!({ "username": user_identifier.trim() })),
            )
            .await?;
        Self::parse_empty(response).await
    }
}

#[derive(Debug, Deserialize)]
struct LoginResponse {
    #[serde(default)]
    token: Option<String>,
    #[serde(default)]
    mfa: Option<bool>,
    #[serde(default)]
    captcha_key: Option<Value>,
    #[serde(default)]
    captcha_sitekey: Option<String>,
}

fn super_properties() -> String {
    BASE64.encode(
        serde_json::to_vec(&json!({
            "os": "Windows",
            "browser": "Chrome",
            "device": "",
            "system_locale": "en-US",
            "browser_user_agent": USER_AGENT,
            "browser_version": "136.0.0.0",
            "os_version": "10",
            "referrer": "",
            "referring_domain": "",
            "release_channel": "stable",
            "client_build_number": 0,
            "client_event_source": null
        }))
        .expect("static super properties serialize"),
    )
}

fn authentication_error(status: StatusCode, body: &str) -> DiscordError {
    if status == StatusCode::TOO_MANY_REQUESTS {
        return DiscordError::RateLimited {
            retry_after_ms: retry_after_ms(body),
        };
    }
    let message = body_message(body).unwrap_or_else(|| match status {
        StatusCode::UNAUTHORIZED => "invalid email or password".to_owned(),
        StatusCode::FORBIDDEN => "Discord refused this login".to_owned(),
        _ => format!("HTTP {}", status.as_u16()),
    });
    DiscordError::Authentication(message)
}

fn error_from_response(status: StatusCode, body: &str) -> DiscordError {
    if status == StatusCode::FORBIDDEN {
        return DiscordError::PermissionDenied(
            body_message(body).unwrap_or_else(|| "Discord denied this operation".to_owned()),
        );
    }
    if status == StatusCode::UNAUTHORIZED {
        return DiscordError::AuthenticationRequired;
    }
    if status == StatusCode::TOO_MANY_REQUESTS {
        return DiscordError::RateLimited {
            retry_after_ms: retry_after_ms(body),
        };
    }
    DiscordError::Http {
        status: status.as_u16(),
        message: body_message(body).unwrap_or_else(|| "Discord returned an error".to_owned()),
    }
}

fn body_message(body: &str) -> Option<String> {
    let parsed = serde_json::from_str::<Value>(body).ok()?;
    parsed
        .get("message")
        .and_then(Value::as_str)
        .map(|message| message.chars().take(200).collect())
}

fn retry_after_ms(body: &str) -> u64 {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| value.get("retry_after").cloned())
        .and_then(|value| value.as_f64())
        .map(|seconds| (seconds * 1000.0).max(0.0) as u64)
        .unwrap_or(1_000)
}

impl Drop for OfficialDiscordProvider {
    fn drop(&mut self) {
        if self.gateway_task.try_lock().is_ok() {
            if let Ok(mut cancel) = self.gateway_cancel.try_lock()
                && let Some(cancel) = cancel.take()
            {
                let _ = cancel.send(true);
            }
        } else {
            warn!("Gateway task was still running while provider dropped");
        }
    }
}
