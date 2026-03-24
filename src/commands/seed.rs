use anyhow::Context;
use colored::Colorize;
use pubky_testnet::pubky::{PubkyHttpClient, Pubky};

use crate::config::SeedAction;
use crate::social;
use super::keygen::keypair_from_index;

fn connect_to_testnet() -> anyhow::Result<Pubky> {
    let client = PubkyHttpClient::builder()
        .testnet_with_host("127.0.0.1")
        .build()
        .context("failed to connect to testnet — is antfarm running on localhost?")?;
    Ok(Pubky::with_client(client))
}

pub async fn run(action: &SeedAction) -> anyhow::Result<()> {
    let sdk = connect_to_testnet()
        .context("seed command requires a running antfarm (cargo run)")?;

    println!("\n{}", "▸ Seeding cross-homeserver reference".cyan().bold());

    match action {
        SeedAction::Follow { from, to } => seed_follow(&sdk, *from, *to).await,
        SeedAction::Tag { from, to, label } => seed_tag(&sdk, *from, *to, label).await,
        SeedAction::Mention { from, to } => seed_mention(&sdk, *from, to).await,
    }
}

async fn seed_follow(sdk: &Pubky, from: usize, to: usize) -> anyhow::Result<()> {
    let (_, from_kp) = keypair_from_index(from);
    let (_, to_kp) = keypair_from_index(to);
    let from_pk = from_kp.public_key();
    let to_pk = to_kp.public_key();

    social::create_follow(sdk, from_kp, &to_pk.z32())
        .await
        .context(format!("failed to create follow from user {from} to user {to} — is antfarm running?"))?;

    println!("\n{}", "  Seed result:".white().bold());
    println!("  {} follow", "action:".dimmed());
    println!("  {} user {} ({})", "from:".dimmed(), from, from_pk.z32());
    println!("  {}   user {} ({})", "to:".dimmed(), to, to_pk.z32());
    println!(
        "  {}  pubky://{}/pub/pubky.app/follows/{}",
        "uri:".dimmed(),
        from_pk.z32(),
        to_pk.z32()
    );

    Ok(())
}

async fn seed_tag(sdk: &Pubky, from: usize, to: usize, label: &str) -> anyhow::Result<()> {
    let (_, from_kp) = keypair_from_index(from);
    let (_, to_kp) = keypair_from_index(to);
    let from_pk = from_kp.public_key();
    let to_pk = to_kp.public_key();
    let target_uri = format!("pubky://{}", to_pk.z32());

    social::create_tag(sdk, from_kp, &target_uri, label)
        .await
        .context(format!("failed to create tag from user {from} to user {to} — is antfarm running?"))?;

    println!("\n{}", "  Seed result:".white().bold());
    println!("  {} tag (label: {})", "action:".dimmed(), label.yellow());
    println!("  {} user {} ({})", "from:".dimmed(), from, from_pk.z32());
    println!("  {}   user {} ({})", "to:".dimmed(), to, to_pk.z32());
    println!("  {} {}", "target:".dimmed(), target_uri);

    Ok(())
}

async fn seed_mention(sdk: &Pubky, from: usize, to_indices: &[usize]) -> anyhow::Result<()> {
    if to_indices.is_empty() {
        anyhow::bail!("mention requires at least one --to index");
    }

    let (_, from_kp) = keypair_from_index(from);
    let from_pk = from_kp.public_key();
    let mut mentioned = Vec::with_capacity(to_indices.len());
    for &idx in to_indices {
        let (_, kp) = keypair_from_index(idx);
        mentioned.push(kp.public_key());
    }

    let (author_pk, post_id) = social::create_mention(sdk, from_kp, from, &mentioned)
        .await
        .context(format!("failed to create mention from user {from} — is antfarm running?"))?;

    println!("\n{}", "  Seed result:".white().bold());
    println!("  {} mention", "action:".dimmed());
    println!("  {} user {} ({})", "from:".dimmed(), from, from_pk.z32());
    for (i, idx) in to_indices.iter().enumerate() {
        println!(
            "  {}   user {} ({})",
            if i == 0 { "to:".dimmed() } else { "   ".dimmed() },
            idx,
            mentioned[i].z32()
        );
    }
    println!(
        "  {}  pubky://{}/pub/pubky.app/posts/{}",
        "uri:".dimmed(),
        author_pk.z32(),
        post_id
    );

    Ok(())
}
