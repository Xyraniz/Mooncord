use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer, Serialize};
use uuid::Uuid;

use super::User;

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
pub enum MessageKind {
    #[default]
    Default,
    Reply,
    System,
}

impl<'de> Deserialize<'de> for MessageKind {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = serde_json::Value::deserialize(deserializer)?;
        Ok(match value {
            serde_json::Value::String(value) if value.eq_ignore_ascii_case("reply") => Self::Reply,
            serde_json::Value::String(value) if value.eq_ignore_ascii_case("system") => {
                Self::System
            }
            _ => Self::Default,
        })
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct Attachment {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub filename: String,
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub proxy_url: Option<String>,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    #[serde(default)]
    pub content_type: Option<String>,
    #[serde(default)]
    pub ephemeral: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct Message {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub channel_id: String,
    #[serde(default)]
    pub author: User,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
    #[serde(default)]
    pub timestamp: String,
    #[serde(default)]
    pub edited_timestamp: Option<String>,
    #[serde(default)]
    pub kind: MessageKind,
    #[serde(default)]
    pub pending: bool,
    #[serde(default)]
    pub failed: bool,
}

impl Message {
    pub fn pending(channel_id: &str, author: User, content: &str) -> Self {
        Self {
            id: format!("pending-{}", Uuid::new_v4()),
            channel_id: channel_id.to_owned(),
            author,
            content: content.to_owned(),
            attachments: Vec::new(),
            timestamp: Utc::now().to_rfc3339(),
            edited_timestamp: None,
            kind: MessageKind::Default,
            pending: true,
            failed: false,
        }
    }

    pub fn timestamp_value(&self) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(&self.timestamp)
            .map(|value| value.with_timezone(&Utc))
            .unwrap_or(DateTime::<Utc>::UNIX_EPOCH)
    }

    pub fn is_same_day_as(&self, other: &Self) -> bool {
        self.timestamp_value().date_naive() == other.timestamp_value().date_naive()
    }
}

pub fn sort_messages(messages: &mut [Message]) {
    messages.sort_by(|left, right| {
        left.timestamp_value()
            .cmp(&right.timestamp_value())
            .then_with(|| left.id.cmp(&right.id))
    });
}

#[cfg(test)]
mod tests {
    use super::{Attachment, Message, MessageKind, sort_messages};
    use crate::models::User;

    fn message(id: &str, timestamp: &str) -> Message {
        Message {
            id: id.to_owned(),
            channel_id: "channel".to_owned(),
            author: User {
                id: "user".to_owned(),
                username: "Ada".to_owned(),
                ..User::default()
            },
            content: "hello".to_owned(),
            attachments: Vec::new(),
            timestamp: timestamp.to_owned(),
            edited_timestamp: None,
            kind: MessageKind::Default,
            pending: false,
            failed: false,
        }
    }

    #[test]
    fn message_serialization_round_trips() {
        let original = message("one", "2026-01-01T00:00:00Z");
        let encoded = serde_json::to_string(&original).expect("message serializes");
        let decoded: Message = serde_json::from_str(&encoded).expect("message deserializes");
        assert_eq!(decoded, original);
    }

    #[test]
    fn message_attachments_round_trip() {
        let mut original = message("image", "photo");
        original.attachments.push(Attachment {
            id: "attachment-1".to_owned(),
            filename: "photo.png".to_owned(),
            size: 1024,
            url: "https://cdn.discordapp.com/attachments/1/photo.png".to_owned(),
            proxy_url: Some("https://media.discordapp.net/attachments/1/photo.png".to_owned()),
            width: Some(640),
            height: Some(480),
            content_type: Some("image/png".to_owned()),
            ephemeral: false,
        });
        let encoded = serde_json::to_string(&original).expect("attachment serializes");
        let decoded: Message = serde_json::from_str(&encoded).expect("attachment deserializes");
        assert_eq!(decoded.attachments, original.attachments);
    }

    #[test]
    fn messages_are_sorted_by_timestamp_then_id() {
        let mut messages = vec![
            message("two", "2026-01-01T00:00:02Z"),
            message("one", "2026-01-01T00:00:01Z"),
            message("three", "2026-01-01T00:00:02Z"),
        ];
        sort_messages(&mut messages);
        assert_eq!(
            messages
                .iter()
                .map(|message| message.id.as_str())
                .collect::<Vec<_>>(),
            vec!["one", "three", "two"]
        );
    }
}
