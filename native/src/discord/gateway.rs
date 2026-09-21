use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::{
    select,
    sync::{broadcast, watch},
};
use tokio_tungstenite::{connect_async, tungstenite::Message as WsMessage};

use crate::models::{Message, User};

use super::DiscordError;
use super::provider::{ConnectionStatus, DiscordEvent};

const GATEWAY_URL: &str = "wss://gateway.discord.gg/?v=10&encoding=json";
const DIRECT_MESSAGES_INTENT: u64 = 1 << 12;
const MESSAGE_CONTENT_INTENT: u64 = 1 << 15;

#[derive(Debug, Deserialize)]
struct GatewayEnvelope {
    op: u8,
    #[serde(default)]
    t: Option<String>,
    #[serde(default)]
    d: Value,
}

#[derive(Debug, Deserialize)]
struct HelloData {
    heartbeat_interval: u64,
}

pub async fn run(
    token: String,
    events: broadcast::Sender<DiscordEvent>,
    mut cancel: watch::Receiver<bool>,
) {
    let mut attempt = 0_u32;
    loop {
        if *cancel.borrow() {
            return;
        }

        if attempt == 0 {
            send_event(
                &events,
                DiscordEvent::Connection(ConnectionStatus::Connecting),
            );
        } else {
            send_event(
                &events,
                DiscordEvent::Connection(ConnectionStatus::Reconnecting { attempt }),
            );
        }

        match run_connection(&token, &events, &mut cancel).await {
            Ok(()) => {
                send_event(
                    &events,
                    DiscordEvent::Connection(ConnectionStatus::Disconnected {
                        reason: "Gateway closed".to_owned(),
                    }),
                );
                return;
            }
            Err(DiscordError::Cancelled) => return,
            Err(error) => {
                send_event(
                    &events,
                    DiscordEvent::Connection(ConnectionStatus::Disconnected {
                        reason: safe_gateway_reason(&error),
                    }),
                );
                attempt = attempt.saturating_add(1);
                let delay = reconnect_delay(attempt);
                if select! {
                    _ = tokio::time::sleep(delay) => false,
                    changed = cancel.changed() => changed.is_ok() && *cancel.borrow(),
                } {
                    return;
                }
            }
        }
    }
}

async fn run_connection(
    token: &str,
    events: &broadcast::Sender<DiscordEvent>,
    cancel: &mut watch::Receiver<bool>,
) -> Result<(), DiscordError> {
    let (mut socket, _) = connect_async(GATEWAY_URL)
        .await
        .map_err(|error| DiscordError::Network(format!("Gateway connection failed: {error}")))?;

    let hello = loop {
        let Some(message) = next_socket_message(&mut socket, cancel).await? else {
            return Ok(());
        };
        let WsMessage::Text(text) = message else {
            continue;
        };
        let envelope = parse_envelope(&text)?;
        if envelope.op == 10 {
            break serde_json::from_value::<HelloData>(envelope.d).map_err(|error| {
                DiscordError::Protocol(format!("invalid Gateway hello: {error}"))
            })?;
        }
    };

    let identify = json!({
        "op": 2,
        "d": {
            "token": token,
            "properties": {
                "os": "windows",
                "browser": "mooncord-native",
                "device": "mooncord-native"
            },
            "intents": DIRECT_MESSAGES_INTENT | MESSAGE_CONTENT_INTENT
        }
    });
    socket
        .send(WsMessage::Text(identify.to_string().into()))
        .await
        .map_err(|error| DiscordError::Network(format!("Gateway identify failed: {error}")))?;
    send_event(
        events,
        DiscordEvent::Connection(ConnectionStatus::Connected),
    );

    let heartbeat = Duration::from_millis(hello.heartbeat_interval.max(1));
    let mut heartbeat_timer = tokio::time::interval(heartbeat);
    heartbeat_timer.tick().await;

    loop {
        select! {
            changed = cancel.changed() => {
                if changed.is_err() || *cancel.borrow() {
                    let _ = socket.send(WsMessage::Close(None)).await;
                    return Err(DiscordError::Cancelled);
                }
            }
            _ = heartbeat_timer.tick() => {
                let heartbeat_message = json!({ "op": 1, "d": Value::Null });
                socket.send(WsMessage::Text(heartbeat_message.to_string().into())).await
                    .map_err(|error| DiscordError::Network(format!("Gateway heartbeat failed: {error}")))?;
            }
            next = socket.next() => {
                let Some(result) = next else { return Ok(()); };
                let message = result.map_err(|error| DiscordError::Network(format!("Gateway read failed: {error}")))?;
                if let Some(event) = dispatch(message)? {
                    send_event(events, event);
                }
            }
        }
    }
}

