use colored::Colorize;
use pubky_testnet::pubky::{PublicKey, Pubky};
use rand::RngExt as _;

use crate::config::SimulatorConfig;
use crate::social;

pub struct Registry {
    pub user_keys: social::UserKeys,
    pub posts: Vec<(PublicKey, String)>,
}

impl Registry {
    pub fn new(
        user_keys: social::UserKeys,
        posts: Vec<(PublicKey, String)>,
    ) -> Self {
        Self {
            user_keys,
            posts,
        }
    }

    fn random_post(&self) -> Option<&(PublicKey, String)> {
        if self.posts.is_empty() {
            return None;
        }
        let idx = rand::rng().random_range(0..self.posts.len());
        Some(&self.posts[idx])
    }
}

pub async fn tick(
    sdk: &Pubky,
    homeservers: &[(String, PublicKey)],
    registry: &mut Registry,
    sim: &SimulatorConfig,
    tick_num: u64,
) {
    let mut rng = rand::rng();
    let num_users = rng.random_range(sim.users_per_tick[0]..=sim.users_per_tick[1]);
    let num_posts = rng.random_range(sim.posts_per_tick[0]..=sim.posts_per_tick[1]);
    let num_tags = rng.random_range(sim.tags_per_tick[0]..=sim.tags_per_tick[1]);
    let num_follows = rng.random_range(sim.follows_per_tick[0]..=sim.follows_per_tick[1]);

    let mut created_users = 0u32;
    let mut created_posts = 0u32;
    let mut created_tags = 0u32;
    let mut created_follows = 0u32;

    for _ in 0..num_users {
        let hs_idx = rng.random_range(0..homeservers.len());
        let (_, hs_pk) = &homeservers[hs_idx];
        let (index, keypair) = registry.user_keys.create_next();

        match social::signup_and_write(sdk, index, hs_pk, keypair).await {
            Ok((user_pk, post_id)) => {
                registry.posts.push((user_pk, post_id));
                created_users += 1;
            }
            Err(e) => {
                println!("    {} user signup: {e}", "error".red());
            }
        }
    }

    for _ in 0..num_posts {
        let Some((index, _)) = registry.user_keys.random_user() else {
            continue;
        };
        let keypair = social::UserKeys::keypair_at(index);
        let content = social::random_content();

        match social::create_post(sdk, keypair, &content).await {
            Ok((author_pk, post_id)) => {
                registry.posts.push((author_pk, post_id));
                created_posts += 1;
            }
            Err(e) => {
                println!("    {} create post: {e}", "error".red());
            }
        }
    }

    for _ in 0..num_tags {
        let Some((index, _)) = registry.user_keys.random_user() else {
            continue;
        };
        let keypair = social::UserKeys::keypair_at(index);
        let tag_label = social::random_tag_label();

        let tag_user: bool = rng.random();
        let target_uri = if tag_user {
            if let Some((_, target_pk)) = registry.user_keys.random_user() {
                format!("pubky://{}/pub/pubky.app/profile.json", target_pk.z32())
            } else {
                continue;
            }
        } else if let Some((author_pk, post_id)) = registry.random_post() {
            format!("pubky://{}/pub/pubky.app/posts/{}", author_pk.z32(), post_id)
        } else {
            continue;
        };

        match social::create_tag(sdk, keypair, &target_uri, tag_label).await {
            Ok(()) => {
                created_tags += 1;
            }
            Err(e) => {
                println!("    {} create tag: {e}", "error".red());
            }
        }
    }

    for _ in 0..num_follows {
        let Some((follower_idx, _)) = registry.user_keys.random_user() else {
            continue;
        };
        let Some((_, followee_pk)) = registry.user_keys.random_user() else {
            continue;
        };
        let follower_keypair = social::UserKeys::keypair_at(follower_idx);
        if follower_keypair.public_key() == followee_pk {
            continue;
        }

        match social::create_follow(sdk, follower_keypair, &followee_pk.z32()).await {
            Ok(()) => {
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
}
