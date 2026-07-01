use colored::Colorize;
use pubky_testnet::pubky::{Keypair, PublicKey};
use pubky_testnet::pubky_homeserver::{ConfigToml, ConnectionString, HomeserverApp, MockDataDir};
use pubky_testnet::StaticTestnet;

use crate::config::{AntfarmConfig, HomeserverEntry};

/// A homeserver tracked by the runtime, with the metadata needed for both
/// simulator activity (the `PublicKey`) and the dashboard (label, seed, URL).
pub struct Homeserver {
    pub label: String,
    pub seed: u8,
    pub public_key: PublicKey,
    pub http_url: String,
    /// Admin API base URL (e.g. `http://127.0.0.1:6288`).
    pub admin_url: String,
    /// Postgres connection string for this homeserver's database.
    pub database_url: String,
    /// Configured per-user storage quota in MB (`0` = unlimited).
    pub storage_quota_mb: u64,
    /// When `true`, no one may reference this homeserver's users — the simulator
    /// will not follow or tag them (nor tag their posts). An isolated "island".
    pub island: bool,
}

fn admin_url(hs: &HomeserverApp) -> String {
    hs.admin_server()
        .map(|admin| format!("http://{}", admin.listen_socket()))
        .unwrap_or_default()
}

fn test_config(pg_url: &str, label: &str, storage_quota_mb: u64) -> anyhow::Result<ConfigToml> {
    let mut config = ConfigToml::default_test_config();
    let conn_str = crate::db::connection_string(pg_url, label);
    config.general.database_url = ConnectionString::new(&conn_str)?;
    config.storage.default_quota_mb = (storage_quota_mb > 0).then_some(storage_quota_mb);
    Ok(config)
}

pub async fn start_all(
    testnet: &mut StaticTestnet,
    config: &AntfarmConfig,
) -> anyhow::Result<Vec<Homeserver>> {
    let quota_mb = config.user_storage_quota_mb;
    let hs1_app = testnet.homeserver_app();
    let hs1_pk = hs1_app.public_key();
    let hs1_http = hs1_app.icann_http_url().to_string();
    let hs1_admin = admin_url(hs1_app);
    let hs1_db = crate::db::connection_string(config.postgres_url(), "hs1");
    print_hs("hs1", &hs1_pk.z32(), &hs1_http);

    let mut homeservers: Vec<Homeserver> = vec![Homeserver {
        label: "hs1".into(),
        seed: 0,
        public_key: hs1_pk,
        http_url: hs1_http,
        admin_url: hs1_admin,
        database_url: hs1_db,
        storage_quota_mb: quota_mb,
        island: false,
    }];
    for entry in &config.homeservers {
        let conn_str = crate::db::connection_string(config.postgres_url(), &entry.label);
        let hs = create_fixed(testnet, config.postgres_url(), entry, quota_mb).await?;
        let pk = hs.public_key();
        let http = hs.icann_http_url().to_string();
        print_hs(&entry.label, &pk.z32(), &http);
        homeservers.push(Homeserver {
            label: entry.label.clone(),
            seed: entry.seed,
            public_key: pk,
            http_url: http,
            admin_url: admin_url(hs),
            database_url: conn_str,
            storage_quota_mb: quota_mb,
            island: false,
        });
    }

    Ok(homeservers)
}

async fn create_fixed<'a>(
    testnet: &'a mut StaticTestnet,
    pg_url: &str,
    entry: &HomeserverEntry,
    storage_quota_mb: u64,
) -> anyhow::Result<&'a HomeserverApp> {
    let config = test_config(pg_url, &entry.label, storage_quota_mb)?;
    let mock_dir = MockDataDir::new(config, Some(Keypair::from_secret(&entry.seed_bytes())))?;
    testnet
        .testnet
        .create_homeserver_app_with_mock(mock_dir)
        .await
}

pub async fn create_dynamic(
    testnet: &mut StaticTestnet,
    pg_url: &str,
    index: u8,
    storage_quota_mb: u64,
    island: bool,
) -> anyhow::Result<Homeserver> {
    let label = format!("hs{}", index + 1);
    let seed_bytes = [index; 32];
    let config = test_config(pg_url, &label, storage_quota_mb)?;
    let conn_str = crate::db::connection_string(pg_url, &label);
    let mock_dir = MockDataDir::new(config, Some(Keypair::from_secret(&seed_bytes)))?;
    let hs = testnet
        .testnet
        .create_homeserver_app_with_mock(mock_dir)
        .await?;
    let pk = hs.public_key();
    let http_url = hs.icann_http_url().to_string();
    print_hs(&label, &pk.z32(), &http_url);
    Ok(Homeserver {
        label,
        seed: index,
        public_key: pk,
        http_url,
        admin_url: admin_url(hs),
        database_url: conn_str,
        storage_quota_mb,
        island,
    })
}

pub fn print_hs(label: &str, pubkey: &str, http_url: &str) {
    println!(
        "  {} {} {}",
        "●".green(),
        label.white().bold(),
        pubkey.dimmed()
    );
    println!("    {} {}", "HTTP:".dimmed(), http_url.underline());
}
