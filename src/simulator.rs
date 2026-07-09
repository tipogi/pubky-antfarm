use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Arc;

use colored::Colorize;
use futures_util::stream::{self, StreamExt};
use pubky_testnet::pubky::{Pubky, PublicKey};
use rand::RngExt as _;
use tokio::sync::{Notify, RwLock, Semaphore};

use crate::config::SimulatorConfig;
use crate::social::{self, SessionCache};

/// A handle to the runtime's shared mutable simulation state. Cloning is cheap
/// (an `Arc`); the lock is taken only to read inputs and to commit results,
/// never across a network `.await`.
pub type RegistryHandle = Arc<RwLock<Registry>>;

/// A point-in-time, cheap-to-clone view of an active homeserver, captured on the
/// runtime loop (which owns the topology) and passed into spawned data-plane
/// work so it never needs to lock the topology.
#[derive(Clone)]
pub struct HsSnapshot {
    pub label: String,
    pub public_key: PublicKey,
}

pub struct Registry {
    pub user_keys: social::UserKeys,
    pub posts: Vec<(PublicKey, String)>,
    /// Maps a user index to the homeserver label it signed up on.
    pub assignments: HashMap<usize, String>,
    /// Directed follow relationships as (follower index, followee index).
    /// Aggregated into homeserver-level edges for the network graph.
    pub follows: Vec<(usize, usize)>,
    /// Labels of homeservers in island mode. Users on these homeservers cannot
    /// be referenced (followed/tagged) by the simulator.
    pub islands: HashSet<String>,
    /// Labels of dormant (stopped) homeservers. Users on these homeservers are
    /// out of the simulator rotation and must not author new activity.
    pub dormant: HashSet<String>,
    /// Labels of homeservers whose HTTP process is stopped.
    pub down: HashSet<String>,
}

impl Registry {
    pub fn new(user_keys: social::UserKeys, posts: Vec<(PublicKey, String)>) -> Self {
        Self {
            user_keys,
            posts,
            assignments: HashMap::new(),
            follows: Vec::new(),
            islands: HashSet::new(),
            dormant: HashSet::new(),
            down: HashSet::new(),
        }
    }

    /// Whether a user index lives on a down homeserver (process stopped).
    fn is_down_user(&self, index: usize) -> bool {
        self.assignments
            .get(&index)
            .is_some_and(|label| self.down.contains(label))
    }

    /// Whether a user index lives on an island homeserver (cannot be referenced).
    fn is_island_user(&self, index: usize) -> bool {
        self.assignments
            .get(&index)
            .is_some_and(|label| self.islands.contains(label))
    }

    /// Whether a user index lives on a dormant (stopped) homeserver, which is
    /// out of the simulator rotation and must not author new activity.
    fn is_dormant_user(&self, index: usize) -> bool {
        self.assignments
            .get(&index)
            .is_some_and(|label| self.dormant.contains(label))
    }

    /// Pick a random user whose homeserver is in the active simulator rotation.
    fn random_active_user(&self) -> Option<(usize, PublicKey)> {
        if self.dormant.is_empty() && self.down.is_empty() {
            return self.user_keys.random_user();
        }
        let eligible: Vec<(usize, &PublicKey)> = self
            .user_keys
            .all()
            .filter(|(index, _)| !self.is_dormant_user(*index) && !self.is_down_user(*index))
            .collect();
        if eligible.is_empty() {
            return None;
        }
        let idx = rand::rng().random_range(0..eligible.len());
        let (index, pk) = eligible[idx];
        Some((index, pk.clone()))
    }

    /// Pick a random user that is allowed to be referenced (not on an island).
    fn random_referable_user(&self) -> Option<(usize, PublicKey)> {
        if self.islands.is_empty() {
            return self.user_keys.random_user();
        }
        let eligible: Vec<(usize, &PublicKey)> = self
            .user_keys
            .all()
            .filter(|(index, _)| !self.is_island_user(*index))
            .collect();
        if eligible.is_empty() {
            return None;
        }
        let idx = rand::rng().random_range(0..eligible.len());
        let (index, pk) = eligible[idx];
        Some((index, pk.clone()))
    }

    /// Pick a random post whose author is allowed to be referenced.
    fn random_referable_post(&self) -> Option<&(PublicKey, String)> {
        if self.islands.is_empty() {
            return self.random_post();
        }
        let eligible: Vec<&(PublicKey, String)> = self
            .posts
            .iter()
            .filter(|(author_pk, _)| {
                match self.user_keys.index_for_z32(&author_pk.z32()) {
                    Some(index) => !self.is_island_user(index),
                    // Unknown author (e.g. seeded before assignment) — allow.
                    None => true,
                }
            })
            .collect();
        if eligible.is_empty() {
            return None;
        }
        let idx = rand::rng().random_range(0..eligible.len());
        Some(eligible[idx])
    }

