use colored::Colorize;
use pubky_app_specs::{traits::HasPath, PubkyAppUser, PubkyAppUserLink};
use pubky_testnet::pubky::{Keypair, Pubky, PublicKey, SessionStorage};

use super::common::{self, Writable};
use super::{file, identity, post, tag};

/// Signs up a user on the given homeserver, returns (public_key, storage).
pub(crate) async fn signup(
    sdk: &Pubky,
    keypair: Keypair,
    hs_pk: &PublicKey,
) -> anyhow::Result<(PublicKey, SessionStorage)> {
    let signer = sdk.signer(keypair);
    let user_pk = signer.public_key();
    let session = signer.signup(hs_pk, None).await?;
    println!(
        "  {} signed up user {}",
        "[signup]".magenta().bold(),
        user_pk.z32().dimmed()
    );
    Ok((user_pk, session.storage()))
}

/// Writes profile.json (with avatar) for an already signed-up user.
pub(crate) async fn write_profile(
    storage: &SessionStorage,
    index: usize,
    user_pk: &PublicKey,
) -> anyhow::Result<()> {
    let name = identity::user_name();
    let label = format!("[{name}]").magenta().bold().to_string();
    let z32 = user_pk.z32();

    let image_uri = file::upload_avatar(storage, index, &label, &z32).await?;

    let user = PubkyAppUser::new(
        name.clone(),
        Some(format!("Antfarm test user {name}. im index {index}")),
        Some(image_uri),
        Some(vec![PubkyAppUserLink::new(
            "Website".into(),
            "https://pubky.app".into(),
        )]),
        Some("Online".into()),
    );
    let profile_writable = Writable {
        path: PubkyAppUser::create_path(),
        json: serde_json::to_string(&user)?,
    };
    common::put(storage, &profile_writable, &label, &z32).await?;

    Ok(())
}

/// Full signup + profile + first post + tag (used by the simulator).
pub(crate) async fn signup_and_write(
    sdk: &Pubky,
    index: usize,
    hs_pk: &PublicKey,
    keypair: Keypair,
) -> anyhow::Result<(PublicKey, String)> {
    let (user_pk, storage) = signup(sdk, keypair, hs_pk).await?;

    let name = identity::user_name();
    let label = format!("[{name}]").magenta().bold().to_string();
    let z32 = user_pk.z32();

    let image_uri = file::upload_avatar(&storage, index, &label, &z32).await?;

    let user = PubkyAppUser::new(
        name.clone(),
        Some(format!("Antfarm test user {name}. im index {index}")),
        Some(image_uri),
        Some(vec![PubkyAppUserLink::new(
            "Website".into(),
            "https://pubky.app".into(),
        )]),
        Some("Online".into()),
    );
    let profile_writable = Writable {
        path: PubkyAppUser::create_path(),
        json: serde_json::to_string(&user)?,
    };
    common::put(&storage, &profile_writable, &label, &z32).await?;

    let (post_writable, post_id) = post::build(&name)?;
    common::put(&storage, &post_writable, &label, &z32).await?;

    common::put(
        &storage,
        &tag::build(&z32, post_id.clone(), "hello")?,
        &label,
        &z32,
    )
    .await?;

    Ok((user_pk, post_id))
}
