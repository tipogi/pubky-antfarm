use std::collections::HashMap;
use std::net::SocketAddr;
use std::str::FromStr;

use colored::Colorize;
use pubky_testnet::pubky::{Keypair, PublicKey};
use pubky_testnet::pubky_homeserver::{ConfigToml, ConnectionString, DomainPort, HomeserverApp, MockDataDir};
use pubky_testnet::StaticTestnet;

use crate::config::{AntfarmConfig, HomeserverInitialState};

/// A homeserver tracked by the runtime, with the metadata needed for both
/// simulator activity (the `PublicKey`) and the dashboard (label, seed, URL).
#[derive(Clone)]
pub struct Homeserver {
    pub label: String,
    pub seed: u8,
    pub public_key: PublicKey,
    pub http_url: String,
    /// Admin API base URL (e.g. `http://127.0.0.1:6288`).
    pub admin_url: String,
    /// Pubky TLS listen URL (e.g. `https://127.0.0.1:6287`), reused on restart.
    pub pubky_tls_url: String,
    /// Postgres connection string for this homeserver's database.
    pub database_url: String,
    /// Configured per-user storage quota in MB (`0` = unlimited).
    pub storage_quota_mb: u64,
    /// When `true`, no one may reference this homeserver's users — the simulator
    /// will not follow or tag them (nor tag their posts). An isolated "island".
    pub island: bool,
    /// When `true`, the homeserver process is stopped; metadata and DB are kept.
    pub down: bool,
}

pub struct StartupHomeservers {
    pub active: Vec<Homeserver>,
    pub dormant: HashMap<u8, Homeserver>,
    /// Running homeserver processes for hs2+ keyed by seed. hs1 lives in StaticTestnet.
    pub apps: HashMap<u8, HomeserverApp>,
}

fn admin_url(hs: &HomeserverApp) -> String {
    hs.admin_server()
        .map(|admin| format!("http://{}", admin.listen_socket()))
        .unwrap_or_default()
}

fn urls_from_app(app: &HomeserverApp) -> (String, String, String) {
    (
        app.client_server().icann_http_url_string(),
        admin_url(app),
        app.client_server().pubky_tls_ip_url_ring(),
    )
}

fn has_stored_ports(hs: &Homeserver) -> bool {
    !hs.http_url.is_empty() && !hs.admin_url.is_empty() && !hs.pubky_tls_url.is_empty()
}

fn parse_listen_addr(url: &str) -> anyhow::Result<SocketAddr> {
    let rest = url
        .strip_prefix("http://")
        .or_else(|| url.strip_prefix("https://"))
        .ok_or_else(|| anyhow::anyhow!("listen URL must start with http:// or https://: {url}"))?;
    let host_port = rest.trim_end_matches('/');
    SocketAddr::from_str(host_port)
        .map_err(|e| anyhow::anyhow!("invalid listen address in {url}: {e}"))
}

fn apply_stored_ports(config: &mut ConfigToml, hs: &Homeserver) -> anyhow::Result<()> {
    config.drive.icann_listen_socket = parse_listen_addr(&hs.http_url)?;
    config.drive.pubky_listen_socket = parse_listen_addr(&hs.pubky_tls_url)?;
    config.admin.listen_socket = parse_listen_addr(&hs.admin_url)?;
    Ok(())
}

fn config_from_homeserver(hs: &Homeserver, storage_quota_mb: u64) -> anyhow::Result<ConfigToml> {
    let mut config = ConfigToml::default_test_config();
    config.general.database_url = ConnectionString::new(&hs.database_url)?;
    config.storage.default_quota_mb = (storage_quota_mb > 0).then_some(storage_quota_mb);
    if has_stored_ports(hs) {
        apply_stored_ports(&mut config, hs)?;
    }
    Ok(config)
}

fn wire_testnet_pkdns(testnet: &StaticTestnet, config: &mut ConfigToml) {
    config.pkdns.dht_bootstrap_nodes = Some(
        testnet
            .bootstrap_nodes()
            .iter()
            .filter_map(|node| DomainPort::from_str(node).ok())
            .collect(),
    );
    let relays = testnet.testnet.dht_relay_urls();
    config.pkdns.dht_relay_nodes = if relays.is_empty() {
        None
    } else {
        Some(relays)
    };
}

async fn start_mock_app(
    testnet: &StaticTestnet,
    hs: &Homeserver,
    storage_quota_mb: u64,
) -> anyhow::Result<HomeserverApp> {
    let mut config = config_from_homeserver(hs, storage_quota_mb)?;
    wire_testnet_pkdns(testnet, &mut config);

    let seed_bytes = [hs.seed; 32];
    let mock_dir = MockDataDir::new(config, Some(Keypair::from_secret(&seed_bytes)))?;
    HomeserverApp::start_with_mock_data_dir(mock_dir).await
}

