use colored::Colorize;
use pubky_app_specs::{traits::HasIdPath, PubkyAppFollow};
use pubky_testnet::pubky::{Keypair, Pubky};

use super::common::{self, Writable};

fn build(followee_z32: &str) -> anyhow::Result<Writable> {
    let follow = PubkyAppFollow::new();
    let path = PubkyAppFollow::create_path(followee_z32);
    let json = serde_json::to_string(&follow)?;
    Ok(Writable { path, json })
}

pub(crate) async fn create(
    sdk: &Pubky,
    keypair: Keypair,
    followee_z32: &str,
) -> anyhow::Result<()> {
    let signer = sdk.signer(keypair);
    let user_pk = signer.public_key();
    let z32 = user_pk.z32();
    let label = "[sim]".dimmed().to_string();

    let session = signer.signin().await?;
    let storage = session.storage();

    common::put(&storage, &build(followee_z32)?, &label, &z32).await?;

    Ok(())
}
