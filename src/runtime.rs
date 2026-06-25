use std::collections::{HashMap, VecDeque};
use std::time::Duration;

use colored::Colorize;
use pubky_testnet::pubky::{Pubky, PubkyHttpClient};
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
    /// One signed-in session per user index, reused across writes so each user
    /// signs in at most once.
    sessions: social::SessionCache,
    state_tx: watch::Sender<DashboardState>,
    activity_tx: broadcast::Sender<TickEvent>,
    totals: ActivityTotals,
}

impl Runtime {
    pub async fn new(config_path: &str) -> anyhow::Result<Self> {
        let config = AntfarmConfig::load(config_path)?;

        // hs1 uses the same named database as other homeservers (pubky_antfarm_hs1).
        // TEST_PUBKY_CONNECTION_STRING is no longer required for dashboard storage stats.

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

        let mut db_labels: Vec<&str> = vec!["hs1"];
        db_labels.extend(config.homeservers.iter().map(|h| h.label.as_str()));

        println!("{}", "▸ Setting up databases".cyan().bold());
        db::setup_databases(config.postgres_url(), &db_labels).await?;

        let mut testnet = testnet::start(&config).await?;
        let homeservers = homeservers::start_all(&mut testnet, &config).await?;

        db::list_databases(config.postgres_url()).await?;

        println!("\n{}", "▸ Network".cyan().bold());
        println!("  {} {}", "Bootstrap:".white().bold(), web::BOOTSTRAP_ADDR);
        println!(
            "  {}  {}",
            "Pkarr relay:".white().bold(),
            web::PKARR_RELAY_URL.underline()
        );

        let client = PubkyHttpClient::builder()
            .testnet_with_host("127.0.0.1")
            .build()?;
        let sdk = Pubky::with_client(client);

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
            sessions: social::SessionCache::default(),
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
                let (user_pk, post_id) = social::signup_and_write(
                    &self.sdk,
                    index,
                    &hs.public_key,
                    keypair,
                    &self.sessions,
                )
                .await?;
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
            registry.islands = self.island_labels();
            self.publish_state(Some(&registry));
            let secs = self.config.simulator.interval_secs;
            let mut interval = tokio::time::interval(Duration::from_secs(secs));
            // We deliberately stop polling the timer while draining a tick's
            // ops, so skip (don't burst-fire) any ticks missed in the meantime.
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            let mut tick_num: u64 = 0;

            // A tick is expanded into a queue of individual ops; we execute one
            // per loop iteration so queued control commands (a dashboard click)
            // are serviced after at most one in-flight op instead of waiting for
            // the whole tick.
            let mut pending: VecDeque<simulator::SimOp> = VecDeque::new();
            let mut tick_acc = simulator::TickSummary::default();

            println!(
                "\n{} (every {}s)",
                "▸ Simulator running".cyan().bold(),
                secs
            );

            loop {
                tokio::select! {
                    biased;

                    // Control commands win over draining the next op.
                    Some(cmd) = ctrl_rx.recv() => {
                        self.handle_cmd(cmd, Some(&mut registry)).await;
                    }
                    _ = tokio::signal::ctrl_c() => {
                        println!("\n{} {}", "✓".green().bold(), "Shutting down...".green());
                        break;
                    }

                    // Plan a new tick only when idle, so ticks throttle under
                    // load and per-tick accounting stays clean.
                    _ = interval.tick(), if pending.is_empty() => {
                        tick_num += 1;
                        pending = simulator::plan_tick(&self.config.simulator);
                        tick_acc = simulator::TickSummary::default();
                        if pending.is_empty() {
                            self.finalize_tick(tick_num, tick_acc);
                        }
                    }

                    // Drain exactly one op. The arm is always ready while work
                    // remains; pop inside the body (never in the arm pattern, or
                    // select would consume an op even when this arm isn't taken).
                    _ = std::future::ready(()), if !pending.is_empty() => {
                        let op = pending.pop_front().unwrap();
                        let res = simulator::run_op(
                            &self.sdk,
                            &self.homeservers,
                            &mut registry,
                            &self.sessions,
                            &self.config.simulator,
                            op,
                        )
                        .await;
                        tick_acc.add(res);
                        // Publish per op so new users/edges appear live.
                        self.publish_state(Some(&registry));
                        if pending.is_empty() {
                            self.finalize_tick(tick_num, tick_acc);
                        }
                    }
                }
            }
        }

