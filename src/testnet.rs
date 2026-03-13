use colored::Colorize;
use pubky_testnet::StaticTestnet;

pub async fn start() -> anyhow::Result<StaticTestnet> {
    println!("\n{}", "▸ Starting testnet".cyan().bold());

    StaticTestnet::start().await.inspect_err(|e| {
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
