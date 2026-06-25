use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use colored::Colorize;
use pubky_testnet::pubky::{Pubky, PubkyHttpClient, PublicKey};
use tokio::sync::{broadcast, mpsc, watch, Notify, RwLock, Semaphore};

use crate::config::AntfarmConfig;
use crate::homeservers::Homeserver;
use crate::simulator::RegistryHandle;
use crate::web::{ActivityTotals, DashboardState, TickEvent};
use crate::{control, db, homeservers, simulator, social, testnet, web};

/// Cumulative simulator counters, shared across the runtime loop and every
/// spawned data-plane task. Atomics so any task can bump a count without taking
/// the registry lock.
#[derive(Default)]
pub struct Totals {
    ticks: AtomicU64,
    users: AtomicU64,
    posts: AtomicU64,
    tags: AtomicU64,
    follows: AtomicU64,
}

impl Totals {
    fn snapshot(&self) -> ActivityTotals {
        ActivityTotals {
            ticks: self.ticks.load(Ordering::Relaxed),
            users: self.users.load(Ordering::Relaxed),
            posts: self.posts.load(Ordering::Relaxed),
            tags: self.tags.load(Ordering::Relaxed),
            follows: self.follows.load(Ordering::Relaxed),
        }
    }

    fn add_summary(&self, s: &simulator::TickSummary) {
        self.users.fetch_add(s.users as u64, Ordering::Relaxed);
        self.posts.fetch_add(s.posts as u64, Ordering::Relaxed);
        self.tags.fetch_add(s.tags as u64, Ordering::Relaxed);
        self.follows.fetch_add(s.follows as u64, Ordering::Relaxed);
    }

    fn incr_ticks(&self) {
        self.ticks.fetch_add(1, Ordering::Relaxed);
    }

    fn add_posts(&self, n: u64) {
        self.posts.fetch_add(n, Ordering::Relaxed);
    }

    fn add_tags(&self, n: u64) {
        self.tags.fetch_add(n, Ordering::Relaxed);
    }
}

pub struct Runtime {
    testnet: pubky_testnet::StaticTestnet,
    homeservers: Vec<Homeserver>,
    dormant: HashMap<u8, Homeserver>,
    config: AntfarmConfig,
    sdk: Pubky,
    /// One signed-in session per user index, reused across writes so each user
    /// signs in at most once.
    sessions: social::SessionCache,
    /// Shared mutable simulation state. Locked only for brief read/commit
    /// bursts, never across a network `.await`.
    registry: RegistryHandle,
    /// Cumulative activity counters (atomics).
    totals: Arc<Totals>,
    /// Caps concurrent data-plane operations (tick ops + dashboard actions),
    /// which bounds in-flight network connections.
    limiter: Arc<Semaphore>,
    /// Signalled whenever shared state changes; the loop publishes a fresh
    /// dashboard snapshot (coalesced) in response.
    dirty: Arc<Notify>,
    state_tx: watch::Sender<DashboardState>,
    activity_tx: broadcast::Sender<TickEvent>,
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
        let registry: RegistryHandle = Arc::new(RwLock::new(simulator::Registry::new(
            social::UserKeys::new(config.user_index_start()),
            Vec::new(),
        )));
        let totals = Arc::new(Totals::default());
        let limiter = Arc::new(Semaphore::new(config.simulator.concurrency.max(1)));
        let dirty = Arc::new(Notify::new());

        let (state_tx, _) = watch::channel(DashboardState::build(
            &homeservers,
            &dormant,
            &config,
            None,
            ActivityTotals::default(),
        ));
        let (activity_tx, _) = broadcast::channel(128);

