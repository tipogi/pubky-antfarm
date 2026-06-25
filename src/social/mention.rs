use colored::Colorize;
use pubky_app_specs::{
    traits::{HasIdPath, TimestampId},
    PubkyAppPost, PubkyAppPostKind,
};
use pubky_testnet::pubky::PublicKey;

use super::common::{self, Writable};
use super::UserSession;

fn build(author_index: usize, mentioned: &[PublicKey]) -> anyhow::Result<(Writable, String)> {
    let mentions_text: Vec<String> = mentioned
        .iter()
        .map(|pk| format!("pubky://{}", pk.z32()))
        .collect();

    let content = format!(
        "Post from user {} mentioning: {}",
        author_index,
        mentions_text.join(" ")
    );

    let post = PubkyAppPost::new(content, PubkyAppPostKind::Short, None, None, None);
    let id = post.create_id();
    let path = PubkyAppPost::create_path(&id);
    let json = serde_json::to_string(&post)?;
    Ok((Writable { path, json }, id))
}

pub(crate) async fn create(
    session: &UserSession,
    author_index: usize,
    mentioned: &[PublicKey],
) -> anyhow::Result<(PublicKey, String)> {
    let user_pk = session.public_key.clone();
    let z32 = user_pk.z32();
    let label = "[seed]".yellow().bold().to_string();

    let (writable, post_id) = build(author_index, mentioned)?;
    common::put(&session.storage, &writable, &label, &z32).await?;

    Ok((user_pk, post_id))
}
