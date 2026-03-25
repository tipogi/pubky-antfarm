use colored::Colorize;

use crate::config::HomeserverAction;
use crate::control;

pub async fn run(addr: &str, action: &HomeserverAction) -> anyhow::Result<()> {
    let (action_str, index) = match action {
        HomeserverAction::Create { index } => ("create", *index),
        HomeserverAction::Seed { index } => ("seed", *index),
        HomeserverAction::Stop { index } => ("stop", *index),
    };

    if index == 0 {
        anyhow::bail!("index 0 is reserved for hs1 (the built-in homeserver)");
    }

    let resp = match control::client::send(addr, action_str, index).await {
        Ok(r) => r,
        Err(e) => {
            eprintln!(
                "\n  {} {e}",
                "✗".red().bold(),
            );
            eprintln!(
                "  {} make sure antfarm is running: {}",
                "→".cyan(),
                "cargo run".white().bold()
            );
            std::process::exit(1);
        }
    };

    if resp.ok {
        let label = resp.label.unwrap_or_default();
        let message = resp.message.unwrap_or_default();

        if let (Some(pk), Some(url)) = (&resp.public_key, &resp.http_url) {
            println!(
                "\n  {} {} {}",
                "●".green(),
                label.white().bold(),
                pk.dimmed()
            );
            println!("    {} {}", "HTTP:".dimmed(), url.underline());
        }

        println!("\n  {} {}", "✓".green().bold(), message);
    } else {
        let msg = resp.error.unwrap_or_else(|| "unknown error".into());
        eprintln!("\n  {} {}", "✗".red().bold(), msg);
        std::process::exit(1);
    }

    Ok(())
}
