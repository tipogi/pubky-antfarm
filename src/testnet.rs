use std::io::Write;

use colored::Colorize;
use pubky_testnet::pubky_homeserver::{ConfigToml, ConnectionString};
use pubky_testnet::StaticTestnet;

use crate::config::AntfarmConfig;

pub async fn start(config: &AntfarmConfig) -> anyhow::Result<StaticTestnet> {
    println!("\n{}", "▸ Starting testnet".cyan().bold());

    let mut hs_config = ConfigToml::default_test_config();
    hs_config.general.user_storage_quota_mb = config.user_storage_quota_mb;
    let hs1_db = crate::db::connection_string(config.postgres_url(), "hs1");
    hs_config.general.database_url = ConnectionString::new(&hs1_db)?;

    let mut tmp = tempfile::NamedTempFile::new()?;
    write!(tmp, "{}", toml::to_string(&hs_config)?)?;
    let config_path = tmp.path().to_path_buf();

    StaticTestnet::start_with_homeserver_config(config_path)
        .await
        .inspect_err(|e| {
            let msg = e.to_string();
            if msg.contains("6881") && msg.contains("already in use") {
                print_port_collision_help();
                std::process::exit(1);
            }
        })
}

fn print_port_collision_help() {
    eprintln!(
        "\n  {} {}\n",
        "✗".red().bold(),
        "UDP port 6881 is already in use".red().bold()
    );
    eprintln!("  The StaticTestnet needs port 6881 for its DHT bootstrap node,");
    eprintln!("  but another process already holds it.\n");
    eprintln!(
        "  {} The mainline DHT library defaults to port 6881 for any DHT",
        "ℹ".cyan()
    );
    eprintln!("    node, including clients created by testnet_with_host().");
    eprintln!("    If Nexus or another service using PubkyHttpClient started");
    eprintln!("    first, its DHT node grabbed port 6881 before the testnet.\n");
    eprintln!(
        "  {} Run: {}",
        "→".cyan(),
        "lsof -i UDP:6881".white().bold()
    );
    eprintln!("    to find which process holds the port, then kill it and");
    eprintln!(
        "    restart pubky-antfarm {} external services.\n",
        "before".white().bold()
    );
}