/// Stop a running homeserver process. Metadata in the runtime is unchanged.
pub fn stop_app(
    apps: &mut HashMap<u8, HomeserverApp>,
    hs: &Homeserver,
) -> anyhow::Result<()> {
    if let Some(app) = apps.remove(&hs.seed) {
        drop(app);
        return Ok(());
    }

    anyhow::bail!("homeserver process is not running")
}

/// Start a homeserver process from existing metadata (same seed + database).
pub async fn start_app(
    testnet: &StaticTestnet,
    apps: &mut HashMap<u8, HomeserverApp>,
    hs: &Homeserver,
    storage_quota_mb: u64,
) -> anyhow::Result<(String, String, String)> {
    if hs.seed == 0 {
        anyhow::bail!("hs1 is managed by StaticTestnet and cannot be started here");
    }

    if apps.contains_key(&hs.seed) {
        anyhow::bail!("homeserver process is already running");
    }

    let app = start_mock_app(testnet, hs, storage_quota_mb).await?;
    let urls = urls_from_app(&app);
    apps.insert(hs.seed, app);
    Ok(urls)
}

pub async fn start_all(
    testnet: &mut StaticTestnet,
    config: &AntfarmConfig,
) -> anyhow::Result<StartupHomeservers> {
    let quota_mb = config.user_storage_quota_mb;
    let hs1_app = testnet.homeserver_app();
    let hs1_pk = hs1_app.public_key();
    let (hs1_http, hs1_admin, hs1_pubky_tls) = urls_from_app(hs1_app);
    let hs1_db = crate::db::connection_string(config.postgres_url(), "hs1");
    print_hs("hs1", &hs1_pk.z32(), &hs1_http);

    let mut active = Vec::new();
    let mut dormant = HashMap::new();
    let mut apps = HashMap::new();

    push_by_state(
        &mut active,
        &mut dormant,
        config.main_homeserver.state,
        Homeserver {
            label: "hs1".into(),
            seed: 0,
            public_key: hs1_pk,
            http_url: hs1_http,
            admin_url: hs1_admin,
            pubky_tls_url: hs1_pubky_tls,
            database_url: hs1_db,
            storage_quota_mb: quota_mb,
            island: config.main_homeserver.island,
            down: false,
        },
    );

    for entry in &config.homeservers {
        let conn_str = crate::db::connection_string(config.postgres_url(), &entry.label);
        let hs_meta = Homeserver {
            label: entry.label.clone(),
            seed: entry.seed,
            public_key: Keypair::from_secret(&entry.seed_bytes()).public_key(),
            http_url: String::new(),
            admin_url: String::new(),
            pubky_tls_url: String::new(),
            database_url: conn_str,
            storage_quota_mb: quota_mb,
            island: entry.island,
            down: false,
        };
        let app = start_mock_app(testnet, &hs_meta, quota_mb).await?;
        let pk = app.public_key();
        let (http, admin, pubky_tls) = urls_from_app(&app);
        print_hs(&entry.label, &pk.z32(), &http);
        apps.insert(entry.seed, app);
        push_by_state(
            &mut active,
            &mut dormant,
            entry.state,
            Homeserver {
                http_url: http,
                admin_url: admin,
                pubky_tls_url: pubky_tls,
                public_key: pk,
                ..hs_meta
            },
        );
    }

    Ok(StartupHomeservers {
        active,
        dormant,
        apps,
    })
}

fn push_by_state(
    active: &mut Vec<Homeserver>,
    dormant: &mut HashMap<u8, Homeserver>,
    state: HomeserverInitialState,
    homeserver: Homeserver,
) {
    match state {
        HomeserverInitialState::Active => active.push(homeserver),
        HomeserverInitialState::Dormant => {
            dormant.insert(homeserver.seed, homeserver);
        }
    }
}

pub async fn create_dynamic(
    testnet: &StaticTestnet,
    apps: &mut HashMap<u8, HomeserverApp>,
    pg_url: &str,
    index: u8,
    storage_quota_mb: u64,
    island: bool,
) -> anyhow::Result<Homeserver> {
    let label = format!("hs{}", index + 1);
    let seed_bytes = [index; 32];
    let conn_str = crate::db::connection_string(pg_url, &label);
    let hs_meta = Homeserver {
        label: label.clone(),
        seed: index,
        public_key: Keypair::from_secret(&seed_bytes).public_key(),
        http_url: String::new(),
        admin_url: String::new(),
        pubky_tls_url: String::new(),
        database_url: conn_str,
        storage_quota_mb,
        island,
        down: false,
    };
    let (http_url, admin, pubky_tls) = start_app(testnet, apps, &hs_meta, storage_quota_mb).await?;
    print_hs(&label, &hs_meta.public_key.z32(), &http_url);
    Ok(Homeserver {
        label,
        seed: index,
        public_key: hs_meta.public_key,
        http_url,
        admin_url: admin,
        pubky_tls_url: pubky_tls,
        database_url: hs_meta.database_url,
        storage_quota_mb,
        island,
        down: false,
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
