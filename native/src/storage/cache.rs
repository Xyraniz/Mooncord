use std::collections::{HashMap, VecDeque};

use crate::models::{Message, sort_messages};

const DEFAULT_PER_CONVERSATION_LIMIT: usize = 200;

#[derive(Clone, Debug)]
pub struct MessageCache {
    per_conversation_limit: usize,
    messages: HashMap<String, VecDeque<Message>>,
}

impl Default for MessageCache {
    fn default() -> Self {
        Self::new(DEFAULT_PER_CONVERSATION_LIMIT)
    }
}

impl MessageCache {
    pub fn new(per_conversation_limit: usize) -> Self {
        Self {
            per_conversation_limit: per_conversation_limit.max(1),
            messages: HashMap::new(),
        }
    }

    pub fn upsert(&mut self, message: Message) {
        let channel_id = message.channel_id.clone();
        let entries = self.messages.entry(channel_id).or_default();
        if let Some(existing) = entries.iter_mut().find(|item| item.id == message.id) {
            *existing = message;
        } else {
            entries.push_back(message);
        }
        Self::sort_and_trim(entries, self.per_conversation_limit);
    }

    pub fn merge_page(&mut self, channel_id: &str, page: impl IntoIterator<Item = Message>) {
        for message in page {
            debug_assert!(message.channel_id == channel_id || message.channel_id.is_empty());
            let mut normalized = message;
            if normalized.channel_id.is_empty() {
                normalized.channel_id = channel_id.to_owned();
            }
            self.upsert(normalized);
        }
    }

    pub fn edit(&mut self, message: Message) {
        let channel_id = message.channel_id.clone();
        let entries = self.messages.entry(channel_id).or_default();
        if let Some(existing) = entries.iter_mut().find(|item| item.id == message.id) {
            if !message.content.is_empty() {
                existing.content = message.content;
            }
            if !message.author.id.is_empty() && !message.author.username.is_empty() {
                existing.author = message.author;
            }
            if !message.timestamp.is_empty() {
                existing.timestamp = message.timestamp;
            }
            if message.edited_timestamp.is_some() {
                existing.edited_timestamp = message.edited_timestamp;
            }
            existing.kind = message.kind;
        } else {
            self.upsert(message);
        }
    }

    pub fn remove(&mut self, channel_id: &str, message_id: &str) -> bool {
        let Some(entries) = self.messages.get_mut(channel_id) else {
            return false;
        };
        let previous_len = entries.len();
        entries.retain(|message| message.id != message_id);
        entries.len() != previous_len
    }

    pub fn messages(&self, channel_id: &str) -> Vec<Message> {
        self.messages
            .get(channel_id)
            .map(|messages| messages.iter().cloned().collect())
            .unwrap_or_default()
    }

    pub fn clear(&mut self) {
        self.messages.clear();
    }

    pub fn len(&self) -> usize {
        self.messages.values().map(VecDeque::len).sum()
    }

    fn sort_and_trim(entries: &mut VecDeque<Message>, per_conversation_limit: usize) {
        let mut sorted = entries.drain(..).collect::<Vec<_>>();
        sort_messages(&mut sorted);
        sorted.truncate(per_conversation_limit);
        entries.extend(sorted);
    }
}

#[cfg(test)]
mod tests {
    use super::MessageCache;
    use crate::models::{Message, User};

    fn message(id: &str, content: &str) -> Message {
        Message {
            id: id.to_owned(),
            channel_id: "channel".to_owned(),
            author: User {
                id: "user".to_owned(),
                username: "Ada".to_owned(),
                ..User::default()
            },
            content: content.to_owned(),
            timestamp: format!("2026-01-01T00:00:0{id}Z"),
            ..Message::default()
        }
    }

    #[test]
    fn upsert_deduplicates_and_edits_messages() {
        let mut cache = MessageCache::new(10);
        cache.upsert(message("1", "old"));
        cache.upsert(message("1", "new"));
        assert_eq!(cache.len(), 1);
        assert_eq!(cache.messages("channel")[0].content, "new");
    }

    #[test]
    fn deletion_is_idempotent() {
        let mut cache = MessageCache::default();
        cache.upsert(message("1", "hello"));
        assert!(cache.remove("channel", "1"));
        assert!(!cache.remove("channel", "1"));
    }
}
