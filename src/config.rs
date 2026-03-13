use std::path::Path;

use clap::{Parser, Subcommand};
use colored::Colorize;
use serde::Deserialize;

#[derive(Parser)]
#[command(about = "Local testnet with simulated social activity for testing Pubky services")]
pub struct Cli {
    /// Path to config file
    #[arg(long, default_value = "config.toml")]
    pub config: String,
    /// Start the network without writing any data or running the simulator
    #[arg(long)]
    pub listen_only: bool,
    #[command(subcommand)]
    pub command: Option<Command>,
}

#[derive(Subcommand)]
pub enum Command {
    /// Generate a deterministic keypair and 12-word mnemonic from an index
    Keygen {
        /// User index to derive the keypair from
        #[arg(long)]
        index: usize,
    },
}

#[derive(Deserialize)]
pub struct AntfarmConfig {
    #[serde(default = "default_true")]
    pub tracing: bool,
    #[serde(default)]
    pub postgres: PostgresConfig,
    #[serde(default)]
    pub homeservers: Vec<HomeserverEntry>,
    #[serde(default)]
    pub simulator: SimulatorConfig,
}

fn default_true() -> bool {
    true
}

#[derive(Deserialize)]
pub struct PostgresConfig {
    #[serde(default = "PostgresConfig::default_url")]
    pub url: String,
}

impl PostgresConfig {
    fn default_url() -> String {
        "postgres://postgres:postgres@localhost:5432/postgres".into()
    }
}

impl Default for PostgresConfig {
    fn default() -> Self {
        Self {
            url: Self::default_url(),
        }
    }
}

#[derive(Deserialize, Clone)]
pub struct HomeserverEntry {
    pub label: String,
    pub seed: u8,
}

impl HomeserverEntry {
    pub fn seed_bytes(&self) -> [u8; 32] {
        [self.seed; 32]
    }
}

#[derive(Deserialize)]
pub struct SimulatorConfig {
    #[serde(default = "SimulatorConfig::default_interval")]
    pub interval_secs: u64,
    #[serde(default = "SimulatorConfig::default_users")]
    pub users_per_tick: [u32; 2],
    #[serde(default = "SimulatorConfig::default_posts")]
    pub posts_per_tick: [u32; 2],
    #[serde(default = "SimulatorConfig::default_tags")]
    pub tags_per_tick: [u32; 2],
    #[serde(default = "SimulatorConfig::default_follows")]
    pub follows_per_tick: [u32; 2],
}

impl SimulatorConfig {
    fn default_interval() -> u64 {
        20
    }
    fn default_users() -> [u32; 2] {
        [0, 5]
    }
    fn default_posts() -> [u32; 2] {
        [0, 10]
    }
    fn default_tags() -> [u32; 2] {
        [0, 10]
    }
    fn default_follows() -> [u32; 2] {
        [0, 5]
    }
}

impl Default for SimulatorConfig {
    fn default() -> Self {
        Self {
            interval_secs: Self::default_interval(),
            users_per_tick: Self::default_users(),
            posts_per_tick: Self::default_posts(),
            tags_per_tick: Self::default_tags(),
            follows_per_tick: Self::default_follows(),
        }
    }
}

impl Default for AntfarmConfig {
    fn default() -> Self {
        Self {
            tracing: true,
            postgres: PostgresConfig::default(),
            homeservers: vec![
                HomeserverEntry {
                    label: "hs2".into(),
                    seed: 1,
                },
                HomeserverEntry {
                    label: "hs3".into(),
                    seed: 2,
                },
            ],
            simulator: SimulatorConfig::default(),
        }
    }
}

impl AntfarmConfig {
    pub fn load(path: &str) -> anyhow::Result<Self> {
        if !Path::new(path).exists() {
            let default_exists = Path::new("config.default.toml").exists();
            eprintln!(
                "\n  {} config file not found: {}\n",
                "✗".red().bold(),
                path.bold()
            );
            if default_exists {
                eprintln!(
                    "  {} copy the default config to get started:",
                    "→".cyan()
                );
                eprintln!("    {}\n", "cp config.default.toml config.toml".white().bold());
            } else {
                eprintln!(
                    "  {} create a {} with your settings\n",
                    "→".cyan(),
                    "config.toml".white().bold()
                );
            }
            eprintln!(
                "  {} or specify a different path:",
                "→".cyan()
            );
            eprintln!("    {}\n", "cargo run -- run --config path/to/config.toml".dimmed());
            std::process::exit(1);
        }

        let content = std::fs::read_to_string(path)?;
        let mut config = toml::from_str::<AntfarmConfig>(&content)?;

        if let Ok(url) = std::env::var("TEST_PUBKY_CONNECTION_STRING") {
            config.postgres.url = url;
        }

        Ok(config)
    }

    pub fn postgres_url(&self) -> &str {
        &self.postgres.url
    }
}
