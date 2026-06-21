use std::collections::HashMap;
use std::time::Duration;

use colored::Colorize;
use pubky_testnet::pubky::Pubky;
use tokio::sync::{broadcast, watch};

use crate::config::AntfarmConfig;
use crate::homeservers::Homeserver;
use crate::web::{ActivityTotals, DashboardState, TickEvent};
use crate::{control, db, homeservers, simulator, social, testnet, web};

pub struct Runtime {
    testnet: pubky_testnet::StaticTestnet,
    homeservers: Vec<Homeserver>,
    dormant: HashMap<u8, Homeserver>,
    config: AntfarmConfig,
    sdk: Pubky,
    state_tx: watch::Sender<DashboardState>,
    activity_tx: broadcast::Sender<TickEvent>,
    totals: ActivityTotals,
}

impl Runtime {
    pub async fn new(config_path: &str) -> anyhow::Result<Self> {
        let config = AntfarmConfig::load(config_path)?;

        // hs1 is created by StaticTestnet, which reads its Postgres connection
        // from TEST_PUBKY_CONNECTION_STRING (not config.toml). If the user didn't
        // export it, fall back to the configured url so config.toml drives every
        // homeserver, including hs1. An explicit env var still takes precedence.
        if std::env::var("TEST_PUBKY_CONNECTION_STRING").is_err() {
            std::env::set_var("TEST_PUBKY_CONNECTION_STRING", config.postgres_url());
        }

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
        println!("  {} {}", "Bootstrap:".white().bold(), web::BOOTSTRAP_ADDR);
        println!(
            "  {}  {}",
            "Pkarr relay:".white().bold(),
            web::PKARR_RELAY_URL.underline()
        );

        let sdk = testnet.sdk()?;

        let dormant = HashMap::new();
        let totals = ActivityTotals::default();
        let (state_tx, _) = watch::channel(DashboardState::build(
            &homeservers,
            &dormant,
            &config,
            None,
            totals,
        ));
        let (activity_tx, _) = broadcast::channel(128);

        Ok(Self {
            testnet,
            homeservers,
            dormant,
            config,
            sdk,
            state_tx,
            activity_tx,
            totals,
        })
    }

    pub async fn run(mut self, listen_only: bool) -> anyhow::Result<()> {
        let (ctrl_tx, mut ctrl_rx) = tokio::sync::mpsc::channel::<control::Cmd>(8);
        tokio::spawn(control::server::listen(
            self.config.control_addr.clone(),
            ctrl_tx.clone(),
        ));

        if self.config.dashboard_enabled {
            tokio::spawn(web::server::serve(
                self.config.dashboard_addr.clone(),
                self.state_tx.subscribe(),
                self.activity_tx.clone(),
                ctrl_tx.clone(),
            ));
        }

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
            let mut initial_assignments = Vec::new();

            for hs in &self.homeservers {
                let (index, keypair) = user_keys.create_next();
                let (user_pk, post_id) =
                    social::signup_and_write(&self.sdk, index, &hs.public_key, keypair).await?;
                initial_posts.push((user_pk.clone(), post_id));
                initial_assignments.push((index, hs.label.clone()));
                initial_events.push((hs.label.clone(), user_pk, hs.public_key.clone()));
            }

            println!("\n{}", "▸ Reading events".cyan().bold());
            for (hs_name, user_pk, hs_pk) in &initial_events {
                social::read_events(&self.sdk, hs_name, user_pk, hs_pk).await;
            }

            let mut registry = simulator::Registry::new(user_keys, initial_posts);
            for (index, label) in initial_assignments {
                registry.assign(index, label);
            }
            self.publish_state(Some(&registry));
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
                        // Race the tick against Ctrl-C so shutdown can cancel an
                        // in-flight tick instead of waiting for it to finish.
                        tokio::select! {
                            summary = simulator::tick(
                                &self.sdk,
                                &self.homeservers,
                                &mut registry,
                                &self.config.simulator,
                                tick_num,
                            ) => {
                                self.totals.ticks += 1;
                                self.totals.users += summary.users as u64;
                                self.totals.posts += summary.posts as u64;
                                self.totals.tags += summary.tags as u64;
                                self.totals.follows += summary.follows as u64;

                                let _ = self.activity_tx.send(TickEvent {
                                    tick: tick_num,
                                    users: summary.users,
                                    posts: summary.posts,
                                    tags: summary.tags,
                                    follows: summary.follows,
                                });

                                self.publish_state(Some(&registry));
                            }
                            _ = tokio::signal::ctrl_c() => {
                                println!("\n{} {}", "✓".green().bold(), "Shutting down...".green());
                                break;
                            }
                        }
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
        mut registry: Option<&mut simulator::Registry>,
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
                    registry.as_deref_mut(),
                )
                .await
            }
        };
        self.publish_state(registry.as_deref());
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

        let hs =
            homeservers::create_dynamic(&mut self.testnet, self.config.postgres_url(), index)
                .await?;

        let reply = control::Reply::Ok {
            label: hs.label.clone(),
            public_key: Some(hs.public_key.z32()),
            http_url: Some(hs.http_url.clone()),
            message: "homeserver created (dormant — use `seed` to start simulator activity)"
                .into(),
        };

        self.dormant.insert(index, hs);

        Ok(reply)
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
            .position(|hs| hs.label == label)
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
            .find(|hs| hs.label == label)
            .map(|hs| hs.public_key.clone())
            .or_else(|| self.dormant.get(&hs_index).map(|hs| hs.public_key.clone()))
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
            reg.assign(user_index, label.clone());
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
        self.homeservers.iter().any(|hs| hs.label == label)
    }

    /// Push the current homeserver topology + users to dashboard subscribers.
    fn publish_state(&self, registry: Option<&simulator::Registry>) {
        let _ = self.state_tx.send(DashboardState::build(
            &self.homeservers,
            &self.dormant,
            &self.config,
            registry,
            self.totals,
        ));
    }
}
