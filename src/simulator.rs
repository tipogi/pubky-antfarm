use std::collections::{HashMap, HashSet, VecDeque};

use colored::Colorize;
use pubky_testnet::pubky::{PublicKey, Pubky};
use rand::RngExt as _;

use crate::config::SimulatorConfig;
use crate::homeservers::Homeserver;
use crate::social::{self, SessionCache};

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
}

impl Registry {
    pub fn new(
        user_keys: social::UserKeys,
        posts: Vec<(PublicKey, String)>,
    ) -> Self {
        Self {
            user_keys,
            posts,
            assignments: HashMap::new(),
            follows: Vec::new(),
            islands: HashSet::new(),
        }
    }

    /// Whether a user index lives on an island homeserver (cannot be referenced).
    fn is_island_user(&self, index: usize) -> bool {
        self.assignments
            .get(&index)
            .is_some_and(|label| self.islands.contains(label))
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

    let mut ops = VecDeque::with_capacity(
        (num_users + num_posts + num_tags + num_follows) as usize,
    );
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

/// Execute exactly one planned op and return its contribution to the tick
/// totals. Each op resolves its target(s) at call time so islanded/removed
/// users are skipped correctly even though planning happened earlier.
pub async fn run_op(
    sdk: &Pubky,
    homeservers: &[Homeserver],
    registry: &mut Registry,
    sessions: &SessionCache,
    sim: &SimulatorConfig,
    op: SimOp,
) -> TickSummary {
    let mut rng = rand::rng();
    match op {
        SimOp::User => run_user(sdk, homeservers, registry, sessions, sim, &mut rng).await,
        SimOp::Post => TickSummary {
            posts: create_one_post(sdk, sessions, registry).await,
            ..Default::default()
        },
        SimOp::Tag => TickSummary {
            tags: create_one_tag(sdk, sessions, registry, &mut rng).await,
            ..Default::default()
        },
        SimOp::Follow => TickSummary {
            follows: create_one_follow(sdk, sessions, registry).await,
            ..Default::default()
        },
    }
}

/// Sign up a new user on a random non-full homeserver. When every homeserver
/// is at capacity, the slot is redirected to a random event (mirroring the old
/// tick behavior).
async fn run_user<R: rand::RngExt>(
    sdk: &Pubky,
    homeservers: &[Homeserver],
    registry: &mut Registry,
    sessions: &SessionCache,
    sim: &SimulatorConfig,
    rng: &mut R,
) -> TickSummary {
    let max_users = sim.max_users_per_homeserver;
    let (hs_label, hs_pk) = match pick_homeserver(homeservers, registry, max_users, rng) {
        Some(hs) => (hs.label.clone(), hs.public_key.clone()),
        None => return run_redirected_event(sdk, sessions, registry, rng).await,
    };

    let (index, keypair) = registry.user_keys.create_next();
    match social::signup_and_write(sdk, index, &hs_pk, keypair, sessions).await {
        Ok((user_pk, post_id)) => {
            registry.assign(index, hs_label);
            registry.posts.push((user_pk, post_id));
            TickSummary {
                users: 1,
                ..Default::default()
            }
        }
        Err(e) => {
            println!("    {} user signup: {e}", "error".red());
            TickSummary::default()
        }
    }
}

/// Perform one random event in place of a user signup that could not be placed.
async fn run_redirected_event<R: rand::RngExt>(
    sdk: &Pubky,
    sessions: &SessionCache,
    registry: &mut Registry,
    rng: &mut R,
) -> TickSummary {
    match rng.random_range(0..3) {
        0 => TickSummary {
            posts: create_one_post(sdk, sessions, registry).await,
            ..Default::default()
        },
        1 => TickSummary {
            tags: create_one_tag(sdk, sessions, registry, rng).await,
            ..Default::default()
        },
        _ => TickSummary {
            follows: create_one_follow(sdk, sessions, registry).await,
            ..Default::default()
        },
    }
}

/// Create one follow between two random (referable) users. Returns 1 on success.
async fn create_one_follow(sdk: &Pubky, sessions: &SessionCache, registry: &mut Registry) -> u32 {
    let Some((follower_idx, _)) = registry.user_keys.random_user() else {
        return 0;
    };
    // The followee must be referable — island users cannot be followed.
    let Some((followee_idx, followee_pk)) = registry.random_referable_user() else {
        return 0;
    };
    if social::UserKeys::keypair_at(follower_idx).public_key() == followee_pk {
        return 0;
    }

    let session = match sessions.get(sdk, follower_idx).await {
        Ok(s) => s,
        Err(e) => {
            println!("    {} follow signin: {e}", "error".red());
            return 0;
        }
    };

    match social::create_follow(&session, &followee_pk.z32()).await {
        Ok(()) => {
            registry.follows.push((follower_idx, followee_idx));
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
    registry: &mut Registry,
    from: usize,
    num_posts: u32,
    num_tags: u32,
) -> TickSummary {
    let mut rng = rand::rng();
    let mut created_posts = 0u32;
    let mut created_tags = 0u32;

    for _ in 0..num_posts {
        created_posts += create_one_post_as(sdk, sessions, registry, from).await;
    }

    for _ in 0..num_tags {
        created_tags += create_one_tag_as(sdk, sessions, registry, from, &mut rng).await;
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

async fn create_one_post(sdk: &Pubky, sessions: &SessionCache, registry: &mut Registry) -> u32 {
    let Some((index, _)) = registry.user_keys.random_user() else {
        return 0;
    };
    create_one_post_as(sdk, sessions, registry, index).await
}

async fn create_one_post_as(
    sdk: &Pubky,
    sessions: &SessionCache,
    registry: &mut Registry,
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
            registry.posts.push((author_pk, post_id));
            1
        }
        Err(e) => {
            println!("    {} create post: {e}", "error".red());
            sessions.invalidate(from);
            0
        }
    }
}

async fn create_one_tag<R: rand::RngExt>(
    sdk: &Pubky,
    sessions: &SessionCache,
    registry: &mut Registry,
    rng: &mut R,
) -> u32 {
    let Some((index, _)) = registry.user_keys.random_user() else {
        return 0;
    };
    create_one_tag_as(sdk, sessions, registry, index, rng).await
}

async fn create_one_tag_as<R: rand::RngExt>(
    sdk: &Pubky,
    sessions: &SessionCache,
    registry: &mut Registry,
    from: usize,
    rng: &mut R,
) -> u32 {
    let tag_label = social::random_tag_label();

    let tag_user: bool = rng.random();
    // Targets must be referable — island users (and their posts) are off-limits.
    let target_uri = if tag_user {
        if let Some((_, target_pk)) = registry.random_referable_user() {
            format!("pubky://{}/pub/pubky.app/profile.json", target_pk.z32())
        } else {
            return 0;
        }
    } else if let Some((author_pk, post_id)) = registry.random_referable_post() {
        format!("pubky://{}/pub/pubky.app/posts/{}", author_pk.z32(), post_id)
    } else {
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

fn pick_homeserver<'a, R: rand::RngExt>(
    homeservers: &'a [Homeserver],
    registry: &Registry,
    max_users: u32,
    rng: &mut R,
) -> Option<&'a Homeserver> {
    let eligible: Vec<&Homeserver> = homeservers
        .iter()
        .filter(|hs| !registry.at_user_capacity(&hs.label, max_users))
        .collect();
    if eligible.is_empty() {
        return None;
    }
    let idx = rng.random_range(0..eligible.len());
    Some(eligible[idx])
}