async fn next_socket_message<S>(
    socket: &mut S,
    cancel: &mut watch::Receiver<bool>,
) -> Result<Option<WsMessage>, DiscordError>
where
    S: futures_util::Stream<Item = Result<WsMessage, tokio_tungstenite::tungstenite::Error>>
        + Unpin,
{
    select! {
        changed = cancel.changed() => {
            if changed.is_err() || *cancel.borrow() { return Err(DiscordError::Cancelled); }
            Ok(None)
        }
        next = socket.next() => {
            let Some(result) = next else { return Ok(None); };
            result.map(Some).map_err(|error| DiscordError::Network(format!("Gateway read failed: {error}")))
        }
    }
}

fn dispatch(message: WsMessage) -> Result<Option<DiscordEvent>, DiscordError> {
    let WsMessage::Text(text) = message else {
        return Ok(None);
    };
    let envelope = parse_envelope(&text)?;
    match envelope.op {
        0 => dispatch_event(envelope.t.as_deref(), envelope.d),
        7 => Err(DiscordError::Protocol(
            "Gateway requested reconnect".to_owned(),
        )),
        9 => Err(DiscordError::Authentication(
            "Gateway rejected the session".to_owned(),
        )),
        _ => Ok(None),
    }
}

fn dispatch_event(
    event_name: Option<&str>,
    data: Value,
) -> Result<Option<DiscordEvent>, DiscordError> {
    match event_name {
        Some("READY") => {
            let user =
                serde_json::from_value::<User>(data.get("user").cloned().unwrap_or_default())
                    .map_err(|error| {
                        DiscordError::Protocol(format!("invalid READY user: {error}"))
                    })?;
            Ok(Some(DiscordEvent::Ready { user }))
        }
        Some("MESSAGE_CREATE") => serde_json::from_value::<Message>(data)
            .map(|message| Some(DiscordEvent::MessageCreate(message)))
            .map_err(|error| DiscordError::Protocol(format!("invalid MESSAGE_CREATE: {error}"))),
        Some("MESSAGE_UPDATE") => serde_json::from_value::<Message>(data)
            .map(|message| Some(DiscordEvent::MessageUpdate(message)))
            .map_err(|error| DiscordError::Protocol(format!("invalid MESSAGE_UPDATE: {error}"))),
        Some("MESSAGE_DELETE") => {
            let channel_id = data
                .get("channel_id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            let message_id = data
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            if channel_id.is_empty() || message_id.is_empty() {
                return Err(DiscordError::Protocol(
                    "MESSAGE_DELETE did not include identifiers".to_owned(),
                ));
            }
            Ok(Some(DiscordEvent::MessageDelete {
                channel_id,
                message_id,
            }))
        }
        _ => Ok(None),
    }
}

fn parse_envelope(text: &str) -> Result<GatewayEnvelope, DiscordError> {
    serde_json::from_str(text)
        .map_err(|error| DiscordError::Protocol(format!("invalid Gateway payload: {error}")))
}

fn send_event(events: &broadcast::Sender<DiscordEvent>, event: DiscordEvent) {
    let _ = events.send(event);
}

pub fn reconnect_delay(attempt: u32) -> Duration {
    let exponent = attempt.saturating_sub(1).min(5);
    Duration::from_secs(2_u64.saturating_pow(exponent).min(30))
}

fn safe_gateway_reason(error: &DiscordError) -> String {
    match error {
        DiscordError::Network(_) => "Network failure".to_owned(),
        DiscordError::Authentication(_) => "Authentication rejected".to_owned(),
        DiscordError::Protocol(_) => "Protocol failure".to_owned(),
        _ => "Gateway disconnected".to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::reconnect_delay;
    use std::time::Duration;

    #[test]
    fn reconnect_backoff_is_bounded() {
        assert_eq!(reconnect_delay(1), Duration::from_secs(1));
        assert_eq!(reconnect_delay(2), Duration::from_secs(2));
        assert_eq!(reconnect_delay(6), Duration::from_secs(30));
        assert_eq!(reconnect_delay(20), Duration::from_secs(30));
    }
}
