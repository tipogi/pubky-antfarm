use colored::Colorize;
use pubky_testnet::pubky::{Keypair, PublicKey};
use pubky_testnet::pubky_homeserver::{ConfigToml, ConnectionString, HomeserverApp, MockDataDir};
use pubky_testnet::StaticTestnet;

use crate::config::{HomeserverEntry, AntfarmConfig};

pub async fn start_all(
    testnet: &mut StaticTestnet,
    config: &AntfarmConfig,
) -> anyhow::Result<Vec<(String, PublicKey)>> {
    let hs1_pk = testnet.homeserver_app().public_key();
    let hs1_http = testnet.homeserver_app().icann_http_url();
    print_hs("hs1", &hs1_pk.z32(), hs1_http.as_ref());

    let mut homeservers: Vec<(String, PublicKey)> = vec![("hs1".into(), hs1_pk)];
    for entry in &config.homeservers {
        let hs = create_fixed(testnet, config.postgres_url(), entry).await?;
        let pk = hs.public_key();
        let http = hs.icann_http_url();
        print_hs(&entry.label, &pk.z32(), http.as_ref());
        homeservers.push((entry.label.clone(), pk));
    }

    Ok(homeservers)
}

async fn create_fixed<'a>(
    testnet: &'a mut StaticTestnet,
    pg_url: &str,
    entry: &HomeserverEntry,
) -> anyhow::Result<&'a HomeserverApp> {
    let mut config = ConfigToml::default_test_config();
    let conn_str = crate::db::connection_string(pg_url, &entry.label);
    config.general.database_url = ConnectionString::new(&conn_str)?;
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
) -> anyhow::Result<(String, PublicKey, String)> {
    let label = format!("hs{}", index + 1);
    let seed_bytes = [index; 32];
    let mut config = ConfigToml::default_test_config();
    let conn_str = crate::db::connection_string(pg_url, &label);
    config.general.database_url = ConnectionString::new(&conn_str)?;
    let mock_dir = MockDataDir::new(config, Some(Keypair::from_secret(&seed_bytes)))?;
    let hs = testnet.testnet.create_homeserver_app_with_mock(mock_dir).await?;
    let pk = hs.public_key();
    let http_url = hs.icann_http_url().to_string();
    print_hs(&label, &pk.z32(), &http_url);
    Ok((label, pk, http_url))
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
