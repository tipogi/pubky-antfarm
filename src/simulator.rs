use std::collections::{HashMap, HashSet};

use colored::Colorize;
use pubky_testnet::pubky::{PublicKey, Pubky};
use rand::RngExt as _;

use crate::config::SimulatorConfig;
use crate::homeservers::Homeserver;
use crate::social;

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
pub struct TickSummary {
    pub users: u32,
    pub posts: u32,
    pub tags: u32,
    pub follows: u32,
}

pub async fn tick(
    sdk: &Pubky,
    homeservers: &[Homeserver],
    registry: &mut Registry,
    sim: &SimulatorConfig,
    tick_num: u64,
) -> TickSummary {
    let mut rng = rand::rng();
    let num_users = rng.random_range(sim.users_per_tick[0]..=sim.users_per_tick[1]);
    let mut num_posts = rng.random_range(sim.posts_per_tick[0]..=sim.posts_per_tick[1]);
    let mut num_tags = rng.random_range(sim.tags_per_tick[0]..=sim.tags_per_tick[1]);
    let mut num_follows = rng.random_range(sim.follows_per_tick[0]..=sim.follows_per_tick[1]);
    let max_users = sim.max_users_per_homeserver;

    let mut created_users = 0u32;
    let mut created_posts = 0u32;
    let mut created_tags = 0u32;
    let mut created_follows = 0u32;

    for _ in 0..num_users {
        let Some(hs) = pick_homeserver(homeservers, registry, max_users, &mut rng) else {
            redirect_user_slot_to_events(&mut num_posts, &mut num_tags, &mut num_follows, &mut rng);
            continue;
        };
        let hs_label = hs.label.clone();
        let hs_pk = &hs.public_key;
        let (index, keypair) = registry.user_keys.create_next();

        match social::signup_and_write(sdk, index, hs_pk, keypair).await {
            Ok((user_pk, post_id)) => {
                registry.assign(index, hs_label);
                registry.posts.push((user_pk, post_id));
                created_users += 1;
            }
            Err(e) => {
                println!("    {} user signup: {e}", "error".red());
            }
        }
    }

    for _ in 0..num_posts {
        created_posts += create_one_post(sdk, registry).await;
    }

    for _ in 0..num_tags {
        created_tags += create_one_tag(sdk, registry, &mut rng).await;
    }

    for _ in 0..num_follows {
        let Some((follower_idx, _)) = registry.user_keys.random_user() else {
            continue;
        };
        // The followee must be referable — island users cannot be followed.
        let Some((followee_idx, followee_pk)) = registry.random_referable_user() else {
            continue;
        };
        let follower_keypair = social::UserKeys::keypair_at(follower_idx);
        if follower_keypair.public_key() == followee_pk {
            continue;
        }

        match social::create_follow(sdk, follower_keypair, &followee_pk.z32()).await {
            Ok(()) => {
                registry.follows.push((follower_idx, followee_idx));
                created_follows += 1;
            }
            Err(e) => {
                println!("    {} create follow: {e}", "error".red());
            }
        }
    }

    println!(
        "  {} {} {}  {} {}  {} {}  {} {}",
        format!("[tick {tick_num}]").dimmed(),
        format!("+{created_users}").yellow(),
        "users".dimmed(),
        format!("+{created_posts}").yellow(),
        "posts".dimmed(),
        format!("+{created_tags}").yellow(),
        "tags".dimmed(),
        format!("+{created_follows}").yellow(),
        "follows".dimmed(),
    );

    TickSummary {
        users: created_users,
        posts: created_posts,
        tags: created_tags,
        follows: created_follows,
    }
}

/// Create posts and/or tags as a specific user (manual batch).
pub async fn batch(
    sdk: &Pubky,
    registry: &mut Registry,
    from: usize,
    num_posts: u32,
    num_tags: u32,
) -> TickSummary {
    let mut rng = rand::rng();
    let mut created_posts = 0u32;
    let mut created_tags = 0u32;

    for _ in 0..num_posts {
        created_posts += create_one_post_as(sdk, registry, from).await;
    }

    for _ in 0..num_tags {
        created_tags += create_one_tag_as(sdk, registry, from, &mut rng).await;
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

async fn create_one_post(sdk: &Pubky, registry: &mut Registry) -> u32 {
    let Some((index, _)) = registry.user_keys.random_user() else {
        return 0;
    };
    create_one_post_as(sdk, registry, index).await
}

async fn create_one_post_as(sdk: &Pubky, registry: &mut Registry, from: usize) -> u32 {
    let keypair = social::UserKeys::keypair_at(from);
    let content = social::random_content();

    match social::create_post(sdk, keypair, &content).await {
        Ok((author_pk, post_id)) => {
            registry.posts.push((author_pk, post_id));
            1
        }
        Err(e) => {
            println!("    {} create post: {e}", "error".red());
            0
        }
    }
}

async fn create_one_tag<R: rand::RngExt>(sdk: &Pubky, registry: &mut Registry, rng: &mut R) -> u32 {
    let Some((index, _)) = registry.user_keys.random_user() else {
        return 0;
    };
    create_one_tag_as(sdk, registry, index, rng).await
}

async fn create_one_tag_as<R: rand::RngExt>(
    sdk: &Pubky,
    registry: &mut Registry,
    from: usize,
    rng: &mut R,
) -> u32 {

    let tag_label = social::random_tag_label();
    let keypair = social::UserKeys::keypair_at(from);

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

    match social::create_tag(sdk, keypair, &target_uri, tag_label).await {
        Ok(()) => 1,
        Err(e) => {
            println!("    {} create tag: {e}", "error".red());
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

fn redirect_user_slot_to_events<R: rand::RngExt>(
    num_posts: &mut u32,
    num_tags: &mut u32,
    num_follows: &mut u32,
    rng: &mut R,
) {
    match rng.random_range(0..3) {
        0 => *num_posts += 1,
        1 => *num_tags += 1,
        _ => *num_follows += 1,
    }
}
