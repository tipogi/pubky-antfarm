use colored::Colorize;
use pubky_app_specs::{
    traits::{HasIdPath, TimestampId},
    PubkyAppPost, PubkyAppPostKind,
};
use pubky_testnet::pubky::{Keypair, PublicKey, Pubky};

use super::common::{self, Writable};

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
    sdk: &Pubky,
    keypair: Keypair,
    author_index: usize,
    mentioned: &[PublicKey],
) -> anyhow::Result<(PublicKey, String)> {
    let signer = sdk.signer(keypair);
    let user_pk = signer.public_key();
    let z32 = user_pk.z32();
    let label = "[seed]".yellow().bold().to_string();

    let session = signer.signin().await?;
    let storage = session.storage();

    let (writable, post_id) = build(author_index, mentioned)?;
    common::put(&storage, &writable, &label, &z32).await?;

    Ok((user_pk, post_id))
}
