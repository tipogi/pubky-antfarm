use colored::Colorize;
use pubky_app_specs::{traits::HasIdPath, PubkyAppFollow};

use super::common::{self, Writable};
use super::UserSession;

fn build(followee_z32: &str) -> anyhow::Result<Writable> {
    let follow = PubkyAppFollow::new();
    let path = PubkyAppFollow::create_path(followee_z32);
    let json = serde_json::to_string(&follow)?;
    Ok(Writable { path, json })
}

pub(crate) async fn create(session: &UserSession, followee_z32: &str) -> anyhow::Result<()> {
    let z32 = session.public_key.z32();
    let label = "[sim]".dimmed().to_string();

    common::put(&session.storage, &build(followee_z32)?, &label, &z32).await?;

    Ok(())
}