        Ok(())
    }

    /// Roll a completed tick's totals into the running counters, emit the
    /// activity event, and print the per-tick summary line.
    fn finalize_tick(&mut self, tick_num: u64, summary: simulator::TickSummary) {
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

        println!(
            "  {} {} {}  {} {}  {} {}  {} {}",
            format!("[tick {tick_num}]").dimmed(),
            format!("+{}", summary.users).yellow(),
            "users".dimmed(),
            format!("+{}", summary.posts).yellow(),
            "posts".dimmed(),
            format!("+{}", summary.tags).yellow(),
            "tags".dimmed(),
            format!("+{}", summary.follows).yellow(),
            "follows".dimmed(),
        );
    }

    async fn handle_cmd(
        &mut self,
        cmd: control::Cmd,
        mut registry: Option<&mut simulator::Registry>,
    ) {
        let reply = match cmd.action {
            control::Action::Create => match cmd.index {
                Some(i) => self.handle_create(i, cmd.island.unwrap_or(false)).await,
                None => Err(anyhow::anyhow!("create requires --index")),
            },
            control::Action::Island => match cmd.index {
                Some(i) => self.handle_island(i, cmd.island),
                None => Err(anyhow::anyhow!("island requires --index")),
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
            control::Action::Follow => match (cmd.from, cmd.target) {
                (Some(from), Some(target)) => {
                    self.handle_follow(from, target, registry.as_deref_mut())
                        .await
                }
                (None, _) => Err(anyhow::anyhow!("follow requires from user index")),
                (_, None) => Err(anyhow::anyhow!("follow requires target pubky")),
            },
            control::Action::Tag => match (cmd.from, cmd.target, cmd.label) {
                (Some(from), Some(target), Some(label)) => {
                    self.handle_tag(from, target, label, registry.as_deref_mut())
                        .await
                }
                (None, _, _) => Err(anyhow::anyhow!("tag requires from user index")),
                (_, None, _) => Err(anyhow::anyhow!("tag requires target key")),
                (_, _, None) => Err(anyhow::anyhow!("tag requires label")),
            },
            control::Action::Batch => match cmd.from {
                Some(from) => {
                    self.handle_batch(from, cmd.batch_posts, cmd.batch_tags, registry.as_deref_mut())
                        .await
                }
                None => Err(anyhow::anyhow!("batch requires user index")),
            },
        };
        // Keep the simulator's island cache aligned with homeserver state after
        // any command (create-island, toggle, stop/seed, etc.).
        if let Some(reg) = registry.as_deref_mut() {
            reg.islands = self.island_labels();
        }
        self.publish_state(registry.as_deref());
        let reply = reply.unwrap_or_else(|e| control::Reply::Err(format!("{e}")));
        let _ = cmd.reply.send(reply);
    }

    async fn handle_create(&mut self, index: u8, island: bool) -> anyhow::Result<control::Reply> {
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
            homeservers::create_dynamic(
                &mut self.testnet,
                self.config.postgres_url(),
                index,
                self.config.user_storage_quota_mb,
                island,
            )
                .await?;

        let message = if island {
            "homeserver created (dormant island — its users cannot be referenced)"
        } else {
            "homeserver created (dormant — use `seed` to start simulator activity)"
        };
        let reply = control::Reply::Ok {
            label: hs.label.clone(),
            public_key: Some(hs.public_key.z32()),
            http_url: Some(hs.http_url.clone()),
            message: message.into(),
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

    /// Toggle or set a homeserver's island (isolation) mode. Works on both
    /// active and dormant homeservers. When islanded, the simulator stops
    /// referencing (following/tagging) that homeserver's users.
    fn handle_island(
        &mut self,
        index: u8,
        value: Option<bool>,
    ) -> anyhow::Result<control::Reply> {
        let label = Self::label_for(index);

        let hs = self
            .homeservers
            .iter_mut()
            .find(|hs| hs.label == label)
            .or_else(|| self.dormant.get_mut(&index))
            .ok_or_else(|| {
                anyhow::anyhow!("{label} not found (neither active nor dormant) — create it first")
            })?;

        let island = value.unwrap_or(!hs.island);
        hs.island = island;

        let (glyph, state) = if island {
            ("🏝".to_string(), "island enabled — users can no longer be referenced")
        } else {
            ("🌐".to_string(), "island disabled — users can be referenced again")
        };
        println!("  {} {} {}", glyph, label.white().bold(), state.dimmed());

        Ok(control::Reply::Ok {
            label,
            public_key: None,
            http_url: None,
            message: state.into(),
        })
    }

    /// Labels of every homeserver (active or dormant) currently in island mode.
    fn island_labels(&self) -> std::collections::HashSet<String> {
        self.homeservers
            .iter()
            .chain(self.dormant.values())
            .filter(|hs| hs.island)
            .map(|hs| hs.label.clone())
            .collect()
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

        if let Some(reg) = registry.as_ref() {
            let max_users = self.config.simulator.max_users_per_homeserver;
            if reg.at_user_capacity(&label, max_users) {
                anyhow::bail!(
                    "{label} is at its user limit ({max_users}) — create events instead"
                );
            }
        }

        let (user_pk, storage) = social::signup(&self.sdk, keypair, &hs_pk).await?;
        self.sessions.insert(
            user_index,
            social::UserSession {
                public_key: user_pk.clone(),
                storage: storage.clone(),
            },
        );

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

    async fn handle_follow(
        &self,
        from: usize,
        target: String,
        mut registry: Option<&mut simulator::Registry>,
    ) -> anyhow::Result<control::Reply> {
        let followee_z32 = social::normalize_follow_target(&target)?;
        let session = self.sessions.get(&self.sdk, from).await?;

        if let Err(e) = social::create_follow(&session, &followee_z32).await {
            self.sessions.invalidate(from);
            return Err(e);
        }

        if let Some(reg) = registry.as_deref_mut() {
            if let Some(to) = reg.user_keys.index_for_z32(&followee_z32) {
                reg.follows.push((from, to));
            }
        }

        Ok(control::Reply::Ok {
            label: format!("user {from}"),
            public_key: None,
            http_url: None,
            message: format!("user {from} now follows {followee_z32}"),
        })
    }

    async fn handle_tag(
        &self,
        from: usize,
        target: String,
        label: String,
        _registry: Option<&mut simulator::Registry>,
    ) -> anyhow::Result<control::Reply> {
        let tag_label = label.trim();
        if tag_label.is_empty() {
            anyhow::bail!("tag label cannot be empty");
        }

        let target_uri = social::normalize_tag_target(&target)?;
        let session = self.sessions.get(&self.sdk, from).await?;

        if let Err(e) = social::create_tag(&session, &target_uri, tag_label).await {
            self.sessions.invalidate(from);
            return Err(e);
        }

        Ok(control::Reply::Ok {
            label: format!("user {from}"),
            public_key: None,
            http_url: None,
            message: format!("user {from} tagged {target_uri} as \"{tag_label}\""),
        })
    }

    async fn handle_batch(
        &mut self,
        from: usize,
        posts: u32,
        tags: u32,
        registry: Option<&mut simulator::Registry>,
    ) -> anyhow::Result<control::Reply> {
        const MAX_BATCH: u32 = 100;

        if posts == 0 && tags == 0 {
            anyhow::bail!("batch requires at least one event type with count > 0");
        }
        if posts > MAX_BATCH || tags > MAX_BATCH {
            anyhow::bail!("batch count cannot exceed {MAX_BATCH} per event type");
        }

        let Some(reg) = registry else {
            anyhow::bail!("batch requires the simulator (not available in listen-only mode)");
        };

        let summary = simulator::batch(&self.sdk, &self.sessions, reg, from, posts, tags).await;

        if summary.posts == 0 && summary.tags == 0 {
            anyhow::bail!("batch created no events — try again or add posts for tag targets");
        }

        self.totals.posts += summary.posts as u64;
        self.totals.tags += summary.tags as u64;

        let mut parts = Vec::new();
        if summary.posts > 0 {
            parts.push(format!("{} posts", summary.posts));
        }
        if summary.tags > 0 {
            parts.push(format!("{} tags", summary.tags));
        }

        Ok(control::Reply::Ok {
            label: format!("user {from}"),
            public_key: None,
            http_url: None,
            message: format!("user {from} created {}", parts.join(", ")),
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
