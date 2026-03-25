mod commands;
mod config;
mod control;
mod db;
mod homeservers;
mod runtime;
mod simulator;
mod social;
mod testnet;

use clap::Parser;
use config::{Cli, Command};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Some(Command::Keygen { index }) => {
            commands::keygen::print_keygen(index);
            Ok(())
        }
        Some(Command::List) => commands::list::run(&cli.config).await,
        Some(Command::Seed { ref action }) => commands::seed::run(action).await,
        Some(Command::Homeserver { ref addr, ref action }) => {
            commands::homeserver::run(addr, action).await
        }
        None => {
            runtime::Runtime::new(&cli.config)
                .await?
                .run(cli.listen_only)
                .await
        }
    }
}
