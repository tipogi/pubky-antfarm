use colored::Colorize;
use pubky_app_specs::{
    traits::{HasIdPath, TimestampId},
    PubkyAppPost, PubkyAppPostKind,
};
use pubky_testnet::pubky::{Keypair, Pubky, PublicKey};
use rand::RngExt as _;

use super::common::{self, Writable};

const WORDS: &[&str] = &[
    "hello", "world", "pubky", "rust", "async", "token", "node", "swarm", "hash", "key",
    "data", "sync", "peer", "link", "feed", "post", "user", "tag", "event", "stream",
    "block", "chain", "relay", "store", "cache", "query", "index", "table", "graph", "edge",
    "cloud", "local", "test", "debug", "build", "start", "stop", "run", "loop", "tick",
    "alpha", "beta", "gamma", "delta", "sigma", "omega", "proxy", "route", "layer", "stack",
    "fast", "cool", "nice", "bold", "free", "open", "safe", "deep", "wide", "new",
];

pub(crate) fn random_content() -> String {
    let mut rng = rand::rng();
    let word_count = rng.random_range(1..=10);
    (0..word_count)
        .map(|_| WORDS[rng.random_range(0..WORDS.len())])
        .collect::<Vec<_>>()
        .join(" ")
}

pub(super) fn build(name: &str) -> anyhow::Result<(Writable, String)> {
    build_with_content(&format!("Hello from {name}! This is my first post."))
}

fn build_with_content(content: &str) -> anyhow::Result<(Writable, String)> {
    let post = PubkyAppPost::new(
        content.to_string(),
        PubkyAppPostKind::Short,
        None,
        None,
        None,
    );
    let id = post.create_id();
    let path = PubkyAppPost::create_path(&id);
    let json = serde_json::to_string(&post)?;
    Ok((Writable { path, json }, id))
}

pub(crate) async fn create(
    sdk: &Pubky,
    keypair: Keypair,
    content: &str,
) -> anyhow::Result<(PublicKey, String)> {
    let signer = sdk.signer(keypair);
    let user_pk = signer.public_key();
    let z32 = user_pk.z32();
    let label = "[sim]".dimmed().to_string();

    let session = signer.signin().await?;
    let storage = session.storage();

    let (writable, post_id) = build_with_content(content)?;
    common::put(&storage, &writable, &label, &z32).await?;

    Ok((user_pk, post_id))
}
