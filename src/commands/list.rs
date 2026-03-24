use std::collections::HashMap;
use std::io::Write;

use anyhow::Context;
use colored::Colorize;
use pubky_testnet::pubky::{Keypair, PubkyHttpClient, Pubky, PublicKey};

use crate::config::AntfarmConfig;
use super::keygen::keypair_from_index;

const SPINNER: &[&str] = &["◰", "◳", "◲", "◱"];

struct Homeserver {
    label: String,
    users: Vec<User>,
}

struct User {
    index: usize,
    public_key: PublicKey,
}

pub async fn run(config_path: &str) -> anyhow::Result<()> {
    let config = AntfarmConfig::load(config_path)?;

    let sdk = {
        let client = PubkyHttpClient::builder()
            .testnet_with_host("127.0.0.1")
            .build()
            .context("failed to connect to testnet — is antfarm running?")?;
        Pubky::with_client(client)
    };

    let mut hs_map: HashMap<String, Homeserver> = HashMap::new();

    let hs1_pk = Keypair::from_secret(&[0; 32]).public_key();
    hs_map.insert(hs1_pk.z32(), Homeserver { label: "hs1".into(), users: Vec::new() });

    for entry in &config.homeservers {
        let pk = Keypair::from_secret(&entry.seed_bytes()).public_key();
        hs_map.insert(pk.z32(), Homeserver { label: entry.label.clone(), users: Vec::new() });
    }

    let user_index_start = config.user_index_start();

    print!("\n  {} Discovering users...", SPINNER[0].cyan());
    std::io::stdout().flush().ok();

    let mut index = user_index_start;
    loop {
        let frame = SPINNER[(index - user_index_start) % SPINNER.len()];
        print!("\r  {} Discovering users... index {}", frame.cyan(), index);
        std::io::stdout().flush().ok();

        let (_, kp) = keypair_from_index(index);
        let user_pk = kp.public_key();

        match sdk.get_homeserver_of(&user_pk).await {
            Some(hs_pk) => {
                let hs_z32 = hs_pk.z32();
                if let Some(hs) = hs_map.get_mut(&hs_z32) {
                    hs.users.push(User { index, public_key: user_pk });
                } else {
                    eprintln!(
                        "\r  {} user {} is on unknown homeserver {}",
                        "?".yellow(),
                        index,
                        hs_z32.dimmed()
                    );
                }
            }
            None => break,
        }

        index += 1;
    }

    print!("\r                                              \r");

    let total_users: usize = hs_map.values().map(|hs| hs.users.len()).sum();

    println!("\n{}", "▸ Homeservers & Users".cyan().bold());
    println!(
        "  {} users discovered (indices {}..{})",
        total_users.to_string().white().bold(),
        user_index_start,
        index - 1
    );

    let mut ordered: Vec<_> = hs_map.into_values().collect();
    ordered.sort_by(|a, b| a.label.cmp(&b.label));

    for hs in &ordered {
        println!(
            "\n  {} ({} users)",
            hs.label.white().bold(),
            hs.users.len()
        );
        for user in &hs.users {
            println!(
                "    user {}: {}",
                user.index.to_string().yellow(),
                user.public_key.z32()
            );
        }
    }

    println!();
    Ok(())
}
