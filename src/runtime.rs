use std::collections::HashMap;
use std::time::Duration;

use colored::Colorize;
use pubky_testnet::pubky::{Pubky, PublicKey};

use crate::config::AntfarmConfig;
use crate::{control, db, homeservers, simulator, social, testnet};

pub struct Runtime {
    testnet: pubky_testnet::StaticTestnet,
    homeservers: Vec<(String, PublicKey)>,
    dormant: HashMap<u8, (String, PublicKey)>,
    config: AntfarmConfig,
    sdk: Pubky,
}

impl Runtime {
    pub async fn new(config_path: &str) -> anyhow::Result<Self> {
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

        let sdk = testnet.sdk()?;

        Ok(Self {
            testnet,
            homeservers,
            dormant: HashMap::new(),
            config,
            sdk,
        })
    }

    pub async fn run(mut self, listen_only: bool) -> anyhow::Result<()> {
        let (ctrl_tx, mut ctrl_rx) = tokio::sync::mpsc::channel::<control::Cmd>(8);
        tokio::spawn(control::server::listen(
            self.config.control_addr.clone(),
            ctrl_tx,
        ));

        if listen_only {
            println!(
                "\n{}",
                "▸ Listen-only mode — no data will be written".cyan().bold()
            );

            loop {
                tokio::select! {
                    Some(cmd) = ctrl_rx.recv() => {
                        self.handle_cmd(cmd, None).await;
                    }
                    _ = tokio::signal::ctrl_c() => {
                        println!("\n{} {}", "✓".green().bold(), "Shutting down...".green());
                        break;
                    }
                }
            }
        } else {
            println!("\n{}", "▸ Writing test data".cyan().bold());
            let mut user_keys = social::UserKeys::new(self.config.user_index_start());
            let mut initial_events = Vec::new();
            let mut initial_posts = Vec::new();

            for (hs_name, hs_pk) in &self.homeservers {
                let (index, keypair) = user_keys.create_next();
                let (user_pk, post_id) =
                    social::signup_and_write(&self.sdk, index, hs_pk, keypair).await?;
                initial_posts.push((user_pk.clone(), post_id));
                initial_events.push((hs_name.clone(), user_pk, hs_pk.clone()));
            }

            println!("\n{}", "▸ Reading events".cyan().bold());
            for (hs_name, user_pk, hs_pk) in &initial_events {
                social::read_events(&self.sdk, hs_name, user_pk, hs_pk).await;
            }

            let mut registry = simulator::Registry::new(user_keys, initial_posts);
            let secs = self.config.simulator.interval_secs;
            let mut interval = tokio::time::interval(Duration::from_secs(secs));
            let mut tick_num: u64 = 0;

            println!(
                "\n{} (every {}s)",
                "▸ Simulator running".cyan().bold(),
                secs
            );

            loop {
                tokio::select! {
                    _ = interval.tick() => {
                        tick_num += 1;
                        simulator::tick(
                            &self.sdk,
                            &self.homeservers,
                            &mut registry,
                            &self.config.simulator,
                            tick_num,
                        ).await;
                    }
                    Some(cmd) = ctrl_rx.recv() => {
                        self.handle_cmd(cmd, Some(&mut registry)).await;
                    }
                    _ = tokio::signal::ctrl_c() => {
                        println!("\n{} {}", "✓".green().bold(), "Shutting down...".green());
                        break;
                    }
                }
            }
        }

        Ok(())
    }

    async fn handle_cmd(
        &mut self,
        cmd: control::Cmd,
        registry: Option<&mut simulator::Registry>,
    ) {
        let reply = match cmd.action {
            control::Action::Create => match cmd.index {
                Some(i) => self.handle_create(i).await,
                None => Err(anyhow::anyhow!("create requires --index")),
            },
            control::Action::Seed => match cmd.index {
                Some(i) => self.handle_seed(i),
                None => Err(anyhow::anyhow!("seed requires --index")),
            },
            control::Action::Stop => match cmd.index {
                Some(i) => self.handle_stop(i),
                None => Err(anyhow::anyhow!("stop requires --index")),
            },
            control::Action::User => {
                self.handle_user(
                    cmd.index.map(|i| i as usize),
                    cmd.hs.unwrap_or(0),
                    cmd.profile,
                    registry,
                )
                .await
            }
        };
        let reply = reply.unwrap_or_else(|e| control::Reply::Err(format!("{e}")));
        let _ = cmd.reply.send(reply);
    }