    /// Record which homeserver a user index lives on.
    pub fn assign(&mut self, index: usize, homeserver: String) {
        self.assignments.insert(index, homeserver);
    }

    /// User indices assigned to a homeserver label.
    pub fn user_indices_on(&self, label: &str) -> Vec<usize> {
        self.assignments
            .iter()
            .filter(|(_, hs)| hs.as_str() == label)
            .map(|(index, _)| *index)
            .collect()
    }

    /// Roll back a reserved-but-failed user signup (drops its slot + key).
    pub fn rollback_user(&mut self, index: usize) {
        self.assignments.remove(&index);
        self.user_keys.remove(index);
    }

    /// Choose a (follower, followee) pair for a follow, returning owned data so
    /// the caller can release the lock before doing network I/O. `None` when no
    /// valid, non-self, referable pair exists.
    pub fn pick_follow(&self) -> Option<(usize, usize, PublicKey)> {
        let (follower_idx, _) = self.random_active_user()?;
        let (followee_idx, followee_pk) = self.random_referable_user()?;
        if social::UserKeys::keypair_at(follower_idx).public_key() == followee_pk {
            return None;
        }
        Some((follower_idx, followee_idx, followee_pk))
    }

    /// Build a tag target URI (a random referable user's profile or post),
    /// returning an owned `String` so the lock can be released before I/O.
    pub fn pick_tag_target(&self) -> Option<String> {
        let tag_user: bool = rand::rng().random();
        if tag_user {
            let (_, target_pk) = self.random_referable_user()?;
            Some(format!(
                "pubky://{}/pub/pubky.app/profile.json",
                target_pk.z32()
            ))
        } else {
            let (author_pk, post_id) = self.random_referable_post()?;
            Some(format!(
                "pubky://{}/pub/pubky.app/posts/{}",
                author_pk.z32(),
                post_id
            ))
        }
    }

    pub fn user_count_on(&self, label: &str) -> usize {
        self.assignments
            .values()
            .filter(|assigned| assigned.as_str() == label)
            .count()
    }

    pub fn at_user_capacity(&self, label: &str, max_users: u32) -> bool {
        max_users > 0 && self.user_count_on(label) >= max_users as usize
    }

    fn random_post(&self) -> Option<&(PublicKey, String)> {
        if self.posts.is_empty() {
            return None;
        }
        let idx = rand::rng().random_range(0..self.posts.len());
        Some(&self.posts[idx])
    }
}

/// The number of each entity created during a single tick.
#[derive(Default, Clone, Copy)]
pub struct TickSummary {
    pub users: u32,
    pub posts: u32,
    pub tags: u32,
    pub follows: u32,
}

impl TickSummary {
    /// Fold another summary's counts into this one.
    pub fn add(&mut self, other: TickSummary) {
        self.users += other.users;
        self.posts += other.posts;
        self.tags += other.tags;
        self.follows += other.follows;
    }
}

/// A single unit of simulated activity. A tick is planned as a queue of these
/// so the runtime can execute them one at a time and service control commands
/// in between, rather than blocking on a whole tick.
#[derive(Clone, Copy)]
pub enum SimOp {
    User,
    Post,
    Tag,
    Follow,
}

/// Roll the per-tick counts and expand them into a queue of individual ops.
///
/// Pure (no I/O): it only decides *how much* activity this tick produces, in
/// the same order the old monolithic tick used (users, posts, tags, follows).
/// Concrete targets are chosen later, at execution time, in [`run_op`].
pub fn plan_tick(sim: &SimulatorConfig) -> VecDeque<SimOp> {
    let mut rng = rand::rng();
    let num_users = rng.random_range(sim.users_per_tick[0]..=sim.users_per_tick[1]);
    let num_posts = rng.random_range(sim.posts_per_tick[0]..=sim.posts_per_tick[1]);
    let num_tags = rng.random_range(sim.tags_per_tick[0]..=sim.tags_per_tick[1]);
    let num_follows = rng.random_range(sim.follows_per_tick[0]..=sim.follows_per_tick[1]);

    let mut ops =
        VecDeque::with_capacity((num_users + num_posts + num_tags + num_follows) as usize);
    for _ in 0..num_users {
        ops.push_back(SimOp::User);
    }
    for _ in 0..num_posts {
        ops.push_back(SimOp::Post);
    }
    for _ in 0..num_tags {
        ops.push_back(SimOp::Tag);
    }
    for _ in 0..num_follows {
        ops.push_back(SimOp::Follow);
    }
    ops
}

