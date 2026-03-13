use colored::Colorize;
use pubky_testnet::pubky::SessionStorage;

pub(super) struct Writable {
    pub path: String,
    pub json: String,
}

pub(super) async fn put(
    storage: &SessionStorage,
    w: &Writable,
    label: &str,
    user_z32: &str,
) -> anyhow::Result<()> {
    storage.put(&w.path, w.json.clone()).await?;
    let full_uri = format!("pubky://{}{}", user_z32, w.path);
    println!("  {} wrote {}", label, full_uri.dimmed());
    Ok(())
}

pub(super) async fn put_bytes(
    storage: &SessionStorage,
    path: &str,
    data: Vec<u8>,
    label: &str,
    user_z32: &str,
) -> anyhow::Result<()> {
    storage.put(path, data).await?;
    let full_uri = format!("pubky://{}{}", user_z32, path);
    println!("  {} wrote {}", label, full_uri.dimmed());
    Ok(())
}