    async fn handle_create(&mut self, index: u8) -> anyhow::Result<control::Reply> {
        if index == 0 {
            anyhow::bail!("index 0 is reserved for hs1 (the built-in homeserver)");
        }
        if (index as usize) >= self.config.max_homeservers {
            anyhow::bail!(
                "index {index} exceeds max_homeservers ({})",
                self.config.max_homeservers
            );
        }

        let label = Self::label_for(index);

        if self.dormant.contains_key(&index) {
            anyhow::bail!("{label} already created (dormant)");
        }
        if self.is_active(&label) {
            anyhow::bail!("{label} already exists (active)");
        }

        db::create_single_database(self.config.postgres_url(), &label).await?;

        let (label, pk, http_url) =
            homeservers::create_dynamic(&mut self.testnet, self.config.postgres_url(), index)
                .await?;

        self.dormant.insert(index, (label.clone(), pk.clone()));

        Ok(control::Reply::Ok {
            label,
            public_key: Some(pk.z32()),
            http_url: Some(http_url),
            message: "homeserver created (dormant — use `seed` to start simulator activity)"
                .into(),
        })
    }

    fn handle_seed(&mut self, index: u8) -> anyhow::Result<control::Reply> {
        if index == 0 {
            anyhow::bail!("hs1 is always active");
        }

        let label = Self::label_for(index);

        if self.is_active(&label) {
            anyhow::bail!("{label} is already active in the simulator");
        }

        let entry = self
            .dormant
            .remove(&index)
            .ok_or_else(|| anyhow::anyhow!("{label} not found — create it first"))?;

        self.homeservers.push(entry);

        println!(
            "  {} {} added to simulator",
            "✓".green().bold(),
            label.white().bold()
        );

        Ok(control::Reply::Ok {
            label,
            public_key: None,
            http_url: None,
            message: "homeserver added to simulator rotation".into(),
        })
    }

    fn handle_stop(&mut self, index: u8) -> anyhow::Result<control::Reply> {
        if index == 0 {
            anyhow::bail!("cannot stop hs1 (the built-in homeserver)");
        }

        let label = Self::label_for(index);

        let pos = self
            .homeservers
            .iter()
            .position(|(l, _)| l == &label)
            .ok_or_else(|| anyhow::anyhow!("{label} is not active"))?;

        let entry = self.homeservers.remove(pos);
        self.dormant.insert(index, entry);

        println!(
            "  {} {} removed from simulator",
            "■".red().bold(),
            label.white().bold()
        );

        Ok(control::Reply::Ok {
            label,
            public_key: None,
            http_url: None,
            message: "homeserver stopped (removed from simulator, still reachable)".into(),
        })
    }

    async fn handle_user(
        &self,
        user_index: Option<usize>,
        hs_index: u8,
        profile: bool,
        mut registry: Option<&mut simulator::Registry>,
    ) -> anyhow::Result<control::Reply> {
        let label = Self::label_for(hs_index);
        let hs_pk = self
            .homeservers
            .iter()
            .find(|(l, _)| l == &label)
            .map(|(_, pk)| pk.clone())
            .or_else(|| self.dormant.get(&hs_index).map(|(_, pk)| pk.clone()))
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "homeserver {label} not found (neither active nor dormant) — create it first"
                )
            })?;

        let (user_index, keypair) = match (user_index, &mut registry) {
            (Some(idx), _) => (idx, social::UserKeys::keypair_at(idx)),
            (None, Some(ref mut reg)) => reg.user_keys.create_next(),
            (None, None) => {
                anyhow::bail!("--index is required in listen-only mode (no registry to auto-assign)")
            }
        };

        let (user_pk, storage) = social::signup(&self.sdk, keypair, &hs_pk).await?;

        if profile {
            social::write_profile(&storage, user_index, &user_pk).await?;
        }

        if let Some(reg) = registry {
            reg.user_keys.register_at(user_index, user_pk.clone());
        }

        let action = if profile { "with profile" } else { "signup only" };
        Ok(control::Reply::Ok {
            label,
            public_key: Some(user_pk.z32()),
            http_url: None,
            message: format!("user {user_index} created ({action})"),
        })
    }

    fn label_for(index: u8) -> String {
        format!("hs{}", index + 1)
    }

    fn is_active(&self, label: &str) -> bool {
        self.homeservers.iter().any(|(l, _)| l == label)
    }
}
