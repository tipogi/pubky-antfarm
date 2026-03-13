use std::path::Path;

use pubky_app_specs::{
    blob_uri_builder, file_uri_builder,
    traits::{HasIdPath, HashId, TimestampId},
    PubkyAppBlob, PubkyAppFile,
};
use pubky_testnet::pubky::SessionStorage;

use super::common::{self, Writable};

const AVATARS_DIR: &str = "static/avatars";

async fn fetch_avatar(index: usize) -> anyhow::Result<Vec<u8>> {
    let dir = Path::new(AVATARS_DIR);
    let file_path = dir.join(format!("{index}.jpg"));

    if file_path.exists() {
        return Ok(std::fs::read(&file_path)?);
    }

    std::fs::create_dir_all(dir)?;

    let url = format!("https://robohash.org/{index}.jpg");
    let bytes = reqwest::get(&url).await?.bytes().await?.to_vec();

    std::fs::write(&file_path, &bytes)?;
    Ok(bytes)
}

/// Downloads the robohash avatar for `index`, uploads it as a blob + file
/// metadata to the homeserver, and returns the file URI for use in profile.json.
pub(super) async fn upload_avatar(
    storage: &SessionStorage,
    index: usize,
    label: &str,
    user_z32: &str,
) -> anyhow::Result<String> {
    let avatar_bytes = fetch_avatar(index).await?;

    // PUT blob (raw bytes)
    let blob = PubkyAppBlob::new(avatar_bytes.clone());
    let blob_id = blob.create_id();
    let blob_path = PubkyAppBlob::create_path(&blob_id);
    common::put_bytes(storage, &blob_path, avatar_bytes.clone(), label, user_z32).await?;

    // PUT file metadata (JSON)
    let blob_uri = blob_uri_builder(user_z32.to_string(), blob_id);
    let file = PubkyAppFile::new(
        format!("{index}.jpg"),
        blob_uri,
        "image/jpeg".into(),
        avatar_bytes.len(),
    );
    let file_id = file.create_id();
    let file_path = PubkyAppFile::create_path(&file_id);
    let file_writable = Writable {
        path: file_path,
        json: serde_json::to_string(&file)?,
    };
    common::put(storage, &file_writable, label, user_z32).await?;

    Ok(file_uri_builder(user_z32.to_string(), file_id))
}
