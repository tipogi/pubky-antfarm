use colored::Colorize;
use pubky_app_specs::{
    traits::{HasIdPath, TimestampId},
    PubkyAppPost, PubkyAppPostKind,
};
use pubky_testnet::pubky::PublicKey;
use rand::RngExt as _;

use super::common::{self, Writable};
use super::post::random_content;
use super::UserSession;

const MENTION_TEMPLATES: &[&str] = &[
    "Shoutout to pubky{key}",
    "Thanks pubky{key}",
    "Hey pubky{key}",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Variant {
    Short,
    Mention,
    Repost,
    RepostMention,
}

impl Variant {
    pub(crate) fn parse(kind: &str) -> anyhow::Result<Self> {
        match kind.trim() {
            "short" => Ok(Self::Short),
            "mention" => Ok(Self::Mention),
            "repost" => Ok(Self::Repost),
            "repost_mention" => Ok(Self::RepostMention),
            other => anyhow::bail!("unknown social post kind: {other}"),
        }
    }
}

pub(crate) fn normalize_mention_key(key: &str) -> anyhow::Result<String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        anyhow::bail!("mention key is required");
    }
    if trimmed.contains("://") || trimmed.contains('/') {
        anyhow::bail!("mention key must be a bare pubky z32 key");
    }
    let z32 = trimmed.strip_prefix("pubky").unwrap_or(trimmed);
    if !z32
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        || z32.len() < 40
    {
        anyhow::bail!("invalid mention key");
    }
    Ok(z32.to_string())
}

pub(crate) fn normalize_post_uri(uri: &str) -> anyhow::Result<String> {
    let trimmed = uri.trim();
    if trimmed.is_empty() {
        anyhow::bail!("post URI is required");
    }
    if !trimmed.starts_with("pubky://") {
        anyhow::bail!("post URI must start with pubky://");
    }
    if !trimmed.contains("/pub/pubky.app/posts/") {
        anyhow::bail!("post URI must point to a pubky.app post");
    }
    Ok(trimmed.to_string())
}

fn mention_snippet(mention_z32: &str) -> String {
    let mut rng = rand::rng();
    let template = MENTION_TEMPLATES[rng.random_range(0..MENTION_TEMPLATES.len())];
    template.replace("{key}", mention_z32)
}

fn short_suffix() -> String {
    let mut rng = rand::rng();
    let word_count = rng.random_range(1..=3);
    (0..word_count)
        .map(|_| random_content())
        .collect::<Vec<_>>()
        .join(" ")
}

fn build_content(variant: Variant, mention_z32: Option<&str>) -> String {
    match variant {
        Variant::Short => random_content(),
        Variant::Mention => mention_snippet(mention_z32.expect("mention key checked upstream")),
        Variant::Repost => random_content(),
        Variant::RepostMention => {
            let mention = mention_snippet(mention_z32.expect("mention key checked upstream"));
            format!("{} — {}", mention, short_suffix())
        }
    }
}

fn build_post(content: &str, parent: Option<String>) -> anyhow::Result<(Writable, String)> {
    let post = PubkyAppPost::new(
        content.to_string(),
        PubkyAppPostKind::Short,
        parent,
        None,
        None,
    );
    let id = post.create_id();
    let path = PubkyAppPost::create_path(&id);
    let json = serde_json::to_string(&post)?;
    Ok((Writable { path, json }, id))
}

pub(crate) async fn create(
    session: &UserSession,
    variant: Variant,
    mention_key: Option<&str>,
    post_uri: Option<&str>,
) -> anyhow::Result<(PublicKey, String)> {
    let mention_z32 = match variant {
        Variant::Mention | Variant::RepostMention => {
            Some(normalize_mention_key(mention_key.unwrap_or_default())?)
        }
        Variant::Short | Variant::Repost => None,
    };

    let parent = match variant {
        Variant::Repost | Variant::RepostMention => {
            Some(normalize_post_uri(post_uri.unwrap_or_default())?)
        }
        Variant::Short | Variant::Mention => None,
    };

    let content = build_content(variant, mention_z32.as_deref());
    let user_pk = session.public_key.clone();
    let z32 = user_pk.z32();
    let label = "[post]".cyan().bold().to_string();

    let (writable, post_id) = build_post(&content, parent)?;
    common::put(&session.storage, &writable, &label, &z32).await?;

    Ok((user_pk, post_id))
}