/// Run all of a tick's planned ops with bounded concurrency. The shared
/// registry is locked only in short read/commit bursts inside each op, so up to
/// `concurrency` network operations overlap. Returns the aggregated tick totals.
#[allow(clippy::too_many_arguments)]
pub async fn run_tick_ops(
    sdk: &Pubky,
    snapshot: &[HsSnapshot],
    registry: &RegistryHandle,
    sessions: &SessionCache,
    limiter: &Arc<Semaphore>,
    dirty: &Arc<Notify>,
    max_users: u32,
    concurrency: usize,
    ops: VecDeque<SimOp>,
) -> TickSummary {
    let results: Vec<TickSummary> = stream::iter(ops.into_iter())
        .map(|op| {
            run_op(
                sdk, snapshot, registry, sessions, limiter, dirty, max_users, op,
            )
        })
        .buffer_unordered(concurrency.max(1))
        .collect()
        .await;

    let mut acc = TickSummary::default();
    for r in results {
        acc.add(r);
    }
    acc
}

/// Execute exactly one planned op and return its contribution to the tick
/// totals. Holds a concurrency permit for the duration and signals `dirty` on
/// completion so the dashboard refreshes live. Each op resolves its target(s)
/// at call time so islanded/removed users are skipped correctly.
#[allow(clippy::too_many_arguments)]
pub async fn run_op(
    sdk: &Pubky,
    snapshot: &[HsSnapshot],
    registry: &RegistryHandle,
    sessions: &SessionCache,
    limiter: &Arc<Semaphore>,
    dirty: &Arc<Notify>,
    max_users: u32,
    op: SimOp,
) -> TickSummary {
    let _permit = limiter.acquire().await.expect("limiter never closed");
    let summary = match op {
        SimOp::User => run_user(sdk, snapshot, registry, sessions, max_users).await,
        SimOp::Post => TickSummary {
            posts: create_one_post(sdk, sessions, registry).await,
            ..Default::default()
        },
        SimOp::Tag => TickSummary {
            tags: create_one_tag(sdk, sessions, registry).await,
            ..Default::default()
        },
        SimOp::Follow => TickSummary {
            follows: create_one_follow(sdk, sessions, registry).await,
            ..Default::default()
        },
    };
    // Coalesced: many notifications collapse into a single publish.
    dirty.notify_one();
    summary
}

/// Sign up a new user on a random non-full homeserver. The slot is reserved
/// under the write lock (so concurrent signups don't overshoot capacity) before
/// the network signup; rolled back on failure. When every homeserver is at
/// capacity, the slot is redirected to a random event.
async fn run_user(
    sdk: &Pubky,
    snapshot: &[HsSnapshot],
    registry: &RegistryHandle,
    sessions: &SessionCache,
    max_users: u32,
) -> TickSummary {
    // Reserve a slot + key under the lock, then release before the network call.
    let reserved = {
        let mut reg = registry.write().await;
        match pick_homeserver(snapshot, &reg, max_users) {
            Some((label, hs_pk)) => {
                let (index, keypair) = reg.user_keys.create_next();
                reg.assign(index, label);
                Some((index, keypair, hs_pk))
            }
            None => None,
        }
    };

    let Some((index, keypair, hs_pk)) = reserved else {
        return run_redirected_event(sdk, sessions, registry).await;
    };

    match social::signup_and_write(sdk, index, &hs_pk, keypair, sessions).await {
        Ok((user_pk, post_id)) => {
            let mut reg = registry.write().await;
            reg.user_keys.register_at(index, user_pk.clone());
            reg.posts.push((user_pk, post_id));
            TickSummary {
                users: 1,
                ..Default::default()
            }
        }
        Err(e) => {
            println!("    {} user signup: {e}", "error".red());
            registry.write().await.rollback_user(index);
            TickSummary::default()
        }
    }
}

/// Perform one random event in place of a user signup that could not be placed.
async fn run_redirected_event(
    sdk: &Pubky,
    sessions: &SessionCache,
    registry: &RegistryHandle,
) -> TickSummary {
    let choice = rand::rng().random_range(0..3);
    match choice {
        0 => TickSummary {
            posts: create_one_post(sdk, sessions, registry).await,
            ..Default::default()
        },
        1 => TickSummary {
            tags: create_one_tag(sdk, sessions, registry).await,
            ..Default::default()
        },
        _ => TickSummary {
            follows: create_one_follow(sdk, sessions, registry).await,
            ..Default::default()
        },
    }
}

