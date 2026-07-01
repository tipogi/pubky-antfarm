use colored::Colorize;
use pubky_app_specs::{
    traits::{HasIdPath, HashId},
    PubkyAppTag,
};
use rand::RngExt as _;

use super::common::{self, Writable};
use super::UserSession;

const TAG_LABELS: &[&str] = &[
    "cool",
    "interesting",
    "important",
    "funny",
    "relevant",
    "useful",
    "trending",
    "favorite",
    "bookmark",
    "recommend",
];

pub(crate) fn random_label() -> &'static str {
    let idx = rand::rng().random_range(0..TAG_LABELS.len());
    TAG_LABELS[idx]
}

pub(super) fn build(user_z32: &str, post_id: String, label: &str) -> anyhow::Result<Writable> {
    let post_uri = pubky_app_specs::post_uri_builder(user_z32.to_string(), post_id);
    build_for_uri(&post_uri, label)
}

fn build_for_uri(uri: &str, label: &str) -> anyhow::Result<Writable> {
    let tag = PubkyAppTag::new(uri.to_string(), label.into());
    let path = PubkyAppTag::create_path(&tag.create_id());
    let json = serde_json::to_string(&tag)?;
    Ok(Writable { path, json })
}

fn build_for_app(uri: &str, label: &str, app: &str) -> anyhow::Result<Writable> {
    let tag = PubkyAppTag::new(uri.to_string(), label.into());
    let id = tag.create_id();
    let path = format!("/pub/{app}/tags/{id}");
    let json = serde_json::to_string(&tag)?;
    Ok(Writable { path, json })
}

pub(crate) async fn create(
    session: &UserSession,
    target_uri: &str,
    tag_label: &str,
) -> anyhow::Result<()> {
    let z32 = session.public_key.z32();
    let label = "[sim]".dimmed().to_string();

    common::put(
        &session.storage,
        &build_for_uri(target_uri, tag_label)?,
        &label,
        &z32,
    )
    .await?;

    Ok(())
}

pub(crate) async fn create_for_app(
    session: &UserSession,
    target_uri: &str,
    tag_label: &str,
    app: &str,
) -> anyhow::Result<()> {
    let z32 = session.public_key.z32();
    let label = "[sim]".dimmed().to_string();

    common::put(
        &session.storage,
        &build_for_app(target_uri, tag_label, app)?,
        &label,
        &z32,
    )
    .await?;

    Ok(())
}