        Ok(Self {
            testnet,
            homeservers,
            dormant,
            config,
            sdk,
            sessions: social::SessionCache::default(),
            registry,
            totals,
            limiter,
            dirty,
            state_tx,
            activity_tx,
        })
    }

    pub async fn run(mut self, listen_only: bool) -> anyhow::Result<()> {
        let (ctrl_tx, mut ctrl_rx) = mpsc::channel::<control::Cmd>(8);
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

        let simulate = !listen_only;

        if simulate {
            println!("\n{}", "▸ Writing test data".cyan().bold());
            self.bootstrap_initial_users().await?;
            self.sync_islands().await;
            self.publish_state().await;
        } else {
            println!(
                "\n{}",
                "▸ Listen-only mode — no data will be written".cyan().bold()
            );
        }

        let secs = self.config.simulator.interval_secs;
        let mut interval = tokio::time::interval(Duration::from_secs(secs));
        // Don't burst-fire ticks missed while a previous tick was still running.
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let tick_running = Arc::new(AtomicBool::new(false));
        let mut tick_num: u64 = 0;

        if simulate {
            println!("\n{} (every {}s)", "▸ Simulator running".cyan().bold(), secs);
        }

        // Local clone so the publish arm doesn't borrow `self` inside select!.
        let dirty = self.dirty.clone();

        loop {
            tokio::select! {
                biased;

                // Control commands win over everything else.
                Some(cmd) = ctrl_rx.recv() => {
                    self.dispatch(cmd, simulate).await;
                }
                _ = tokio::signal::ctrl_c() => {
                    println!("\n{} {}", "✓".green().bold(), "Shutting down...".green());
                    break;
                }

                // Coalesced dashboard refresh triggered by data-plane progress.
                _ = dirty.notified() => {
                    self.publish_state().await;
                }

                // Fire a full tick concurrently; skip if the previous one is
                // still draining so ticks never overlap.
                _ = interval.tick(), if simulate => {
                    if !tick_running.swap(true, Ordering::SeqCst) {
                        tick_num += 1;
                        self.spawn_tick(tick_num, tick_running.clone());
                    }
                }
            }
        }

        Ok(())
    }

    /// Route a control command: topology changes run inline (they need `&mut
    /// self`); data-plane actions are spawned so they run concurrently.
    async fn dispatch(&mut self, cmd: control::Cmd, simulate: bool) {
        match cmd.action {
            control::Action::Create
            | control::Action::Seed
            | control::Action::Stop
            | control::Action::Island => {
                self.handle_control(cmd).await;
                self.sync_islands().await;
                self.publish_state().await;
            }
            control::Action::User
            | control::Action::Follow
            | control::Action::Tag
            | control::Action::Batch => {
                self.spawn_data_cmd(cmd, simulate);
            }
        }
    }

    async fn handle_control(&mut self, cmd: control::Cmd) {
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
            _ => unreachable!("handle_control only handles topology commands"),
        };
        let reply = reply.unwrap_or_else(|e| control::Reply::Err(format!("{e}")));
        let _ = cmd.reply.send(reply);
    }

    /// Spawn a data-plane command (user/follow/tag/batch) so it runs
    /// concurrently with the tick and other commands. The task owns the reply
    /// channel and answers the caller directly.
    fn spawn_data_cmd(&self, cmd: control::Cmd, simulate: bool) {
        let sdk = self.sdk.clone();
        let sessions = self.sessions.clone();
        let registry = self.registry.clone();
        let totals = self.totals.clone();
        let limiter = self.limiter.clone();
        let dirty = self.dirty.clone();
        let max_users = self.config.simulator.max_users_per_homeserver;

        // Resolve the target homeserver on the loop (it owns the topology).
        let user_hs = if matches!(cmd.action, control::Action::User) {
            Some(self.lookup_hs(cmd.hs.unwrap_or(0)))
        } else {
            None
        };

        tokio::spawn(async move {
            let reply: anyhow::Result<control::Reply> = match cmd.action {
                control::Action::User => match user_hs.expect("resolved for User") {
                    Some((label, hs_pk)) => {
                        run_user_cmd(
                            &sdk,
                            &sessions,
                            &registry,
                            &limiter,
                            label,
                            hs_pk,
                            cmd.index.map(|i| i as usize),
                            cmd.profile,
                            max_users,
                            simulate,
                        )
                        .await
                    }
                    None => Err(anyhow::anyhow!(
                        "homeserver hs{} not found (neither active nor dormant) — create it first",
                        cmd.hs.unwrap_or(0) + 1
                    )),
                },
                control::Action::Follow => match (cmd.from, cmd.target) {
                    (Some(from), Some(target)) => {
                        run_follow_cmd(&sdk, &sessions, &registry, &limiter, from, target).await
                    }
                    (None, _) => Err(anyhow::anyhow!("follow requires from user index")),
                    (_, None) => Err(anyhow::anyhow!("follow requires target pubky")),
                },
                control::Action::Tag => match (cmd.from, cmd.target, cmd.label) {
                    (Some(from), Some(target), Some(label)) => {
                        run_tag_cmd(&sdk, &sessions, &limiter, from, target, label).await
                    }
                    (None, _, _) => Err(anyhow::anyhow!("tag requires from user index")),
                    (_, None, _) => Err(anyhow::anyhow!("tag requires target key")),
                    (_, _, None) => Err(anyhow::anyhow!("tag requires label")),
                },
                control::Action::Batch => match cmd.from {
                    Some(from) => {
                        run_batch_cmd(
                            &sdk,
                            &sessions,
                            &registry,
                            &totals,
                            &limiter,
                            from,
                            cmd.batch_posts,
                            cmd.batch_tags,
                            simulate,
                        )
                        .await
                    }
                    None => Err(anyhow::anyhow!("batch requires user index")),
                },
                _ => unreachable!("spawn_data_cmd only handles data-plane commands"),
            };

            let reply = reply.unwrap_or_else(|e| control::Reply::Err(format!("{e}")));
            let _ = cmd.reply.send(reply);
            dirty.notify_one();
        });
    }

    /// Sign up the first user on each homeserver, populating the shared registry.
    async fn bootstrap_initial_users(&self) -> anyhow::Result<()> {
        let homeservers: Vec<(String, PublicKey)> = self
            .homeservers
            .iter()
            .map(|hs| (hs.label.clone(), hs.public_key.clone()))
            .collect();

        let mut initial_events = Vec::new();
        for (label, hs_pk) in &homeservers {
            let (index, keypair) = {
                let mut reg = self.registry.write().await;
                reg.user_keys.create_next()
            };
            let (user_pk, post_id) =
                social::signup_and_write(&self.sdk, index, hs_pk, keypair, &self.sessions).await?;
            {
                let mut reg = self.registry.write().await;
                reg.user_keys.register_at(index, user_pk.clone());
                reg.posts.push((user_pk.clone(), post_id));
                reg.assign(index, label.clone());
            }
            initial_events.push((label.clone(), user_pk, hs_pk.clone()));
        }

        println!("\n{}", "▸ Reading events".cyan().bold());
        for (hs_name, user_pk, hs_pk) in &initial_events {
            social::read_events(&self.sdk, hs_name, user_pk, hs_pk).await;
        }

        Ok(())
    }

    /// Spawn a full tick that runs its ops with bounded concurrency, then folds
    /// the result into the totals and emits the activity event.
    fn spawn_tick(&self, tick_num: u64, running: Arc<AtomicBool>) {
        let sdk = self.sdk.clone();
        let sessions = self.sessions.clone();
        let registry = self.registry.clone();
        let totals = self.totals.clone();
        let limiter = self.limiter.clone();
        let dirty = self.dirty.clone();
        let activity_tx = self.activity_tx.clone();
        let snapshot: Vec<simulator::HsSnapshot> = self
            .homeservers
            .iter()
            .map(|hs| simulator::HsSnapshot {
                label: hs.label.clone(),
                public_key: hs.public_key.clone(),
            })
            .collect();
        let max_users = self.config.simulator.max_users_per_homeserver;
        let concurrency = self.config.simulator.concurrency;
        let ops = simulator::plan_tick(&self.config.simulator);

        tokio::spawn(async move {
            let summary = if ops.is_empty() {
                simulator::TickSummary::default()
            } else {
                simulator::run_tick_ops(
                    &sdk,
                    &snapshot,
                    &registry,
                    &sessions,
                    &limiter,
                    &dirty,
                    max_users,
                    concurrency,
                    ops,
                )
                .await
            };

            totals.incr_ticks();
            totals.add_summary(&summary);

            let _ = activity_tx.send(TickEvent {
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

            dirty.notify_one();
            running.store(false, Ordering::SeqCst);
        });
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

        let hs = homeservers::create_dynamic(
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
    fn handle_island(&mut self, index: u8, value: Option<bool>) -> anyhow::Result<control::Reply> {
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

    /// Keep the simulator's island cache aligned with homeserver state.
    async fn sync_islands(&self) {
        let labels = self.island_labels();
        self.registry.write().await.islands = labels;
    }

    /// Resolve a homeserver index to its label + public key, searching active
    /// then dormant.
    fn lookup_hs(&self, hs_index: u8) -> Option<(String, PublicKey)> {
        let label = Self::label_for(hs_index);
        self.homeservers
            .iter()
            .find(|hs| hs.label == label)
            .map(|hs| (hs.label.clone(), hs.public_key.clone()))
            .or_else(|| {
                self.dormant
                    .get(&hs_index)
                    .map(|hs| (label.clone(), hs.public_key.clone()))
            })
    }

    fn label_for(index: u8) -> String {
        format!("hs{}", index + 1)
    }

    fn is_active(&self, label: &str) -> bool {
        self.homeservers.iter().any(|hs| hs.label == label)
    }

    /// Push the current homeserver topology + users to dashboard subscribers.
    async fn publish_state(&self) {
        let reg = self.registry.read().await;
        let _ = self.state_tx.send(DashboardState::build(
            &self.homeservers,
            &self.dormant,
            &self.config,
            Some(&reg),
            self.totals.snapshot(),
        ));
    }
}

/// Create (or recreate) a user on a specific homeserver. The slot is reserved
/// under the registry lock before the network signup so concurrent creates
/// don't overshoot capacity; the reservation is rolled back on failure.
#[allow(clippy::too_many_arguments)]
async fn run_user_cmd(
    sdk: &Pubky,
    sessions: &social::SessionCache,
    registry: &RegistryHandle,
    limiter: &Arc<Semaphore>,
    label: String,
    hs_pk: PublicKey,
    user_index: Option<usize>,
    profile: bool,
    max_users: u32,
    auto_assign: bool,
) -> anyhow::Result<control::Reply> {
    let _permit = limiter.acquire().await.expect("limiter never closed");

    let (index, keypair) = {
        let mut reg = registry.write().await;
        if reg.at_user_capacity(&label, max_users) {
            anyhow::bail!("{label} is at its user limit ({max_users}) — create events instead");
        }
        let (index, keypair) = match user_index {
            Some(idx) => {
                let kp = social::UserKeys::keypair_at(idx);
                reg.user_keys.register_at(idx, kp.public_key());
                (idx, kp)
            }
            None if auto_assign => reg.user_keys.create_next(),
            None => {
                anyhow::bail!("--index is required in listen-only mode (no registry to auto-assign)")
            }
        };
        // Reserve the slot under the lock; sign up below without holding it.
        reg.assign(index, label.clone());
        (index, keypair)
    };

    let (user_pk, storage) = match social::signup(sdk, keypair, &hs_pk).await {
        Ok(v) => v,
        Err(e) => {
            registry.write().await.rollback_user(index);
            return Err(e);
        }
    };

    sessions.insert(
        index,
        social::UserSession {
            public_key: user_pk.clone(),
            storage: storage.clone(),
        },
    );

    if profile {
        social::write_profile(&storage, index, &user_pk).await?;
    }

    {
        let mut reg = registry.write().await;
        reg.user_keys.register_at(index, user_pk.clone());
        reg.assign(index, label.clone());
    }

    let action = if profile { "with profile" } else { "signup only" };
    Ok(control::Reply::Ok {
        label,
        public_key: Some(user_pk.z32()),
        http_url: None,
        message: format!("user {index} created ({action})"),
    })
}

async fn run_follow_cmd(
    sdk: &Pubky,
    sessions: &social::SessionCache,
    registry: &RegistryHandle,
    limiter: &Arc<Semaphore>,
    from: usize,
    target: String,
) -> anyhow::Result<control::Reply> {
    let _permit = limiter.acquire().await.expect("limiter never closed");

    let followee_z32 = social::normalize_follow_target(&target)?;
    let session = sessions.get(sdk, from).await?;

    if let Err(e) = social::create_follow(&session, &followee_z32).await {
        sessions.invalidate(from);
        return Err(e);
    }

    {
        let mut reg = registry.write().await;
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

async fn run_tag_cmd(
    sdk: &Pubky,
    sessions: &social::SessionCache,
    limiter: &Arc<Semaphore>,
    from: usize,
    target: String,
    label: String,
) -> anyhow::Result<control::Reply> {
    let _permit = limiter.acquire().await.expect("limiter never closed");

    let tag_label = label.trim();
    if tag_label.is_empty() {
        anyhow::bail!("tag label cannot be empty");
    }

    let target_uri = social::normalize_tag_target(&target)?;
    let session = sessions.get(sdk, from).await?;

    if let Err(e) = social::create_tag(&session, &target_uri, tag_label).await {
        sessions.invalidate(from);
        return Err(e);
    }

    Ok(control::Reply::Ok {
        label: format!("user {from}"),
        public_key: None,
        http_url: None,
        message: format!("user {from} tagged {target_uri} as \"{tag_label}\""),
    })
}

#[allow(clippy::too_many_arguments)]
async fn run_batch_cmd(
    sdk: &Pubky,
    sessions: &social::SessionCache,
    registry: &RegistryHandle,
    totals: &Arc<Totals>,
    limiter: &Arc<Semaphore>,
    from: usize,
    posts: u32,
    tags: u32,
    simulate: bool,
) -> anyhow::Result<control::Reply> {
    const MAX_BATCH: u32 = 100;

    if posts == 0 && tags == 0 {
        anyhow::bail!("batch requires at least one event type with count > 0");
    }
    if posts > MAX_BATCH || tags > MAX_BATCH {
        anyhow::bail!("batch count cannot exceed {MAX_BATCH} per event type");
    }
    if !simulate {
        anyhow::bail!("batch requires the simulator (not available in listen-only mode)");
    }

    let _permit = limiter.acquire().await.expect("limiter never closed");

    let summary = simulator::batch(sdk, sessions, registry, from, posts, tags).await;

    if summary.posts == 0 && summary.tags == 0 {
        anyhow::bail!("batch created no events — try again or add posts for tag targets");
    }

    totals.add_posts(summary.posts as u64);
    totals.add_tags(summary.tags as u64);

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