/// Create one follow between two random (referable) users. Returns 1 on success.
async fn create_one_follow(sdk: &Pubky, sessions: &SessionCache, registry: &RegistryHandle) -> u32 {
    let Some((follower_idx, followee_idx, followee_pk)) = ({ registry.read().await.pick_follow() })
    else {
        return 0;
    };

    let session = match sessions.get(sdk, follower_idx).await {
        Ok(s) => s,
        Err(e) => {
            println!("    {} follow signin: {e}", "error".red());
            return 0;
        }
    };

    match social::create_follow(&session, &followee_pk.z32()).await {
        Ok(()) => {
            registry
                .write()
                .await
                .follows
                .push((follower_idx, followee_idx));
            1
        }
        Err(e) => {
            println!("    {} create follow: {e}", "error".red());
            sessions.invalidate(follower_idx);
            0
        }
    }
}

/// Create posts and/or tags as a specific user (manual batch).
pub async fn batch(
    sdk: &Pubky,
    sessions: &SessionCache,
    registry: &RegistryHandle,
    from: usize,
    num_posts: u32,
    num_tags: u32,
) -> TickSummary {
    let mut created_posts = 0u32;
    let mut created_tags = 0u32;

    for _ in 0..num_posts {
        created_posts += create_one_post_as(sdk, sessions, registry, from).await;
    }

    for _ in 0..num_tags {
        created_tags += create_one_tag_as(sdk, sessions, registry, from).await;
    }

    if created_posts > 0 || created_tags > 0 {
        println!(
            "  {} user {from}  {} {}  {} {}",
            "[batch]".dimmed(),
            format!("+{created_posts}").yellow(),
            "posts".dimmed(),
            format!("+{created_tags}").yellow(),
            "tags".dimmed(),
        );
    }

    TickSummary {
        users: 0,
        posts: created_posts,
        tags: created_tags,
        follows: 0,
    }
}

async fn create_one_post(sdk: &Pubky, sessions: &SessionCache, registry: &RegistryHandle) -> u32 {
    let Some((index, _)) = ({ registry.read().await.random_active_user() }) else {
        return 0;
    };
    create_one_post_as(sdk, sessions, registry, index).await
}

async fn create_one_post_as(
    sdk: &Pubky,
    sessions: &SessionCache,
    registry: &RegistryHandle,
    from: usize,
) -> u32 {
    let content = social::random_content();
    let session = match sessions.get(sdk, from).await {
        Ok(s) => s,
        Err(e) => {
            println!("    {} post signin: {e}", "error".red());
            return 0;
        }
    };

    match social::create_post(&session, &content).await {
        Ok((author_pk, post_id)) => {
            registry.write().await.posts.push((author_pk, post_id));
            1
        }
        Err(e) => {
            println!("    {} create post: {e}", "error".red());
            sessions.invalidate(from);
            0
        }
    }
}

async fn create_one_tag(sdk: &Pubky, sessions: &SessionCache, registry: &RegistryHandle) -> u32 {
    let Some((index, _)) = ({ registry.read().await.random_active_user() }) else {
        return 0;
    };
    create_one_tag_as(sdk, sessions, registry, index).await
}

async fn create_one_tag_as(
    sdk: &Pubky,
    sessions: &SessionCache,
    registry: &RegistryHandle,
    from: usize,
) -> u32 {
    let tag_label = social::random_tag_label();

    // Targets must be referable — island users (and their posts) are off-limits.
    let Some(target_uri) = ({ registry.read().await.pick_tag_target() }) else {
        return 0;
    };

    let session = match sessions.get(sdk, from).await {
        Ok(s) => s,
        Err(e) => {
            println!("    {} tag signin: {e}", "error".red());
            return 0;
        }
    };

    match social::create_tag(&session, &target_uri, tag_label).await {
        Ok(()) => 1,
        Err(e) => {
            println!("    {} create tag: {e}", "error".red());
            sessions.invalidate(from);
            0
        }
    }
}

fn pick_homeserver(
    snapshot: &[HsSnapshot],
    registry: &Registry,
    max_users: u32,
) -> Option<(String, PublicKey)> {
    let eligible: Vec<&HsSnapshot> = snapshot
        .iter()
        .filter(|hs| !registry.at_user_capacity(&hs.label, max_users))
        .collect();
    if eligible.is_empty() {
        return None;
    }
    let idx = rand::rng().random_range(0..eligible.len());
    Some((
        eligible[idx].label.clone(),
        eligible[idx].public_key.clone(),
    ))
}
