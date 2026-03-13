mod config;
mod db;
mod homeservers;
mod keygen;
mod simulator;
mod social;
mod testnet;

use clap::Parser;
use colored::Colorize;

use config::{Cli, AntfarmConfig, Command};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    if let Some(Command::Keygen { index }) = cli.command {
        keygen::print_keygen(index);
        return Ok(());
    }

    run(&cli.config, cli.listen_only).await
}

async fn run(config_path: &str, listen_only: bool) -> anyhow::Result<()> {
    let config = AntfarmConfig::load(config_path)?;

    if config.tracing {
        tracing_subscriber::fmt()
            .with_env_filter(
                tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
                    "info,pubky_homeserver=debug,pubky=debug,pkarr_republisher=error,mainline=warn"
                        .parse()
                        .unwrap()
                }),
            )
            .init();
    }

    let db_labels: Vec<&str> = config.homeservers.iter().map(|h| h.label.as_str()).collect();

    println!("{}", "▸ Setting up databases".cyan().bold());
    db::setup_databases(config.postgres_url(), &db_labels).await?;

    let mut testnet = testnet::start().await?;
    let homeservers = homeservers::start_all(&mut testnet, &config).await?;

    db::list_databases(config.postgres_url()).await?;

    println!("\n{}", "▸ Network".cyan().bold());
    println!("  {} localhost:6881", "Bootstrap:".white().bold());
    println!(
        "  {}  {}",
        "Pkarr relay:".white().bold(),
        "http://localhost:15411".underline()
    );

    if listen_only {
        println!("\n{}", "▸ Listen-only mode — no data will be written".cyan().bold());
        tokio::signal::ctrl_c().await?;
        println!(
            "\n{} {}",
            "✓".green().bold(),
            "Shutting down...".green()
        );
    } else {
        println!("\n{}", "▸ Writing test data".cyan().bold());
        let sdk = testnet.sdk()?;
        let mut user_keys = social::UserKeys::new();
        let mut initial_events = Vec::new();
        let mut initial_posts = Vec::new();

        for (hs_name, hs_pk) in &homeservers {
            let (index, keypair) = user_keys.create_next();
            let (user_pk, post_id) = social::signup_and_write(&sdk, index, hs_pk, keypair).await?;
            initial_posts.push((user_pk.clone(), post_id));
            initial_events.push((hs_name.clone(), user_pk, hs_pk.clone()));
        }

        println!("\n{}", "▸ Reading events".cyan().bold());
        for (hs_name, user_pk, hs_pk) in &initial_events {
            social::read_events(&sdk, hs_name, user_pk, hs_pk).await;
        }

        let mut registry = simulator::Registry::new(user_keys, initial_posts);

        tokio::select! {
            res = simulator::run(&sdk, &homeservers, &mut registry, &config.simulator) => res?,
            _ = tokio::signal::ctrl_c() => {
                println!(
                    "\n{} {}",
                    "✓".green().bold(),
                    "Shutting down...".green()
                );
            }
        }
    }

    Ok(())
}
