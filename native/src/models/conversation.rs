use serde::{Deserialize, Serialize};

use super::User;

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
pub struct Conversation {
    pub id: String,
    #[serde(rename = "type", default)]
    pub kind: u8,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub recipients: Vec<User>,
    #[serde(default)]
    pub last_message_id: Option<String>,
}

impl Conversation {
    pub fn last_message_timestamp_millis(&self) -> Option<u64> {
        let snowflake = self.last_message_id.as_deref()?.parse::<u64>().ok()?;
        Some((snowflake >> 22) + 1_420_070_400_000)
    }

    pub fn title(&self) -> String {
        if let Some(name) = self.name.as_deref().filter(|name| !name.is_empty()) {
            return name.to_owned();
        }

        self.recipients
            .iter()
            .map(User::display_name)
            .collect::<Vec<_>>()
            .join(", ")
    }

    pub fn primary_user(&self) -> Option<&User> {
        self.recipients.first()
    }

    pub fn is_group_dm(&self) -> bool {
        self.kind == 3 || self.recipients.len() > 1 || self.name.is_some()
    }

    pub fn subtitle(&self) -> String {
        if self.is_group_dm() {
            format!("{} miembros", self.recipients.len().max(1))
        } else {
            "Mensaje directo".to_owned()
        }
    }
}

pub fn sort_conversations(conversations: &mut [Conversation]) {
    conversations.sort_by(|left, right| {
        right
            .last_message_timestamp_millis()
            .cmp(&left.last_message_timestamp_millis())
            .then_with(|| right.last_message_id.cmp(&left.last_message_id))
            .then_with(|| left.id.cmp(&right.id))
    });
}

#[cfg(test)]
mod tests {
    use super::{Conversation, sort_conversations};

    #[test]
    fn discord_type_field_is_kept_as_kind() {
        let conversation: Conversation = serde_json::from_str(
            r#"{
                "id": "dm-1",
                "type": 1,
                "recipients": [],
                "last_message_id": "message-1"
            }"#,
        )
        .expect("Discord DM payload deserializes");
        assert_eq!(conversation.kind, 1);
        assert_eq!(conversation.subtitle(), "Mensaje directo");
    }

    #[test]
    fn group_dm_uses_recipient_count() {
        let conversation: Conversation = serde_json::from_str(
            r#"{
                "id": "group-1",
                "type": 3,
                "name": "Friends",
                "recipients": [{"id":"1","username":"Ada"},{"id":"2","username":"Lin"}]
            }"#,
        )
        .expect("Discord group DM payload deserializes");
        assert!(conversation.is_group_dm());
        assert_eq!(conversation.subtitle(), "2 miembros");
    }

    #[test]
    fn last_message_timestamp_comes_from_discord_snowflake() {
        let conversation = Conversation {
            last_message_id: Some("175928847299117063".to_owned()),
            ..Conversation::default()
        };
        assert_eq!(
            conversation.last_message_timestamp_millis(),
            Some(1_462_015_105_796)
        );
    }

    #[test]
    fn conversations_are_sorted_by_newest_last_message_first() {
        let old_id = 175_928_847_299_117_063u64;
        let new_id = old_id + (1u64 << 22);
        let mut conversations = vec![
            Conversation {
                id: "old".to_owned(),
                last_message_id: Some(old_id.to_string()),
                ..Conversation::default()
            },
            Conversation {
                id: "empty".to_owned(),
                ..Conversation::default()
            },
            Conversation {
                id: "new".to_owned(),
                last_message_id: Some(new_id.to_string()),
                ..Conversation::default()
            },
        ];

        sort_conversations(&mut conversations);

        assert_eq!(
            conversations
                .iter()
                .map(|conversation| conversation.id.as_str())
                .collect::<Vec<_>>(),
            vec!["new", "old", "empty"]
        );
    }
}
